# Sports data foundation — milestone 1

## Verified state (2026-10-08)
- Supabase project: SportsEdge (ref: `fzyjazhvkstvwwzjhlrr`).
- Applied migration: `sports_foundation_v1`.
- Seven tables exist: `sports`, `leagues`, `teams`, `games`, `odds_snapshots`, `model_predictions`, `paper_bets`.
- Nine sport records: NFL, NBA, MLB, NHL, Soccer, College Football, College Basketball, Tennis, MMA/UFC.
- All tables have row-level security enabled. No public policies were created.
- No provider feeds, historical games, odds, model predictions, or bets have been ingested. No AI model is running.

## Data principles
- Use UTC `timestamptz` for events, observations and ingestion timestamps.
- Never overwrite historical odds snapshots; append new observations.
- Store provider names and provider IDs for reconciliation and deduplication.
- Distinguish observed sportsbook prices, modeled probabilities, and settled paper returns.
- Do not interpret paper P/L as actual earnings.
- Server-only credentials must never appear in client code or git.

## Next independently testable milestone
1. Select and verify a legitimate multi-sport schedule and odds provider, including coverage, licensing, update cadence and costs.
2. Add server-side ingestion with secret keys stored in deployment environment variables.
3. Add provider health checks, stale-data indicators, and scheduled collection.
4. Validate sample records against the provider before displaying them.
5. Add per-sport views and performance statistics only after trustworthy records exist.

## Security follow-up
- Add authenticated, user-scoped read/write policies for `paper_bets` before enabling user bets.
- Keep provider ingestion behind a trusted backend and restrict administrative database access.
- Review whether any provider IDs are only unique within a league before ingesting.
