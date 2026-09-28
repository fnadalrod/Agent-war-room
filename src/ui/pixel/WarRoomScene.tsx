import { useEffect, useMemo, useRef, useState } from "react";
import type { WarRoomStore } from "../../application/warRoomStore";
import { agentName, deskName, providerName, type WarRoomView } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { type Hit, type Office, type Point, deskAtPoint, layoutOffice, pixelScale } from "./office";
import { miniFeet, paintOffice } from "./paint";
import { type Actor, goals, step } from "./sim";

type Props = {
  view: WarRoomView;
  store: WarRoomStore;
  showArchived: boolean;
  selectedId: string | null;
  selectedAgent: string | null;
};

const FPS = 20;

/** What is under a point: a subagent, then an agent wherever it walks, then a desk. */
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
export function WarRoomScene({ view, store, showArchived, selectedId, selectedAgent }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssWidth, setCssWidth] = useState(1200);
  const [hovered, setHovered] = useState<Hit | null>(null);
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

  // Live state for the paint loop, so it is not restarted on every render.
  const live = useRef({ office, selectedId, selectedAgent, alerts, hovered: null as Hit | null });
  live.current = { office, selectedId, selectedAgent, alerts, hovered };

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
      const { office, selectedId, selectedAgent, hovered, alerts } = live.current;
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
        actors: actors.current,
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const at = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * office.width, y: ((e.clientY - r.top) / r.height) * office.height };
    return hitTest(office, actors.current, p);
  };

  return (
    <div className="pixel-room">
      <div className="pixel-stage" ref={box}>
        <canvas
          ref={canvas}
          style={{ width: office.width * scale, height: office.height * scale, cursor: hovered ? "pointer" : "default" }}
          onMouseMove={(e) => setHovered(at(e))}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => {
            const hit = at(e);
            if (!hit) store.closeDetail();
            else if (hit.agent) store.openSubagent(hit.session.id, hit.agent.id);
            else store.openDetail(hit.session.id);
          }}
          onDoubleClick={(e) => {
            const hit = at(e);
            if (hit?.session.alive && !hit.agent) store.goTo(hit.session);
          }}
          role="img"
          aria-label={copy.pixel.canvasLabel}
        />
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
                <span className="muted"> · {providerName(hovered.session.provider)}</span>
              </>
            )}
          </div>
        )}
        {office.zones.length === 0 && <p className="empty">{copy.pixel.empty}</p>}
      </div>
    </div>
  );
}
