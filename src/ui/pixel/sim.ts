// Who is where in the office and where they are heading. Pure and deterministic given the time:
// each session's agent, and each running subagent, is an actor that walks (4-way, over walkable
// tiles) to its goal.
import type { SessionView } from "../../domain/attention";
import { type Office, type Point, feetOf, findPath, tileOf } from "./office";

export type Dir = "down" | "up" | "left" | "right";
export type Pose = "walk" | "stand" | "desk" | "sofa";

export type Goal = {
  key: string;
  tile: Point;
  pose: Exclude<Pose, "walk">;
  face: Dir;
  /** Subagents: the session they work for, and where they appear (their agent's chair). */
  owner?: string;
  from?: Point;
};

export type Actor = {
  id: string;
  /** Feet position, pixels. */
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  path: Point[];
  goal: string;
  /** Distance walked, for the step animation. */
  walked: number;
  leaving: boolean;
  /** A subagent's session (its id is `subagentKey`); null for a session's own agent. */
  owner: string | null;
};

/** Actor id of a subagent. */
export const subagentKey = (agentId: string) => `sub:${agentId}`;

/** Pixels per millisecond: three tiles a second. */
const SPEED = 0.048;

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Idle agents drift between lounge spots every so often (each on its own rhythm). */
function wanderTurn(id: string, now: number): number {
  const period = 14_000 + (hash(id) % 9_000);
  return Math.floor((now + (hash(id) % period)) / period);
}

/** Subagents take a step round their agent's chair every few seconds (each desk on its own beat). */
function orbitTurn(id: string, now: number): number {
  const period = 5_000 + (hash(id) % 3_000);
  return Math.floor((now + (hash(id) % period)) / period);
}

/** Facing the chair from each slot of the ring (left, aisle left, aisle right, right). */
const SLOT_FACE: Dir[] = ["right", "up", "up", "left"];

/**
 * Where every visible agent wants to be now. Closed sessions have no agent. Running subagents stand
 * spread round their agent's chair and walk the ring; finished ones have no goal, so they leave.
 */
export function goals(office: Office, now: number): Map<string, Goal> {
  const out = new Map<string, Goal>();
  const idle: SessionView[] = [];
  for (const zone of office.zones) {
    for (const d of zone.desks) {
      const s = d.session;
      if (s.attention === "offline" || s.archived) continue;
      if (s.attention === "idle") idle.push(s);
      else out.set(s.id, { key: `desk:${d.seat.x},${d.seat.y}`, tile: d.seat, pose: "desk", face: "up" });
      const running = s.subagents.filter((a) => a.running).slice(0, d.slots.length);
      const turn = orbitTurn(s.id, now);
      running.forEach((a, i) => {
        const slot = (turn + Math.round((i * d.slots.length) / running.length)) % d.slots.length;
        const tile = d.slots[slot];
        out.set(subagentKey(a.id), {
          key: `slot:${tile.x},${tile.y}`,
          tile,
          pose: "stand",
          face: SLOT_FACE[slot] ?? "down",
          owner: s.id,
          from: d.seat,
        });
      });
    }
  }
  const taken = new Set<number>();
  for (const s of idle.sort((a, b) => a.id.localeCompare(b.id))) {
    if (office.spots.length === 0) break;
    let i = (hash(s.id) + wanderTurn(s.id, now)) % office.spots.length;
    for (let tries = 0; taken.has(i) && tries < office.spots.length; tries++) i = (i + 1) % office.spots.length;
    taken.add(i);
    const spot = office.spots[i];
    out.set(s.id, {
      key: `spot:${spot.tile.x},${spot.tile.y}`,
      tile: spot.tile,
      pose: spot.pose === "sit" ? "sofa" : "stand",
      face: spot.face,
    });
  }
  return out;
}

function place(id: string, tile: Point, goal: Goal | null, owner: string | null = goal?.owner ?? null): Actor {
  const feet = feetOf(tile);
  return {
    id,
    x: feet.x,
    y: feet.y,
    dir: goal?.face ?? "down",
    pose: goal?.pose ?? "stand",
    path: [],
    goal: goal?.key ?? "",
    walked: 0,
    leaving: false,
    owner,
  };
}

/**
 * Advances the actors `dt` milliseconds towards their goals. New agents come in through the door
 * and new subagents stand up from their agent's chair (or everyone appears at their goal when
 * `arrive` is false, e.g. on the first frame); actors without a goal walk out through the door and
 * disappear.
 */
export function step(actors: Map<string, Actor>, office: Office, targets: Map<string, Goal>, dt: number, arrive: boolean) {
  for (const [id, goal] of targets) {
    if (actors.has(id)) continue;
    actors.set(id, arrive ? place(id, goal.from ?? office.door, null, goal.owner ?? null) : place(id, goal.tile, goal));
  }
  for (const [id, actor] of actors) {
    const goal = targets.get(id) ?? null;
    const doorGoal: Goal = { key: "door", tile: office.door, pose: "stand", face: "up" };
    const target = goal ?? doorGoal;
    actor.leaving = goal === null;
    if (actor.goal !== target.key) {
      actor.goal = target.key;
      const from = tileOf(actor);
      actor.path = findPath(office, from, target.tile);
      // Unreachable (layout changed under it): just be there.
      if (actor.path.length === 0 && (from.x !== target.tile.x || from.y !== target.tile.y)) {
        Object.assign(actor, place(id, target.tile, target, actor.owner), { leaving: actor.leaving });
      }
    }
    move(actor, dt);
    if (actor.path.length > 0) actor.pose = "walk";
    else {
      if (actor.leaving) {
        actors.delete(id);
        continue;
      }
      actor.pose = target.pose;
      actor.dir = target.face;
    }
  }
}

function move(actor: Actor, dt: number) {
  let budget = SPEED * dt;
  while (budget > 0 && actor.path.length > 0) {
    const next = feetOf(actor.path[0]);
    const dx = next.x - actor.x;
    const dy = next.y - actor.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    actor.pose = "walk";
    if (dx !== 0) actor.dir = dx > 0 ? "right" : "left";
    else if (dy !== 0) actor.dir = dy > 0 ? "down" : "up";
    if (dist <= budget) {
      actor.x = next.x;
      actor.y = next.y;
      actor.path.shift();
      budget -= dist;
      actor.walked += dist;
    } else {
      // 4-way: finish the horizontal leg first.
      const along = Math.min(budget, Math.abs(dx));
      actor.x += Math.sign(dx) * along;
      actor.y += Math.sign(dy) * (budget - along);
      actor.walked += budget;
      budget = 0;
    }
  }
}
