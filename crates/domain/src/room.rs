use crate::{Attention, EndReason, Session, SessionEvent, SessionEventKind, SessionId};
use std::collections::HashMap;

/// All known sessions. Aggregate root: events come in here.
#[derive(Debug, Default, Clone)]
pub struct WarRoom {
    sessions: HashMap<SessionId, Session>,
}

/// Attention change caused by an event, used to decide on notifications.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionChange {
    pub session: SessionId,
    pub from: Option<Attention>,
    pub to: Attention,
    /// The session is on watch (neither archived nor muted) after the event.
    pub on_watch: bool,
}

impl AttentionChange {
    pub fn deserves_notice(&self) -> bool {
        self.on_watch && self.to.is_alerting() && self.from != Some(self.to)
    }
}

impl WarRoom {
    pub fn new() -> Self {
        Self::default()
    }

    /// Applies an event. Returns `None` if the event is ignored (an intent on an unknown
    /// session, or a context-less signal from a session we never saw start).
    pub fn apply(&mut self, event: SessionEvent) -> Option<AttentionChange> {
        let SessionEvent { session: id, at, context, kind } = event;

        let from = match self.sessions.get_mut(&id) {
            Some(session) => {
                let from = session.attention();
                session.apply(context, &kind, at);
                Some(from)
            }
            None => {
                let context = context?;
                let mut session = Session::open(id.clone(), context, at);
                session.apply(None, &kind, at);
                self.sessions.insert(id.clone(), session);
                None
            }
        };

        let session = &self.sessions[&id];
        Some(AttentionChange { session: id, from, to: session.attention(), on_watch: session.is_on_watch() })
    }

    pub fn get(&self, id: &SessionId) -> Option<&Session> {
        self.sessions.get(id)
    }

    pub fn sessions(&self) -> impl Iterator<Item = &Session> {
        self.sessions.values()
    }

    /// Room colour: the most urgent attention among sessions on watch.
    pub fn aggregate_attention(&self) -> Attention {
        self.sessions.values().filter(|s| s.is_on_watch()).map(Session::attention).max().unwrap_or(Attention::Offline)
    }

    /// Live sessions whose process no longer exists, according to `is_alive`. Returns the events to
    /// apply; the caller decides whether to persist them.
    pub fn detect_lost(&self, is_alive: impl Fn(u32) -> bool, at: crate::Timestamp) -> Vec<SessionEvent> {
        self.sessions
            .values()
            .filter(|s| s.is_alive())
            .filter(|s| s.host.agent_pid.is_some_and(|pid| !is_alive(pid)))
            .map(|s| SessionEvent {
                session: s.id.clone(),
                at,
                context: None,
                kind: SessionEventKind::Ended { reason: EndReason::ProcessLost },
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;

    fn ctx(pid: Option<u32>) -> SessionContext {
        SessionContext {
            provider: ProviderKind::Claude,
            workspace: Workspace {
                repo: RepoId("/repo/.git".into()),
                repo_name: "repo".into(),
                worktree_path: "/repo".into(),
                branch: Some("main".into()),
                is_linked_worktree: false,
            },
            host: TerminalHost { agent_pid: pid, ..Default::default() },
            transcript_path: None,
            cwd: Some("/repo/sub".into()),
        }
    }

    fn signal(id: &str, t: i64, kind: SessionEventKind) -> SessionEvent {
        SessionEvent { session: SessionId(id.into()), at: Timestamp(t), context: Some(ctx(Some(42))), kind }
    }

    fn intent(id: &str, t: i64, kind: SessionEventKind) -> SessionEvent {
        SessionEvent { session: SessionId(id.into()), at: Timestamp(t), context: None, kind }
    }

    fn attention(room: &WarRoom, id: &str) -> Attention {
        room.get(&SessionId(id.into())).unwrap().attention()
    }

    #[test]
    fn a_turn_goes_idle_working_finished_and_back_to_idle_when_seen() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::Started));
        assert_eq!(attention(&room, "s"), Attention::Idle);

        room.apply(signal("s", 2, SessionEventKind::PromptSubmitted));
        room.apply(signal("s", 3, SessionEventKind::ToolStarted { tool: "Bash".into() }));
        assert_eq!(attention(&room, "s"), Attention::Working);

        let change = room.apply(signal("s", 4, SessionEventKind::TurnEnded)).unwrap();
        assert_eq!(change.to, Attention::Finished);
        assert!(change.deserves_notice());

        room.apply(intent("s", 5, SessionEventKind::Seen));
        assert_eq!(attention(&room, "s"), Attention::Idle);
    }

