# Supervised stock PAPER session: Monday 2026-11-30 (owner checklist)

Prepared 2026-11-24 from the code on main `ebffeb9` and PR #102's pinned head `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811`.
It replaces nothing in `docs/AUTOMATION_OPERATIONS_2026_11_10.md`; it applies that runbook to the next eligible
session. All times are Mountain Standard Time (MST) unless marked; New York is on EST (UTC−5).

## Why Monday 2026-11-30

- **Nov 23 was not a supervised session.**
  - The decision was recorded as `TARGETS` (run 45145587251).
  - Only main's executes ran, all `SHADOW_PLAN_ONLY` with `posts:0`.
  - No workflow has run on `release/stock-paper-orders` since 2026-11-10.
  - The Nov 24 operations monitor still lists the blocker `stock-first-session`.
- **The weekly bridge decides only on the first exchange session of an ISO week**
  (`analytics/stock_weekly_bridge_v2.py`, `decision_point`). Checked against a calendar with Thanksgiving closed:
  - Nov 24, Nov 25 and Nov 27 are not decision sessions;
  - Nov 30 (ISO week 49) is;
  - Dec 1 is not.
- **The controller executes only a decision made for the same New York session**
  (`NO_EXECUTABLE_DECISION_TODAY` otherwise), and the database allows one decision per session. The Nov 23 decision
  cannot be replayed.
- **The `initial` option is spent.** It was used on 2026-10-30 (run 41043837193). The bridge would still accept
  `initial=true` on any weekday, because nothing in code limits it to once. **Never dispatch the weekly decision with
  `initial=true`.** The Vercel kickoff always sends `initial:'false'`, and the workflow default is `false`.

## Verified on 2026-11-24 (local, disposable PostgreSQL, fake broker; no hosted state)

| Check | Result |
|---|---|
| main/branch stock suites: broker, risk, owner, resume, views, performance, evaluation, worker, kickoff, controller e2e, release gates, ops monitor | 133/133, PostgreSQL e2e not skipped |
| #102 head `9e23e63` stock suites (its CI list) | 93/93, PostgreSQL e2e not skipped; Python bridge OK |
| #102 head flag check (CI step) | `paperOnly:true`, `brokerWritesEnabled:true`, `scheduledRunsEnabled:true`, `realMoneyEnabled:false`; decision/owner workflows unscheduled; owner workflow owner-only |
| Code identity between `9e23e63` and main | controller, broker, risk, store, planner, staging SQL, bridge, scoring and registration are byte-identical. The universe file differs (MMC→MRSH, EA removed); the decision runs on main, and execute only reads it |
| Frozen stock files (experiment manifest 2026-11-13) | zero drift on `stock-v2-weekly-1`, including on this review branch |
| main release flags | `brokerWritesEnabled:false`, so main stays shadow-only |
| Release watcher | `paper-release.yml` is disabled, and the window expired 2026-11-21. #102 merges only by the owner's hand |
| Kickoff timing | Vercel 09:00 UTC = 04:00 EST, inside the 03:00–07:45 ET kickoff window. GitHub backup 11:20 UTC. Decision at 08:00 ET = 6:00 AM MST |

**Not verifiable from here:**
- the hosted ledger: ARM state, last account check, alerts, unresolved intents;
- the Alpaca PAPER account;
- Vercel cron delivery.

The Nov 24 monitor shows `stock-decision:OK` and `stock-kickoff:OK`. It also shows `stock-worker:MISSED_SLOT`:
GitHub's scheduled worker slots are being dropped, which matters for the after-close mark (step 9).

## Gate requirements #102 checks (`scripts/paper-release-gates.mjs`, `stockReleaseGate`): unchanged

