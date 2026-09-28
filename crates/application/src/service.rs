use crate::locale;
use crate::ports::{
    AgentLauncher, AgentProvider, ApprovalDecision, ApprovalResponder, Clock, EventStore, FocusOutcome, FocusTarget,
    LaunchOutcome, LaunchRequest, LaunchTarget, Notice, Notifier, PortError, PortResult, ProcessProbe, RepoResolver,
    SessionInput, SkillCatalog, TranscriptReader, TranscriptSummary, ViewPublisher, WindowNavigator,
};
use crate::view::{self, SessionDetail, SubagentPreview, WarRoomView};
use awr_domain::{
    Attention, AttentionChange, SessionContext, SessionEvent, SessionEventKind, SessionId, SessionStatus, TerminalHost,
    Timestamp, WarRoom,
};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

/// How much history is rebuilt on startup.
const RESTORE_WINDOW_MS: i64 = 3 * 24 * 60 * 60 * 1000;
/// What the store keeps; anything older is deleted on startup.
const RETENTION_MS: i64 = 14 * 24 * 60 * 60 * 1000;

/// Raw signal from an agent, already detached from the transport.
pub struct IncomingSignal {
    pub provider: String,
    pub received_at: Option<Timestamp>,
    pub host: TerminalHost,
    pub payload: serde_json::Value,
    /// Present if the agent awaits a decision (permission approvable from the app).
    pub reply: Option<Arc<dyn ApprovalResponder>>,
}

/// Everything external the service needs.
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
    pub launcher: Arc<dyn AgentLauncher>,
    pub input: Arc<dyn SessionInput>,
    pub skills: Arc<dyn SkillCatalog>,
}

pub struct WarRoomService {
    room: Mutex<WarRoom>,
    /// Enrichment derived from the transcript; not domain state and not persisted.
    summaries: Mutex<HashMap<SessionId, TranscriptSummary>>,
    /// Permissions resolvable from the app. Ephemeral: they live as long as the hook connection.
    approvals: Mutex<HashMap<SessionId, Arc<dyn ApprovalResponder>>>,
    ports: Ports,
}

impl WarRoomService {
    pub fn new(ports: Ports) -> Self {
        Self { room: Mutex::new(WarRoom::new()), summaries: Mutex::default(), approvals: Mutex::default(), ports }
    }

    /// Rebuilds the state from the store without notifying anything. Returns the events applied.
    pub fn restore(&self) -> PortResult<usize> {
        let now = self.ports.clock.now().0;
        self.ports.store.prune(Timestamp(now - RETENTION_MS))?;
        let since = Timestamp(now - RESTORE_WINDOW_MS);
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
            .ok_or_else(|| PortError::Failed(format!("unknown provider: {}", signal.provider)))?;
        let Some(translated) = provider.translate(&signal.payload)? else {
            return Ok(());
        };

        if let Some(reply) = signal.reply
            && matches!(
                translated.kind,
                SessionEventKind::AwaitingYou { reason: awr_domain::WaitReason::Permission, .. }
            )
        {
            self.approvals().insert(translated.session.clone(), reply);
        }

        let workspace = self.ports.resolver.resolve(&translated.cwd);
        let at = signal.received_at.unwrap_or_else(|| self.ports.clock.now());
        let worktree = workspace.worktree_path.clone();
        self.commit(SessionEvent {
            session: translated.session.clone(),
            at,
            context: Some(SessionContext {
                provider: provider.kind(),
                workspace,
                host: signal.host,
                transcript_path: translated.transcript_path,
                cwd: Some(translated.cwd.clone()).filter(|c| !c.is_empty()),
            }),
            kind: translated.kind,
        })?;

        for kind in translated.extra {
            let kind = match kind {
                SessionEventKind::SkillInvoked { name, by, .. } => {
                    let source = self.ports.skills.classify(&name, &translated.cwd, &worktree);
                    SessionEventKind::SkillInvoked { name, by, source }
                }
                other => other,
            };
            self.commit(SessionEvent { session: translated.session.clone(), at, context: None, kind })?;
        }
        Ok(())
    }

    pub fn mark_seen(&self, id: SessionId) -> PortResult<()> {
        self.intent(id, SessionEventKind::Seen)
    }

