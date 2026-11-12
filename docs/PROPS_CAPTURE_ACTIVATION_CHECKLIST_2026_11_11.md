# Props capture ticks: migration and activation checklist (owner)

This turns on event-aware line capture (props-capture-v1, PR #135). Every step is the owner's. Nothing here has
been done. PAPER only: no real-money entry, no DFS account, no private PrizePicks/Pick6 endpoint.

The steps are ordered so that each one can be verified, and stopped, before the next one.

**Project.** Props use the Supabase project `vfyzbliksooljxrlfadp` (`scripts/paper-release.mjs` refuses any
other). It was confirmed reachable on 2026-11-11. Run all SQL below in that project's SQL editor.

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
