# Token usage, estimated cost and context window

> Leaf of `transcripts.mdc`. Read it before touching `count_usage`, `pricing.rs`, the "Hoy" total or the
> context bar.

## Counting

`count_usage` (transcript.rs) runs once per API message (`seen_messages` in the per-file `Tail`, not
in `Facts`, so reads don't clone thousands of ids):

- `input_tokens`, `output_tokens`, `cache_read_input_tokens` as is;
- cache writes from `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`
  (fallback: `cache_creation_input_tokens` as 5 m);
- cost = tokens × $/MTok = **micro-dollars** (`Usage::cost_micros`, integer so summaries stay `Eq`);
  messages whose model has no price add to `unpriced_messages` ("partial cost" in the UI);
- per local calendar day (`chrono::Local`) in `Facts::daily`, for "today".

Session totals add **every** `subagents/agent-*.jsonl` (finished ones too, even those no longer
listed). Context (`context_tokens`) is the last message's input + cache read + cache write — how full
the window is now, not a total.

Sanity check against a real session (this project's own): ~120 M cache-read tokens dominate; the
estimate was ~$47.7 for opus-5-5. If a change moves that by an order of magnitude, something double
counts.

## Prices (pricing.rs)

Public API prices per MTok (input/output/cache read); cache write = 1.25× input (5 m) or 2× (1 h).
Context window per model (1M for current models, 200K for Haiku 4.5 and older 4.x/4.5; `[1m]` suffix
forces 1M). Longest-prefix match on the id without `claude-` and date suffix. **Update the table when
a model is released or repriced**; `pricing.rs` tests pin the tricky prefixes (`opus-5` vs `opus-5-5`,
`opus-4-5` vs `opus-4`).

The UI always labels cost as "estimado a precio de API": subscriptions don't pay it.
