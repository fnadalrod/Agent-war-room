# Transcript JSONL format (as observed)

> Leaf of `transcripts.mdc`. Read it when you parse a new entry type or a field looks wrong. The format
> is internal to Claude Code and **undocumented on purpose** — it changes between versions. Before
> relying on something, inspect a real file (or delegate to the `awr-transcript-scout` subagent, which
> reads MBs so you don't):
>
> ```sh
> python3 - ~/.claude/projects/<dir>/<session>.jsonl <<'EOF'
> import json,sys,collections
> c=collections.Counter(json.loads(l).get('type') for l in open(sys.argv[1]))
> print(c)
> EOF
> ```

## Entry types seen (Claude Code 2.1.x)

| `type` | Useful fields | Used for |
|---|---|---|
| `user` | `message.content` (string = typed prompt; list of `tool_result` = tool output; list of `text` blocks = prompt with attachments), `isMeta`, `isSidechain`, `timestamp` | first/last prompt, timeline |
| `assistant` | `message.{id, model, content[], usage}`, `effort`, `perTurnEffort`, `timestamp` | reply, tool actions, model, effort, usage |
| `ai-title` | `aiTitle` | session title |
| `custom-title` | `customTitle` (user rename, wins over ai-title) | session title |
| `last-prompt` | `lastPrompt` | last prompt |
| `system`, `attachment`, `mode`, `permission-mode`, `file-history-*`, `atis-latch` | — | ignored |

## Shapes that bite

- **One API message is written as several `assistant` lines** (one per content block, up to ~11),
  each repeating `message.id` and the same `usage`. Count usage once per `message.id`.
- Each message has at most one `text` block in practice; tools are `tool_use` blocks with `name` +
  `input` (summarised by `claude/tools.rs::tool_label`: `description`, then paths as file names, then
  command/pattern/url…).
- Slash commands appear as `user` content starting with `<command-name>/x</command-name>`: prompts
  starting with `<` are not shown as prompts.
- `message.model` can be `<synthetic>` for internal messages: ignore it.
- `timestamp` is ISO UTC with millis (`2026-09-27T22:44:39.232Z`), parsed by `parse_iso_ms`.

## Background shell commands (observed in Claude 2.1.282–2.1.289)

`user.toolUseResult.backgroundTaskId` confirms a running command. A user content string can contain
`<task-notification>` with one or more `<task-id>` tags and a terminal `<status>` (`completed`,
`failed`, `killed`, `stopped`). Remove every matching pending ID. Successful `TaskStop` tool results
carry `toolUseResult.task_id`; correlate with the assistant's tool-use ID and reject error results.
Some UI/Monitor/teardown stops have no marker until a resumed session reports orphan tasks; keep
them pending until observed rather than inventing completion. This is derived state, not a new hook.
