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
  aRoom("tintero", [
    aSession({ id: "t1", skills: [skill("close-task", "project", "agent")] }),
    aSession({ id: "t2", skills: [skill("claude-api", "builtin", "user")] }),
  ]),
  aRoom("kainban", [aSession({ id: "k1" })]),
]);

describe("filtros", () => {
  it("sin filtro devuelve la sala tal cual", () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(applyFilter(view, NO_FILTER)).toBe(view);
  });

  it("filtra por repo", () => {
    const out = applyFilter(view, { ...NO_FILTER, repos: ["/code/kainban/.git"] });
    expect(out.rooms.map((r) => r.repo_name)).toEqual(["kainban"]);
  });

  it("filtra por skill y quita las salas que se quedan vacías", () => {
    const out = applyFilter(view, { ...NO_FILTER, skills: ["close-task"] });
    expect(out.rooms.map((r) => r.sessions.map((s) => s.id))).toEqual([["t1"]]);
  });

  it("filtra por procedencia", () => {
    const out = applyFilter(view, { ...NO_FILTER, sources: ["builtin"] });
    expect(out.rooms.flatMap((r) => r.sessions.map((s) => s.id))).toEqual(["t2"]);
  });

  it("ofrece los repos y las skills que hay, con quién las lanzó", () => {
    const { repos, skills } = filterOptions(view);
    expect(repos.map((r) => r.name)).toEqual(["kainban", "tintero"]);
    expect(skills.map((s) => [s.name, s.byUser, s.byAgent])).toEqual([
      ["claude-api", true, false],
      ["close-task", false, true],
    ]);
  });

  it("toggle añade y quita", () => {
    expect(toggle(toggle(["a"], "b"), "a")).toEqual(["b"]);
  });
});
