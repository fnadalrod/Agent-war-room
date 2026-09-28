# Subagents

Delegable workers: a bounded task, done in their own context window, returning a short result. One file
per subagent with `name` + `description` frontmatter (+ `tools`, `model`). `.claude/agents` is a
symlink to this folder. Tools without a subagent runtime: treat each file as a playbook and follow it
yourself — the **output contract** still applies.

## The rule that decides

**Delegating only saves context when the subagent goes to *find* something you don't have.** If you
have to hand it the material, you pay twice (in its prompt and in its answer). All of these go and
fetch: real transcripts on disk, screenshots, the diff.

| | Skill | Subagent |
|---|---|---|
| Is | a procedure you follow | a worker you delegate to |
| Context | spends yours | spends its own, returns a summary |
| Good for | steps whose results you must see | reading a lot to deliver little |

## Catalogue

| Subagent | Delegate when | Returns |
|---|---|---|
| `awr-transcript-scout` | you need to know how Claude writes something in its JSONL transcripts or hook payloads (a field, an entry type, a subagent file) | the shape with a minimal real example, and where it was seen |
| `awr-screenshotter` | you changed UI and want to know if it looks right without loading images into your context | per-screenshot findings (overlaps, clipping, wrong colors, missing states) + paths |
| `awr-reviewer` | a large diff or a full context before committing | findings against the project invariants, most severe first; never edits |
