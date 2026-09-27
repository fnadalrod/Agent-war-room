import { describe, expect, it } from "vitest";
import { aRoom, aSession } from "../test/fixtures";
import { activity, contextLabel, isWritable, modelName, roomHome } from "./attention";

describe("reglas de presentación", () => {
  it("resume modelo y contexto", () => {
    expect(modelName(aSession({ model: "claude-opus-5-5" }))).toBe("opus-5-5");
    expect(contextLabel(aSession({ context_tokens: 152_340 }))).toBe("152k");
    expect(contextLabel(aSession({ context_tokens: 1_200_000 }))).toBe("1.2M");
    expect(contextLabel(aSession())).toBeNull();
  });

  it("muestra la acción detallada solo mientras trabaja", () => {
    const s = aSession({ attention: "working", status_label: "Bash", last_action: "Bash · cargo test" });
    expect(activity(s)).toBe("Bash · cargo test");
    expect(activity({ ...s, attention: "finished", status_label: "Terminado" })).toBe("Terminado");
  });

  it("solo se escribe en sesiones vivas de terminal propio o tmux", () => {
    expect(isWritable(aSession({ pty_id: "p" }))).toBe(true);
    expect(isWritable(aSession({ tmux_pane: "%1" }))).toBe(true);
    expect(isWritable(aSession({ pty_id: "p", alive: false }))).toBe(false);
    expect(isWritable(aSession())).toBe(false);
  });

  it("abre agentes nuevos en el checkout principal de la sala", () => {
    const room = aRoom("app", [
      aSession({ worktree_path: "/code/app-wt", is_linked_worktree: true }),
      aSession({ worktree_path: "/code/app" }),
    ]);
    expect(roomHome(room)).toBe("/code/app");
  });
});
