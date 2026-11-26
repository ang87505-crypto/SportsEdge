# NBA/EPL moneyline refresh: why the board went stale, and the gated repair (2026-11-26)

PR #229, branch `claude/moneyline-refresh-20261126`, merged with `main` at `fe96631` (#230). The release switch is **OFF**. Nothing in this PR has been applied to a hosted database, scheduled, deployed or run against the provider.

## Production evidence before any change (2026-11-26 20:22 UTC)

`GET https://sports-edge-eta.vercel.app/api/sports?sport=nba` returned 7 upcoming games.
- The newest stored h2h quote anywhere was `2026-10-30T07:04:57Z`.
- The two Nov 28 games carried Oct 8 prices from 2 books.

`?sport=soccer` returned 0 games. Every stored EPL fixture had started, and no new ones had been saved.

## Trace and cause

1. `/sports` → `useSportsFeed` → `/api/sports` → `storedSports()` only reads `games` and `odds_snapshots` (`market=h2h`).
2. The only writer of those rows is the dual-track collector, now split into:
   - `src/lib/server/collect/odds-collector.ts`: the server-only wrapper;
   - `dual-track-core.ts`: the logic, which can now be tested.
3. It has two callers, and neither is scheduled:
   - `GET /api/internal/collect-markets` (bearer token).
   - `POST /api/internal/research-cycle`. It runs only on a single-use, ten-minute capability issued by the database function `research_dispatch(false)` through `pg_net`.
4. Runs 2–3 on 2026-10-30 were explicit one-time runs (`docs/NBA_ON_DEMAND_MARKET_REFRESH_2026_10_30.md`). `research-market-refresh.yml` runs contract tests only. The props collector is a separate pipeline.

**Cause.** Nothing is broken in the collector. The h2h refresh was built on demand, and a schedule was never approved.

## Design (implemented and tested; not active)

```
Vercel cron 11:00 UTC ─► /api/internal/moneyline-refresh            (switch OFF → returns before any network call)
                           │ one RPC, no provider call, no credit reservation
                           ▼
        research_refresh_slot_dispatch('moneyline-h2h-<UTC date>')  (NEW, additive migration, not applied)
          one transaction: INSERT slot ON CONFLICT DO NOTHING ─► if new: existing research_dispatch(false)
                           │ pg_net (sent only if the transaction commits)
                           ▼
        existing /api/internal/research-cycle: research_claim (single use, 10 min)
          → research_reserve_credit('nba'), ('soccer')   (existing 8/24h, 240/30d caps)
          → collector → per-sport receipt → research_finish(run id, status, summary)
```

### 1. Duplicate prevention

The old "newest quote under 20 h" check is gone: it was a read-then-write and could race.

The new slot is atomic:
- Concurrent firings for one UTC day serialise on the slot's primary key. Exactly one of them commits a dispatch.
- If `research_dispatch` raises, the slot row rolls back with it. A later firing that day may then dispatch once.
- A committed dispatch spends the slot even if its run later fails. A failed run is never retried automatically.
- Downstream, `research_claim` makes the capability single-use. Duplicate `pg_net` deliveries or replays of the same run therefore get 404, with no reserve and no collect.

Taken together, one scheduled slot can reserve credits at most once (two requests), and only inside a claimed run.

### 2. Freshness and receipts, per sport

Each sport is stored, read back by **this run's own inserted row IDs** and classified separately (`src/lib/ingestion/track-receipt.ts`):

| Outcome | Meaning |
| --- | --- |
| `saved` | This run inserted rows, and every one was read back by ID under this sport's fixtures |
| `unchanged` | Prices were offered, but all were already stored (same provider `last_update` and price) |
| `empty_slate` | The provider listed no upcoming fixtures for the sport |
| `no_prices` | Fixtures were listed, but none had a complete pregame h2h market |
| `store_failed` | A write or the read-back failed. Rows may be partly written, so none are claimed |
| `unverified` | Inserts were reported, but not all of them were found on read-back |

Each sport's receipt also carries `newestSourceObservedAt`: the newest provider timestamp offered for that sport.

Run status:

| Status | When |
| --- | --- |
| `refreshed` | Every sport is ok-class and at least one sport is `saved` |
| `no_new_quotes` | Every sport is ok-class and none is `saved` |
| `partial_refresh` | At least one sport is `saved` and another failed |
| `refresh_failed` | No sport is `saved` and at least one failed |
| `refresh_unverified` | The report's shape is not recognised |

Only `refreshed` and `no_new_quotes` finish the run as `completed`. Everything else is `failed` with `reviewRequired`.

The summary written by `research_finish` contains:
- `runId`;
- the per-sport outcomes;
- the full report.

The receipt is therefore tied to the claimed run, not to whichever row has a recent timestamp. Provider feeds are still fetched before any write. If storing one sport fails, the other sport's already-paid-for quotes are still saved and reported.

### 3. The `research_reserve_credit` contract

**Blocked: the definition cannot be inspected from here.** The `research_*` functions were installed directly in the production database and are not in the repository on any branch. This session has no database credentials.

The design no longer depends on how the function behaves outside a run: it is only called inside a claimed research-cycle run, which is the context of the successful run 3 on Oct 30.

The exact read-only check is `database/verify/research_refresh_contract_readonly.sql`. It is a catalogue-only `BEGIN READ ONLY … ROLLBACK` that returns:
- the definitions, return types, owners and execute grants of `research_dispatch`, `research_claim`, `research_finish` and `research_reserve_credit`;
- the `research_*` columns and constraints;
- whether `pg_net` and `pg_cron` are installed.