    /// Marks every finished session as reviewed.
    pub fn mark_all_seen(&self) -> PortResult<()> {
        let finished: Vec<SessionId> =
            self.room().sessions().filter(|s| s.attention() == Attention::Finished).map(|s| s.id.clone()).collect();
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

    /// Approves the pending permission as if you had pressed "Yes" in the terminal.
    pub fn approve(&self, id: SessionId) -> PortResult<()> {
        self.decide(id, ApprovalDecision::Allow)
    }

    pub fn deny(&self, id: SessionId, message: Option<String>) -> PortResult<()> {
        self.decide(id, ApprovalDecision::Deny { message })
    }

    fn decide(&self, id: SessionId, decision: ApprovalDecision) -> PortResult<()> {
        let responder =
            self.approvals().remove(&id).ok_or_else(|| PortError::Failed(locale::NO_PENDING_PERMISSION.into()))?;
        let delivered = responder.respond(decision);
        self.publish();
        if delivered { Ok(()) } else { Err(PortError::Failed(locale::ALREADY_ANSWERED_IN_TERMINAL.into())) }
    }

    /// Preview: the session card and its last `limit` conversation entries.
    pub fn session_detail(&self, id: SessionId, limit: usize) -> PortResult<SessionDetail> {
        let (session, transcript) = {
            let room = self.room();
            let session = known(&room, &id)?;
            let can_approve = self.approvals().contains_key(&id);
            let view = view::session_view(session, self.summaries().get(&id), can_approve);
            (view, session.transcript_path.clone())
        };
        let timeline = transcript
            .map(|path| self.ports.transcripts.recent(&path, limit).into_iter().map(Into::into).collect())
            .unwrap_or_default();
        Ok(SessionDetail { session, timeline })
    }

    /// Preview of one of the session's subagents.
    pub fn subagent_detail(&self, id: SessionId, agent_id: &str, limit: usize) -> PortResult<SubagentPreview> {
        let (agent, transcript) = {
            let room = self.room();
            let session = known(&room, &id)?;
            let can_approve = self.approvals().contains_key(&id);
            let view = view::session_view(session, self.summaries().get(&id), can_approve);
            let agent = view
                .subagents
                .into_iter()
                .find(|a| a.id == agent_id)
                .ok_or_else(|| PortError::Failed(locale::unknown_subagent(agent_id)))?;
            (agent, session.transcript_path.clone())
        };
        let transcript =
            transcript.and_then(|path| self.ports.transcripts.subagent(&path, agent_id, limit)).unwrap_or_default();
        Ok(SubagentPreview {
            session_id: id.0,
            agent,
            first_prompt: transcript.first_prompt,
            last_reply: transcript.last_reply,
            timeline: transcript.timeline.into_iter().map(Into::into).collect(),
        })
    }

    /// Opens a new agent in a folder (usually a room's worktree).
    pub fn launch(&self, cwd: String, target: LaunchTarget) -> PortResult<LaunchOutcome> {
        let label = folder_name(&cwd);
        self.ports.launcher.launch(&LaunchRequest { cwd, resume: None, target, label })
    }

    /// Resumes a closed session (`claude --resume`) in its original folder.
    pub fn resume(&self, id: SessionId, target: LaunchTarget) -> PortResult<LaunchOutcome> {
        let request = {
            let room = self.room();
            let session = known(&room, &id)?;
            if session.is_alive() {
                return Err(PortError::Failed(locale::SESSION_STILL_OPEN.into()));
            }
            let label = self
                .summaries()
                .get(&id)
                .and_then(|s| s.title.clone())
                .unwrap_or_else(|| folder_name(&session.workspace.worktree_path));
            LaunchRequest { cwd: session.launch_dir().to_owned(), resume: Some(id.clone()), target, label }
        };
        self.ports.launcher.launch(&request)
    }

    /// Types a message into the session and sends it (Enter).
    pub fn send_input(&self, id: SessionId, text: &str) -> PortResult<()> {
        let host = {
            let room = self.room();
            let session = known(&room, &id)?;
            if !session.is_alive() {
                return Err(PortError::Failed(locale::SESSION_CLOSED.into()));
            }
            session.host.clone()
        };
        self.ports.input.send(&host, text)
    }

    /// Jumps to the session's window (and pane). Going to a finished session counts as reviewing it.
    pub fn focus(&self, id: SessionId) -> PortResult<FocusOutcome> {
        let (target, finished) = {
            let room = self.room();
            let session = known(&room, &id)?;
            if !session.is_alive() {
                return Ok(FocusOutcome::Unreachable { reason: locale::SESSION_CLOSED.into() });
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

    /// Periodic maintenance: closes sessions whose process died and refreshes the transcripts of
    /// the running ones.
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
        // Permissions answered in the terminal: Claude killed the hook and the connection closed.
        let mut changed = {
            let mut approvals = self.approvals();
            let before = approvals.len();
            approvals.retain(|_, r| r.is_open());
            approvals.len() != before
        };
        for id in &active {
            changed |= self.refresh_summary(id);
        }
        if changed {
            self.publish();
        }
        Ok(())
    }

    pub fn view(&self) -> WarRoomView {
        let approvable: HashSet<SessionId> = self.approvals().keys().cloned().collect();
        view::project(&self.room(), &self.summaries(), &approvable)
    }

    fn intent(&self, id: SessionId, kind: SessionEventKind) -> PortResult<()> {
        let at = self.ports.clock.now();
        self.commit(SessionEvent { session: id, at, context: None, kind })
    }

    fn commit(&self, event: SessionEvent) -> PortResult<()> {
        let persisted = event.clone();
        let id = event.session.clone();
        let from_agent = event.context.is_some();
        // Any other signal from the agent means the permission was already resolved some other way.
        if from_agent && !matches!(event.kind, SessionEventKind::AwaitingYou { .. }) {
            self.approvals().remove(&id);
        }
        let change = {
            let mut room = self.room();
            let Some(change) = room.apply(event) else {
                return Ok(());
            };
            change
        };

        // In-memory state wins even if persisting fails: the UI must not lie.
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

    /// Rereads a session's transcript. Returns whether anything visible changed.
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
            Attention::NeedsYou => (locale::needs_you_title(&place), locale::NEEDS_YOU_FALLBACK_BODY),
            Attention::Finished => (locale::finished_title(&place), locale::FINISHED_FALLBACK_BODY),
            _ => return None,
        };
        let body =
            summary.title.or(summary.last_reply.map(|r| truncate(&r, 140))).unwrap_or_else(|| fallback.to_string());
        let approvable = change.to == Attention::NeedsYou && self.approvals().contains_key(&change.session);
        Some(Notice { session: change.session.clone(), attention: change.to, title, body, approvable })
    }

    fn room(&self) -> MutexGuard<'_, WarRoom> {
        self.room.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn approvals(&self) -> MutexGuard<'_, HashMap<SessionId, Arc<dyn ApprovalResponder>>> {
        self.approvals.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn summaries(&self) -> MutexGuard<'_, HashMap<SessionId, TranscriptSummary>> {
        self.summaries.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn folder_name(path: &str) -> String {
    path.rsplit('/').find(|p| !p.is_empty()).unwrap_or(path).to_string()
}

/// The session, or the error the UI shows for an unknown one.
fn known<'a>(room: &'a WarRoom, id: &SessionId) -> PortResult<&'a awr_domain::Session> {
    room.get(id).ok_or_else(|| PortError::Failed(locale::unknown_session(id)))
}

fn truncate(text: &str, max: usize) -> String {
    let max = max.max(1);
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max { text } else { format!("{}…", text.chars().take(max - 1).collect::<String>()) }
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
                "ask" => SessionEventKind::AwaitingYou { reason: WaitReason::Permission, tool: None, detail: None },
                "slash" => SessionEventKind::PromptSubmitted,
                _ => return Ok(None),
            };
            let extra = if payload["e"] == "slash" {
                vec![SessionEventKind::SkillInvoked {
                    name: "close-task".into(),
                    by: awr_domain::SkillInvoker::User,
                    source: awr_domain::SkillSource::Builtin,
                }]
            } else {
                vec![]
            };
            Ok(Some(Translated {
                session: SessionId(payload["s"].as_str().unwrap().into()),
                cwd: "/code/app".into(),
                transcript_path: Some("/t.jsonl".into()),
                kind,
                extra,
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
        fn prune(&self, before: Timestamp) -> PortResult<usize> {
            let mut events = self.0.lock().unwrap();
            let len = events.len();
            events.retain(|e| e.at >= before);
            Ok(len - events.len())
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
        fn recent(&self, path: &str, limit: usize) -> Vec<crate::ports::TimelineItem> {
            use crate::ports::{TimelineItem, TimelineKind};
            let all = vec![
                TimelineItem {
                    kind: TimelineKind::Prompt,
                    text: format!("prompt from {path}"),
                    at: Some(1),
                    model: None,
                    effort: None,
                },
                TimelineItem {
                    kind: TimelineKind::Reply,
                    text: "**done**".into(),
                    at: Some(2),
                    model: Some("claude-opus-5-5".into()),
                    effort: Some("high".into()),
                },
            ];
            all.into_iter().rev().take(limit).rev().collect()
        }
        fn subagent(&self, _: &str, agent_id: &str, _: usize) -> Option<crate::ports::AgentTranscript> {
            Some(crate::ports::AgentTranscript {
                first_prompt: Some(format!("task for {agent_id}")),
                last_reply: Some("ready".into()),
                timeline: vec![],
            })
        }
    }

    #[derive(Default)]
    struct Recorder {
        notices: Mutex<Vec<Notice>>,
        views: Mutex<Vec<WarRoomView>>,
        focused: Mutex<Vec<FocusTarget>>,
        launched: Mutex<Vec<LaunchRequest>>,
        typed: Mutex<Vec<(Option<u32>, String)>>,
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

    impl AgentLauncher for Recorder {
        fn launch(&self, request: &LaunchRequest) -> PortResult<LaunchOutcome> {
            self.launched.lock().unwrap().push(request.clone());
            Ok(LaunchOutcome::AppTerminal { pty_id: "p1".into() })
        }
    }
    impl SessionInput for Recorder {
        fn send(&self, host: &TerminalHost, text: &str) -> PortResult<()> {
            self.typed.lock().unwrap().push((host.agent_pid, text.to_owned()));
            Ok(())
        }
    }

    /// Every skill is a repo skill in the tests.
    struct RepoSkills;
    impl SkillCatalog for RepoSkills {
        fn classify(&self, _: &str, _: &str, _: &str) -> awr_domain::SkillSource {
            awr_domain::SkillSource::Project
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
            launcher: rec.clone(),
            input: rec.clone(),
            skills: Arc::new(RepoSkills),
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
            reply: None,
        }
    }

    #[derive(Default)]
    struct FakeResponder {
        closed: std::sync::atomic::AtomicBool,
        got: Mutex<Option<ApprovalDecision>>,
    }
    impl ApprovalResponder for FakeResponder {
        fn is_open(&self) -> bool {
            !self.closed.load(Ordering::SeqCst)
        }
        fn respond(&self, decision: ApprovalDecision) -> bool {
            *self.got.lock().unwrap() = Some(decision);
            self.is_open()
        }
    }

    fn asking(s: &str) -> (IncomingSignal, Arc<FakeResponder>) {
        let responder = Arc::new(FakeResponder::default());
        let mut sig = signal(s, "ask");
        sig.reply = Some(responder.clone());
        (sig, responder)
    }

    fn id(s: &str) -> SessionId {
        SessionId(s.into())
    }

    #[test]
    fn finishing_a_turn_notifies_with_the_session_title() {
        let h = harness();
        h.transcript.0.lock().unwrap().title = Some("Fix the login".into());
        h.svc.ingest(signal("a", "prompt")).unwrap();
        h.svc.ingest(signal("a", "stop")).unwrap();

        let notices = h.rec.notices.lock().unwrap();
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, locale::finished_title("app · main"));
        assert_eq!(notices[0].body, "Fix the login");
        let view = h.rec.views.lock().unwrap().last().unwrap().clone();
        assert_eq!(view.aggregate, AttentionView::Finished);
        assert_eq!(view.rooms[0].sessions[0].title.as_deref(), Some("Fix the login"));
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
        assert_eq!(view.aggregate, AttentionView::Offline, "archived sessions don't count");
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

        h.transcript.0.lock().unwrap().last_reply = Some("Reading the code".into());
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
    fn a_pending_permission_can_be_approved_from_the_app() {
        let h = harness();
        h.svc.ingest(signal("a", "prompt")).unwrap();
        let (sig, responder) = asking("a");
        h.svc.ingest(sig).unwrap();
        assert!(h.svc.view().rooms[0].sessions[0].can_approve);

        h.svc.approve(id("a")).unwrap();
        assert_eq!(*responder.got.lock().unwrap(), Some(ApprovalDecision::Allow));
        assert!(!h.svc.view().rooms[0].sessions[0].can_approve);
        assert!(h.svc.approve(id("a")).is_err(), "it can only be answered once");
    }

    #[test]
    fn answering_in_the_terminal_withdraws_the_approval() {
        let h = harness();
        let (sig, responder) = asking("a");
        h.svc.ingest(sig).unwrap();

        responder.closed.store(true, Ordering::SeqCst);
        h.svc.tick().unwrap();
        assert!(!h.svc.view().rooms[0].sessions[0].can_approve);

        let (sig, _) = asking("b");
        h.svc.ingest(sig).unwrap();
        h.svc.ingest(signal("b", "stop")).unwrap();
        let view = h.svc.view();
        let b = view.rooms[0].sessions.iter().find(|s| s.id == "b").unwrap();
        assert!(!b.can_approve, "another agent signal closes the approval window");
        assert!(h.svc.deny(id("b"), None).is_err());
    }

    #[test]
    fn a_closed_session_resumes_in_its_original_folder_with_its_title() {
        let h = harness_with(Arc::default(), false);
        h.transcript.0.lock().unwrap().title = Some("Fix login".into());
        h.svc.ingest(signal("a", "prompt")).unwrap();
        assert!(h.svc.resume(id("a"), LaunchTarget::Warp).is_err(), "alive: go to it, don't resume it");

        h.svc.tick().unwrap();
        h.svc.resume(id("a"), LaunchTarget::Warp).unwrap();
        let launched = h.rec.launched.lock().unwrap();
        assert_eq!(launched[0].resume, Some(id("a")));
        assert_eq!(launched[0].cwd, "/code/app");
        assert_eq!(launched[0].label, "Fix login");
    }

    #[test]
    fn typing_goes_to_live_sessions_only() {
        let h = harness_with(Arc::default(), false);
        h.svc.ingest(signal("a", "prompt")).unwrap();
        h.svc.send_input(id("a"), "go on").unwrap();
        assert_eq!(h.rec.typed.lock().unwrap()[0], (Some(7), "go on".to_string()));

        h.svc.tick().unwrap();
        assert!(h.svc.send_input(id("a"), "hello").is_err());
    }

    #[test]
    fn the_preview_brings_the_card_and_the_recent_conversation() {
        let h = harness();
        h.transcript.0.lock().unwrap().first_prompt = Some("Migrate the login".into());
        h.svc.ingest(signal("a", "prompt")).unwrap();
        let detail = h.svc.session_detail(id("a"), 1).unwrap();
        assert_eq!(detail.session.first_prompt.as_deref(), Some("Migrate the login"));
        assert_eq!(detail.timeline.len(), 1);
        assert_eq!(detail.timeline[0].text, "**done**");
        assert_eq!(detail.timeline[0].effort.as_deref(), Some("high"));
        assert!(h.svc.session_detail(id("ghost"), 5).is_err());
    }

    #[test]
    fn restore_forgets_events_older_than_the_retention() {
        let store = Arc::new(MemoryStore::default());
        let old = SessionEvent {
            session: id("old"),
            at: Timestamp(1_000_000_000_000 - 30 * 24 * 60 * 60 * 1000),
            context: None,
            kind: SessionEventKind::Seen,
        };
        store.append(&old).unwrap();
        harness_with(store.clone(), true).svc.restore().unwrap();
        assert!(store.0.lock().unwrap().is_empty());
    }

    #[test]
    fn a_permission_notice_says_it_can_be_approved_from_the_notification() {
        let h = harness();
        let (sig, _responder) = asking("a");
        h.svc.ingest(sig).unwrap();
        let notices = h.rec.notices.lock().unwrap();
        assert!(notices[0].approvable);
    }

    #[test]
    fn a_subagent_preview_brings_its_task_and_reply() {
        let h = harness();
        h.svc.ingest(signal("a", "prompt")).unwrap();
        h.svc
            .commit(SessionEvent {
                session: id("a"),
                at: Timestamp(5),
                context: None,
                kind: SessionEventKind::SubagentStarted { id: "x1".into(), kind: Some("Explore".into()) },
            })
            .unwrap();
        let preview = h.svc.subagent_detail(id("a"), "x1", 10).unwrap();
        assert_eq!(preview.first_prompt.as_deref(), Some("task for x1"));
        assert!(preview.agent.running);
        assert!(h.svc.subagent_detail(id("a"), "other", 10).is_err());
    }

    #[test]
    fn a_slash_skill_counts_as_prompt_and_skill_with_its_real_source() {
        let h = harness();
        h.svc.ingest(signal("a", "slash")).unwrap();
        let view = h.svc.view();
        let s = &view.rooms[0].sessions[0];
        assert_eq!(s.turns, 1);
        assert_eq!(s.skills.len(), 1);
        assert_eq!(s.skills[0].name, "close-task");
        assert_eq!(s.skills[0].source, crate::view::SkillSourceView::Project, "the catalog settles the source");
        assert!(s.skills[0].by_user && !s.skills[0].by_agent);
    }

    #[test]
    fn truncate_collapses_whitespace_and_cuts_on_chars() {
        assert_eq!(truncate("hello\n\n  world", 50), "hello world");
        assert_eq!(truncate("ßßßßß", 3), "ßß…");
    }
}
