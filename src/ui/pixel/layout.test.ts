import { describe, expect, it } from "vitest";
import { aRoom, aSession, aView } from "../../test/fixtures";
import { DESK_W, hitTest, layoutScene, MARGIN, pixelScale, WALL_H } from "./layout";

const sessions = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => aSession({ id: `${prefix}${i}` }));

describe("layoutScene", () => {
  it("coloca una bahía por repo, bajo la pared, en el orden recibido", () => {
    const scene = layoutScene(aView([aRoom("a", sessions("a", 2)), aRoom("b", sessions("b", 1))]), 400, false);
    expect(scene.bays.map((b) => b.room.repo_name)).toEqual(["a", "b"]);
    const left = scene.bays[0].x - MARGIN;
    const right = 400 - MARGIN - (scene.bays[1].x + scene.bays[1].w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    expect(scene.bays[0].y).toBeGreaterThan(WALL_H);
    expect(scene.bays[1].x).toBeGreaterThan(scene.bays[0].x + scene.bays[0].w);
  });

  it("parte en filas los repos con más puestos de los que caben y salta de estantería", () => {
    const width = 4 * DESK_W + 40;
    const scene = layoutScene(aView([aRoom("grande", sessions("g", 7)), aRoom("otro", sessions("o", 2))]), width, false);
    const [big, other] = scene.bays;
    const rows = new Set(big.desks.map((d) => d.y));
    expect(rows.size).toBe(2);
    expect(other.y).toBeGreaterThan(big.y);
    expect(other.x).toBeGreaterThan(MARGIN);
    expect(scene.height).toBeGreaterThanOrEqual(other.y + other.h);
  });

  it("oculta archivadas salvo que se pidan y omite salas vacías", () => {
    const view = aView([aRoom("a", [aSession({ id: "x", archived: true })]), aRoom("b", sessions("b", 1))]);
    expect(layoutScene(view, 400, false).bays.map((b) => b.room.repo_name)).toEqual(["b"]);
    expect(layoutScene(view, 400, true).bays).toHaveLength(2);
  });

  it("llena al menos el alto pedido para que parezca una sala", () => {
    const tight = layoutScene(aView([aRoom("a", sessions("a", 1))]), 400, false);
    const scene = layoutScene(aView([aRoom("a", sessions("a", 1))]), 400, false, 300);
    expect(scene.height).toBe(300);
    expect(scene.bays[0].y).toBeGreaterThan(tight.bays[0].y);
    expect(scene.bays[0].y + scene.bays[0].h).toBeLessThan(300);
  });

  it("encuentra el puesto bajo el cursor", () => {
    const scene = layoutScene(aView([aRoom("a", sessions("a", 2))]), 400, false);
    const second = scene.bays[0].desks[1];
    expect(hitTest(scene, second.x + 5, second.y + 5)?.id).toBe("a1");
    expect(hitTest(scene, 1, 1)).toBeNull();
  });

  it("elige una escala entera según el ancho", () => {
    expect([pixelScale(600), pixelScale(820), pixelScale(1920)]).toEqual([2, 3, 4]);
  });
});
