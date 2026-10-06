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

  it("measures the glyphs actually painted after Unicode normalization", () => {
    expect(textWidth("Cafe\u0301")).toBe(textWidth("CAFE"));
    expect(textWidth("Straße")).toBe(textWidth("STRASSE"));
    expect(normalize("🚀")).toBe("?");
    expect(textWidth("🚀")).toBe(3);
  });

  it("does not draw a truncation dot when even one glyph cannot fit", () => {
    for (const width of [-1, 0, 1, 2]) expect(fit("ABC", width)).toBe("");
    expect(fit("ABC", 3)).toBe(".");
  });

  it("truncates what does not fit with a trailing dot", () => {
    expect(fit("Fix the login", 23)).toBe("FIX T.");
    expect(textWidth(fit("Fix the login", 23))).toBeLessThanOrEqual(23);
    expect(fit("OK", 23)).toBe("OK");
  });

  it("fine text fits more letters in the same width", () => {
    expect(textWidth("ABC", 0.5)).toBe(5.5);
    expect(fit("Fix the login", 23, 0.5)).toBe("FIX THE LO.");
    expect(textWidth(fit("Fix the login", 23, 0.5), 0.5)).toBeLessThanOrEqual(23);
  });
});
