import { describe, expect, it, vi } from "vitest";
import { createDemo } from "../infrastructure/demoGateway";
import { aSession } from "../test/fixtures";
import { NO_FILTER, type Filter } from "../domain/attention";
import { copy } from "../domain/copy";
import { WarRoomStore } from "./warRoomStore";

function storeWith(overrides: Partial<ReturnType<typeof createDemo>["rooms"]> = {}) {
  const demo = createDemo();
  return new WarRoomStore({ ...demo.rooms, ...overrides }, demo.integration, demo.terminals);
}

describe("WarRoomStore", () => {
  it("loads the view and the integration on start", async () => {
    const store = storeWith();
    await store.start();
    expect(store.snapshot().view?.rooms.length).toBeGreaterThan(0);
    expect(store.snapshot().integrations.map((i) => i.provider)).toEqual(["claude", "codex", "cursor", "antigravity"]);
    expect(store.snapshot().integrations.every((i) => i.installed)).toBe(true);
  });

  it("only confirms the approval if the core accepted it", async () => {
    const store = storeWith({ approve: vi.fn().mockRejectedValue("already answered in the terminal") });
    store.approve(aSession());
    await vi.waitFor(() => expect(store.snapshot().error).toContain("terminal"));
    expect(store.snapshot().toast).toBeNull();
  });

  it("opens the in-app terminal when launching an agent in the app", async () => {
    const store = storeWith({ launch: vi.fn().mockResolvedValue({ pty_id: "pty-1", via: "app" }) });
    store.launch("codex", "/code/app", "app", "app");
    await vi.waitFor(() => expect(store.snapshot().terminal).toEqual({ id: "pty-1", label: "app" }));
  });

  it("navigates from a session to its subagent and back", async () => {
    const store = storeWith();
    await store.start();
    store.openSubagent("b2c3d4e5-harbor-pixie", "x1");
    await vi.waitFor(() => expect(store.snapshot().detail?.agent?.data?.first_prompt).toContain("Find usages"));
    expect(store.snapshot().detail?.data?.session.id).toBe("b2c3d4e5-harbor-pixie");
    store.backToSession();
    expect(store.snapshot().detail?.agent).toBeNull();
    expect(store.snapshot().detail?.id).toBe("b2c3d4e5-harbor-pixie");
  });

  it("loads the complete conversation only when requested", async () => {
    const demo = createDemo();
    const detail = vi.fn(demo.rooms.detail);
    const store = storeWith({ detail });
    await store.start();
    const id = "a1b2c3d4-harbor-sync";
    store.openDetail(id);
    await vi.waitFor(() => expect(store.snapshot().detail?.data).not.toBeNull());
    expect(detail).toHaveBeenCalledWith(id, false);

    store.loadFullHistory();
    await vi.waitFor(() => expect(store.snapshot().detail?.history.full).toBe(true));
    expect(detail).toHaveBeenLastCalledWith(id, true);
  });

  it("moves a reviewed finished session to idle while keeping its detail", async () => {
    const store = storeWith();
    await store.start();
    const id = "c3d4e5f6-harbor-docs";
    store.openDetail(id);
    await vi.waitFor(() => expect(store.snapshot().detail?.data?.session.attention).toBe("idle"));
    expect(store.snapshot().detail?.id).toBe(id);
    expect(store.snapshot().view?.rooms.flatMap((r) => r.sessions).find((s) => s.id === id)?.attention).toBe("idle");
  });

  it("does not acknowledge working sessions or a subagent result", async () => {
    const markSeen = vi.fn().mockResolvedValue(undefined);
    const store = storeWith({ markSeen });
    await store.start();
    store.openDetail("a1b2c3d4-harbor-sync");
    await vi.waitFor(() => expect(store.snapshot().detail?.data).not.toBeNull());
    store.readAnswer("c3d4e5f6-harbor-docs", "child");
    expect(markSeen).not.toHaveBeenCalled();
    store.readAnswer("c3d4e5f6-harbor-docs");
    expect(markSeen).toHaveBeenCalledWith("c3d4e5f6-harbor-docs");
  });

  it("remembers the filter across launches", () => {
    let saved: Filter | null = { ...NO_FILTER, repos: ["/code/trellis/.git"] };
    const storage = { load: () => saved, save: (f: Filter) => void (saved = f) };
    const demo = createDemo();
    const store = new WarRoomStore(demo.rooms, demo.integration, demo.terminals, storage);
    expect(store.snapshot().filter.repos).toEqual(["/code/trellis/.git"]);

    store.toggleSkillFilter("close-task");
    store.toggleRepoFilter("/code/trellis/.git");
    expect(saved).toEqual({ ...NO_FILTER, skills: ["close-task"] });
    store.clearFilter();
    expect(saved).toEqual(NO_FILTER);
  });

  it("says so when nothing is waiting for the next jump", async () => {
    const store = storeWith({ focusNext: vi.fn().mockResolvedValue(null) });
    store.goNext();
    await vi.waitFor(() => expect(store.snapshot().toast?.text).toBe(copy.topbar.nothingWaiting));
  });

  it("loads changes on demand and opens a commit diff over the preview", async () => {
    const store = storeWith();
    await store.start();
    store.openDetail("a1b2c3d4-harbor-sync");
    expect(store.snapshot().detail?.changes).toBeNull();
    store.loadChanges();
    await vi.waitFor(() => expect(store.snapshot().detail?.changes?.data?.commits.length).toBeGreaterThan(0));
    const commit = store.snapshot().detail!.changes!.data!.commits[0];
    store.openDiff(commit.hash, commit.short);
    await vi.waitFor(() => expect(store.snapshot().detail?.diff?.text).toContain("diff --git"));
    store.closeDiff();
    expect(store.snapshot().detail?.diff).toBeNull();
  });

  it("warns without breaking when a session cannot be written to", async () => {
    const store = storeWith({ sendInput: vi.fn().mockRejectedValue("use Go to") });
    expect(await store.send(aSession(), "hello")).toBe(false);
    expect(store.snapshot().toast?.tone).toBe("warn");
  });

  it("delivers structured answers through the question channel", async () => {
    const answerQuestion = vi.fn().mockResolvedValue(undefined);
    const store = storeWith({ answerQuestion });
    const session = aSession({ can_answer_question: true });
    const answers = { "Which database?": "SQLite" };

    expect(await store.answerQuestion(session, answers)).toBe(true);
    expect(answerQuestion).toHaveBeenCalledWith(session.id, answers);
    expect(store.snapshot().toast?.text).toBe(copy.toasts.questionAnswered);
  });
});
