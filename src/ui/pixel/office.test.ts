import { describe, expect, it } from "vitest";
import { aRoom, aSession, aView } from "../../test/fixtures";
import { deskAtPoint, feetOf, findPath, layoutOffice, pixelScale, TILE, WALL_ROWS } from "./office";
import { type Actor, goals, step } from "./sim";

const sessions = (prefix: string, n: number, attention: "working" | "idle" = "working") =>
  Array.from({ length: n }, (_, i) => aSession({ id: `${prefix}${i}`, attention }));

describe("layoutOffice", () => {
  it("gives each repo a zone under the wall, in order, with a desk and a free seat per session", () => {
    const office = layoutOffice(aView([aRoom("a", sessions("a", 2)), aRoom("b", sessions("b", 1))]), 480, false);
    expect(office.zones.map((z) => z.room.repo_name)).toEqual(["a", "b"]);
    for (const zone of office.zones) {
      expect(zone.rect.y).toBeGreaterThan(WALL_ROWS);
      for (const d of zone.desks) {
        expect(office.walkable[d.seat.y][d.seat.x]).toBe(true);
        expect(office.walkable[d.seat.y - 1][d.seat.x], "the desk itself blocks").toBe(false);
      }
    }
    expect(office.zones[1].rect.x).toBeGreaterThan(office.zones[0].rect.x + office.zones[0].rect.w);
  });

  it("wraps big repos into rows and zones into shelves, and leaves a lounge below", () => {
    const office = layoutOffice(aView([aRoom("big", sessions("g", 9)), aRoom("other", sessions("o", 2))]), 320, false);
    const [big, other] = office.zones;
    expect(new Set(big.desks.map((d) => d.seat.y)).size).toBeGreaterThan(1);
    expect(other.rect.y).toBeGreaterThan(big.rect.y);
    expect(office.lounge.y).toBeGreaterThanOrEqual(other.rect.y + other.rect.h);
    expect(office.spots.length).toBeGreaterThan(2);
    expect(office.height).toBe(office.rows * TILE);
  });

  it("every seat and lounge spot can be reached from the door", () => {
    const office = layoutOffice(aView([aRoom("a", sessions("a", 5)), aRoom("b", sessions("b", 3))]), 400, false, 500);
    for (const d of office.zones.flatMap((z) => z.desks)) expect(findPath(office, office.door, d.seat).length).toBeGreaterThan(0);
    for (const s of office.spots) expect(findPath(office, office.door, s.tile).length).toBeGreaterThan(0);
  });

  it("finds the desk under a point, and hides archived sessions unless asked", () => {
    const view = aView([aRoom("a", [aSession({ id: "x", archived: true }), aSession({ id: "y" })])]);
    const office = layoutOffice(view, 400, false);
    const d = office.zones[0].desks[0];
    expect(d.session.id).toBe("y");
    expect(deskAtPoint(office, feetOf(d.seat))?.session.id).toBe("y");
    expect(layoutOffice(view, 400, true).zones[0].desks).toHaveLength(2);
  });

  it("picks a comfortable scale", () => {
    expect([pixelScale(600), pixelScale(1200), pixelScale(2000)]).toEqual([2, 3, 4]);
  });
});

describe("sim", () => {
  const office = layoutOffice(
    aView([aRoom("a", [aSession({ id: "w", attention: "working" }), aSession({ id: "i", attention: "idle" }), aSession({ id: "o", attention: "offline" })])]),
    400,
    false,
    400,
  );

  it("sends working agents to their seat and idle ones to the lounge; closed ones have no agent", () => {
    const g = goals(office, 0);
    expect(g.get("w")?.pose).toBe("desk");
    expect(["stand", "sofa"]).toContain(g.get("i")?.pose);
    expect(g.has("o")).toBe(false);
  });

  it("new agents come in through the door and walk to their seat", () => {
    const actors = new Map<string, Actor>();
    const g = goals(office, 0);
    step(actors, office, g, 0, true);
    const w = actors.get("w")!;
    expect(w.pose).toBe("walk");
    for (let t = 0; t < 200; t++) step(actors, office, g, 100, true);
    expect(w.pose).toBe("desk");
    expect(w.dir).toBe("up");
    const seat = feetOf(office.zones[0].desks[0].seat);
    expect([w.x, w.y]).toEqual([seat.x, seat.y]);
  });

  it("on the first frame agents are already in place, and they leave through the door when gone", () => {
    const actors = new Map<string, Actor>();
    step(actors, office, goals(office, 0), 0, false);
    expect(actors.get("w")?.pose).toBe("desk");
    for (let t = 0; t < 300; t++) step(actors, office, new Map(), 100, true);
    expect(actors.size).toBe(0);
  });
});
