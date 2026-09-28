import { useEffect, useMemo, useRef, useState } from "react";
import type { WarRoomStore } from "../../application/warRoomStore";
import { agentName, deskName, type WarRoomView } from "../../domain/attention";
import { copy } from "../../domain/copy";
import { type Hit, hitTest, layoutScene, pixelScale } from "./layout";
import { paintScene } from "./paint";

type Props = {
  view: WarRoomView;
  store: WarRoomStore;
  showArchived: boolean;
  selectedId: string | null;
  selectedAgent: string | null;
};

const FPS = 10;

/** The room in pixel art. Click: preview; double click: go to the session. */
export function WarRoomScene({ view, store, showArchived, selectedId, selectedAgent }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssWidth, setCssWidth] = useState(1200);
  const [hovered, setHovered] = useState<Hit | null>(null);

  const scale = pixelScale(cssWidth);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Fill the window below the header, not just the height of the bays.
  const minHeight = Math.max(0, (viewportH - 130) / scale);
  const scene = useMemo(
    () => layoutScene(view, Math.floor(cssWidth / scale), showArchived, minHeight),
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
  const live = useRef({ scene, selectedId, selectedAgent, alerts, hovered: null as Hit | null });
  live.current = { scene, selectedId, selectedAgent, alerts, hovered };

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
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 1000 / FPS) return;
      last = t;
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const { scene, selectedId, selectedAgent, hovered, alerts } = live.current;
      if (c.width !== scene.width || c.height !== scene.height) {
        c.width = scene.width;
        c.height = scene.height;
      }
      paintScene(ctx, scene, {
        frame: frame++,
        selected: selectedId,
        selectedAgent,
        hovered: hovered?.session.id ?? null,
        hoveredAgent: hovered?.agent?.id ?? null,
        now: new Date(),
        alerts,
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const at = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return hitTest(scene, ((e.clientX - r.left) / r.width) * scene.width, ((e.clientY - r.top) / r.height) * scene.height);
  };

  return (
    <div className="pixel-room">
      <div className="pixel-stage" ref={box}>
        <canvas
          ref={canvas}
          style={{ width: scene.width * scale, height: scene.height * scale }}
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
              </>
            )}
          </div>
        )}
        {scene.bays.length === 0 && <p className="empty">{copy.pixel.empty}</p>}
      </div>
    </div>
  );
}
