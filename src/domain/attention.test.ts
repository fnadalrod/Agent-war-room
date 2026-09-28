import { describe, expect, it } from "vitest";
import { aRoom, aSession } from "../test/fixtures";
import { copy } from "./copy";
import { activity, contextLabel, extraActivity, isWritable, modelName, plainText, roomHome, toolDigest } from "./attention";

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
