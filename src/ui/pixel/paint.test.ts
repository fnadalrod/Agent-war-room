import { expect, it } from "vitest";
import { aRoom, aSession, aView } from "../../test/fixtures";
import { layoutOffice } from "./office";
import { paintOffice } from "./paint";

it("keeps animated terminal lines inside the monitor with a one-pixel margin", () => {
  const office = layoutOffice(aView([aRoom("repo", [aSession({ attention: "working" })])]), 480, false);
  const desk = office.zones[0].desks[0];
  const left = desk.cell.x + Math.floor(desk.cell.w / 2) - 7;
  const lines: Array<{ x: number; w: number }> = [];
  const ctx = {
    fillStyle: "", globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(x: number, y: number, w: number) {
      if (y >= desk.desk.y - 8 && y < desk.desk.y &&
          (this.fillStyle === "#34d27a" || this.fillStyle === "#a7f3c9")) lines.push({ x, w });
    },
  };
  for (let frame = 0; frame < 120; frame++) {
    paintOffice(ctx as unknown as CanvasRenderingContext2D, office, {
      frame, scale: 3, now: new Date(0), selected: null, selectedAgent: null,
      hovered: null, hoveredAgent: null, alerts: [], today: null,
      hoveredCabinet: null, hoveredDoor: false, actors: new Map(),
    });
  }
  expect(lines).toHaveLength(480);
  for (const line of lines) {
    expect(line.x).toBeGreaterThanOrEqual(left + 1);
    expect(line.x + line.w).toBeLessThanOrEqual(left + 13);
  }
});
