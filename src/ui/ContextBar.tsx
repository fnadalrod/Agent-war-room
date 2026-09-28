import { contextLevel, contextRatio, type SessionView, tokenCount } from "../domain/attention";
import { copy } from "../domain/copy";

/** How full the model's context is. Warns before the agent has to compact. */
export function ContextBar({ session: s }: { session: SessionView }) {
  const ratio = contextRatio(s);
  if (ratio == null) return null;
  const pct = Math.round(ratio * 100);
  const label = copy.detail.contextUsed(tokenCount(s.context_tokens!), tokenCount(s.context_window!), pct);
  return (
    <div className="context-bar" data-level={contextLevel(ratio)} title={label} aria-label={label} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}
