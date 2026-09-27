use crate::ports::{
    AgentProvider, Clock, EventStore, FocusOutcome, FocusTarget, Notice, Notifier, PortError,
    PortResult, ProcessProbe, RepoResolver, TranscriptReader, TranscriptSummary, ViewPublisher,
    WindowNavigator,
};
use crate::view::{self, WarRoomView};
use awr_domain::{
    Attention, AttentionChange, SessionContext, SessionEvent, SessionEventKind, SessionId,
    SessionStatus, TerminalHost, Timestamp, WarRoom,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

/// Cuánto historial se reconstruye al arrancar.
const RESTORE_WINDOW_MS: i64 = 3 * 24 * 60 * 60 * 1000;

/// Señal cruda de un agente, ya separada del transporte.
#[derive(Debug, Clone)]
pub struct IncomingSignal {
    pub provider: String,
    pub received_at: Option<Timestamp>,
    pub host: TerminalHost,
    pub payload: serde_json::Value,
}

/// Todo lo externo que necesita el servicio.
pub struct Ports {
    pub providers: Vec<Arc<dyn AgentProvider>>,
    pub resolver: Arc<dyn RepoResolver>,
    pub store: Arc<dyn EventStore>,
    pub clock: Arc<dyn Clock>,
    pub probe: Arc<dyn ProcessProbe>,
    pub notifier: Arc<dyn Notifier>,
    pub publisher: Arc<dyn ViewPublisher>,
    pub transcripts: Arc<dyn TranscriptReader>,
    pub navigator: Arc<dyn WindowNavigator>,
}

pub struct WarRoomService {
    room: Mutex<WarRoom>,
    /// Enriquecimiento derivado del transcript; no es estado de dominio y no se persiste.
    summaries: Mutex<HashMap<SessionId, TranscriptSummary>>,
    ports: Ports,
}

impl WarRoomService {
    pub fn new(ports: Ports) -> Self {
        Self { room: Mutex::new(WarRoom::new()), summaries: Mutex::default(), ports }
    }

    /// Reconstruye el estado desde el almacén sin avisar de nada. Devuelve los eventos aplicados.
    pub fn restore(&self) -> PortResult<usize> {
        let since = Timestamp(self.ports.clock.now().0 - RESTORE_WINDOW_MS);
        let events = self.ports.store.load_since(since)?;
        let count = events.len();
        let ids: Vec<SessionId> = {
            let mut room = self.room();
            for event in events {
                room.apply(event);
            }
            room.sessions().map(|s| s.id.clone()).collect()
        };
        for id in &ids {
            self.refresh_summary(id);
        }
        self.publish();
        Ok(count)
    }

    pub fn ingest(&self, signal: IncomingSignal) -> PortResult<()> {
        let provider = self
            .ports
            .providers
            .iter()
            .find(|p| p.wire_name() == signal.provider)
            .ok_or_else(|| PortError::Failed(format!("proveedor desconocido: {}", signal.provider)))?;
        let Some(translated) = provider.translate(&signal.payload)? else {
            return Ok(());
        };

        let workspace = self.ports.resolver.resolve(&translated.cwd);
        self.commit(SessionEvent {
            session: translated.session,
            at: signal.received_at.unwrap_or_else(|| self.ports.clock.now()),
            context: Some(SessionContext {
                provider: provider.kind(),
                workspace,
                host: signal.host,
                transcript_path: translated.transcript_path,
            }),
            kind: translated.kind,
        })
    }

    pub fn mark_seen(&self, id: SessionId) -> PortResult<()> {
        self.intent(id, SessionEventKind::Seen)
    }

    /// Marca como revisadas todas las sesiones terminadas.
    pub fn mark_all_seen(&self) -> PortResult<()> {
        let finished: Vec<SessionId> = self
            .room()
            .sessions()
            .filter(|s| s.attention() == Attention::Finished)
            .map(|s| s.id.clone())
            .collect();
        for id in finished {
            self.mark_seen(id)?;
        }
        Ok(())
    }

    pub fn archive(&self, id: SessionId) -> PortResult<()> {
        self.intent(id, SessionEventKind::Archived)
    }

    pub fn unarchive(&self, id: SessionId) -> PortResult<()> {
        self.intent(id, SessionEventKind::Unarchived)
    }

    pub fn mute(&self, id: SessionId) -> PortResult<()> {
        self.intent(id, SessionEventKind::Muted)
    }

    pub fn unmute(&self, id: SessionId) -> PortResult<()> {
        self.intent(id, SessionEventKind::Unmuted)
    }

    /// Salta a la ventana (y pane) de la sesión. Ir a una sesión terminada es revisarla.
    pub fn focus(&self, id: SessionId) -> PortResult<FocusOutcome> {
        let (target, finished) = {
            let room = self.room();
            let session = room
                .get(&id)
                .ok_or_else(|| PortError::Failed(format!("sesión desconocida: {id}")))?;
            if !session.is_alive() {
                return Ok(FocusOutcome::Unreachable { reason: "la sesión está cerrada".into() });
            }
            let mut hints = vec![];
            if let Some(title) = self.summaries().get(&id).and_then(|s| s.title.clone()) {
                hints.push(title);
            }
            hints.push(folder_name(&session.workspace.worktree_path));
            hints.push(session.workspace.repo_name.clone());
            let target = FocusTarget { host: session.host.clone(), caption_hints: hints };
            (target, session.attention() == Attention::Finished)
        };

        let outcome = self.ports.navigator.focus(&target)?;
        if finished && matches!(outcome, FocusOutcome::Focused { .. }) {
            self.mark_seen(id)?;
        }
        Ok(outcome)
    }

    /// Mantenimiento periódico: cierra sesiones cuyo proceso murió y refresca los transcripts de
    /// las que están en marcha.
    pub fn tick(&self) -> PortResult<()> {
        let now = self.ports.clock.now();
        let (lost, active) = {
            let room = self.room();
            let lost = room.detect_lost(|pid| self.ports.probe.is_alive(pid), now);
            let active: Vec<SessionId> = room
                .sessions()
                .filter(|s| matches!(s.status, SessionStatus::Working { .. } | SessionStatus::Compacting))
                .map(|s| s.id.clone())
                .collect();
            (lost, active)
        };
        for event in lost {
            self.commit(event)?;
        }
        let mut changed = false;
        for id in &active {
            changed |= self.refresh_summary(id);
        }
        if changed {
            self.publish();
        }
        Ok(())
    }

    pub fn view(&self) -> WarRoomView {
        view::project(&self.room(), &self.summaries())
    }

    fn intent(&self, id: SessionId, kind: SessionEventKind) -> PortResult<()> {
        let at = self.ports.clock.now();
        self.commit(SessionEvent { session: id, at, context: None, kind })
    }

    fn commit(&self, event: SessionEvent) -> PortResult<()> {
        let persisted = event.clone();
        let id = event.session.clone();
        let from_agent = event.context.is_some();
        let change = {
            let mut room = self.room();
            let Some(change) = room.apply(event) else {
                return Ok(());
            };
            change
        };

        // El estado en memoria manda aunque falle la persistencia: la UI no debe mentir.
        let stored = self.ports.store.append(&persisted);
        if from_agent {
            self.refresh_summary(&id);
        }
        self.publish();
        if change.deserves_notice()
            && let Some(notice) = self.notice_for(&change)
        {
            self.ports.notifier.notify(&notice);
        }
        stored
    }

    /// Relee el transcript de una sesión. Devuelve si cambió algo visible.
    fn refresh_summary(&self, id: &SessionId) -> bool {
        let source = self.room().get(id).and_then(|s| {
            let path = s.transcript_path.clone()?;
            Some((path, s.subagents.keys().cloned().collect::<Vec<_>>()))
        });
        let Some((path, subagents)) = source else { return false };
        let Some(summary) = self.ports.transcripts.read(&path, &subagents) else { return false };
        self.summaries().insert(id.clone(), summary.clone()) != Some(summary)
    }

    fn publish(&self) {
        let view = self.view();
        self.ports.publisher.publish(&view);
    }

    fn notice_for(&self, change: &AttentionChange) -> Option<Notice> {
        let room = self.room();
        let session = room.get(&change.session)?;
        let place = match &session.workspace.branch {
            Some(branch) => format!("{} · {branch}", session.workspace.repo_name),
            None => session.workspace.repo_name.clone(),
        };
        let summary = self.summaries().get(&change.session).cloned().unwrap_or_default();
        let (title, fallback) = match change.to {
            Attention::NeedsYou => (format!("{place} te necesita"), "Está esperando tu decisión"),
            Attention::Finished => (format!("{place} ha terminado"), "Te toca revisar"),
            _ => return None,
        };
        let body = summary
            .title
            .or(summary.last_reply.map(|r| truncate(&r, 140)))
            .unwrap_or_else(|| fallback.to_string());
        Some(Notice { session: change.session.clone(), attention: change.to, title, body })
    }

    fn room(&self) -> MutexGuard<'_, WarRoom> {
        self.room.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn summaries(&self) -> MutexGuard<'_, HashMap<SessionId, TranscriptSummary>> {
        self.summaries.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn folder_name(path: &str) -> String {
    path.rsplit('/').find(|p| !p.is_empty()).unwrap_or(path).to_string()
}

fn truncate(text: &str, max: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        text
    } else {
        format!("{}…", text.chars().take(max - 1).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::Translated;
    use crate::view::AttentionView;
    use awr_domain::{ProviderKind, RepoId, WaitReason, Workspace};
    use std::sync::atomic::{AtomicI64, Ordering};

    struct FakeProvider;
    impl AgentProvider for FakeProvider {
        fn kind(&self) -> ProviderKind {
            ProviderKind::Claude
        }
        fn wire_name(&self) -> &'static str {
            "fake"
        }
        fn translate(&self, payload: &serde_json::Value) -> PortResult<Option<Translated>> {
            let kind = match payload["e"].as_str().unwrap() {
                "prompt" => SessionEventKind::PromptSubmitted,
                "stop" => SessionEventKind::TurnEnded,
                "ask" => SessionEventKind::AwaitingYou { reason: WaitReason::Permission, tool: None },
                _ => return Ok(None),
            };
            Ok(Some(Translated {
                session: SessionId(payload["s"].as_str().unwrap().into()),
                cwd: "/code/app".into(),
                transcript_path: Some("/t.jsonl".into()),
                kind,
            }))
        }
    }

    struct FixedResolver;
    impl RepoResolver for FixedResolver {
        fn resolve(&self, cwd: &str) -> Workspace {
            Workspace {
                repo: RepoId(format!("{cwd}/.git")),
                repo_name: "app".into(),
                worktree_path: cwd.into(),
                branch: Some("main".into()),
                is_linked_worktree: false,
            }
        }
    }

    #[derive(Default)]
    struct MemoryStore(Mutex<Vec<SessionEvent>>);
    impl EventStore for MemoryStore {
        fn append(&self, event: &SessionEvent) -> PortResult<()> {
            self.0.lock().unwrap().push(event.clone());
            Ok(())
        }
        fn load_since(&self, since: Timestamp) -> PortResult<Vec<SessionEvent>> {
            Ok(self.0.lock().unwrap().iter().filter(|e| e.at >= since).cloned().collect())
        }
    }

    struct TickClock(AtomicI64);
    impl Clock for TickClock {
        fn now(&self) -> Timestamp {
            Timestamp(self.0.fetch_add(1, Ordering::SeqCst))
        }
    }

    struct Probe(bool);
    impl ProcessProbe for Probe {
        fn is_alive(&self, _: u32) -> bool {
            self.0
        }
    }

    struct FakeTranscripts(Mutex<TranscriptSummary>);
    impl TranscriptReader for FakeTranscripts {
        fn read(&self, _: &str, _: &[String]) -> Option<TranscriptSummary> {
            Some(self.0.lock().unwrap().clone())
        }
    }

    #[derive(Default)]
    struct Recorder {
        notices: Mutex<Vec<Notice>>,
        views: Mutex<Vec<WarRoomView>>,
        focused: Mutex<Vec<FocusTarget>>,
    }
    impl Notifier for Recorder {
        fn notify(&self, notice: &Notice) {
            self.notices.lock().unwrap().push(notice.clone());
        }
    }
    impl ViewPublisher for Recorder {
        fn publish(&self, view: &WarRoomView) {
            self.views.lock().unwrap().push(view.clone());
        }
    }
    impl WindowNavigator for Recorder {
        fn focus(&self, target: &FocusTarget) -> PortResult<FocusOutcome> {
            self.focused.lock().unwrap().push(target.clone());
            Ok(FocusOutcome::Focused { via: "test".into() })
        }
    }

    struct Harness {
        svc: WarRoomService,
        store: Arc<MemoryStore>,
        rec: Arc<Recorder>,
        transcript: Arc<FakeTranscripts>,
    }

    fn harness_with(store: Arc<MemoryStore>, alive: bool) -> Harness {
        let rec = Arc::new(Recorder::default());
        let transcript = Arc::new(FakeTranscripts(Mutex::default()));
        let svc = WarRoomService::new(Ports {
            providers: vec![Arc::new(FakeProvider)],
            resolver: Arc::new(FixedResolver),
            store: store.clone(),
            clock: Arc::new(TickClock(AtomicI64::new(1_000_000_000_000))),
            probe: Arc::new(Probe(alive)),
            notifier: rec.clone(),
            publisher: rec.clone(),
            transcripts: transcript.clone(),
            navigator: rec.clone(),
        });
        Harness { svc, store, rec, transcript }
    }

    fn harness() -> Harness {
        harness_with(Arc::default(), true)
    }

    fn signal(s: &str, e: &str) -> IncomingSignal {
        IncomingSignal {
            provider: "fake".into(),
            received_at: None,
            host: TerminalHost { agent_pid: Some(7), ..Default::default() },
            payload: serde_json::json!({ "s": s, "e": e }),
        }
    }

    fn id(s: &str) -> SessionId {
        SessionId(s.into())
    }

    #[test]
    fn finishing_a_turn_notifies_with_the_session_title() {
        let h = harness();
        h.transcript.0.lock().unwrap().title = Some("Arreglar el login".into());
        h.svc.ingest(signal("a", "prompt")).unwrap();
        h.svc.ingest(signal("a", "stop")).unwrap();

        let notices = h.rec.notices.lock().unwrap();
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "app · main ha terminado");
        assert_eq!(notices[0].body, "Arreglar el login");
        let view = h.rec.views.lock().unwrap().last().unwrap().clone();
        assert_eq!(view.aggregate, AttentionView::Finished);
        assert_eq!(view.rooms[0].sessions[0].title.as_deref(), Some("Arreglar el login"));
    }

    #[test]
    fn irrelevant_hooks_change_nothing() {
        let h = harness();
        h.svc.ingest(signal("a", "whatever")).unwrap();
        assert!(h.store.0.lock().unwrap().is_empty());
        assert!(h.rec.views.lock().unwrap().is_empty());
    }

    #[test]
    fn restore_rebuilds_state_including_user_intents_without_notifying() {
        let store = Arc::new(MemoryStore::default());
        let first = harness_with(store.clone(), true);
        first.svc.ingest(signal("a", "prompt")).unwrap();
        first.svc.ingest(signal("a", "ask")).unwrap();
        first.svc.archive(id("a")).unwrap();

        let second = harness_with(store, true);
        assert_eq!(second.svc.restore().unwrap(), 3);
        assert!(second.rec.notices.lock().unwrap().is_empty());

        let view = second.svc.view();
        assert!(view.rooms[0].sessions[0].archived);
        assert_eq!(view.aggregate, AttentionView::Offline, "archivada no cuenta");
    }

    #[test]
    fn intents_on_unknown_sessions_are_not_persisted() {
        let h = harness();
        h.svc.mute(id("ghost")).unwrap();
        assert!(h.store.0.lock().unwrap().is_empty());
    }

    #[test]
    fn tick_closes_sessions_whose_process_died() {
        let h = harness_with(Arc::default(), false);
        h.svc.ingest(signal("a", "prompt")).unwrap();
        h.svc.tick().unwrap();
        let view = h.svc.view();
        assert_eq!(view.rooms[0].sessions[0].attention, AttentionView::Offline);
        assert!(!view.rooms[0].sessions[0].alive);
    }

    #[test]
    fn tick_republishes_only_when_the_transcript_of_a_working_session_changed() {
        let h = harness();
        h.svc.ingest(signal("a", "prompt")).unwrap();
        let before = h.rec.views.lock().unwrap().len();

        h.svc.tick().unwrap();
        assert_eq!(h.rec.views.lock().unwrap().len(), before);

        h.transcript.0.lock().unwrap().last_reply = Some("Leyendo el código".into());
        h.svc.tick().unwrap();
        assert_eq!(h.rec.views.lock().unwrap().len(), before + 1);
    }

    #[test]
    fn going_to_a_finished_session_reviews_it_and_hints_the_window() {
        let h = harness();
        h.svc.ingest(signal("a", "prompt")).unwrap();
        h.svc.ingest(signal("a", "stop")).unwrap();

        let outcome = h.svc.focus(id("a")).unwrap();
        assert!(matches!(outcome, FocusOutcome::Focused { .. }));
        assert_eq!(h.svc.view().rooms[0].sessions[0].attention, AttentionView::Idle);
        let focused = h.rec.focused.lock().unwrap();
        assert_eq!(focused[0].caption_hints, vec!["app".to_string(), "app".to_string()]);
        assert_eq!(focused[0].host.agent_pid, Some(7));
    }

    #[test]
    fn mark_all_seen_clears_every_finished_screen() {
        let h = harness();
        for s in ["a", "b"] {
            h.svc.ingest(signal(s, "prompt")).unwrap();
            h.svc.ingest(signal(s, "stop")).unwrap();
        }
        h.svc.mark_all_seen().unwrap();
        assert_eq!(h.svc.view().aggregate, AttentionView::Idle);
    }

    #[test]
    fn truncate_collapses_whitespace_and_cuts_on_chars() {
        assert_eq!(truncate("hola\n\n  mundo", 50), "hola mundo");
        assert_eq!(truncate("ñññññ", 3), "ññ…");
    }
}
