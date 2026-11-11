import { describe, expect, it } from "vitest";
import { aRoom, aSession, aView } from "../test/fixtures";
import { cleanOptions, launchChoices, launchFolders, resumeOptions } from "./launch";

describe("launch", () => {
  const view = aView([
    aRoom("b", [aSession({ id: "1", worktree_path: "/code/b", model: "claude-opus-5-5" })]),
    aRoom("a", [aSession({ id: "2", worktree_path: "/code/a", provider: "codex", model: "gpt-6-astra" })]),
  ]);

  it("suggests the agent's models plus the ones already used with it", () => {
    expect(launchChoices("claude", view).models).toEqual(["fable", "opus", "sonnet", "haiku", "claude-opus-5-5"]);
    expect(launchChoices("codex", view).models).toEqual(["gpt-6-astra"]);
    expect(launchChoices("cursor", view).efforts).toEqual([]);
  });

  it("offers every folder sessions ran in, sorted", () => {
    expect(launchFolders(view)).toEqual(["/code/a", "/code/b"]);
  });

  it("resumes with the session's own model and effort, never with odd names", () => {
    expect(resumeOptions({ provider: "claude", model: "claude-opus-5-5[1m]", effort: "high" })).toEqual({
      model: "claude-opus-5-5[1m]",
      effort: "high",
    });
    expect(resumeOptions({ provider: "cursor", model: "a model", effort: "high" })).toEqual({});
  });

  it("sends only what was chosen and what the agent has", () => {
    expect(cleanOptions("claude", { model: " opus ", effort: "", permission_mode: "plan", prompt: "  " })).toEqual({
      model: "opus",
      permission_mode: "plan",
    });
    expect(cleanOptions("cursor", { model: "x", effort: "high", permission_mode: "plan" })).toEqual({ model: "x" });
  });
});
