# Props line collection: timing, credits and an early-vs-late study (2026-11-10)

PAPER only. Nothing here places a real-money entry, contacts a PrizePicks or Pick6 account or private endpoint,
purchases or upgrades an API plan, or changes the props model, its thresholds, the correlation rules or entry limits.
Everything new is **released off**: merging this changes no production behaviour until the owner approves the steps
at the end.

Times are UTC unless marked MT (Mountain Standard Time, UTC−7 since Nov 1).

## 1. What actually happened (confirmed from receipts)

Sources: the props worker's JSON receipt in each GitHub Actions run of `props-daily.yml` (run ids in
`research/props_collection_timing_20261110/inputs.json`), The Odds API response headers recorded in those receipts,
the provider documentation (read 2026-11-10) and ESPN's public scoreboard for tip-off times. No database credentials
were available in this session, so the database itself was not queried; every number below comes from a receipt.

### November 9: 10 qualifying picks, no entries

| Fact | Evidence |
|---|---|
| The 19:10 collect started at 02:00 on Nov 10, **410 minutes late** (GitHub schedule; the Vercel backup did not exist yet). | run 42739655657, `startDelaySeconds: 24607` |
| By then 6 of 8 games had started, SA@PHX (02:00) was too close, NO@GS (03:00) was the only game left; 9 more were the next day's slate beyond the 10-hour horizon. | `events.startedOrPast: 6`, `plan.skipped` matches the ESPN schedule exactly |
| One game priced: 36 lines (29 PrizePicks, 7 Pick6), 34 scored, **10 qualifying picks**, 26 skips. | `predictions.recorded: 10` |
| **No entry:** every qualifying pick came from one game, and the frozen rules require each leg from a different game. Nothing was relaxed or forced. | `entries.*.entries: []`; reason later recorded as `TOO_FEW_DISTINCT_GAMES` |
| The 22:10 collect started at 04:04 (354 min late) and was refused by the rolling cap (4 of 7 used, a collect needs 4). | run 42753467042, `BUDGET_EXHAUSTED` |

### November 10: collections blocked by the rolling budget

| Fact | Evidence |
|---|---|
| The 4 credits reserved at 02:00:07–09 on Nov 10 for the Nov 9 slate count until 02:00 on Nov 11. | ledger `used24h: 4` |
| The 19:10 collect ran via the Vercel backup at 20:11 (61 min after the slot) and was **refused: `BUDGET_EXHAUSTED`** (4 + 4 > 7). | run 42892767595 |
| The 22:10 slot and its 23:00 backup face the same 4 credits, so the Nov 10 slate (6 games, first tip 00:30 Nov 11) gets **no coverage** under the current rules. This follows from the ledger and the code; the run had not happened when this was written. | `props_reserve_credits` sums reservations in the last 24 h |
| One of those 4 "used" credits was never charged: the events list costs 0. With true cost (0 + 3 = 3 used), a 1-game collect would have fit (3 + 3 ≤ 7), still not enough for a two-game entry. | provider headers below |

### Scheduler reliability

* **GitHub schedule:** every scheduled props run on Nov 8–10 started **212–634 minutes late** (n = 9: 212, 220, 265, 354, 360, 410, 467, 508, 634).
* **Vercel backup:** the three backup dispatches observed (Nov 10) started **61–73 minutes** after their slot. It works,
  but Vercel Hobby crons are once per day and only hour-precise.

### When PrizePicks and Pick6 lines became available

* **Confirmed:** both platforms had standard points/rebounds/assists lines for **every one of the 6 games we ever priced**,
  at 60–360 minutes before tip-off. The earliest observation is NY@CLE on Nov 7, priced 360 minutes before tip-off.
  Pick6 posts far fewer usable lines than PrizePicks (7–11 vs 23–33 per game).
* **Not known:** whether lines exist earlier than 6 hours before tip-off. No collection ever ran earlier, and games
  beyond the 10-hour horizon were never priced.
* **Cannot be inferred:** the provider's `last_update` is its refresh time (props refresh every 60 s pre-match per the
  docs), not the time a line was first posted. We never label our first observation as the market's opening line.
* **How it could be answered:** historical event-odds snapshots (5-minute intervals since May 2023) exist only on paid
  plans and cost 10 × markets × regions per snapshot. Not purchased.

### Detecting new lines without paying

