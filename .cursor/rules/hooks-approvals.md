# Approving permissions and answering questions from the app

> Leaf of `hooks-ingest.mdc`. Read it before touching `PermissionRequest` handling, the reply path
> (`HookReply`, `SocketResponder`) or `WarRoomService::approve/deny/decide/answer_question`.

## What Claude Code actually does (verified with a real session, Claude Code 2.1.283)

- The terminal permission dialog is shown **while** the `PermissionRequest` hook is still running.
- If the hook answers first (`hookSpecificOutput.decision.behavior = allow|deny`), Claude applies it
  ("Allowed by PermissionRequest hook").
- If the user answers in the terminal first, Claude **kills the hook** and ignores anything it prints.

So it is a race that the terminal can always win: holding the hook is safe and needs no setting.

`AskUserQuestion` (verified with Claude Code 2.1.293): `PreToolUse` fires first, then a
`PermissionRequest` for the same tool **in every permission mode** (default, auto, acceptEdits, plan),
with the question dialog on screen while it runs. Answering it is an allow with
`decision.updatedInput` = the original `tool_input` plus `answers: {question text: label or free
text}` (several labels joined with ", "); Claude takes those answers and the dialog closes. Do not
hold `PreToolUse` instead: Claude draws nothing until it returns, so the terminal would freeze.

## Implementation

- Bridge: for `PermissionRequest` it sets `expects_reply`, writes the envelope and waits up to 590 s
  for one line (`HookReply::Allow` / `Deny { message }` / `Answer { answers }`), then prints Claude's
  JSON. Default deny text:
  `DEFAULT_DENY_MESSAGE` (user-facing).
- Ingress: `SocketResponder::watch` keeps the std stream to reply and spawns a tokio task on a clone
  that sets `closed` on EOF — that EOF is Claude killing the bridge because the terminal answered.
  (`UnixStream::peek` is unstable, hence the watcher.) The socket is non-blocking (shared with tokio):
  the reply write retries on `WouldBlock`.
- Mapping: a `PermissionRequest` whose tool is a question tool with parseable `questions` becomes
  `AwaitingYou{Question}` + `Translated::question` (prompts, options, multi-select), not a permission:
  approving it would send no answers, and "yes to all" must not touch it.
- Service: a pending approval is an `Arc<dyn HookResponder>` per session; a pending question is the
  same responder plus its prompts (`questions` map, surfaced as `SessionView.questions` /
  `can_answer_question`). Both are ephemeral, never persisted, dropped when any other agent signal
  arrives, and `tick()` drops closed ones so the buttons/form disappear. `answer_question` requires a
  non-empty answer for every prompt. Notices say `approvable` so the notification gets an "Approve" button.

## Tests

`ingress.rs` (reply delivered; killed bridge detected), `service.rs` (approve once; terminal answer
withdraws; questions answered once and only complete), the bridge's `hook_output` tests, and the real
e2e `a_real_permission_request_is_approved_from_the_war_room`, `a_real_question_is_answered_from_the_war_room`,
`a_real_question_answered_in_the_terminal_leaves_the_war_room` (skill `e2e`).
