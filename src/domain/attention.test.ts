import { describe, expect, it } from "vitest";
import { aRoom, aSession, aView } from "../test/fixtures";
import { copy } from "./copy";
import { activity, contextLabel, extraActivity, isWritable, modelName, neighbourSession, plainText, roomHome, toolDigest } from "./attention";

describe("presentation rules", () => {
  it("summarises model and context", () => {
    expect(modelName(aSession({ model: "claude-opus-5-5" }))).toBe("opus-5-5");
    expect(contextLabel(aSession({ context_tokens: 152_340 }))).toBe("152k");
    expect(contextLabel(aSession({ context_tokens: 1_200_000 }))).toBe("1.2M");
    expect(contextLabel(aSession())).toBeNull();
  });

  it("shows the detailed action only while working", () => {
    const s = aSession({ attention: "working", status_label: "Bash", last_action: "Bash · cargo test" });
    expect(activity(s)).toBe("Bash · cargo test");
    expect(activity({ ...s, attention: "finished", status_label: copy.attention.finished })).toBe(copy.attention.finished);
  });

  it("does not repeat the status the chip already shows", () => {
    expect(extraActivity(aSession({ attention: "finished", status_label: copy.attention.finished }))).toBeNull();
    expect(extraActivity(aSession({ attention: "needs_you", status_label: "Permission: Bash" }))).toBe("Permission: Bash");
  });

  it("flattens Markdown to plain text without gluing the heading to the sentence", () => {
    expect(plainText("## Done\n\nI **fixed** the `login`:\n\n- one\n- [two](http://x)")).toBe(
      "Done — I fixed the login: one two",
    );
  });

  it("groups consecutive tools by name", () => {
    expect(toolDigest(["Read · a.rs", "Read · b.rs", "Bash · ls"])).toBe("Read ×2 · Bash");
  });

  it("only writes to live sessions in an in-app terminal or tmux", () => {
    expect(isWritable(aSession({ pty_id: "p" }))).toBe(true);
    expect(isWritable(aSession({ tmux_pane: "%1" }))).toBe(true);
    expect(isWritable(aSession({ pty_id: "p", alive: false }))).toBe(false);
    expect(isWritable(aSession())).toBe(false);
  });

  it("opens new agents in the room's main checkout", () => {
    const room = aRoom("app", [
      aSession({ worktree_path: "/code/app-wt", is_linked_worktree: true }),
      aSession({ worktree_path: "/code/app" }),
    ]);
    expect(roomHome(room)).toBe("/code/app");
  });
});

describe("moving between sessions from the keyboard", () => {
  const view = aView([
    aRoom("a", [aSession({ id: "a1" }), aSession({ id: "a2", archived: true })]),
    aRoom("b", [aSession({ id: "b1" }), aSession({ id: "b2" })]),
  ]);
  const ids = (from: string | null, step: 1 | -1, archived = false) => neighbourSession(view, from, step, archived)?.id;

  it("follows the room's order, repo by repo, and wraps around", () => {
    expect([ids("a1", 1), ids("b1", 1), ids("b2", 1)]).toEqual(["b1", "b2", "a1"]);
    expect([ids("b1", -1), ids("a1", -1)]).toEqual(["a1", "b2"]);
  });

  it("starts at an end when nothing is open and skips dismissed sessions unless shown", () => {
    expect([ids(null, 1), ids(null, -1)]).toEqual(["a1", "b2"]);
    expect(ids("a1", 1, true)).toBe("a2");
    expect(neighbourSession(aView([]), null, 1, false)).toBeNull();
  });
});
