import { describe, expect, it, vi } from "vitest";
import { createDemo } from "../infrastructure/demoGateway";
import { aSession } from "../test/fixtures";
import { NO_FILTER, type Filter } from "../domain/attention";
import { WarRoomStore } from "./warRoomStore";

function storeWith(overrides: Partial<ReturnType<typeof createDemo>["rooms"]> = {}) {
  const demo = createDemo();
  return new WarRoomStore({ ...demo.rooms, ...overrides }, demo.integration, demo.terminals);
}

describe("WarRoomStore", () => {
  it("carga la vista y la integración al arrancar", async () => {
    const store = storeWith();
    await store.start();
    expect(store.snapshot().view?.rooms.length).toBeGreaterThan(0);
    expect(store.snapshot().integration?.installed).toBe(true);
  });

  it("solo confirma la aprobación si el núcleo la aceptó", async () => {
    const store = storeWith({ approve: vi.fn().mockRejectedValue("ya se había respondido en la terminal") });
    store.approve(aSession());
    await vi.waitFor(() => expect(store.snapshot().error).toContain("terminal"));
    expect(store.snapshot().toast).toBeNull();
  });

  it("abre el terminal propio al lanzar un agente en la app", async () => {
    const store = storeWith({ launch: vi.fn().mockResolvedValue({ pty_id: "pty-1", via: "app" }) });
    store.launch("/code/app", "app", "app");
    await vi.waitFor(() => expect(store.snapshot().terminal).toEqual({ id: "pty-1", label: "app" }));
  });

  it("navega de una sesión a su subagente y vuelve", async () => {
    const store = storeWith();
    await store.start();
    store.openSubagent("b2c3d4e5-tintero-inky", "x1");
    await vi.waitFor(() => expect(store.snapshot().detail?.agent?.data?.first_prompt).toContain("Buscar usos"));
    expect(store.snapshot().detail?.data?.session.id).toBe("b2c3d4e5-tintero-inky");
    store.backToSession();
    expect(store.snapshot().detail?.agent).toBeNull();
    expect(store.snapshot().detail?.id).toBe("b2c3d4e5-tintero-inky");
  });

  it("recuerda el filtro entre arranques", () => {
    let saved: Filter | null = { ...NO_FILTER, repos: ["/code/kainban/.git"] };
    const storage = { load: () => saved, save: (f: Filter) => void (saved = f) };
    const demo = createDemo();
    const store = new WarRoomStore(demo.rooms, demo.integration, demo.terminals, storage);
    expect(store.snapshot().filter.repos).toEqual(["/code/kainban/.git"]);

    store.toggleSkillFilter("close-task");
    store.toggleRepoFilter("/code/kainban/.git");
    expect(saved).toEqual({ ...NO_FILTER, skills: ["close-task"] });
    store.clearFilter();
    expect(saved).toEqual(NO_FILTER);
  });

  it("avisa sin romper cuando no se puede escribir en una sesión", async () => {
    const store = storeWith({ sendInput: vi.fn().mockRejectedValue("usa Ir a") });
    expect(await store.send(aSession(), "hola")).toBe(false);
    expect(store.snapshot().toast?.tone).toBe("warn");
  });
});
