import { useEffect, useMemo, useRef, useState } from "react";
import type { WarRoomStore } from "../../application/warRoomStore";
import { agentName, deskName, money, providerName, tokenCount, unpriced, usageLabel, type WarRoomView } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { type Hit, type Office, type Point, type Zone, cabinetAtPoint, deskAtPoint, layoutOffice, pixelScale } from "./office";
import { miniFeet, paintOffice } from "./paint";
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

type SceneHit = { kind: "session"; hit: Hit } | { kind: "cabinet"; zone: Zone };

/** What is under a point: a cabinet, a subagent, an agent wherever it walks, then a desk. */
function sceneHit(office: Office, actors: Map<string, Actor>, p: Point): SceneHit | null {
  const zone = cabinetAtPoint(office, p);
  if (zone) return { kind: "cabinet", zone };
  const hit = hitTest(office, actors, p);
  return hit ? { kind: "session", hit } : null;
}

function hitTest(office: Office, actors: Map<string, Actor>, p: Point): Hit | null {
  for (const zone of office.zones) {
    for (const d of zone.desks) {
      const i = d.session.subagents.slice(0, d.slots.length).findIndex((_, n) => {
        const f = miniFeet(d, n);
        return p.x >= f.x - 4 && p.x <= f.x + 4 && p.y >= f.y - 10 && p.y <= f.y + 1;
      });
      if (i >= 0) return { session: d.session, agent: d.session.subagents[i] };
    }
  }
  for (const actor of actors.values()) {
    if (p.x >= actor.x - 6 && p.x <= actor.x + 5 && p.y >= actor.y - 18 && p.y <= actor.y + 1) {
      const d = office.zones.flatMap((z) => z.desks).find((d) => d.session.id === actor.id);
      if (d) return { session: d.session, agent: null };
    }
  }
  const d = deskAtPoint(office, p);
  return d ? { session: d.session, agent: null } : null;
}

/** The office in pixel art. Click: preview; double click: go to the session. */
export function WarRoomScene({ view, store, showArchived, selectedId, selectedAgent, onShowRepo }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssWidth, setCssWidth] = useState(1200);
  const [hoveredAt, setHovered] = useState<SceneHit | null>(null);
  const hovered = hoveredAt?.kind === "session" ? hoveredAt.hit : null;
  const hoveredZone = hoveredAt?.kind === "cabinet" ? hoveredAt.zone : null;
  const actors = useRef(new Map<string, Actor>());

  const scale = pixelScale(cssWidth);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Fill the window below the header, not just the height of the zones.
  const minHeight = Math.max(0, (viewportH - 130) / scale);
  const office = useMemo(
    () => layoutOffice(view, Math.floor(cssWidth / scale), showArchived, minHeight),
    [view, cssWidth, scale, showArchived, minHeight],
  );
  const alerts = useMemo(
    () =>
      view.rooms
        .flatMap((r) => r.sessions)
        .filter((s) => s.attention === "needs_you" && !s.muted && !s.archived)
        .map((s) => s.title ?? deskName(s)),
    [view],
  );

  const today = view.today.total_tokens > 0
    ? `${tokenCount(view.today.total_tokens).toUpperCase()}${unpriced(view.today) ? "" : ` ${money(view.today.cost_usd)}`}`
    : null;
  // Live state for the paint loop, so it is not restarted on every render.
  const live = useRef({ office, selectedId, selectedAgent, alerts, today, hovered: null as Hit | null, cabinet: null as string | null });
  live.current = { office, selectedId, selectedAgent, alerts, today, hovered, cabinet: hoveredZone?.room.repo_id ?? null };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setCssWidth(Math.max(320, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    let raf = 0;
    let last = 0;
    let laidOutFor = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 1000 / FPS) return;
      const dt = last ? Math.min(t - last, 250) : 0;
      last = t;
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const { office, selectedId, selectedAgent, hovered, alerts, today, cabinet } = live.current;
      // Agents already there when the room opens are in place; later ones come through the door.
      // A new width moves every desk: re-seat everyone rather than have them all walk.
      const relaid = laidOutFor !== office.width;
      laidOutFor = office.width;
      if (relaid) actors.current.clear();
      step(actors.current, office, goals(office, Date.now()), dt, !relaid);
      if (c.width !== office.width || c.height !== office.height) {
        c.width = office.width;
        c.height = office.height;
      }
      paintOffice(ctx, office, {
        frame: Math.floor(frame++ / 2),
        now: new Date(),
        selected: selectedId,
        selectedAgent,
        hovered: hovered?.session.id ?? null,
        hoveredAgent: hovered?.agent?.id ?? null,
        alerts,
        today,
        hoveredCabinet: cabinet,
        actors: actors.current,
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const at = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * office.width, y: ((e.clientY - r.top) / r.height) * office.height };
    return sceneHit(office, actors.current, p);
  };

  return (
    <div className="pixel-room">
      <div className="pixel-stage" ref={box}>
        <canvas
          ref={canvas}
          style={{ width: office.width * scale, height: office.height * scale, cursor: hoveredAt ? "pointer" : "default" }}
          onMouseMove={(e) => setHovered(at(e))}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => {
            const found = at(e);
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
        {hoveredZone && <div className="pixel-tip">{copy.pixel.cabinetTip(hoveredZone.folded.length)}</div>}
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
