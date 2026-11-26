# NBA/EPL moneyline refresh: why the board went stale, and the gated repair (2026-11-26)

Branch `claude/moneyline-refresh-20261126`, based on `main` at `4d26f7222016a55c5fe903d659f55665db3bbf67`. At 2026-11-26 20:20 UTC this was still the head of `main` and the last verified production commit.

## Production evidence before any change (2026-11-26 20:22 UTC)

`GET https://sports-edge-eta.vercel.app/api/sports?sport=nba` returned `status: stored` with 7 upcoming games:

| Start (UTC) | Game | Books | Newest stored quote |
| --- | --- | --- | --- |
| 2026-11-28 00:10 | Heat @ Knicks | 2 | 2026-10-08 22:52 |
| 2026-11-28 02:40 | Lakers @ Spurs | 2 | 2026-10-08 22:52 |
| 2026-12-25 to 2026-12-26 | five Christmas games | 8 each | 2026-10-30 07:04:57 |

The newest stored h2h quote anywhere was `2026-10-30T07:04:57Z`. `?sport=soccer` returned 0 games. Every stored EPL fixture had already started, and no new fixtures were saved.

## Trace

1. `/sports` → `useSportsFeed` → `/api/sports` → `storedSports()` (`src/lib/server/research-db.ts`). This route only reads the research database (`games` + `odds_snapshots`, `market=h2h`). It never calls a provider.
2. The only writer of those rows is `collectDualTracks()` (`src/lib/server/collect/odds-collector.ts`). It makes two Odds API h2h requests per run, for `basketball_nba` and `soccer_epl`, and saves append-only snapshots with ON CONFLICT DO NOTHING.
3. `collectDualTracks()` has two callers:
   - `GET /api/internal/collect-markets`, guarded by a bearer token. Its comment says "no automatic schedule until the owner … approves cron".
   - `POST /api/internal/research-cycle`. It runs only on a single-use, ten-minute capability issued by the database function `research_dispatch(false)`. It reserves two requests through `research_reserve_credit` (8 per rolling 24 h, 240 per rolling 30 days).
4. Nothing calls either route on a schedule:
   - neither route appears in `vercel.json` or `SCHEDULER_SLOTS`;
   - no workflow calls either route;
   - `research-market-refresh.yml` only runs contract tests on push and PR.
   - `docs/NBA_ON_DEMAND_MARKET_REFRESH_2026_10_30.md` and `docs/NBA_PAPER_RUN_2026_10_30.md` record runs 2–3 on Oct 30 as explicit one-time runs: "creates no … automatic schedules".
   - `docs/SPORTSEDGE_NOV12_AI_READINESS.md` records "forward collection needs an external `research_dispatch` call and has no current schedule".
5. The NBA player-prop collector is a separate pipeline: `props-daily.yml`/`props-tick.yml`, the props database and props budget. It never writes `games` or `odds_snapshots`, so it kept working while the moneyline board aged.

**Cause.** Nothing is broken in the collector. The h2h refresh was built as an on-demand operation, and the once-daily schedule its design documents anticipated was never approved or added. The last manual runs were on Oct 30.

These earlier prerequisites for scheduling are already met in production:
- database-level dedupe (`database/migrations/20261008_odds_snapshot_dedupe_v1.sql`, `docs/ATOMIC_ODDS_WRITES.md`);
- a request budget (`research_reserve_credit`).

Owner approval of the schedule is the one missing step.

## Repair in this branch (implemented and tested; NOT active)

| File | Change | Why |
| --- | --- | --- |
| `src/lib/server/moneyline-refresh.ts` (new) | Once-daily handler. `MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled=false` | Reuses the existing production pin (`researchCycleEnvironmentReady`), the existing `research_reserve_credit` caps and the existing collector. Changes no algorithm, budget or table. |
| `src/app/api/internal/moneyline-refresh/route.ts` (new) | Wires the handler to `researchDb` and `collectDualTracks`, and logs only outcome codes and counts | Same server-only clients as `/api/sports` and `research-cycle` |
| `vercel.json` | One cron: `/api/internal/moneyline-refresh` at `0 11 * * *` | Fires within 11:00 UTC: before EPL's earliest kickoff (12:30 UTC) and the same night's NBA tip-offs. No other Odds API job runs in that hour. `vercel.json` is a recorded, not frozen, file in the experiment manifest. |
| `src/lib/server/moneyline-refresh.test.mjs` (new) | 12 tests | See below |
| `.github/workflows/research-market-refresh.yml` | Runs the new test; path filters; comment saying this workflow proves contracts, not fresh data | The audit finding |

