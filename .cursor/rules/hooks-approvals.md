# Approving permissions from the app

> Leaf of `hooks-ingest.mdc`. Read it before touching `PermissionRequest` handling, the reply path
> (`HookReply`, `SocketResponder`) or `WarRoomService::approve/deny/decide`.

## What Claude Code actually does (verified with a real session, Claude Code 2.1.283)

- The terminal permission dialog is shown **while** the `PermissionRequest` hook is still running.
- If the hook answers first (`hookSpecificOutput.decision.behavior = allow|deny`), Claude applies it
  ("Allowed by PermissionRequest hook").
- If the user answers in the terminal first, Claude **kills the hook** and ignores anything it prints.

So it is a race that the terminal can always win: holding the hook is safe and needs no setting.

## Implementation

- Bridge: for `PermissionRequest` it sets `expects_reply`, writes the envelope and waits up to 590 s
  for one line (`HookReply::Allow` / `Deny { message }`), then prints Claude's JSON. Default deny text:
  `DEFAULT_DENY_MESSAGE` (user-facing).
- Ingress: `SocketResponder::watch` keeps the std stream to reply and spawns a tokio task on a clone
  that sets `closed` on EOF — that EOF is Claude killing the bridge because the terminal answered.
  (`UnixStream::peek` is unstable, hence the watcher.) The socket is non-blocking (shared with tokio):
  the reply write retries on `WouldBlock`.
- Service: a pending approval is an `Arc<dyn ApprovalResponder>` per session (ephemeral, never
  persisted). It is dropped when any other agent signal arrives, and `tick()` drops closed ones so the
  "Approve" buttons disappear. Notices say `approvable` so the notification gets an "Approve" button.

## Tests

`ingress.rs` (reply delivered; killed bridge detected), `service.rs` (approve once; terminal answer
withdraws), and the real e2e `a_real_permission_request_is_approved_from_the_war_room` (skill `e2e`).
