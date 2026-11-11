import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WarRoomStore } from "../../application/warRoomStore";
import { agentName, closedSessions, providerName, roomHome, usageLabel, type WarRoomView } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { usePreference } from "../useStore";
import { ClosedShelf } from "./ClosedShelf";
import { DeskMenu } from "./DeskMenu";
import {
  type Hit,
  type Office,
  type Point,
  type RoomName,
  type Zone,
  TILE,
  cabinetAtPoint,
  deskAtPoint,
  doorwayAtPoint,
  fitOffice,
  fitViewport,
  zoneAtPoint,
} from "./office";
import { lobbyCount, paintOffice, subagentOf } from "./paint";
import { type Actor, goals, step } from "./sim";

type Props = {
  view: WarRoomView;
  store: WarRoomStore;
  showArchived: boolean;
  selectedId: string | null;
  selectedAgent: string | null;
  /** Show a repo's sessions in the classic view (from its cabinet of closed ones). */
  onShowRepo: (repoId: string) => void;
};

const FPS = 20;

const ROOMS = ["war", "lobby"] as const;

type SceneHit = { kind: "session"; hit: Hit } | { kind: "cabinet"; zone: Zone } | { kind: "door" };

/** What is under a point: the doorway, a cabinet, a subagent, an agent wherever it walks, then a desk. */
function sceneHit(office: Office, room: RoomName, actors: Map<string, Actor>, p: Point): SceneHit | null {
  if (doorwayAtPoint(office, room, p)) return { kind: "door" };
  const zone = cabinetAtPoint(office, p);
  if (zone) return { kind: "cabinet", zone };
  const hit = hitTest(office, actors, p);
  return hit ? { kind: "session", hit } : null;
}

function hitTest(office: Office, actors: Map<string, Actor>, p: Point): Hit | null {
  const sessionOf = (id: string) => office.zones.flatMap((z) => z.desks).find((d) => d.session.id === id)?.session;
  for (const actor of actors.values()) {
    if (actor.owner == null || !(p.x >= actor.x - 7 && p.x <= actor.x + 6 && p.y >= actor.y - 19 && p.y <= actor.y + 1)) continue;
    const session = sessionOf(actor.owner);
    const agent = session && subagentOf(session, actor);
    if (session && agent) return { session, agent };
  }
  for (const actor of actors.values()) {
    if (actor.owner != null) continue;
    if (p.x >= actor.x - 7 && p.x <= actor.x + 6 && p.y >= actor.y - 19 && p.y <= actor.y + 1) {
      const session = sessionOf(actor.id);
      if (session) return { session, agent: null };
    }
  }
  const d = deskAtPoint(office, p);
  return d ? { session: d.session, agent: null } : null;
}

