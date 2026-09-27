import { useEffect, useMemo, useRef, useState } from "react";
import type { WarRoomStore } from "../../application/warRoomStore";
import type { SessionView, WarRoomView } from "../../domain/attention";
import { SessionScreen } from "../SessionScreen";
import { hitTest, layoutScene, pixelScale } from "./layout";
import { paintScene } from "./paint";

type Props = { view: WarRoomView; store: WarRoomStore; now: number; showArchived: boolean };

const FPS = 8;

/** La sala en pixel art. Clic: inspeccionar; doble clic: ir a la sesión. */
export function WarRoomScene({ view, store, now, showArchived }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssWidth, setCssWidth] = useState(1200);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<SessionView | null>(null);

  const scale = pixelScale(cssWidth);
  const scene = useMemo(
    () => layoutScene(view, Math.floor(cssWidth / scale), showArchived),
    [view, cssWidth, scale, showArchived],
  );
  const selected = useMemo(
    () => view.rooms.flatMap((r) => r.sessions).find((s) => s.id === selectedId) ?? null,
    [view, selectedId],
  );

  // Estado vivo para el bucle de pintado sin reiniciarlo en cada render.
  const live = useRef({ scene, selectedId, hoveredId: null as string | null });
  live.current = { scene, selectedId, hoveredId: hovered?.id ?? null };

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
      const { scene, selectedId, hoveredId } = live.current;
      if (c.width !== scene.width || c.height !== scene.height) {
        c.width = scene.width;
        c.height = scene.height;
      }
      paintScene(ctx, scene, { frame: frame++, selected: selectedId, hovered: hoveredId, now: new Date() });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const at = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return hitTest(scene, ((e.clientX - r.left) / r.width) * scene.width, ((e.clientY - r.top) / r.height) * scene.height);
  };

  return (
    <div className="pixel-room" data-inspecting={selected != null}>
      <div className="pixel-stage" ref={box}>
        <canvas
          ref={canvas}
          style={{ width: scene.width * scale, height: scene.height * scale }}
          onMouseMove={(e) => setHovered(at(e))}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => setSelectedId(at(e)?.id ?? null)}
          onDoubleClick={(e) => {
            const s = at(e);
            if (s?.alive) store.goTo(s);
          }}
          role="img"
          aria-label="Sala de control: un puesto por sesión, coloreado por su estado"
        />
        {hovered && !selected && (
          <div className="pixel-tip">
            <strong>{hovered.title ?? hovered.worktree_path}</strong> · {hovered.status_label}
          </div>
        )}
        {scene.bays.length === 0 && <p className="empty">Sala vacía: los puestos aparecerán cuando un agente arranque.</p>}
      </div>
      {selected && (
        <aside className="inspector">
          <button className="close" onClick={() => setSelectedId(null)} aria-label="Cerrar inspector">
            ×
          </button>
          <SessionScreen session={selected} store={store} now={now} />
        </aside>
      )}
    </div>
  );
}
