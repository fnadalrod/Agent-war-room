# Claude Code hooks we rely on

> Leaf of `hooks-ingest.mdc`. Read it when you depend on a hook field, map a new hook, or a state looks
> wrong for a real session. Claude Code changes these between versions: when in doubt, capture real
> payloads with `WARROOM_HOOK_DUMP=/tmp/x.jsonl` (the bridge appends every envelope) instead of trusting
> this table.

## Common fields

`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`; `agent_id` / `agent_type`
when the hook fires inside a subagent. No env var identifies the session or the Claude PID (hence
`/proc`). `claude --resume <id>` keeps the same `session_id`.

## Events installed (`installer.rs::HOOKED_EVENTS`) and what we do with them

| Hook | Fields used | → Event |
|---|---|---|
| SessionStart | `source` (startup/resume/clear/compact/fork) | `Started` |
| UserPromptSubmit | `prompt` (`/name args` → skill unless built-in) | `PromptSubmitted` (+ `SkillInvoked{User}`) |
| PreToolUse | `tool_name`, `tool_input` (`skill` for `Skill`; `questions[].question/options[].label` for `AskUserQuestion`), `agent_id` | `ToolStarted` / `SubagentTool` / `AwaitingYou{Question, detail}` (+ `SkillInvoked{Agent}`) |
| PostToolUse, PostToolUseFailure | `tool_name` | `ToolFinished` (subagent ones ignored) |
| PermissionRequest | `tool_name`, `tool_input.command` (`questions` for `AskUserQuestion`) | `AwaitingYou{Permission, detail}`, or `AwaitingYou{Question}` for `AskUserQuestion` (bridge waits for a reply: decision or answers) |
| Notification | `notification_type` (or legacy `message`) | permission_prompt → AwaitingYou, elicitation_dialog → Question, idle_prompt → IdlePrompt; others ignored |
| Stop | — | `TurnEnded` (every turn, not only "task done") |
| SubagentStart / SubagentStop | `agent_id`, `agent_type` | `SubagentStarted` / `SubagentStopped` |
| PreCompact | — | `CompactionStarted` |
| SessionEnd | `reason` (clear/resume/logout/prompt_input_exit/other) | `Ended` |

Known `notification_type`s: permission_prompt, idle_prompt, auth_success, elicitation_dialog,
elicitation_url_dialog, elicitation_complete, elicitation_response, agent_needs_input, agent_completed,
quota_auto_resume_*.

## Built-in slash commands (not skills)

`provider.rs::BUILTIN_COMMANDS` (/model, /effort, /clear, /compact, /init, /login…). Update it when a
new built-in shows up as a "skill" tag.

## Gotcha: inherited session markers

A process started from inside a Claude session inherits `CLAUDECODE`, `CLAUDE_CODE_*` (e.g.
`CLAUDE_CODE_CHILD_SESSION`), `CLAUDE_PID`, `CLAUDE_EFFORT`, `AI_AGENT`. A child `claude` with those
thinks it is a subprocess and **does not save its transcript**. Everything we launch scrubs them
(`launch.rs::inherited_agent_markers`).
