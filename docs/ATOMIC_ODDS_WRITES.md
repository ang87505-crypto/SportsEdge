# SportsEdge — Atomic bookmaker-odds persistence (Milestone 2)

## Verified prerequisites
- PostgreSQL 17; previous applied migration `odds_snapshot_dedupe_v1`.
- Constraint `public.odds_snapshots.odds_capture_dedupe_v1` is **UNIQUE NULLS NOT DISTINCT** on:
  `game_id,provider,sportsbook,market,selection,observed_at,american_odds,line`.
- Before implementation the Supabase database had **zero leagues, teams, games and odds snapshots**.
- Vercel Production **contains** `ODDS_API_KEY`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (sensitive). Presence of credentials **does not prove** successful runtime REST connectivity.
- No `SPORTSEDGE_INGEST_TOKEN` is configured. Therefore the protected route is inaccessible, and **no live ingestion was attempted**.

## Changes and behavior

Updated:
- `src/lib/server/collect/odds-collector.ts` — now executes `POST /rest/v1/odds_snapshots` using PostgREST `Prefer: resolution=ignore-duplicates,return=representation` and exact `on_conflict` columns matching the constraint. The returned IDs determine the **actual inserted-row count**, not attempted writes.
- `.github/workflows/dual-track-verify.yml` — executes both provider-contract and snapshot-preparation tests.

Added:
- `src/lib/ingestion/snapshot-rows.ts` — pure validated candidate preparation, deterministic within-batch deduplication and explicit DB conflict column declaration.
- `src/lib/ingestion/snapshot-rows.test.mjs` — tests duplicate, changed-odds, changed-timestamp, null-line, invalid-value and distinct event/provider identities.

The collector no longer fetches all historical rows before inserting. Two concurrent invocations cannot create identical snapshots: the database constraint applies under concurrency. On a retry, duplicates are ignored and the collector reports `oddsInserted=0` for unchanged prices. Distinct timestamps and odds remain separate. Existing games are read or inserted without overwriting settled scores.

## Limitations and next gate

**Do not confuse atomic writes with a distributed lock:** simultaneous collectors could still each consume provider quota. A single-flight lease is a separate milestone if recurring collection is enabled. Database operations are not one cross-request transaction, so partial failures can leave successfully written rows, with retries reconciling via uniqueness.

There is no live fixture or proof of Supabase connectivity yet: the missing private `SPORTSEDGE_INGEST_TOKEN` is required for a controlled authenticated run. Do not paste that token or the Supabase secret key into chat or source code. Once configured privately in Vercel Production and redeployed, run one authorized collection, verify actual `nba` and `soccer_epl` rows, then repeat it to confirm zero new snapshot inserts when timestamps/prices have not changed.

The provider's advertised odds timestamps are distinct from actual `ingested_at`. No model accuracy, performance or profits can be derived from these empty tables.

## Verification

```shell
node --test src/lib/ingestion/*.test.mjs
npm run lint
npm run build
npx tsc --noEmit
```

The existing GitHub Action runs the above checks (with Next build before typechecking). Structural DB verification can check the unique constraint and count zero duplicates without inserting fake odds:

```sql
SELECT c.conname, i.indnullsnotdistinct, pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_index i ON c.conindid = i.indexrelid
WHERE c.conrelid = 'public.odds_snapshots'::regclass
  AND c.conname = 'odds_capture_dedupe_v1';

SELECT game_id, provider, sportsbook, market, selection,
       observed_at, american_odds, line, COUNT(*)
FROM public.odds_snapshots
GROUP BY game_id, provider, sportsbook, market, selection,
         observed_at, american_odds, line
HAVING COUNT(*) > 1;
```