Order of checks on every firing:
1. `CRON_SECRET` bearer (constant-time comparison).
2. GET with no query.
3. `VERCEL_ENV=production`.
4. Inside the 11:00 UTC hour.
5. **Release switch.** While it is off, the route returns `skipped/moneyline_schedule_off` before any network call.
6. The production research database pin and server credentials. A read-only key, preview fixtures or the props/staging project all fail closed.
7. Read the newest stored h2h `ingested_at`. If it is less than 20 h old, skip without spending credits.
8. Reserve `nba`, then `soccer`, through the existing caps. A refusal returns 429 with no retry and no provider call.
9. Run the existing collector once.
10. Read the newest stored h2h row back from the database. The result is:
    - `refreshed` only if a row saved by this run is visible in the database;
    - `no_new_quotes` if the collector inserted nothing;
    - otherwise `refresh_unverified` (503).

Thrown messages are never returned, because provider URLs carry the key.

Budget: 2 requests per day, about 60 per 30 days. That is inside the existing 240/30-day refresh cap and the 500/month plan already shared with props (200 + 240 ≤ 500, `docs/NBA_PLAYER_PROPS_PAPER_2026_11_07.md`). No budget increases.

It does not create forecasts, paper positions, settlements or results. It does not touch props, stocks, Kalshi, NOAA timing or any frozen experiment file.

## Tests run on this branch

- `node --experimental-strip-types --test src/lib/server/research-cycle-handler.test.mjs src/lib/server/moneyline-refresh.test.mjs src/lib/nba-paper-run-contract.test.mjs src/lib/ingestion/*.test.mjs`: 54/54 pass, including the 12 new tests.
- `scheduler-kickoff`, `props/backup-coverage`, `scripts/data-branches` and `scripts/experiment-manifest` tests (they read `vercel.json`): 36/36 pass.
- `npx tsc --noEmit`: clean. `eslint` on the new files: clean. `npm run build`: passes, and `ƒ /api/internal/moneyline-refresh` is listed.
- `experiment-manifest verify docs/experiments/manifest-2026-11-13-candidate.json`:
  - The only recorded-file change from this branch is `vercel.json`.
  - The props drift it reports (`capture-plan.ts`, `props-tick.ts`) already exists on `main` and is not from this branch.

## Runtime evidence

None yet, and none can be produced without an owner action. This session has no research-database or Vercel credentials, and the switch is off. A green workflow or a page reload does not show fresh ingestion. Fresh ingestion is shown by all three of:

1. `/api/sports?sport=nba` (and `soccer`) `bookmakers[].updatedAt` later than `2026-10-30T07:04:57Z`, and soccer `games.length > 0`;
2. a `research_runs` receipt (manual path), or the `moneyline-refresh` Vercel log line with `status: refreshed`, `receipt.savedThisRun: true` and `receipt.after.ingestedAt` (scheduled path);
3. new `odds_snapshots` rows with `ingested_at` at that time.

## Owner actions (in order)

1. **Restore the board now, within existing authorization (no deploy).** Use the documented Oct 30 path in the Supabase SQL editor of `fzyjazhvkstvwwzjhlrr`:
   - Optionally run `research_dispatch(true)` first: a read-only probe that spends no credits.
   - Then run `research_dispatch(false)` once: 2 credits.
   - Check its `research_runs` receipt.
   - Check the three signals above.
2. **Approve or decline the daily schedule (2 requests per day).** If approved:
   - Review and merge this branch.
   - Then flip `MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled` to `true` in a separate reviewed PR.
   - Deploy outside the freeze, which starts Sunday 2026-11-29 18:00 MST (2026-11-30 01:00 UTC).
   - Merging this branch with the switch off is inert: the cron returns `moneyline_schedule_off`.
3. **First scheduled firing.** Confirm the 11:00 UTC log shows `refreshed`.
   - The `research_reserve_credit` definition is not in the repository; it was installed directly in the database. It has only ever been called inside a claimed `research-cycle` run.
   - If it refuses a call outside a run, the route returns 429 or 503 **before** any provider call.
   - The fallback then is a database-side daily `research_dispatch(false)` via `pg_cron`. That is a database change for the owner.
4. **Rollback.** Set the switch back to `false`. Snapshots are append-only, and nothing else changes.

## For ChatGPT (owner of ops configuration and page displays)

These were deliberately not changed here:
- `config/ops/jobs.json` has no entry for this cron. Suggested job: daily at 11:00 UTC, success = the Vercel log line `status: refreshed` or `no_new_quotes`.
- The sports page does not flag quote age. The two Nov 28 games show Oct 8 prices from 2 books.
- EPL forecasts on `/sports` come from the static `src/data/research/epl_october_2026_forecasts.json`, not from stored fixtures.
- The known 10-minute nominal start-time offset in Odds API NBA fixtures (`docs/NBA_PAPER_RUN_2026_10_30.md`) is unchanged.
