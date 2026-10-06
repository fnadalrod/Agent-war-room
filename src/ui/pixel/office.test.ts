import { describe, expect, it } from "vitest";
import { aRoom, aSession, aSubagent, aView } from "../../test/fixtures";
import { cabinetAtPoint, deskAtPoint, doorwayAtPoint, FOLD_AFTER, feetOf, findPath, fitViewport, layoutOffice, pixelScale, TILE, WALL_ROWS, WAR_WALL_ROWS } from "./office";
import { type Actor, goals, step, subagentKey } from "./sim";
import { lobbyCount } from "./paint";

const sessions = (prefix: string, n: number, attention: "working" | "idle" = "working") =>
  Array.from({ length: n }, (_, i) => aSession({ id: `${prefix}${i}`, attention }));

describe("layoutOffice", () => {
  it("fits a tall room, a narrow preview and expanded filters without cropping or stretching", () => {
    for (const [width, height] of [[1000, 600], [450, 850], [1000, 250]]) {
      const fitted = fitViewport(1440, 1200, width, height);
      expect(fitted.width).toBeLessThanOrEqual(width);
      expect(fitted.height).toBeLessThanOrEqual(height);
      expect((fitted.width - 2) / (fitted.height - 2)).toBeCloseTo(1440 / 1200);
      expect(fitted.shrunk).toBe(true);
    }
    expect(fitViewport(1440, 1200, 1800, 1600)).toEqual({ width: 1442, height: 1202, shrunk: false });
    expect(fitViewport(1440, 1200, 0, 0)).toEqual({ width: 0, height: 0, shrunk: true });
  });
  it("gives each repo a zone under the wall, in order, with a desk and a free seat per session", () => {
    const office = layoutOffice(aView([aRoom("a", sessions("a", 2)), aRoom("b", sessions("b", 1))]), 480, false);
    expect(office.zones.map((z) => z.room.repo_name)).toEqual(["a", "b"]);
    for (const zone of office.zones) {
      expect(zone.rect.y).toBeGreaterThan(WAR_WALL_ROWS);
      for (const d of zone.desks) {
        expect(office.walkable[d.seat.y][d.seat.x], "a chair is not a corridor").toBe(false);
        for (const slot of d.slots) expect(office.walkable[slot.y][slot.x]).toBe(true);
        expect(office.walkable[d.seat.y - 1][d.seat.x], "the desk itself blocks").toBe(false);
      }
    }
    expect(office.zones[1].rect.x).toBeGreaterThan(office.zones[0].rect.x + office.zones[0].rect.w);
  });

  it("keeps the tall command wall out of the navigation grid without enlarging the lobby wall", () => {
    const office = layoutOffice(aView([aRoom("a", sessions("a", 2))]), 480, false);
    for (let row = 0; row < WAR_WALL_ROWS; row++) expect(office.walkable[row].some(Boolean)).toBe(false);
    expect(office.door.y).toBe(WAR_WALL_ROWS);
    expect(office.walkable[office.door.y][office.door.x]).toBe(true);
    const lobbyFloor = office.bands.lobby.y + WALL_ROWS;
    expect(office.walkable[lobbyFloor][office.lobbyDoor.x - 1]).toBe(true);
    for (const desk of office.zones.flatMap((z) => z.desks)) {
      expect(findPath(office, office.door, desk.seat).length).toBeGreaterThan(0);
    }
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

  it("hides empty repositories but keeps a module while its principal rests in the lobby", () => {
    const view = aView([
      aRoom("closed", [aSession({ attention: "offline" })]),
      aRoom("dismissed", [aSession({ archived: true })]),
      aRoom("resting", [aSession({ attention: "idle" })]),
    ]);
    for (const archived of [false, true]) {
      expect(layoutOffice(view, 400, archived).zones.map((z) => z.room.repo_name)).toEqual(["resting"]);
    }
  });

  it("the lounge grows until every idle agent has a spot of its own", () => {
    const office = layoutOffice(aView([aRoom("lazy", sessions("i", 30, "idle"))]), 400, false);
    expect(office.spots.length).toBeGreaterThanOrEqual(30);
    const taken = new Set([...goals(office, 0).values()].map((g) => g.key));
    expect(taken.size).toBe(30);
    for (const s of office.spots) expect(findPath(office, office.door, s.tile).length).toBeGreaterThan(0);
  });

  it.each([160, 304, 480, 624])("keeps furnished lounge routes and seats usable at width %i", (width) => {
    const office = layoutOffice(aView([aRoom("resting", sessions("i", 30, "idle"))]), width, false, 320);
    const occupied = new Set<string>();
    for (const prop of office.props) {
      const size = prop.kind === "sofa" ? 2 : 1;
      for (let dx = 0; dx < size; dx++) {
        const key = `${prop.x + dx},${prop.y}`;
        expect(occupied.has(key), "furniture footprints do not overlap").toBe(false);
        occupied.add(key);
        expect(prop.x + dx).toBeLessThan(office.cols - 1);
        expect(office.walkable[prop.y][prop.x + dx]).toBe(false);
      }
    }
    const spots = office.spots.map((s) => `${s.tile.x},${s.tile.y}`);
    expect(new Set(spots).size).toBe(spots.length);
    expect(spots.length).toBeGreaterThanOrEqual(30);
    for (const spot of office.spots) {
      if (spot.pose === "stand") expect(occupied.has(`${spot.tile.x},${spot.tile.y}`)).toBe(false);
      const path = findPath(office, office.door, spot.tile);
      expect(path.length).toBeGreaterThan(0);
      for (const tile of path.slice(0, -1)) expect(occupied.has(`${tile.x},${tile.y}`)).toBe(false);
    }
    expect(new Set(office.props.filter((p) => p.kind === "sofa").map((p) => p.y)).size).toBeGreaterThan(1);
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

  it("running teammates surround the principal and finished ones rest in the lobby", () => {
    const office = withSubagents([true, true, false]);
    const desk = office.zones[0].desks[0];
    const g = goals(office, 0);
    const a = g.get(subagentKey("s0"))!;
    const b = g.get(subagentKey("s1"))!;
    expect(desk.slots).toContainEqual(a.tile);
    expect(desk.slots).toContainEqual(b.tile);
    expect(a.tile, "spread, not side by side").not.toEqual(b.tile);
    expect(a.owner).toBe("w");
    expect(g.get(subagentKey("s2"))!.tile.y).toBeGreaterThan(office.bands.lobby.y);
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

  it("when they finish they walk to the lobby and remain inspectable", () => {
    const office = withSubagents([true]);
    const actors = new Map<string, Actor>();
    step(actors, office, goals(office, 0), 0, false);
    expect(actors.has(subagentKey("s0"))).toBe(true);
    const done = withSubagents([false]);
    step(actors, done, goals(done, 0), 100, true);
    expect(actors.get(subagentKey("s0"))?.leaving).toBe(false);
    walk(actors, done, 0, 30_000);
    expect(actors.get(subagentKey("s0"))!.y).toBeGreaterThan(done.bands.lobby.y * TILE);
    expect(actors.has("w"), "their agent stays").toBe(true);
  });

  it("gives every teammate space, including teams larger than the old four-person ring", () => {
    const office = withSubagents(Array(9).fill(true));
    const targets = goals(office, 0);
    expect(targets.size).toBe(10);
    expect(new Set([...targets.values()].map((g) => `${g.tile.x},${g.tile.y}`)).size).toBe(10);
    for (const goal of targets.values()) expect(findPath(office, office.door, goal.tile).length).toBeGreaterThan(0);
  });

  it("pairs resting teammates face to face and reserves enough lobby space", () => {
    const office = withSubagents(Array(30).fill(false));
    const targets = goals(office, 0);
    const a = targets.get(subagentKey("s0"))!;
    const b = targets.get(subagentKey("s1"))!;
    expect(a.face).toBe("right");
    expect(b.face).toBe("left");
    expect(b.tile).toEqual({ x: a.tile.x + 1, y: a.tile.y });
    expect(office.spots.length).toBeGreaterThanOrEqual(30);
    expect(lobbyCount(office)).toBe(30);
    expect(new Set([...targets.values()].map((g) => `${g.tile.x},${g.tile.y}`)).size).toBe(31);
  });

  it.each([160, 480])("separates resting principals and teammates into reachable rooms at width %i", (width) => {
    const office = layoutOffice(aView([aRoom("team", [aSession({
      id: "principal", attention: "idle", subagents: [aSubagent({ id: "helper", running: false })],
    })])]), width, false);
    for (const now of [0, 20_000, 36_000, 58_000]) {
      const targets = goals(office, now);
      for (const [id, room] of [["principal", office.lounges.principals], [subagentKey("helper"), office.lounges.team]] as const) {
        const tile = targets.get(id)!.tile;
        expect(tile.x).toBeGreaterThanOrEqual(room.rect.x);
        expect(tile.x).toBeLessThan(room.rect.x + room.rect.w);
        expect(tile.y).toBeGreaterThanOrEqual(room.rect.y);
        expect(tile.y).toBeLessThan(room.rect.y + room.rect.h);
        expect(findPath(office, office.door, tile).length).toBeGreaterThan(0);
      }
    }
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