    #[test]
    fn interrupting_a_turn_yourself_gives_you_the_turn_without_a_notice() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        let change = room.apply(signal("s", 2, SessionEventKind::Interrupted)).unwrap();
        assert_eq!(change.to, Attention::Idle);
        assert!(!change.deserves_notice());
    }

    #[test]
    fn permission_and_questions_need_you() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        let change = room
            .apply(signal(
                "s",
                2,
                SessionEventKind::AwaitingYou {
                    reason: WaitReason::Permission,
                    tool: Some("Bash".into()),
                    detail: None,
                },
            ))
            .unwrap();
        assert_eq!(change.to, Attention::NeedsYou);
        assert_eq!(room.aggregate_attention(), Attention::NeedsYou);

        room.apply(signal("s", 3, SessionEventKind::ToolStarted { tool: "Bash".into() }));
        assert_eq!(attention(&room, "s"), Attention::Working);
    }

    #[test]
    fn archived_session_stays_alive_but_leaves_the_watch_until_you_write_again() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        room.apply(intent("s", 2, SessionEventKind::Archived));

        let change = room.apply(signal("s", 3, SessionEventKind::TurnEnded)).unwrap();
        assert!(!change.deserves_notice(), "an archived session does not notify");
        assert_eq!(room.aggregate_attention(), Attention::Offline);

        room.apply(signal("s", 4, SessionEventKind::PromptSubmitted));
        let s = room.get(&SessionId("s".into())).unwrap();
        assert!(!s.archived, "writing to it unarchives it");
        assert_eq!(room.aggregate_attention(), Attention::Working);
    }

    #[test]
    fn muted_session_is_visible_but_silent() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        room.apply(intent("s", 2, SessionEventKind::Muted));
        let change = room.apply(signal("s", 3, SessionEventKind::TurnEnded)).unwrap();
        assert_eq!(change.to, Attention::Finished);
        assert!(!change.deserves_notice());
    }

    #[test]
    fn idle_prompt_only_fills_a_missed_turn_end() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        room.apply(signal("s", 2, SessionEventKind::TurnEnded));
        room.apply(intent("s", 3, SessionEventKind::Seen));
        room.apply(signal("s", 4, SessionEventKind::IdlePrompt));
        assert_eq!(attention(&room, "s"), Attention::Idle, "does not reopen what was already seen");

        room.apply(signal("t", 1, SessionEventKind::PromptSubmitted));
        room.apply(signal("t", 9, SessionEventKind::IdlePrompt));
        assert_eq!(attention(&room, "t"), Attention::Finished);
    }

    #[test]
    fn auto_compaction_resumes_working() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        room.apply(signal("s", 2, SessionEventKind::CompactionStarted));
        room.apply(signal("s", 3, SessionEventKind::Started));
        assert_eq!(attention(&room, "s"), Attention::Working);
    }

    #[test]
    fn intents_for_unknown_sessions_are_ignored() {
        let mut room = WarRoom::new();
        assert!(room.apply(intent("ghost", 1, SessionEventKind::Archived)).is_none());
        assert_eq!(room.sessions().count(), 0);
    }

    #[test]
    fn lost_processes_are_detected_once() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        let lost = room.detect_lost(|_| false, Timestamp(10));
        assert_eq!(lost.len(), 1);
        for e in lost {
            room.apply(e);
        }
        assert_eq!(attention(&room, "s"), Attention::Offline);
        assert!(room.detect_lost(|_| false, Timestamp(11)).is_empty());
    }

    #[test]
    fn finished_subagents_are_kept_to_see_what_they_did() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::SubagentStarted { id: "a1".into(), kind: Some("Explore".into()) }));
        room.apply(signal("s", 2, SessionEventKind::SubagentStarted { id: "a2".into(), kind: None }));
        room.apply(signal("s", 3, SessionEventKind::SubagentStopped { id: "a1".into() }));
        let s = room.get(&SessionId("s".into())).unwrap();
        assert_eq!(s.subagents.len(), 2);
        assert_eq!(s.running_subagents(), 1);
        assert_eq!(s.subagents["a1"].finished_at, Some(Timestamp(3)));

        room.apply(signal("s", 4, SessionEventKind::Ended { reason: EndReason::Exited("other".into()) }));
        assert_eq!(room.get(&SessionId("s".into())).unwrap().running_subagents(), 0);
    }

    #[test]
    fn only_the_latest_finished_subagents_are_kept() {
        let mut room = WarRoom::new();
        for i in 0..10 {
            let id = format!("a{i}");
            room.apply(signal("s", i * 2, SessionEventKind::SubagentStarted { id: id.clone(), kind: None }));
            room.apply(signal("s", i * 2 + 1, SessionEventKind::SubagentStopped { id }));
        }
        let s = room.get(&SessionId("s".into())).unwrap();
        assert_eq!(s.subagents.len(), 6);
        assert!(s.subagents.contains_key("a9") && !s.subagents.contains_key("a0"));
    }

    #[test]
    fn subagent_tools_do_not_hijack_the_main_status_but_resolve_a_pending_permission() {
        let mut room = WarRoom::new();
        room.apply(signal("s", 1, SessionEventKind::ToolStarted { tool: "Agent".into() }));
        room.apply(signal("s", 2, SessionEventKind::SubagentTool { id: "a1".into(), tool: "Grep".into() }));
        let s = room.get(&SessionId("s".into())).unwrap();
        assert_eq!(s.status, SessionStatus::Working { tool: Some("Agent".into()) });
        assert_eq!(s.subagents["a1"].current_tool.as_deref(), Some("Grep"));

        room.apply(signal(
            "s",
            3,
            SessionEventKind::AwaitingYou { reason: WaitReason::Permission, tool: Some("Bash".into()), detail: None },
        ));
        room.apply(signal("s", 4, SessionEventKind::SubagentTool { id: "a1".into(), tool: "Bash".into() }));
        assert_eq!(attention(&room, "s"), Attention::Working);
    }

    #[test]
    fn events_stored_before_new_fields_still_load() {
        let old = r#"{"session":"s","at":1,"context":{"provider":"claude","workspace":{"repo":"r","repo_name":"r","worktree_path":"/r","branch":null,"is_linked_worktree":false},"host":{"agent_pid":7,"ancestry":[],"tmux_pane":null,"term_program":null},"transcript_path":null},"kind":{"type":"started"}}"#;
        let e: SessionEvent = serde_json::from_str(old).unwrap();
        assert_eq!(e.context.unwrap().host.warp_focus_url, None);
    }

    #[test]
    fn skills_are_counted_with_who_launched_them() {
        let mut room = WarRoom::new();
        let skill = |by| SessionEventKind::SkillInvoked { name: "close-task".into(), by, source: SkillSource::Project };
        room.apply(signal("s", 1, SessionEventKind::PromptSubmitted));
        room.apply(signal("s", 2, skill(SkillInvoker::Agent)));
        room.apply(signal("s", 3, skill(SkillInvoker::User)));
        let s = room.get(&SessionId("s".into())).unwrap();
        let used = &s.skills["close-task"];
        assert_eq!((used.count, used.by_user, used.by_agent), (2, true, true));
        assert_eq!(used.last_at, Timestamp(3));
        assert_eq!(attention(&room, "s"), Attention::Working, "a skill does not change the status");
    }

    #[test]
    fn events_roundtrip_through_json() {
        let e =
            signal("s", 1, SessionEventKind::AwaitingYou { reason: WaitReason::Question, tool: None, detail: None });
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(serde_json::from_str::<SessionEvent>(&json).unwrap(), e);
    }
}
