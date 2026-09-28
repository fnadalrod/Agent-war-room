import { describe, expect, it } from "vitest";
import type { TimelineEntryView } from "../domain/attention";
import { blocks } from "./DetailPanel";

const e = (kind: TimelineEntryView["kind"], text: string, model: string | null = null, effort: string | null = null) => ({
  kind,
  text,
  at: null,
  model,
  effort,
});

describe("línea de tiempo", () => {
  it("anota modelo y esfuerzo solo donde cambian y no mezcla herramientas de antes y después", () => {
    const out = blocks([
      e("prompt", "hola"),
      e("tool", "Read · a", "claude-sonnet-5", "medium"),
      e("tool", "Read · b", "claude-sonnet-5", "medium"),
      e("reply", "vale", "claude-sonnet-5", "medium"),
      e("prompt", "/model opus"),
      e("tool", "Edit · c", "claude-opus-5-5", "high"),
      e("reply", "hecho", "claude-opus-5-5", "high"),
    ]);
    expect(out.map((b) => [b.kind, b.setting])).toEqual([
      ["prompt", null],
      ["tools", "sonnet-5 · esfuerzo medio"],
      ["reply", null],
      ["prompt", null],
      ["tools", "opus-5-5 · esfuerzo alto"],
      ["reply", null],
    ]);
  });
});
