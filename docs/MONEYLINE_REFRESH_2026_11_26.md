# NBA/EPL moneyline refresh: why the board went stale, and the gated repair (2026-11-26)

PR #229, branch `claude/moneyline-refresh-20261126`, merged with `main` at `7af4bf6` (#230, #231). The release switch is **OFF**. Nothing in this PR has been applied to a hosted database, scheduled, deployed or run against the provider.

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
                           │ one RPC as service_role; no provider call, no credit reservation
                           ▼
        research_refresh_slot_dispatch('moneyline-h2h-<UTC date>')  (NEW, additive migration, not applied)
          per-slot advisory lock ─► slot exists? → duplicate_slot (its run_id)
                                 └► run_id := existing research_dispatch(false)   -- RETURNS bigint, NULL in cooldown
                                      NULL / ≤ 0 → not_dispatched, NOTHING recorded, slot stays open
                                      > 0       → INSERT slot(run_id) → dispatched
                           │ pg_net (sent only if the transaction commits)
                           ▼
        existing /api/internal/research-cycle: research_claim (single use, 10 min)
          → research_reserve_credit('nba'), ('soccer')   (existing caps, shared by both sports: 8/24h, 240/30d)
          → collector → per-sport receipt → research_finish(run id, status, summary)
```

### Verified production contract (ChatGPT's read-only database review, 2026-11-27)

- `research_dispatch(boolean)` **RETURNS bigint**: the new run id. It legitimately returns **NULL**, creating no run, when its **25-minute cooldown** prevents a dispatch.
- `research_reserve_credit` caps are **shared across both sports**: 8 reservations per rolling 24 h and 240 per rolling 30 days. A run reserves two.
- Execute permissions:
  - `anon` and `authenticated` cannot execute the installed research functions;
  - `service_role` cannot execute `research_dispatch` directly. The wrapper keeps that restriction: it is SECURITY DEFINER and only `service_role` may execute it.
- The slot table and the wrapper are not installed in production.

**Release blocker found at `4c55ea3`, now fixed.** The previous wrapper:
1. inserted the slot first;
2. converted the dispatcher's result to text, turning NULL into `''`;
3. committed the slot and reported `dispatched`.

A cooldown NULL therefore consumed the day's slot without creating a run, and blocked any retry that day. Running the `4c55ea3` migration against the new production-shaped stub reproduces it: `{"status":"dispatched","dispatch":""}` with 1 slot committed.

### 1. Duplicate prevention and the NULL contract

- The migration refuses to install unless `research_dispatch(boolean)` exists and returns `bigint`: `PREREQUISITE_MISSING` or `CONTRACT_MISMATCH`.
- Calls for one slot serialise on `pg_advisory_xact_lock`. The primary key is a backstop.
- The dispatcher is called first. A slot row is written **only together with a positive run id**: `run_id bigint NOT NULL CHECK (run_id > 0)`. A committed slot therefore always names a real run.
- **NULL or a non-positive id → `not_dispatched`.** Nothing is recorded, and the slot stays open for a later call the same day. The cron reports it as `not_dispatched` (HTTP 409, `slotAvailable: true`), never as success.
- **An exception rolls back everything:** the dispatcher's run, the slot and the pg_net request. A later call may dispatch once.
- **A recorded run spends the slot,** even after its cooldown ends and even if the run later fails, so one slot reserves credits at most once.
- Downstream, `research_claim` makes each capability single-use. Replayed or duplicate deliveries get 404, with no reserve and no collect.

**Operational note.** A manual `research_dispatch(false)` less than 25 minutes before 11:00 UTC makes that day's firing `not_dispatched`. The slot stays open, but the Vercel cron fires only once a day. The owner can re-request the route within 11:xx UTC, or wait for the next day.

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

**Verified** in the read-only review: shared 8/24h and 240/30d caps. The design calls it only inside a claimed research-cycle run, which is the context of the successful Oct 30 run 3.

`database/verify/research_refresh_contract_readonly.sql` records which points are verified (a, c, f, g) and which the owner still confirms from the output:
- (b) the dispatcher uses `net.http_post`;
- (d) single-use, ten-minute claim;
- (e) `research_finish` stores the summary against the run id.

It also lists the results to expect after the migration is applied.

## Changed files

| File | Change |
| --- | --- |
| `database/migrations/20261126_research_refresh_slots_v1.sql` | New, additive and **not applied**. Adds the bigint contract guard, the `research_refresh_slots` table (`run_id bigint NOT NULL CHECK > 0`, RLS, select-only for `service_role`) and the `research_refresh_slot_dispatch(text)` function (security definer, advisory lock, today's UTC slot only, execute for `service_role` only). It changes no existing object. |
| `src/lib/server/moneyline-refresh.ts`, `src/app/api/internal/moneyline-refresh/route.ts` | The cron handler only claims the slot through the RPC. Switch `MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled=false`. |
| `src/lib/server/collect/dual-track-core.ts` (new), `odds-collector.ts` | Collector logic moved into a testable core. Provider requests are unchanged (2 h2h calls, `regions=us`, american odds). Each sport now gets its own store, read-back by ID and receipt. |
| `src/lib/ingestion/track-receipt.ts` (new) | Pure per-sport classification and run status |
| `src/lib/server/research-cycle-handler.ts` | Run status and `research_finish` status now come from the per-sport receipts. Claim, reserve and auth logic are unchanged. |
| `vercel.json` | One cron: `0 11 * * *`. It is a recorded (not frozen) manifest file. |
| `.github/workflows/research-market-refresh.yml` | Runs the new tests. Adds a `slot-sql` job (disposable local PostgreSQL). Its comment says it does not prove fresh data. |
| `database/tests/research_refresh_slots_v1_{stub,test}.sql`, `…_race.sh`, `scripts/verify-research-refresh-sql.sh` | SQL contract, replay and race tests against a **production-shaped** stub: BIGINT, NULL during a 25-minute cooldown, not executable by `service_role` |
| `database/verify/research_refresh_contract_readonly.sql` | The owner's read-only production check |

## Validation

Tested SHA: see the PR description (the head that contains this section).

- **`scripts/verify-research-refresh-sql.sh`** (PostgreSQL 16, production-shaped stub):
  - **Install guards:** the migration is refused without `research_dispatch`, and refused over a void-returning one.
  - **Single session:**
    - malformed and other-day slots are refused;
    - **NULL/cooldown** → `not_dispatched`, 0 slots, no new run (and again on a second call);
    - **retry after the cooldown** → `dispatched` with the stub's positive run id, recorded in the slot;
    - **replay** → `duplicate_slot` with the same run id, including after the cooldown has expired;
    - **exception** → run, slot and request all rolled back, then the retry dispatches;
    - run ids 0 and −7 → `not_dispatched`, slot open.
  - **Grants:**
    - anon/authenticated cannot execute the wrapper;
    - `service_role` executes the wrapper (called as `service_role` → `dispatched`);
    - `service_role` calling `research_dispatch` directly → refused;
    - `service_role` cannot write slots.
  - **Races, as `service_role`, 20 concurrent firings each:**
    - A: plain → 1 dispatched / 19 duplicate (1 run, 1 slot);
    - B: the first dispatch fails after creating its run → 1 rolled back / 1 dispatched / 18 duplicate (1 run, 1 slot);
    - C1: during the cooldown → 20 `not_dispatched` (0 slots);
    - C2: after the cooldown → 1 dispatched / 19 duplicate.
- **Regression:** the `4c55ea3` wrapper fails the NULL case (reproduced above).
- **Contract suite:** 70/70, including:
  - moneyline handler: 13 (NULL is never success, concurrent cooldown firings, retry then replay, exception replay, only positive integer run ids count, migration contract checks);
  - collector core: 8; receipts: 3; research-cycle: 4 (per-sport receipts unchanged).
- **Full JavaScript suite:** 1233 tests, 1185 pass, 48 skipped, 0 fail.
- `tsc`: clean. `eslint`: clean. `next build`: passes.
- `experiment-manifest verify`: the only recorded-file change from this branch is `vercel.json`. Frozen props drift already exists on `main`.
- No #230/#231 UI, briefing or ops-configuration file is changed.

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
   - a NULL result means the 25-minute cooldown is active: wait and run it once more;
   - check the returned run id's `research_runs` row and `/api/sports`.

   The run uses the code currently deployed, so its summary does not yet contain the per-sport receipts.
2. Confirm the remaining contract points (b, d, e) from `database/verify/research_refresh_contract_readonly.sql`. Points a, c, f and g were verified in ChatGPT's read-only review.
3. If approved:
   - merge #229 (inert while the switch is off);
   - apply the migration in the SQL editor;
   - re-run step 2 to confirm the new objects and grants.
4. Approve or decline the daily schedule: 2 requests per day, about 60 per 30 days, inside the existing 240 cap. If approved:
   - flip `MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled` in a separate reviewed PR;
   - deploy **before** the freeze starts (Sun 2026-11-29 18:00 MST = 2026-11-30 01:00 UTC), or after it ends.
5. **First firing (11:00 UTC):**
   - the Vercel log shows `dispatched` with the slot and a positive `runId`, or `not_dispatched` if a manual run happened less than 25 minutes earlier;
   - `research_refresh_slots` has one row for the day, whose `run_id` matches a `research_runs` row;
   - the run summary shows the outcome for each sport;
   - a manual re-request of the route the same day returns `duplicate_slot`.
6. **Rollback.** Set the switch back to `false`. Slots and snapshots are append-only.

## For ChatGPT (ops configuration and page displays)

These were deliberately not changed here:
- An ops-monitor job for the 11:00 UTC firing in `config/ops/jobs.json`.
- Quote-age display on `/sports`. #230 changed that page.
- The static `epl_october_2026_forecasts.json` EPL panel.
- The Odds API's 10-minute nominal NBA start offset.
