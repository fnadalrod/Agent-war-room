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
    expect(store.snapshot().integration?.installed).toBe(true);
  });

  it("only confirms the approval if the core accepted it", async () => {
    const store = storeWith({ approve: vi.fn().mockRejectedValue("already answered in the terminal") });
    store.approve(aSession());
    await vi.waitFor(() => expect(store.snapshot().error).toContain("terminal"));
    expect(store.snapshot().toast).toBeNull();
  });

  it("opens the in-app terminal when launching an agent in the app", async () => {
    const store = storeWith({ launch: vi.fn().mockResolvedValue({ pty_id: "pty-1", via: "app" }) });
    store.launch("/code/app", "app", "app");
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
});
