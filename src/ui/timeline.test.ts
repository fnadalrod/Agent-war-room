import { describe, expect, it } from "vitest";
import type { TimelineEntryView } from "../domain/attention";
import { copy } from "../domain/copy";
import { blocks } from "./DetailPanel";

const e = (kind: TimelineEntryView["kind"], text: string, model: string | null = null, effort: string | null = null) => ({
  kind,
  text,
  at: null,
  model,
  effort,
});

describe("timeline", () => {
  it("notes model and effort only where they change and keeps tools before and after apart", () => {
    const out = blocks([
      e("prompt", "hello"),
      e("tool", "Read · a", "claude-sonnet-5", "medium"),
      e("tool", "Read · b", "claude-sonnet-5", "medium"),
      e("reply", "ok", "claude-sonnet-5", "medium"),
      e("prompt", "/model opus"),
      e("tool", "Edit · c", "claude-opus-5-5", "high"),
      e("reply", "done", "claude-opus-5-5", "high"),
    ]);
    expect(out.map((b) => [b.kind, b.setting])).toEqual([
      ["prompt", null],
      ["tools", `sonnet-5 · ${copy.session.effort(copy.effort.medium)}`],
      ["reply", null],
      ["prompt", null],
      ["tools", `opus-5-5 · ${copy.session.effort(copy.effort.high)}`],
      ["reply", null],
    ]);
  });
});
