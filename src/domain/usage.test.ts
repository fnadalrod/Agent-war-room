import { describe, expect, it } from "vitest";
import { aSession } from "../test/fixtures";
import { contextLevel, contextRatio, money, stalledMinutes, tokenCount } from "./attention";

describe("usage and stalls", () => {
  it("formats token counts compactly", () => {
    expect([tokenCount(950), tokenCount(1_200), tokenCount(12_345_678), tokenCount(120_000_000), tokenCount(2_000_000)]).toEqual([
      "950",
      "1,2k",
      "12,3M",
      "120M",
      "2M",
    ]);
  });

  it("formats money for a Spanish UI", () => {
    expect([money(0.42), money(47.68), money(312.4)]).toEqual(["$0,42", "$47,68", "$312"]);
  });

  it("knows how full the context is and when to warn", () => {
    expect(contextRatio(aSession({ context_tokens: 250_000, context_window: 1_000_000 }))).toBe(0.25);
    expect(contextRatio(aSession({ context_tokens: 250_000 }))).toBeNull();
    expect([contextLevel(0.3), contextLevel(0.7), contextLevel(0.9)]).toEqual(["ok", "warn", "full"]);
  });

  it("counts minutes since a working session went silent", () => {
    expect(stalledMinutes(aSession({ stalled_since: 0 }), 9 * 60_000)).toBe(9);
    expect(stalledMinutes(aSession(), 9 * 60_000)).toBeNull();
  });
});