The file ends with the seven questions (a–g) that the reviewer must answer before activation. It was dry-run locally against the stub database.

## Changed files

| File | Change |
| --- | --- |
| `database/migrations/20261126_research_refresh_slots_v1.sql` | New, additive and **not applied**. Adds the `research_refresh_slots` table (RLS on, no browser access) and the `research_refresh_slot_dispatch(text)` function (security definer, today's UTC slot only, execute granted to `service_role` only). It changes no existing object. |
| `src/lib/server/moneyline-refresh.ts`, `src/app/api/internal/moneyline-refresh/route.ts` | The cron handler only claims the slot through the RPC. Switch `MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled=false`. |
| `src/lib/server/collect/dual-track-core.ts` (new), `odds-collector.ts` | Collector logic moved into a testable core. Provider requests are unchanged (2 h2h calls, `regions=us`, american odds). Each sport now gets its own store, read-back by ID and receipt. |
| `src/lib/ingestion/track-receipt.ts` (new) | Pure per-sport classification and run status |
| `src/lib/server/research-cycle-handler.ts` | Run status and `research_finish` status now come from the per-sport receipts. Claim, reserve and auth logic are unchanged. |
| `vercel.json` | One cron: `0 11 * * *`. It is a recorded (not frozen) manifest file. |
| `.github/workflows/research-market-refresh.yml` | Runs the new tests. Adds a `slot-sql` job (disposable local PostgreSQL). Its comment says it does not prove fresh data. |
| `database/tests/research_refresh_slots_v1_{stub,test}.sql`, `…_race.sh`, `scripts/verify-research-refresh-sql.sh` | SQL contract, replay and race tests against a **stub** `research_dispatch` |
| `database/verify/research_refresh_contract_readonly.sql` | The owner's read-only production check |

## Validation (local, 2026-11-26)

- **`scripts/verify-research-refresh-sql.sh`** (PostgreSQL 16):
  - contract test, including grants, malformed slots, other-day slots and replay after failure and after success;
  - race A: 20 concurrent firings → 1 `dispatched`, 19 `duplicate_slot`, 1 stub dispatch;
  - race B: 20 concurrent firings where the first dispatch fails → 1 `failed (rolled back)`, 1 `dispatched`, 18 `duplicate_slot`, 1 stub dispatch;
  - a `void`-returning dispatcher → PASS;
  - re-applying the migration is idempotent.
- **New tests:**
  - collector core: 8 (both saved, EPL empty slate, unchanged, fresh NBA beside unchanged EPL, partial store failure, missing read-back, read-back outage, provider failure before any write);
  - track receipts: 3;
  - moneyline handler: 12 (switch off, auth/hour/env, 12-way overlap → 1 dispatch, replay after failure, mismatched replies);
  - research-cycle: 4 (per-sport receipts tied to the run id, unknown report shape, 10 concurrent deliveries → 1 reserve pair and 1 collect, replay after a failed run).
- Full JavaScript suite: 1221 tests, 1173 pass, 48 skipped, 0 fail.
- `tsc`: clean. `eslint`: clean. `next build`: passes.
- Python analytics: OK. Props SQL: all 7 suites pass, plus 9 integration tests.
- `experiment-manifest verify`: the only recorded-file change from this branch is `vercel.json`. Frozen drift in `capture-plan.ts` and `props-tick.ts` already exists on `main`.

## Runtime status

| | Status |
| --- | --- |
| Implemented and tested | Everything above |
| Deployed | Nothing |
| Applied to a hosted database | Nothing |
| Provider calls made | None |
| Gated | The schedule (switch OFF), the migration and the contract check |

A green workflow or a page reload does not show fresh ingestion. Fresh ingestion is shown by:
- the `research_runs` summary for the dispatched run, with `status`, `runId` and per-sport outcomes;
- `/api/sports?sport=nba` and `?sport=soccer` quote times after `2026-10-30T07:04:57Z`, and soccer games > 0 (unless `empty_slate`).

## Owner actions, in order

1. **Restore the board now, within existing authorization (no deploy).** In the SQL editor of `fzyjazhvkstvwwzjhlrr`:
   - optionally run `select research_dispatch(true);` first (probe, 0 credits);
   - then run `select research_dispatch(false);` once (2 credits);
   - check the run's `research_runs` row and `/api/sports`.

   The run uses the code currently deployed, so its summary does not yet contain the per-sport receipts.
2. Run `database/verify/research_refresh_contract_readonly.sql`, then send the output for review against questions a–g.
3. If approved:
   - merge #229 (inert while the switch is off);
   - apply the migration in the SQL editor;
   - re-run step 2 to confirm the new objects and grants.
4. Approve or decline the daily schedule: 2 requests per day, about 60 per 30 days, inside the existing 240 cap. If approved:
   - flip `MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled` in a separate reviewed PR;
   - deploy **before** the freeze starts (Sun 2026-11-29 18:00 MST = 2026-11-30 01:00 UTC), or after it ends.
5. **First firing (11:00 UTC):**
   - the Vercel log shows `dispatched` with the slot;
   - `research_refresh_slots` has one row for the day;
   - the run summary shows the outcome for each sport;
   - a manual re-request of the route the same day returns `duplicate_slot`.
6. **Rollback.** Set the switch back to `false`. Slots and snapshots are append-only.

## For ChatGPT (ops configuration and page displays)

These were deliberately not changed here:
- An ops-monitor job for the 11:00 UTC firing in `config/ops/jobs.json`.
- Quote-age display on `/sports`. #230 changed that page.
- The static `epl_october_2026_forecasts.json` EPL panel.
- The Odds API's 10-minute nominal NBA start offset.
