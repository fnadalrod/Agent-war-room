import { describe, expect, it } from "vitest";
import { aRoom, aSession, aView } from "../test/fixtures";
import { applyFilter, filterOptions, isFiltering, NO_FILTER, toggle } from "./attention";

const skill = (name: string, source: "project" | "personal" | "plugin" | "builtin", by: "user" | "agent") => ({
  name,
  source,
  by_user: by === "user",
  by_agent: by === "agent",
  count: 1,
  last_at: 0,
});

const view = aView([
  aRoom("harbor", [
    aSession({ id: "t1", skills: [skill("close-task", "project", "agent")] }),
    aSession({ id: "t2", skills: [skill("claude-api", "builtin", "user")] }),
  ]),
  aRoom("trellis", [aSession({ id: "k1" })]),
]);

describe("filters", () => {
  it("returns the view untouched without a filter", () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(applyFilter(view, NO_FILTER)).toBe(view);
  });

  it("filters by repo", () => {
    const out = applyFilter(view, { ...NO_FILTER, repos: ["/code/trellis/.git"] });
    expect(out.rooms.map((r) => r.repo_name)).toEqual(["trellis"]);
  });

  it("filters by skill and drops rooms left empty", () => {
    const out = applyFilter(view, { ...NO_FILTER, skills: ["close-task"] });
    expect(out.rooms.map((r) => r.sessions.map((s) => s.id))).toEqual([["t1"]]);
  });

  it("filters by skill source", () => {
    const out = applyFilter(view, { ...NO_FILTER, sources: ["builtin"] });
    expect(out.rooms.flatMap((r) => r.sessions.map((s) => s.id))).toEqual(["t2"]);
  });

  it("offers the repos and skills present, with who launched them", () => {
    const { repos, skills } = filterOptions(view);
    expect(repos.map((r) => r.name)).toEqual(["harbor", "trellis"]);
    expect(skills.map((s) => [s.name, s.byUser, s.byAgent])).toEqual([
      ["claude-api", true, false],
      ["close-task", false, true],
    ]);
  });

  it("filters by model and effort", () => {
    const v = aView([
      aRoom("a", [
        aSession({ id: "opus", model: "claude-opus-5-5", effort: "high" }),
        aSession({ id: "sonnet", model: "claude-sonnet-5", effort: "medium" }),
        aSession({ id: "none" }),
      ]),
    ]);
    const ids = (f: Partial<typeof NO_FILTER>) => applyFilter(v, { ...NO_FILTER, ...f }).rooms.flatMap((r) => r.sessions.map((s) => s.id));
    expect(ids({ models: ["claude-sonnet-5"] })).toEqual(["sonnet"]);
    expect(ids({ efforts: ["high"] })).toEqual(["opus"]);
    const { models, efforts } = filterOptions(v);
    expect(efforts.map((e) => e.value)).toEqual(["medium", "high"]);
    expect(models).toHaveLength(2);
  });

  it("toggle adds and removes", () => {
    expect(toggle(toggle(["a"], "b"), "a")).toEqual(["b"]);
  });
});
