import { describe, expect, it } from "vitest";
import { fit, normalize, textWidth } from "./font";

describe("3×5 font", () => {
  it("uppercases, strips accents and marks what it cannot draw", () => {
    expect(normalize("Caf\u00e9 \u00f1€")).toBe("CAFE N?");
  });

  it("measures 4 pixels per character minus the last gap", () => {
    expect(textWidth("ABC")).toBe(11);
    expect(textWidth("")).toBe(0);
  });

  it("truncates what does not fit with a trailing dot", () => {
    expect(fit("Fix the login", 23)).toBe("FIX T.");
    expect(textWidth(fit("Fix the login", 23))).toBeLessThanOrEqual(23);
    expect(fit("OK", 23)).toBe("OK");
  });
});
