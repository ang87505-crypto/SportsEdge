# Props capture ticks: migration and activation checklist (owner)

This turns on event-aware line capture (props-capture-v1, PR #135, merged released-off in #140). Every step is the
owner's. Status 2026-11-12 05:39 UTC: **step 1 done, step 2 SQL applied but not opted in, step 3 done (zero-credit), step 4
not done** (verified below). PAPER only: no real-money entry, no DFS account, no private PrizePicks/Pick6 endpoint.

The steps are ordered so that each one can be verified, and stopped, before the next one.

**Project.** Props use the Supabase project `vfyzbliksooljxrlfadp` (`scripts/paper-release.mjs` refuses any
other). It was confirmed reachable on 2026-11-11. Run all SQL below in that project's SQL editor.

## Update 2026-11-12 05:39 UTC: steps 1 to 3 (verified against the real database)

| Item | Result |
|---|---|
| Step 1, `props_capture_v1.sql` | **APPLIED**: all three tables present ([preflight 43162082822](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43162082822)) |
| Step 2, `props_budget_v3_actuals.sql` | **Applied, not opted in**: `count_provider_actuals` exists, but no `props-budget-v3` row was inserted, so `props-budget-v2` (7/200/60) still governs and every request counts in full. To opt in, run the step-2 `insert` (same 7/200/60). |
| Step 3, one manual tick | Done with owner approval while it provably could not spend: 24 h use was 7/7 and no window was open. [Run 43162681228](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43162681228): `NOTHING_DUE`; events list `costLast 0`, provider 476 before and after |
| Tick receipts | [Preflight 43162785980](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43162785980). Run 20 reserved **0** credits. 4 plans for the 2026-11-12 slate: Mavericks @ Timberwolves `selected_anchor` (early), Pistons @ Wizards `selected_nearest_tip` (late), 2 `budget_games_per_slate`. 0 claims, 0 duplicate plans or claims |
| RLS and grants | Not readable through PostgREST. Paste the step-1 verification SQL output into the activation PR, or confirm `rls = true` for the three tables and `INSERT,SELECT` for `service_role` only |
| Step 4 | Not done. PR #142 waits for owner approval |

What step 4 starts: GitHub ticks every 30 minutes (11:00 to 04:59 UTC, often dropped or late) plus 7 Vercel backup hours; the
legacy collect slots stand down. With v2 accounting, a capture costs 3 credits per game; the daily cap of 7 allows two games per
rolling 24 h. The free events list is never reserved by ticks.

## State verified 2026-11-12 (read-only, against the real props database)

From the *Props activation preflight (read-only)* workflow,
[run 43128347240](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43128347240) (GET requests only):

| Check | Result |
|---|---|
| Target | `vfyzbliksooljxrlfadp` (PASS) |
| Active policy | `props-budget-v2`: 7/day, 200/30 days, floor 60 (PASS). `props-budget-v1` (12/day) applied until 2026-11-08 16:00 UTC |
| Rolling cap | 0 windows over the policy in force (the 11-credit peak on 7 Nov was under v1). 7/7 used in the last 24 h; 29/200 in 30 days |
| Provider | 476 credits remaining (floor 60) |
| Provider-confirmed vs reserved, 30 days | `events` list: 5 reserved, **0 charged**; `event_odds`: 24 reserved, 24 charged. Under v3 the totals would be 6/24 h and 24/30 days |
| Duplicates and caps | 0 duplicated run slots; 0 account-days over the entry cap; 15 entries in 30 days |
| Settlement | Completed twice daily through 2026-11-11 16:29 UTC (PASS) |
| Dashboard vs ledger | The live assistant's budget answer (7 of 7, 29 of 200) **matches** the ledger |
| `props_capture_v1.sql` | **NOT APPLIED**: all three tables missing |
| `props_budget_v3_actuals.sql` | **NOT APPLIED**: `count_provider_actuals` column missing |
| Capture ticks | 0 tick runs in the ledger; the release switch is off |

RLS and grants on the production tables cannot be read through PostgREST. Use the step-1 SQL below. The migration's
own SQL tests (`database/props/tests/props_capture_v1_test.sql`) prove on PostgreSQL 16 that `anon` and
`authenticated` are refused and that duplicate plans, claims and outcomes are rejected.

**Run the preflight before and after every step:** GitHub → Actions → *Props activation preflight (read-only)* →
*Run workflow*. After step 1 it must show `capture-schema: APPLIED`. After step 2 it must show
`v3-accounting: APPLIED_AND_ACTIVE`, still with 7/200/60.

**Order matters.** If the switch were merged before step 1, each tick now stops before any provider call with
`CAPTURE_SCHEMA_MISSING`, but no lines would be collected (the legacy collects stand down). Apply step 1 first.

## 0. Before you start

| Check | How | Expected |
|---|---|---|
| PR #135 is merged to `main` and deployed | GitHub PR page; Vercel production deployment of that commit | CI green; deployment "Ready" |
| Merging alone is inert | `src/lib/props/schedule.ts` | `PROPS_COLLECTION_V2.tickEnabled` is `false`. Scheduled and backup ticks print `TICK_RELEASED_OFF` and make **no** DB or provider call. |
| The current policy | `select version,daily_credits,monthly_credits,provider_floor,active_from from public.props_budget_policy order by active_from;` | `props-budget-v1` 12/200/60, then `props-budget-v2` 7/200/60 |

Merging adds these schedules, inert until step 4:

* `props-tick.yml`: GitHub, every 30 minutes, 11:00–04:59 UTC;
* seven Vercel crons `/api/internal/scheduler/props-tick-HH` (13, 15, 17, 19, 21, 23, 01 UTC);
* `vercel.json`.

## 1. Apply the capture schema (additive)

**Do:** paste `database/props/props_capture_v1.sql` and run it. It is one transaction, creates three new
append-only tables, and changes no existing object.

**Verify:**

```sql
select c.relname, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('props_capture_plans','props_captures','props_capture_outcomes');
-- expected: 3 rows, rls = true

select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_name like 'props_capture%' and grantee in ('anon','authenticated','service_role')
group by 1,2 order by 1,2;
-- expected: service_role only, privs = INSERT,SELECT (no anon/authenticated rows)
```

**Rollback:** not needed. Nothing writes these tables until step 4. They can stay empty.

## 2. (Recommended) Count provider-confirmed charges, same limits

**Do:**
1. Paste `database/props/props_budget_v3_actuals.sql` and run it. This adds a column with default `false` and
   replaces `props_reserve_credits` with a version that behaves identically until a policy opts in.
2. Then opt in, effective five minutes later:

```sql
insert into public.props_budget_policy(version,daily_credits,monthly_credits,provider_floor,active_from,count_provider_actuals)
values ('props-budget-v3', 7, 200, 60, now() + interval '5 minutes', true);
```

**Verify:**

```sql
select version, daily_credits, monthly_credits, provider_floor, active_from, count_provider_actuals
from public.props_budget_policy order by active_from;
-- expected last row: props-budget-v3 | 7 | 200 | 60 | <time> | true
```

After that time, the *Props line collection* panel on `/automation` says "Budget reflects provider-confirmed
charges".

**What changes and what doesn't:**

* **Limits:** unchanged. The worker always spends under the **stricter** of this row and the reviewed source
  policy (`effectiveBudgetPolicy`), so a database row alone can never raise spending.
* **Counting:**
  * The free events list (charged 0) stops counting.
  * An empty early attempt (no lines yet, charged 0) stops counting.
  * A request whose reply was not recorded still counts in full.

**Rollback:**

```sql
insert into public.props_budget_policy(version,daily_credits,monthly_credits,provider_floor,active_from,count_provider_actuals)
values ('props-budget-v4', 7, 200, 60, now(), false);
```

Policy rows are append-only.

## 3. One supervised manual tick (optional, with the switch still off)

**Do:** GitHub → Actions → **NBA props capture tick** → *Run workflow* → `trigger: manual`.

**What it does:**

* It plans any slate that is fully visible (free events list).
* It captures only games whose window is open right now, spending at most 3 credits per game within the cap.
* Run it in the evening before a slate to see a plan with **zero** spend.

**Expected result:** the job log's JSON line shows one of these outcomes:

* `NOTHING_DUE`: planned, nothing spent;
* `COMPLETED`: a capture was stored;
* `NO_LINES_CAPTURED`.

```sql
select slate_date, provider_event_id, selected, arm, reason, planned_at from public.props_capture_plans order by id;
-- expected: one row per game of the planned slate; 2 selected (one early, one late); reasons selected_anchor / selected_nearest_tip
select sum(credits) from public.props_credit_reservations where reserved_at > now() - interval '24 hours';
-- expected: <= 7
```

**Stop here if:**

* the outcome starts with `FAILED_`;
* the outcome is `EVENTS_LIST_CHARGED` (the provider charged for the free list; nothing was spent);
* or any number differs from the expectation.

## 4. Release switch (the approval that starts spending on a schedule)

**Do:** open a one-line PR changing `src/lib/props/schedule.ts`:

```ts
export const PROPS_COLLECTION_V2={tickEnabled:true,planVersion:'props-capture-v1'} as const;
```

Merge after CI passes.

**Effect:**

* GitHub and Vercel ticks begin to act.
* Legacy scheduled collect slots and their backups exit with `SUPERSEDED_BY_TICK` and make no calls.
* Settlement is unchanged.

## 5. First 48 hours: checks

```sql
-- No game is ever claimed twice for the same purpose (must be 0 rows)
select plan_id, capture_key, count(*) from public.props_captures group by 1,2 having count(*) > 1;
-- Rolling 24-hour reservations never exceed the cap (must be <= 7)
select max(s) from (select sum(credits) over (order by reserved_at range between interval '24 hours' preceding and current row) s
 from public.props_credit_reservations where reserved_at > now() - interval '3 days') x;
-- Every capture has an outcome, or was claimed in the last 15 minutes
select c.id, c.claimed_at from public.props_captures c left join public.props_capture_outcomes o on o.capture_id=c.id
where o.capture_id is null and c.claimed_at < now() - interval '15 minutes';
-- Captures happened before lock (must be 0 rows)
select c.id from public.props_captures c join public.props_capture_plans p on p.id=c.plan_id where c.claimed_at >= p.commence_time - interval '20 minutes';
```

The dashboard shows each slate's examined/selected/captured games, missing windows, and the timing study as
"Not enough data yet".

## 6. Rollback

A one-line PR setting `tickEnabled:false`:

* Ticks exit before any call.
* Legacy collect slots resume at their next slot.
* Plans, claims, outcomes, lines, picks and entries stay as append-only receipts.

## Optional, separate decisions

| Decision | What changes |
|---|---|
| Raise props to 13/day, 400/30 days | The database row **and** `ACTIVE_BUDGET_POLICY` in `src/lib/props/budget.ts` (reviewed code). Doubles coverage to 4 games per slate. Only if the NBA/EPL moneyline refresh stays under 40 credits per 30 days on the shared key. |
| A paid Odds API plan | Nothing in code until a new budget policy is approved (see `docs/PROPS_COLLECTION_TIMING_2026_11_10.md` §5) |
| Minute-precise scheduler | An external cron calling `/api/internal/scheduler/props-tick-HH` with `CRON_SECRET` |
