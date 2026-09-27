use crate::ports::{
    AgentProvider, Clock, EventStore, Notice, Notifier, PortError, PortResult, ProcessProbe,
    RepoResolver, ViewPublisher,
};
use crate::view::{self, WarRoomView};
use awr_domain::{
    Attention, AttentionChange, SessionContext, SessionEvent, SessionEventKind, SessionId,
    TerminalHost, Timestamp, WarRoom,
};
use std::sync::{Arc, Mutex};

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

pub struct WarRoomService {
    room: Mutex<WarRoom>,
    providers: Vec<Arc<dyn AgentProvider>>,
    resolver: Arc<dyn RepoResolver>,
    store: Arc<dyn EventStore>,
    clock: Arc<dyn Clock>,
    probe: Arc<dyn ProcessProbe>,
    notifier: Arc<dyn Notifier>,
    publisher: Arc<dyn ViewPublisher>,
}

impl WarRoomService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        providers: Vec<Arc<dyn AgentProvider>>,
        resolver: Arc<dyn RepoResolver>,
        store: Arc<dyn EventStore>,
        clock: Arc<dyn Clock>,
        probe: Arc<dyn ProcessProbe>,
        notifier: Arc<dyn Notifier>,
        publisher: Arc<dyn ViewPublisher>,
    ) -> Self {
        Self {
            room: Mutex::new(WarRoom::new()),
            providers,
            resolver,
            store,
            clock,
            probe,
            notifier,
            publisher,
        }
    }

    /// Reconstruye el estado desde el almacén sin avisar de nada. Devuelve los eventos aplicados.
    pub fn restore(&self) -> PortResult<usize> {
        let since = Timestamp(self.clock.now().0 - RESTORE_WINDOW_MS);
        let events = self.store.load_since(since)?;
        let count = events.len();
        let view = {
            let mut room = self.lock();
            for event in events {
                room.apply(event);
            }
            view::project(&room)
        };
        self.publisher.publish(&view);
        Ok(count)
    }

    pub fn ingest(&self, signal: IncomingSignal) -> PortResult<()> {
        let provider = self
            .providers
            .iter()
            .find(|p| p.wire_name() == signal.provider)
            .ok_or_else(|| PortError::Failed(format!("proveedor desconocido: {}", signal.provider)))?;
        let Some(translated) = provider.translate(&signal.payload)? else {
            return Ok(());
        };

        let workspace = self.resolver.resolve(&translated.cwd);
        self.commit(SessionEvent {
            session: translated.session,
            at: signal.received_at.unwrap_or_else(|| self.clock.now()),
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

    /// Marca como cerradas las sesiones cuyo proceso ha desaparecido sin `SessionEnd`.
    pub fn sweep_lost(&self) -> PortResult<()> {
        let now = self.clock.now();
        let lost = self.lock().detect_lost(|pid| self.probe.is_alive(pid), now);
        for event in lost {
            self.commit(event)?;
        }
        Ok(())
    }

    pub fn view(&self) -> WarRoomView {
        view::project(&self.lock())
    }

    fn intent(&self, id: SessionId, kind: SessionEventKind) -> PortResult<()> {
        let at = self.clock.now();
        self.commit(SessionEvent { session: id, at, context: None, kind })
    }

    fn commit(&self, event: SessionEvent) -> PortResult<()> {
        let persisted = event.clone();
        let (view, notice) = {
            let mut room = self.lock();
            let Some(change) = room.apply(event) else {
                return Ok(());
            };
            let notice = change.deserves_notice().then(|| notice_for(&room, &change)).flatten();
            (view::project(&room), notice)
        };

        // El estado en memoria manda aunque falle la persistencia: la UI no debe mentir.
        let stored = self.store.append(&persisted);
        self.publisher.publish(&view);
        if let Some(notice) = notice {
            self.notifier.notify(&notice);
        }
        stored
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, WarRoom> {
        self.room.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn notice_for(room: &WarRoom, change: &AttentionChange) -> Option<Notice> {
    let session = room.get(&change.session)?;
    let place = match &session.workspace.branch {
        Some(branch) => format!("{} · {branch}", session.workspace.repo_name),
        None => session.workspace.repo_name.clone(),
    };
    let (title, body) = match change.to {
        Attention::NeedsYou => (format!("{place} te necesita"), "Está esperando tu decisión".to_string()),
        Attention::Finished => (format!("{place} ha terminado"), "Te toca revisar".to_string()),
        _ => return None,
    };
    Some(Notice { session: change.session.clone(), attention: change.to, title, body })
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
                transcript_path: None,
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

    #[derive(Default)]
    struct Recorder {
        notices: Mutex<Vec<Notice>>,
        views: Mutex<Vec<WarRoomView>>,
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

    fn service(store: Arc<MemoryStore>, rec: Arc<Recorder>, alive: bool) -> WarRoomService {
        WarRoomService::new(
            vec![Arc::new(FakeProvider)],
            Arc::new(FixedResolver),
            store,
            Arc::new(TickClock(AtomicI64::new(1_000_000_000_000))),
            Arc::new(Probe(alive)),
            rec.clone(),
            rec,
        )
    }

    fn signal(s: &str, e: &str) -> IncomingSignal {
        IncomingSignal {
            provider: "fake".into(),
            received_at: None,
            host: TerminalHost { agent_pid: Some(7), ..Default::default() },
            payload: serde_json::json!({ "s": s, "e": e }),
        }
    }

    #[test]
    fn finishing_a_turn_notifies_and_publishes() {
        let rec = Arc::new(Recorder::default());
        let svc = service(Arc::default(), rec.clone(), true);
        svc.ingest(signal("a", "prompt")).unwrap();
        svc.ingest(signal("a", "stop")).unwrap();

        let notices = rec.notices.lock().unwrap();
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "app · main ha terminado");
        assert_eq!(rec.views.lock().unwrap().last().unwrap().aggregate, AttentionView::Finished);
    }

    #[test]
    fn irrelevant_hooks_change_nothing() {
        let rec = Arc::new(Recorder::default());
        let store = Arc::new(MemoryStore::default());
        let svc = service(store.clone(), rec.clone(), true);
        svc.ingest(signal("a", "whatever")).unwrap();
        assert!(store.0.lock().unwrap().is_empty());
        assert!(rec.views.lock().unwrap().is_empty());
    }

    #[test]
    fn restore_rebuilds_state_including_user_intents_without_notifying() {
        let store = Arc::new(MemoryStore::default());
        let first = service(store.clone(), Arc::default(), true);
        first.ingest(signal("a", "prompt")).unwrap();
        first.ingest(signal("a", "ask")).unwrap();
        first.archive(SessionId("a".into())).unwrap();

        let rec = Arc::new(Recorder::default());
        let second = service(store, rec.clone(), true);
        assert_eq!(second.restore().unwrap(), 3);
        assert!(rec.notices.lock().unwrap().is_empty());

        let view = second.view();
        assert!(view.rooms[0].sessions[0].archived);
        assert_eq!(view.aggregate, AttentionView::Offline, "archivada no cuenta");
    }

    #[test]
    fn intents_on_unknown_sessions_are_not_persisted() {
        let store = Arc::new(MemoryStore::default());
        let svc = service(store.clone(), Arc::default(), true);
        svc.mute(SessionId("ghost".into())).unwrap();
        assert!(store.0.lock().unwrap().is_empty());
    }

    #[test]
    fn sweep_closes_sessions_whose_process_died() {
        let svc = service(Arc::default(), Arc::default(), false);
        svc.ingest(signal("a", "prompt")).unwrap();
        svc.sweep_lost().unwrap();
        let view = svc.view();
        assert_eq!(view.rooms[0].sessions[0].attention, AttentionView::Offline);
        assert!(!view.rooms[0].sessions[0].alive);
    }
}
