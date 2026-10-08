# Odds snapshot uniqueness — database milestone

> **Status update (2026-10-08):** The historical notes below describe the state when the database constraint was first applied. The collector now uses an atomic `ON CONFLICT DO NOTHING` write path, with insert counts from `return=representation`, after verification on its development branch. Supabase Production credentials are configured, but `SPORTSEDGE_INGEST_TOKEN` and a real ingestion smoke test are still pending. See [Atomic Odds Writes](./ATOMIC_ODDS_WRITES.md).

## Existing architecture inspected
On 2026-10-08, SportsEdge's Supabase PostgreSQL 17.11 database contained 9 seeded sports and **zero** leagues, teams, games or odds snapshots. `games`, `leagues`, and `teams` already had provider-identity uniqueness. `odds_snapshots` previously had a primary key and a nonunique timeline index, but no logical capture deduplication.

## Change
Add one PostgreSQL `UNIQUE NULLS NOT DISTINCT` constraint named `odds_capture_dedupe_v1` to `public.odds_snapshots`, matching `(game_id,provider,sportsbook,market,selection,observed_at,american_odds,line)`.

Stored snapshots cannot repeat the same provider, game, book, market, selection, source-observed instant, odds and line. Different prices or different observed times remain distinct historical observations. Moneyline `line=NULL` is treated as the *same* value for uniqueness, avoiding the normal PostgreSQL default behavior that allows duplicates when indexed columns contain NULL.

The source migration is recorded in `database/migrations/20261008_odds_snapshot_dedupe_v1.sql`, and is applied through the Supabase migration tool with name `odds_snapshot_dedupe_v1`. The file is a source mirror, not a separately applied second migration.

### Safety
- Purely additive: no existing tables dropped/recreated, rows modified/deleted, RLS policies or API privileges changed.
- A duplicate preflight raises an explicit error rather than deleting historical data.
- The unique constraint stops concurrent duplicate insertions at the database boundary, even if two collectors race.
- **Current collector note:** `src/lib/server/collect/odds-collector.ts` uses a read-before-insert deduplication path. A concurrent duplicate may now return an HTTP error rather than be silently ignored. Improving this to an atomic conflict-ignore write is a *separate reviewed code change*; do not enable unattended schedules until that is verified.
- No live bookmaker odds or games were created for testing; database state remains empty until owner-supplied private Supabase backend credentials are configured in Vercel.

### Verification
Read-only structural verification query (execute against Supabase):
```sql
SELECT
  c.conname,
  c.contype = 'u' AS is_unique,
  i.indnullsnotdistinct AS nulls_not_distinct,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_index i ON i.indexrelid = c.conindid
WHERE c.conrelid = 'public.odds_snapshots'::regclass
  AND c.conname = 'odds_capture_dedupe_v1';
```
Expected: one row, `is_unique=true`, `nulls_not_distinct=true`.

## Remaining owner-only credential
Production Vercel needs `SUPABASE_SECRET_KEY` (preferred modern `sb_secret_` value), which cannot be retrieved through the project connector. Do not paste it into chat or GitHub; add it privately in Vercel Settings > Environment Variables. An ingestion token and URL must also be present for authorized collection. Adding the constraint does **not** start automatic ingestion.

## Next milestone
After verification: harden conflict-aware writes, add a single-flight collection guard, connect Vercel privately to Supabase, run one authorized source capture and independently audit stored NBA and English Premier League games/odds. Then consider scheduled collection within free-tier limits.
