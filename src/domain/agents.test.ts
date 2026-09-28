import { describe, expect, it } from "vitest";
import { aSession } from "../test/fixtures";
import { launchableAgents, mixesAgents, providerName, usageLabel } from "./attention";
import type { IntegrationStatus } from "./attention";
import type { WarRoomView } from "./generated/WarRoomView";

const integration = (provider: string, over: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  provider,
  agent_found: true,
  installed: false,
  hooked_events: [],
  settings_path: "",
  bridge_path: "",
  bridge_present: true,
  launchable: true,
  ...over,
});

describe("several agents", () => {
  it("offers the connected agents, else the installed ones, else Claude", () => {
    expect(launchableAgents([integration("claude", { installed: true }), integration("codex")])).toEqual(["claude"]);
    expect(launchableAgents([integration("claude"), integration("codex")])).toEqual(["claude", "codex"]);
    expect(launchableAgents([integration("codex", { agent_found: false })])).toEqual(["claude"]);
    expect(
      launchableAgents([integration("claude", { installed: true }), integration("antigravity", { installed: true, launchable: false })]),
    ).toEqual(["claude"]);
  });

  it("names agents and notices when the room mixes them", () => {
    expect(providerName("codex")).toBe("Codex");
    expect(providerName("gemini")).toBe("gemini");
    const view = (providers: string[]) =>
      ({ rooms: [{ sessions: providers.map((provider) => aSession({ provider })) }] }) as unknown as WarRoomView;
    expect(mixesAgents(view(["claude", "claude"]))).toBe(false);
    expect(mixesAgents(view(["claude", "codex"]))).toBe(true);
  });

  it("shows no price rather than $0.00 when nothing in it has one", () => {
    const usage = aSession().usage;
    expect(usageLabel({ ...usage, total_tokens: 2_100_000, cost_usd: 0, partial_cost: true })).toBe("2.1M tok");
    expect(usageLabel({ ...usage, total_tokens: 2_100_000, cost_usd: 0.4, partial_cost: true })).toBe("2.1M tok · $0.40");
  });
});
