import { describe, expect, it } from "vitest";
import { aRoom, aSession, aView } from "../../test/fixtures";
import { DESK_W, hitTest, layoutScene, MARGIN, pixelScale, WALL_H } from "./layout";

const sessions = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => aSession({ id: `${prefix}${i}` }));

describe("layoutScene", () => {
  it("places one bay per repo, below the wall, in the given order", () => {
    const scene = layoutScene(aView([aRoom("a", sessions("a", 2)), aRoom("b", sessions("b", 1))]), 400, false);
    expect(scene.bays.map((b) => b.room.repo_name)).toEqual(["a", "b"]);
    const left = scene.bays[0].x - MARGIN;
    const right = 400 - MARGIN - (scene.bays[1].x + scene.bays[1].w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    expect(scene.bays[0].y).toBeGreaterThan(WALL_H);
    expect(scene.bays[1].x).toBeGreaterThan(scene.bays[0].x + scene.bays[0].w);
  });

  it("wraps repos with more desks than fit into rows and moves to the next shelf", () => {
    const width = 4 * DESK_W + 40;
    const scene = layoutScene(aView([aRoom("big", sessions("g", 7)), aRoom("other", sessions("o", 2))]), width, false);
    const [big, other] = scene.bays;
    const rows = new Set(big.desks.map((d) => d.y));
    expect(rows.size).toBe(2);
    expect(other.y).toBeGreaterThan(big.y);
    expect(other.x).toBeGreaterThan(MARGIN);
    expect(scene.height).toBeGreaterThanOrEqual(other.y + other.h);
  });

  it("hides archived sessions unless asked and skips empty rooms", () => {
    const view = aView([aRoom("a", [aSession({ id: "x", archived: true })]), aRoom("b", sessions("b", 1))]);
    expect(layoutScene(view, 400, false).bays.map((b) => b.room.repo_name)).toEqual(["b"]);
    expect(layoutScene(view, 400, true).bays).toHaveLength(2);
  });

  it("fills at least the requested height so it looks like a room", () => {
    const tight = layoutScene(aView([aRoom("a", sessions("a", 1))]), 400, false);
    const scene = layoutScene(aView([aRoom("a", sessions("a", 1))]), 400, false, 300);
    expect(scene.height).toBe(300);
    expect(scene.bays[0].y).toBeGreaterThan(tight.bays[0].y);
    expect(scene.bays[0].y + scene.bays[0].h).toBeLessThan(300);
  });

  it("finds the desk under the cursor", () => {
    const scene = layoutScene(aView([aRoom("a", sessions("a", 2))]), 400, false);
    const second = scene.bays[0].desks[1];
    expect(hitTest(scene, second.x + 20, second.y + 30)?.session.id).toBe("a1");
    expect(hitTest(scene, 1, 1)).toBeNull();
  });

  it("puts subagents in fixed clickable slots around the desk", () => {
    const agents = Array.from({ length: 7 }, (_, i) => ({
      id: `x${i}`,
      kind: null,
      description: null,
      last_tool: null,
      model: null,
      effort: null,
      running: true,
      started_at: i,
      finished_at: null,
    }));
    const scene = layoutScene(aView([aRoom("a", [aSession({ id: "s", subagents: agents })])]), 400, false);
    const desk = scene.bays[0].desks[0];
    expect(desk.drones).toHaveLength(5);
    expect(desk.hiddenDrones).toBe(2);
    for (const d of desk.drones) {
      expect(d.x).toBeGreaterThanOrEqual(desk.x);
      expect(d.x + d.w).toBeLessThanOrEqual(desk.x + desk.w);
    }
    const first = desk.drones[0];
    expect(hitTest(scene, first.x + 2, first.y + 2)).toMatchObject({ session: { id: "s" }, agent: { id: "x0" } });
    expect(hitTest(scene, desk.x + 24, desk.y + 34)?.agent).toBeNull();
  });

  it("picks an integer scale based on width", () => {
    expect([pixelScale(600), pixelScale(820), pixelScale(1920)]).toEqual([2, 3, 4]);
  });
});
