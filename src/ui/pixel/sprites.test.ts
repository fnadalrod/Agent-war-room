import { describe, expect, it } from "vitest";
import { MINI, body, lounging, seated, waving } from "./sprites";

describe("sprites", () => {
  it("every pose is a clean rectangle of known pixels", () => {
    const poses = [
      ...(["down", "up", "left", "right"] as const).flatMap((f) => [body(f, false, 0), body(f, true, 0), body(f, true, 1)]),
      seated(false, 0),
      seated(true, 1),
      waving(0),
      waving(1),
      lounging,
      MINI,
    ];
    for (const sprite of poses) {
      expect(new Set(sprite.map((r) => r.length)).size).toBe(1);
      expect(sprite.join("")).toMatch(/^[.kKshHeScCpPbrml]+$/);
    }
    expect(body("down", false, 0)).toHaveLength(17);
    expect(waving(0)[0]).toHaveLength(13);
  });

  it("nothing sticks out of the silhouette at the sides of the torso", () => {
    // The torso rows (10–14) keep their outermost pixels as outline or shirt, never loose hands.
    for (const row of body("down", false, 0).slice(10, 15)) {
      const inked = row.replace(/^\.+|\.+$/g, "");
      expect(inked[0]).toBe("k");
      expect(inked[inked.length - 1]).toBe("k");
    }
  });
});