1. Ledger registered for `stock-v2-weekly-1`.
2. Gate `ARMED` by the owner.
3. A clean account check within 26 hours, with no unresolved or active intents, critical alerts or executing run.
4. No activity other than strategy fills.
5. A successful **manual** `execute` receipt with `posts > 0`. The run must be a `workflow_dispatch` on
   `release/stock-paper-orders` at exactly `9e23e63`, and **both actor and triggering actor must be the owner's GitHub
   account**.
6. A same-session `TARGETS` decision recorded before that run, and filled intents created during the run.
7. Owner ARM before the run, owner Stop after it, then an owner re-ARM.
8. A `CLEAN` reconcile between that Stop and Start.
9. A same-session daily mark: cash reconciled, no external flows, captured after the restart, inside a successful
   monitor run for that session.

## Checklist

**Before Monday (Sat/Sun)**
- [ ] Do not merge or deploy anything to production between Sunday evening and Monday's after-close mark. That
      includes #208 and #213. Neither touches stock files, but a deploy mid-session adds risk for no benefit.
- [ ] Confirm PR #102 is still open and draft at `9e23e6305eb0…`, and that `release/stock-paper-orders` points there.

**Monday before 7:30 AM**
- [ ] **6:00 AM (automatic):** the weekly decision.
  - Check GitHub → Actions → *Recurring PAPER weekly decision (manual)* → the Nov 30 run.
  - Step *Record TARGETS, HOLD, MISSED or INPUT_REJECTED* must show `"outcome": "TARGETS"` for `2026-11-30`.
  - HOLD, MISSED or INPUT_REJECTED means no order day: stop, and the next session is **Mon 2026-12-07**.
  - **Do not re-dispatch the decision with `initial=true`.**
- [ ] Open https://sports-edge-eta.vercel.app/stocks/paper-auto. If it is not armed, press **Start** (account check,
      then arm). Optional: ask *"Are we ready for Monday?"* while signed in.

**7:31 AM–about 1:00 PM**
- [ ] Run the supervised execute **from your own GitHub account**: Actions → *Recurring PAPER worker (manual)* → Run
      workflow →
  - branch **`release/stock-paper-orders`**;
  - kind **`execute`**;
  - experiment `stock-v2-weekly-1`;
  - trigger `manual`.
  
  Run it **once**. A run started by any other account (including a token or an assistant) does not count.
- [ ] The run's log must show `"status":"DONE","kind":"execute","outcome":"SUCCEEDED"` with `posts` > 0. If the outcome
      is unknown or failed, **never re-run it**. Reconcile first; uncertain submissions use the owner absence check
      after 16:15 ET.
- [ ] On the Autopilot page, wait until every order shows **filled** (none open or partly filled). The controller
      refuses new orders from 1:40 PM (20 minutes before the 2:00 PM close).

**After all fills, before the 2:00 PM close**
- [ ] Press **Stop autopilot**, then **Start**. Start runs a fresh reconcile, which must be `CLEAN`. A still-working
      order makes it unclean, and a Stop/Start after the close cannot satisfy the same-session mark.

**After the close**
- [ ] The daily mark is recorded by the monitor: GitHub at 1:35 / 2:35 PM (often dropped), with a Vercel backup at
      3 PM.
- [ ] **If no mark exists by about 3:30 PM**, run Actions → *Recurring PAPER worker (manual)* on **main**: kind
      `monitor`, experiment `stock-v2-weekly-1`, trigger `manual`. It is accepted from 2:15 PM (16:15 ET) until 10 PM
      the same day. Before 2:15 it skips as `BEFORE_CLOSE`; after midnight ET the session can never be marked.
- [ ] After the mark: Actions → *Operations monitor* → Run workflow on `main`. `stockGate.reason` must read
      `STOCK_SUPERVISED_SESSION_VERIFIED`.
- [ ] Only then, review and merge PR #102 at exactly `9e23e63`, by hand. Nothing merges automatically.

A shadow plan, a HOLD day, a green workflow or this document is not evidence for any step. Paper fills are not
real-money trading; real money stays off (`realMoneyEnabled:false`) on every branch.