/** The office in pixel art. Click: preview; double click: go to the session. */
export function WarRoomScene({ view, store, showArchived, selectedId, selectedAgent, onShowRepo }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The layout follows the room's size with no side panel or terminal open; they only scale the
  // view down (see `roomWidth`, `roomHeight`), so opening them neither reflows the room nor moves anyone.
  const [cssWidth, setCssWidth] = useState(1200);
  const [cssHeight, setCssHeight] = useState(() => window.innerHeight - 176);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [hoveredAt, setHovered] = useState<SceneHit | null>(null);
  const hovered = hoveredAt?.kind === "session" ? hoveredAt.hit : null;
  const hoveredZone = hoveredAt?.kind === "cabinet" ? hoveredAt.zone : null;
  const actors = useRef(new Map<string, Actor>());
  const [room, setRoom] = usePreference<RoomName>("awr.pixelRoom", "war", ROOMS);
  // The list of closed sessions, over the room (the canvas keeps its size and nobody is re-seated).
  const [showClosed, setShowClosed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; hit: Hit } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // Fill the window below the header, filters and room tabs: a wide window gets a wide room.
  const { office, scale } = useMemo(
    // Laid out again on every change of the room, which is when a lingering repo may leave.
    () => fitOffice(view, cssWidth, cssHeight, showArchived, Date.now(), room),
    [view, cssWidth, cssHeight, showArchived, room],
  );
  // Live state for the paint loop, so it is not restarted on every render.
  const band = office.bands[room];
  const fitted = fitViewport(office.width * scale, band.h * TILE * scale, available.width, available.height);
  const live = useRef({ office, scale, band, selectedId, selectedAgent, hovered: null as Hit | null, cabinet: null as string | null, door: false });
  live.current = {
    office,
    scale,
    band,
    selectedId,
    selectedAgent,
    hovered,
    cabinet: hoveredZone?.room.repo_id ?? null,
    door: hoveredAt?.kind === "door",
  };

  useEffect(() => {
    const el = box.current;
    const area = viewport.current;
    if (!el || !area) return;
    const measure = () => {
      setAvailable({ width: area.clientWidth, height: area.clientHeight });
      setCssWidth(Math.max(320, roomWidth(el)));
      setCssHeight(Math.max(160, roomHeight(area)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let raf = 0;
    let last = 0;
    let laidOutFor = "";
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 1000 / FPS) return;
      const dt = last ? Math.min(t - last, 250) : 0;
      last = t;
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const { office, scale, band, selectedId, selectedAgent, hovered, cabinet, door } = live.current;
      // Agents already there when the room opens are in place; later ones come through the door.
      // A new width (or a lobby pushed down by a new shelf of desks) moves everything: re-seat
      // everyone rather than have them all walk.
      const layout = `${office.width}:${office.bands.lobby.y}`;
      const relaid = laidOutFor !== layout;
      laidOutFor = layout;
      if (relaid) actors.current.clear();
      step(actors.current, office, goals(office, Date.now()), dt, !relaid);
      // One canvas pixel per screen (CSS) pixel: the art is scaled up by the transform, and names
      // can be drawn finer than the art. The canvas shows one room: its band of the office.
      const height = band.h * TILE * scale;
      if (c.width !== office.width * scale || c.height !== height) {
        c.width = office.width * scale;
        c.height = height;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, -band.y * TILE * scale);
      paintOffice(ctx, office, {
        frame: Math.floor(frame++ / 2),
        scale,
        now: new Date(),
        selected: selectedId,
        selectedAgent,
        hovered: hovered?.session.id ?? null,
        hoveredAgent: hovered?.agent?.id ?? null,
        hoveredCabinet: cabinet,
        hoveredDoor: door,
        actors: actors.current,
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pointOf = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left - 1) / (r.width - 2)) * office.width, y: band.y * TILE + ((e.clientY - r.top - 1) / (r.height - 2)) * band.h * TILE };
  };
  const at = (e: React.MouseEvent) => sceneHit(office, room, actors.current, pointOf(e));
  const zoneAt = (e: React.MouseEvent) => (room === "war" ? zoneAtPoint(office, pointOf(e)) : null);
  const switchRoom = (to: RoomName) => {
    setShowClosed(false);
    setRoom(to);
    setHovered(null);
    setMenu(null);
  };
  const resting = lobbyCount(office);
  const closedCount = closedSessions(view).reduce((n, g) => n + g.sessions.length, 0);

  return (
    <div className="pixel-room">
      <div className="pixel-stage" ref={box}>
        <div className="segmented pixel-rooms" role="group" aria-label={copy.pixel.rooms}>
          <button aria-pressed={!showClosed && room === "war"} onClick={() => switchRoom("war")}>
            {copy.pixel.warRoom}
          </button>
          <button aria-pressed={!showClosed && room === "lobby"} onClick={() => switchRoom("lobby")} title={copy.pixel.lobbyTitle}>
            {copy.pixel.lobby} <span className="muted">{resting}</span>
          </button>
          <button aria-pressed={showClosed} onClick={() => setShowClosed(!showClosed)} title={copy.pixel.closedTitle}>
            {copy.pixel.closed} <span className="muted">{closedCount}</span>
          </button>
        </div>
        {showClosed && <ClosedShelf view={view} store={store} />}
        <div className="pixel-viewport" ref={viewport}>
          <canvas
            ref={canvas}
            // Fit both axes without changing the office layout or cropping any of the room.
            style={{
              width: fitted.width,
              height: fitted.height,
              cursor: hoveredAt ? "pointer" : "default",
            }}
            data-shrunk={fitted.shrunk}
            onMouseMove={(e) => setHovered(menu ? null : at(e))}
            onMouseLeave={() => setHovered(null)}
            onContextMenu={(e) => {
              const found = at(e);
              if (found?.kind !== "session") {
                setMenu(null);
                // On a repo's deck, away from any console: start a new session in that repo.
                const zone = found ? null : zoneAt(e);
                const home = zone && roomHome(zone.room);
                if (home) {
                  e.preventDefault();
                  store.openLauncher(home);
                }
                return;
              }
              e.preventDefault();
              setHovered(null);
              const r = e.currentTarget.getBoundingClientRect();
              // Inside the stage, clear of its right and bottom edges.
              const x = Math.max(0, Math.min(e.clientX - r.left, r.width - 250)) + e.currentTarget.offsetLeft;
              const y = Math.max(0, Math.min(e.clientY - r.top, r.height - 270)) + e.currentTarget.offsetTop;
              setMenu({ x, y, hit: found.hit });
            }}
            onClick={(e) => {
              const found = at(e);
              if (found?.kind === "door") return switchRoom(room === "war" ? "lobby" : "war");
              if (found?.kind === "cabinet") return onShowRepo(found.zone.room.repo_id);
              const hit = found?.hit ?? null;
              if (!hit) store.closeDetail();
              else if (hit.agent) store.openSubagent(hit.session.id, hit.agent.id);
              else store.openDetail(hit.session.id);
            }}
            onDoubleClick={(e) => {
              const found = at(e);
              const hit = found?.kind === "session" ? found.hit : null;
              if (hit?.session.alive && !hit.agent) store.goTo(hit.session);
            }}
            role="img"
            aria-label={copy.pixel.canvasLabel}
          />
        </div>
        {hoveredZone && <div className="pixel-tip">{copy.pixel.cabinetTip(hoveredZone.folded.length)}</div>}
        {hoveredAt?.kind === "door" && <div className="pixel-tip">{room === "war" ? copy.pixel.toLobbyTip : copy.pixel.toWarTip}</div>}
        {menu && <DeskMenu at={menu} hit={menu.hit} store={store} onClose={closeMenu} />}
        {hovered && (
          <div className="pixel-tip">
            {hovered.agent ? (
              <>
                <strong>{agentName(hovered.agent)}</strong> ·{" "}
                {hovered.agent.running
                  ? (hovered.agent.last_tool ?? copy.session.subagentState(true))
                  : copy.session.subagentState(false)}
                <span className="muted">{copy.pixel.subagentOf(hovered.session.title)}</span>
              </>
            ) : (
              <>
                <strong>{hovered.session.title ?? hovered.session.worktree_path}</strong> · {hovered.session.status_label}
                <span className="muted">
                  {" · "}
                  {providerName(hovered.session.provider)}
                  {hovered.session.usage.total_tokens > 0 && ` · ${usageLabel(hovered.session.usage)}`}
                </span>
              </>
            )}
          </div>
        )}
        {office.zones.length === 0 && <p className="empty">{copy.pixel.empty}</p>}
      </div>
    </div>
  );
}

/** Bottom padding of `.content` in the pixel view with no terminal open (styles.css), plus the canvas border. */
const ROOM_BOTTOM = 18 + 2;

/** The viewport's height with no terminal taking room: from its top to the window's bottom. */
function roomHeight(area: HTMLElement): number {
  return document.documentElement.clientHeight - area.getBoundingClientRect().top - ROOM_BOTTOM;
}

/**
 * The stage's width with no side panel taking room: the window's width minus the page's own
 * margins around the stage (the panel only adds a margin to `.content`, which this leaves out).
 */
function roomWidth(stage: HTMLElement): number {
  const content = stage.closest<HTMLElement>(".content");
  if (!content) return stage.clientWidth;
  const css = getComputedStyle(content);
  const padding = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight);
  const stageLeft = stage.getBoundingClientRect().left - content.getBoundingClientRect().left - parseFloat(css.paddingLeft);
  return document.documentElement.clientWidth - padding - Math.max(0, stageLeft) * 2;
}
