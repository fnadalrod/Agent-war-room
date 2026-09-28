import { describe, expect, it } from "vitest";
import { aRoom, aSession, aSubagent, aView } from "../../test/fixtures";
import { cabinetAtPoint, deskAtPoint, doorwayAtPoint, FOLD_AFTER, feetOf, findPath, layoutOffice, pixelScale, TILE, WALL_ROWS } from "./office";
import { type Actor, goals, step, subagentKey } from "./sim";

const sessions = (prefix: string, n: number, attention: "working" | "idle" = "working") =>
  Array.from({ length: n }, (_, i) => aSession({ id: `${prefix}${i}`, attention }));

describe("layoutOffice", () => {
  it("gives each repo a zone under the wall, in order, with a desk and a free seat per session", () => {
    const office = layoutOffice(aView([aRoom("a", sessions("a", 2)), aRoom("b", sessions("b", 1))]), 480, false);
    expect(office.zones.map((z) => z.room.repo_name)).toEqual(["a", "b"]);
    for (const zone of office.zones) {
      expect(zone.rect.y).toBeGreaterThan(WALL_ROWS);
      for (const d of zone.desks) {
        expect(office.walkable[d.seat.y][d.seat.x], "a chair is not a corridor").toBe(false);
        for (const slot of d.slots) expect(office.walkable[slot.y][slot.x]).toBe(true);
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

  it("a busy repo keeps desks for live sessions and puts the closed ones in a cabinet", () => {
    const live = sessions("l", 3);
    const closed = Array.from({ length: 4 }, (_, i) => aSession({ id: `c${i}`, attention: "offline" }));
    const office = layoutOffice(aView([aRoom("busy", [...live, ...closed])]), 480, false);
    const zone = office.zones[0];
    expect(zone.desks.map((d) => d.session.id)).toEqual(["l0", "l1", "l2"]);
    expect(zone.folded).toHaveLength(4);
    expect(cabinetAtPoint(office, { x: zone.cabinet!.x * TILE + 8, y: zone.cabinet!.y * TILE + 8 })?.room.repo_name).toBe("busy");
    // A small repo keeps every desk, closed or not.
    const small = layoutOffice(aView([aRoom("small", [...live, closed[0]])]), 480, false).zones[0];
    expect(small.desks).toHaveLength(FOLD_AFTER);
    expect(small.cabinet).toBeNull();
  });

  it("the lounge grows until every idle agent has a spot of its own", () => {
    const office = layoutOffice(aView([aRoom("lazy", sessions("i", 30, "idle"))]), 400, false);
    expect(office.spots.length).toBeGreaterThanOrEqual(30);
    const taken = new Set([...goals(office, 0).values()].map((g) => g.key));
    expect(taken.size).toBe(30);
    for (const s of office.spots) expect(findPath(office, office.door, s.tile).length).toBeGreaterThan(0);
  });

  it("puts the lounge in a lobby under the war room, behind a wall with one doorway", () => {
    const office = layoutOffice(aView([aRoom("a", sessions("a", 3)), aRoom("b", sessions("b", 2, "idle"))]), 400, false, 300);
    const { war, lobby } = office.bands;
    expect(lobby.y).toBe(war.y + war.h);
    expect(lobby.y + lobby.h).toBe(office.rows);
    expect(Math.min(war.h, lobby.h), "each room fills the window").toBeGreaterThanOrEqual(Math.floor(300 / TILE));
    for (const d of office.zones.flatMap((z) => z.desks)) expect(d.seat.y).toBeLessThan(war.h);
    for (const s of office.spots) expect(s.tile.y).toBeGreaterThanOrEqual(lobby.y + WALL_ROWS);
    // The only way between the rooms is the doorway.
    const crossings = [...Array(office.cols).keys()].filter((c) => office.walkable[war.h - 1][c]);
    expect(crossings).toEqual([office.lobbyDoor.x]);
    for (let r = lobby.y; r < lobby.y + WALL_ROWS; r++) expect(office.walkable[r].filter(Boolean)).toHaveLength(1);
    const through = findPath(office, office.door, office.spots[0].tile);
    expect(through).toContainEqual(office.lobbyDoor);
  });

  it("clicks the doorway from either room", () => {
    const office = layoutOffice(aView([aRoom("a", sessions("a", 2))]), 400, false, 300);
    const doorway = feetOf(office.lobbyDoor);
    expect(doorwayAtPoint(office, "war", { x: doorway.x, y: doorway.y - TILE })).toBe(true);
    expect(doorwayAtPoint(office, "lobby", { x: doorway.x, y: (office.bands.lobby.y + WALL_ROWS) * TILE - 4 })).toBe(true);
    expect(doorwayAtPoint(office, "war", { x: doorway.x + 3 * TILE, y: doorway.y })).toBe(false);
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

describe("subagents", () => {
  const withSubagents = (running: boolean[]) =>
    layoutOffice(
      aView([aRoom("a", [aSession({ id: "w", attention: "working", subagents: running.map((r, i) => aSubagent({ id: `s${i}`, running: r })) })])]),
      400,
      false,
      400,
    );
  const walk = (actors: Map<string, Actor>, office: ReturnType<typeof layoutOffice>, at: number, ms: number) => {
    for (let t = 0; t < ms; t += 100) step(actors, office, goals(office, at), 100, true);
  };

  it("running ones stand spread round their agent's chair; finished ones are not there", () => {
    const office = withSubagents([true, true, false]);
    const desk = office.zones[0].desks[0];
    const g = goals(office, 0);
    const a = g.get(subagentKey("s0"))!;
    const b = g.get(subagentKey("s1"))!;
    expect(desk.slots).toContainEqual(a.tile);
    expect(desk.slots).toContainEqual(b.tile);
    expect(a.tile, "spread, not side by side").not.toEqual(b.tile);
    expect(a.owner).toBe("w");
    expect(g.has(subagentKey("s2"))).toBe(false);
  });

  it("they stand up from the chair, then walk the ring as time goes by", () => {
    const office = withSubagents([true]);
    const desk = office.zones[0].desks[0];
    const actors = new Map<string, Actor>();
    step(actors, office, goals(office, 0), 0, true);
    const mini = actors.get(subagentKey("s0"))!;
    expect([mini.x, mini.y]).toEqual([feetOf(desk.seat).x, feetOf(desk.seat).y]);
    const seen = new Set<string>();
    for (let at = 0; at < 60_000; at += 2_000) {
      walk(actors, office, at, 2_000);
      seen.add(`${Math.round(mini.x)},${Math.round(mini.y)}`);
    }
    expect(seen.size, "it moves round the chair").toBeGreaterThan(2);
  });

  it("when they finish they walk out through the door", () => {
    const office = withSubagents([true]);
    const actors = new Map<string, Actor>();
    step(actors, office, goals(office, 0), 0, false);
    expect(actors.has(subagentKey("s0"))).toBe(true);
    const done = withSubagents([false]);
    step(actors, done, goals(done, 0), 100, true);
    expect(actors.get(subagentKey("s0"))?.leaving).toBe(true);
    walk(actors, done, 0, 30_000);
    expect(actors.has(subagentKey("s0"))).toBe(false);
    expect(actors.has("w"), "their agent stays").toBe(true);
  });

  it("a closed session's subagents leave too", () => {
    const office = layoutOffice(
      aView([aRoom("a", [aSession({ id: "o", attention: "offline", subagents: [aSubagent({ id: "s0", running: true })] })])]),
      400,
      false,
      400,
    );
    expect(goals(office, 0).has(subagentKey("s0"))).toBe(false);
  });
});

describe("what the room shows", () => {
  it("usage grows on a log scale and tools read at a glance", async () => {
    const { coinStack, paperStack, toolGlyph } = await import("./paint");
    expect([0, 500_000, 5_000_000, 40_000_000, 500_000_000].map(paperStack)).toEqual([0, 1, 2, 4, 5]);
    expect([0, 0.4, 3, 60].map(coinStack)).toEqual([0, 1, 2, 5]);
    expect(["Bash · npm test", "run_command", "Read · a.rs", "view_file", "StrReplace", "Grep · x", "WebFetch", "Task", "TodoWrite", null].map(toolGlyph)).toEqual(
      ["$", "$", "R", "R", "E", "S", "W", "A", null, null],
    );
  });
});