| Endpoint | Cost | Evidence |
|---|---|---|
| `GET /events` | **free** | docs; and every receipt: remaining fell only by the event-odds cost (500 → 497 after events + one game on Nov 7; 491 → 488 Nov 8; 485 → 482 Nov 9) |
| `GET /events/{id}/markets` (which market keys each bookmaker has) | 1 credit | docs |
| `GET /events/{id}/odds` | unique markets **returned** × regions; empty replies free | docs; not yet observed empty in our receipts |

So the provider supports cheap detection, but **our own accounting defeats it**: `props_reserve_credits` reserves the
worst case (3) before every request and never refunds, so an attempt that finds nothing still blocks 3 credits for
24 hours. The events list is also reserved at 1 although it is free (22 credits reserved vs 18 charged so far).

### Plan size and use

* **Plan:** `x-requests-used + x-requests-remaining = 500` on every receipt: the 500-credit Starter tier.
* **Used this period on the props key:** 18 credits, exactly the 6 event-odds requests × 3. The NBA/EPL moneyline
  refresh has spent nothing on this key this period. Whether it uses a different key could not be checked (secrets are
  not visible).
* **Props share:** 200 per 30 days and 7 per rolling 24 hours; 22 of 200 reserved in four days (11%).

**Coverage is limited by timing, not by credits.** Late starts plus the rolling window wiped out 4 of 7 collect slots
(Nov 8 22:10, Nov 9 22:10, both Nov 10 slots).

**The second daily slot can never spend after the first one has.** A collect needs 4 credits, so the first one
leaves at most 3, which is less than the next one needs.

### Is the two-game limit blocking valid two-pick entries?

* **Yes, and especially on Pick6.**
  * Nov 7 (three games, the v1 budget): 3 PrizePicks + 3 Pick6 entries.
  * Nov 8 (two games): 3 PrizePicks entries and 0 Pick6, because Pick6 had too few qualifying picks across the two games.
  * Nov 9 (one game): no entries.
* **Observed qualifying rates:** 24/106, 20/78 and 10/36 lines (23–28%).
* **Within the current 7/day cap**, two games is the maximum either way (3 credits each). A third game needs 9/day.

## 2. Strategies compared (replay)

`scripts/props-collection-replay.ts` replays each strategy against the real Nov 7–12 tip-offs and the observed delays,
under the production budget rules, using the real planner for the proposed design. Output:
`research/props_collection_timing_20261110/report.json`.

**The replay measures coverage and credits only.**
* It assumes lines exist whenever a game is priced. That held for all 6 priced games; earlier than 6 hours before
  tip-off is unverified.
* It cannot say whether a priced game would have produced qualifying picks.

| Strategy | Games priced (per slate) | Slates where a 2-game entry is possible | Credits reserved | Credits charged | Median minutes before tip |
|---|---|---|---|---|---|
| Legacy slots 19:10 + 22:10, on time (best case) | 12 (2/2/2/2/2/2) | 6/6 | 42 | 36 | 290 |
| Legacy, observed GitHub delays, no backup (Nov 8–9 reality) | 6 (2/0/1/1/0/2) | 2/6 | 24 | 18 | 78 |
| Legacy + 150-min late rule + Vercel backup (**current production**) | 10 (2/2/2/2/2/0) | 5/6 | 35 | 30 | 162 |
| Legacy, events list not reserved | 10 (2/2/2/2/2/0) | 5/6 | 30 | 30 | 162 |
| One early slot 16:10 (9:10 AM MT) + backup | 10 (2/2/2/0/2/2) | 5/6 | 30 | 30 | 397 |
| Three slots 16:10 / 19:10 / 22:10 + backups | 12 (2/2/2/2/2/2) | 6/6 | 36 | 36 | 282 |
| **Proposed ticks, Vercel backups only** (GitHub assumed dropped) | 11 (2/2/2/2/1/2) | 5/6 | 33 | 33 | 270 |
| **Proposed ticks, Vercel + GitHub every 30 min** | 12 (2/2/2/2/2/2) | 6/6 | 36 | 36 | 360 |
| Ticks with props at 13/day, 400/30 days (reallocation, owner decision) | 22 (4/4/4/4/2/4) | 6/6 | 66 | 66 | 390 |
| Ticks on a 20K plan, props ~30/day (not purchased) | 37 | 6/6 | 111 | 111 | 330 |

How each approach fares:

1. **Early-day collection alone** captures earlier (median 397 min before tip-off) but keeps the rolling-window chain.
   One late day pushes the next day's spend later, and a slate is lost. It also gives no evidence about whether early
   is better.
2. **Multiple fixed collections** match the proposed coverage when they start on time, but they share one daily cap,
   so later slots only help when earlier ones could not spend. They still depend on slot timing and give no clean
   early-vs-late comparison.
3. **Event-aware ticks (proposed).** A capture happens only inside each game's own window. Lateness of the scheduler
   becomes harmless, and a delayed tick can never spend on a started game. Duplicates are refused twice: by the run
   ledger (30-minute bucket) and by a per-game claim written before any paid call.
4. **New-line detection.** The free events list drives planning. Event odds charge only returned markets, so an
   empty attempt is free at the provider. It is still not free in our ledger until accounting is changed (approval
   step 3). Until then each game gets one paid attempt in a window where lines are likely; a retry needs spare credits
   that no other selected game needs.
5. **Allocation.**
   * Within 7/day the maximum is 2 games per slate.
   * Raising the props share to 13/day and 400/30 days from the moneyline's unused 240 doubles coverage to 4 games.
     That is an owner decision, and the moneyline refresh would have to stay under 40 credits per 30 days.
   * A paid plan removes the constraint (§5).

Two design flaws were found by this replay and fixed before delivery:

* **Per-game windows broke entries.** They let a 00:00 tip-off lock before a 03:00 game was captured, so an entry was
  possible on only 4 of 6 slates: the Nov 9 failure mode. Windows are now anchored to the slate's earliest selected
  tip-off, and the second game is the nearest tip-off to a hash-chosen anchor.
* **Whole-slate EARLY/LATE assignment broke EARLY captures.** It put a LATE day's spend 17–19 hours before the next
  EARLY day's, and the 7-credit rolling cap pushed 4 of 6 EARLY captures into the LATE window. Arms are now split
  within each slate (one EARLY and one LATE game), a paired design. It spends about 3 credits at each time, which the
  rolling cap absorbs: 0 fallbacks in the replay.

## 3. Recommended schedule (within the existing plan and limits)

**Event-aware capture ticks, props-capture-v1:**

* **Planning:**
  * Each slate (ET date) is planned once, the evening before, from the free events list.
  * 2 games are selected: a hash-chosen anchor plus the nearest tip-off.
  * One game is assigned EARLY and one LATE, by hash.
* **Windows,** relative to the slate's earliest selected tip-off:
  * **EARLY:** 8 to 4 hours before.
  * **LATE:** 3 hours to 35 minutes before.
* **Each capture:**
  * predicts immediately with the active model;
  * records picks under the unchanged selection rules;
  * builds entries before lock.

| | Old (legacy slots) | Proposed (ticks) |
|---|---|---|
| Collect triggers | GitHub 19:10 and 22:10 (12:10 PM and 3:10 PM MT); Vercel backups 20:00 and 23:00 (1 PM and 4 PM MT) | Vercel backup ticks at 13, 15, 17, 19, 21, 23, 01 UTC (6 AM, 8 AM, 10 AM, 12 PM, 2 PM, 4 PM, 6 PM MT); GitHub ticks at :07 and :37, 11:00–04:59 UTC |
| What a run does | Prices the earliest 2 unstarted games within 10 h | Captures only the selected games whose own window is open now |
| Typical capture, 5 PM MT first tip-off | 12:10 PM MT when on time, ~5 h before tip-off; observed 1–7 h late | EARLY game 9 AM–1 PM MT (8–4 h before tip-off); LATE game 2:00–4:25 PM MT |
| Typical capture, 7 PM MT first tip-off | 12:10 PM MT, ~7 h before tip-off | EARLY 11 AM–3 PM MT; LATE 4:00–6:25 PM MT |
| Late or duplicate trigger | 150-min late rule, slot-key dedupe | No slots to be late for; 30-min bucket dedupe plus a per-game claim; never spends on a started game |
| Credits per day | 7 reserved (1 phantom), 6 charged, when it runs | 6 reserved and 6 charged (events list not reserved); about 180 per 30 days, within 200 |
| Games per slate | ≤ 2, often 0–1 in practice | 2 (12/12 in replay) |
| Settlement | Unchanged (GitHub 09:20 and 15:20 plus Vercel backups) | Unchanged |

Unchanged:

* the props model (`props-nb-minutes-rate-v1`);
* the selection rules (`props-select-v1`/`v2`) and their thresholds;
* the different-game and different-player entry rules;
* 3 entries per platform per day, $5 virtual stakes;
* lock buffers and observation admission rules;
* append-only ledgers;
* PrizePicks and Pick6 kept in separate accounts.

## 4. Timing research (built in, prospective only)

**Source:** `src/lib/props/timing-study.ts`, shown on the automation page under "Timing study".

**Tracked for every qualifying pick, and for every scored line:**
* the first line SportsEdge observed (never called the opening line) and later line changes;
* the last pregame observation, used as the "closing" line only when it is within 90 minutes of tip-off;
* minutes from capture to tip-off;
* the model probability at the time;
* whether the pick qualified, and whether it went into an entry;
* the win/loss/void outcome;
* PrizePicks simulated dollars by entry arm (Pick6 payouts stay unknown);
* line value against a comparable closing observation, null otherwise.

**Grouping:**
* by assigned arm (intention to treat);
* by the window actually used;
* by minutes-to-tip bucket and quote-age bucket.

**Rules that keep it honest:**
* Only picks from ticks with a plan written before the capture are "prospective". Older slot picks are reported
  separately as observational.
* Nothing is re-decided after results.
* Every group carries a Wilson 95% interval.
* The EARLY − LATE difference uses a slate-cluster bootstrap with a fixed seed. It stays **"Not enough data yet"**
  until each arm has at least 20 slates and 150 graded picks.

**Expected power at this budget:**
* About 1 EARLY and 1 LATE game per day, and roughly 7–10 qualifying picks per game, gives about 200–250 graded picks
  per arm per month.
* The gate is reached in about 3–4 weeks.
* At that size only differences of about 12 percentage points in hit rate are detectable (80% power, ignoring
  clustering).
* A 5-point difference needs about 1,500 graded picks per arm, roughly 6 months on this plan.
* Closing-line comparisons need a second observation of the same game. That does not fit in 7 credits a day, so line
  value will be rare until the budget allows rechecks.
* Entries usually mix one EARLY and one LATE leg, so dollar results cannot be split by arm on this plan.

## 5. What a larger plan could support (not purchased)

* **Cost basis:** one snapshot of one game costs 3 credits, and there are about 7.5 NBA games per day.
* **Illustrative split:** props get 75% of a paid plan and the moneyline refresh keeps 25%.

| Plan | $/month | Credits/month | Props credits/day | One snapshot of every game | Snapshots per game per day | Historical first-posting studies per month* |
|---|---|---|---|---|---|---|
| Starter (current) | 0 | 500 | 6.7 (200 share) | No (2 games) | ≤ 1 | 0 (no historical access) |
| 20K | 30 | 20,000 | 500 | Yes | ~22 (e.g. hourly from 12 h out, every 15 min in the last 2 h) | ~13 games |
| 100K | 59 | 100,000 | 2,500 | Yes | ~110 | ~69 games |

\* Binary search over 24 hours of 5-minute historical snapshots: about 9 lookups × 30 credits per game, using a
quarter of the props share.

On 20K, the study would get an EARLY *and* a closing observation for every game: real line-movement and closing-line
evidence, plus entries from all games.

## 6. Implementation (this branch)

| Piece | File |
|---|---|
| Planner (pure) | `src/lib/props/capture-plan.ts` |
| Tick runner | `src/lib/server/props-tick.ts`, `scripts/props-worker.ts tick` |
| Shared reply storage (legacy collect unchanged in behaviour) | `storeEventReply` in `src/lib/server/props-cycle.ts` |
| Schema, additive and append-only | `database/props/props_capture_v1.sql` |
| Budget accounting **proposal** (behaviour-neutral until a policy row opts in) | `database/props/props_budget_v3_actuals.sql` |
| Release switch (default **off**) | `PROPS_COLLECTION_V2.tickEnabled` in `src/lib/props/schedule.ts` |
| Triggers (inert while off) | `.github/workflows/props-tick.yml`; `props-tick-HH` slots in `scheduler-kickoff.ts` and `vercel.json` |
| Dashboard | `src/lib/props/collection-status.ts`, `src/components/props-collection-panel.tsx`, automation page |
| Timing study | `src/lib/props/timing-study.ts` |
| Replay | `scripts/props-collection-replay.ts`, `research/props_collection_timing_20261110/` |

The dashboard shows:

* last successful collection and next planned collection;
* actual start against scheduled time;
* rolling 24-hour and 30-day credits left, and when credits free up;
* games examined, selected and captured per slate, and lines observed;
* qualifying picks and virtual entries;
* why no entry was made;
* missing or late windows.

Planned work, completed jobs, recorded picks and virtual entries are counted separately.

**Safeguards:**

* **Before any call:**
  * While the switch is off, scheduled and backup ticks exit before any database or provider call.
  * Once it is on, legacy scheduled collects stand down (`SUPERSEDED_BY_TICK`) so both never spend the same credits.
* **Spending:**
  * Every paid request is preceded by a database claim (unique per game and capture key) and a credit reservation.
  * Unknown outcomes are never retried.
  * If the free events list is ever charged, the tick stops before any paid call (`EVENTS_LIST_CHARGED`).
* **Records:**
  * Rechecks (closing observations) store lines and predictions but never picks or entries.
  * The database rejects stale (> 2 h), incomplete and after-lock observations, as before, and claims inside the
    20-minute margin before tip-off.

## 7. Verification

| Check | Result |
|---|---|
| Props unit tests (the CI list plus the scheduler) | 229/229 pass |
| SQL contract tests on disposable PostgreSQL 16 | 6/6 suites pass, including the new `props_capture_v1` and `props_budget_v3_actuals` |
| End-to-end on the real schema | 8/8 pass, including the new tick test (below) |
| Browser smoke (`scripts/browser-smoke.mjs`, production build) | 48 route/viewport checks, 0 failures |
| Collection panel in Chromium at 1360 px and 390 px (temporary uncommitted route; real Nov 9–10 ledger plus a synthetic tick slate) | No page errors, no horizontal overflow |
| `npm run lint` | 0 errors; the 3 existing warnings unchanged |
| `npm run build` | Succeeds |

The tick test on the real schema covers:

* a slate planned once with nothing spent;
* the EARLY game captured and predicted at once, with no single-game entry;
* a duplicate trigger refused;
* the LATE game deferred by yesterday's carried-over credits, then captured after they roll off;
* entries spanning two games, made before lock;
* platforms kept separate;
* 6 credits in total;
* a late tick spends nothing;
* records append-only.

Mutation checks:

* Switch flipped on: backup dispatch and legacy stand-down verified.
* Slate anchor removed: the Nov 9 test fails.
* Started-game filter removed: the missed-game budget test fails.

## 8. Known limitations

* No direct database read in this session; findings come from run receipts.
* Line availability earlier than 6 hours before tip-off is unverified. The EARLY window was set to 8–4 hours (not
  earlier) for this reason. The tick receipts (`no_dfs_lines`, minutes-to-tip) will measure it.
* "Empty replies are free" is documented but not yet observed in our receipts. Each capture outcome records
  `x-requests-last`, so it will be.
* GitHub ticks may be as delayed as the slots were. Without them, the replay lost 1 game on 1 of 6 slates. A
  minute-precise scheduler (step 6) would close that gap.
* The timing study needs about 3–4 weeks before any verdict, and can only detect large differences on this budget.

## 9. Owner approvals required (nothing below has been done)

1. **Apply `database/props/props_capture_v1.sql`** to the props Supabase project. It is additive, creates new
   append-only tables and changes no existing object.
2. **Release switch:** set `PROPS_COLLECTION_V2.tickEnabled = true`.
   * This activates the tick schedules this PR adds, which are inert until then:
     * `props-tick.yml` crons;
     * 7 Vercel crons.
   * Legacy scheduled collects then stand down.
   * Rollback: set it back to `false`.
3. **Recommended budget accounting change.** Apply `props_budget_v3_actuals.sql`, then insert `props-budget-v3`
   (7/day, 200/30 days, floor 60, `count_provider_actuals = true`). Limits stay the same; only provider-confirmed
   charges count. This makes empty early attempts free in our ledger, as they are at the provider, and recovers the
   phantom events credit.
4. **Optional reallocation.** Raise the props share to 13/day and 400/30 days. This doubles coverage to 4 games per
   slate, but only if the moneyline refresh keeps under 40 credits per 30 days on the shared key.
5. **Optional, not purchased.** A paid plan (§5).
6. **Optional scheduler.** A minute-precise external trigger for `/api/internal/scheduler/props-tick-HH` (for example
   Supabase `pg_cron` + `pg_net` or an external cron service), using the existing `CRON_SECRET`. This needs secrets
   configured by the owner.
