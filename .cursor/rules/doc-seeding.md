# Seeding docs: write down what cost you to understand

> On-demand leaf of `engineering-discipline.mdc`. Read it **when finishing** a task where you had to
> trace an undocumented flow — not before starting. Its twin is anti-rot (prune what is wrong; skill
> `anti-rot`); this one **adds** what is missing.

Knowledge is cheapest to capture right after you rebuilt it.

## When (all three, or don't)

- **Non-obvious**: not deducible from names or a single file.
- **Costly**: you read 3+ files or crossed layers to rebuild it.
- **Durable**: a mechanism someone will touch again, not a one-off bug (that is a code comment or a
  regression test).

## Where (shallowest that fits)

- 2–3 sentences → the area router (`<area>.mdc`).
- A deep dive → a leaf `<area>-<topic>.md` next to its router, linked from the router's **trigger
  table** ("if you touch X / the symptom is Y → read Z"). A leaf nobody links is dead.
- **Never** in `AGENTS.md` (index only, paid every session) or `engineering-discipline.mdc`.

## Splitting

If a router section grows past ~50 lines and only matters to one sub-area, move it to a leaf and keep
a 3–5 line summary + trigger in the router. Don't split when everyone who opens the router would open
the leaf anyway (two reads instead of one). Invariants whose violation breaks something stay in the
router even if the *why* moves.

## Hook it up

- Router: add the leaf to its trigger table.
- New router: add it to the area list in `AGENTS.md` and give it `globs:` so Cursor and
  `scripts/rules_for_path.py` attach it.
- Run `python3 scripts/check_docs.py`: it catches unreachable rules, leaves without triggers and
  dead links.
