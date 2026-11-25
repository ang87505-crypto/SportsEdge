# Supervised stock PAPER session: Monday 2026-11-30 (owner checklist)

Prepared 2026-11-24, final timeline 2026-11-25, from the code on main `8c03239` and PR #102's pinned head `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811`.
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

## Links

| What | Link |
|---|---|
| Autopilot page (Start / Stop, orders, evidence) | https://sports-edge-eta.vercel.app/stocks/paper-auto |
| Weekly decision runs | https://github.com/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-decision-weekly.yml |
| Worker runs (execute / monitor) | https://github.com/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-worker.yml |
| Owner actions (confirm-absent for an uncertain order) | https://github.com/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-owner.yml |
| Operations monitor (gate read) | https://github.com/ang87505-crypto/SportsEdge/actions/workflows/ops-monitor.yml |
| Release PR #102 (pinned head `9e23e63`) | https://github.com/ang87505-crypto/SportsEdge/pull/102 |
| Release branch | https://github.com/ang87505-crypto/SportsEdge/tree/release/stock-paper-orders |

## Timeline: Monday 2026-11-30

Times are MST (UTC−7). New York is on EST (UTC−5). "Done when" is what you must see before moving on.

| MST | ET | UTC | Step | Done when |
|---|---|---|---|---|
| **Sun Nov 29, by 6:00 PM** | 8:00 PM | 01:00 Mon | **Last merge or deploy.** If you approved #217's crons, #217 must be live on Vercel by now. Then freeze: no merge or deploy until step 10 | Vercel → sports-edge → Settings → Cron Jobs lists `stock-decision-backup` and `stock-monitor-late` (only if #217 is merged). `release/stock-paper-orders` still points at `9e23e63` |
| 2:00–2:59 AM | 4:00–4:59 | 09:xx | Automatic: the Vercel kickoff dispatches the weekly decision (observed at 09:16 UTC) | A *weekly decision* run for today appears |
| 3:00–3:59 AM | 5:00–5:59 | 10:xx | Automatic (only with #217): the backup decision dispatch. It does nothing if the 09:xx run is queued, running or succeeded | — |
| **6:00 AM** | 8:00 | 13:00 | The decision is recorded at the reference capture | — |
| **1. By 6:15 AM** | 8:15 | 13:15 | **Check the decision.** Open today's run → step *Record TARGETS, HOLD, MISSED or INPUT_REJECTED* | It shows `"outcome": "TARGETS"` for `2026-11-30`. HOLD, MISSED or INPUT_REJECTED means **no orders today**: stop here. The next session is Mon 2026-12-07 |
| **2. 7:00–7:25 AM** | 9:00–9:25 | 14:00–14:25 | **Arm.** Autopilot page: if not armed, press **Start**. Start runs an account check and reconcile, then arms | Page shows armed, clean check, 0 open alerts and 0 unresolved orders |
| **3. 7:31–7:44 AM** | 9:31–9:44 | 14:31–14:44 | **Execute, once, from your own GitHub account.** Worker runs → Run workflow → branch **`release/stock-paper-orders`**, kind **`execute`**, experiment `stock-v2-weekly-1`, trigger `manual`. This window is after the open and before main's first Vercel execute backup (15:xx UTC = 8:xx AM MST) | The run log's last line shows `"status":"DONE","kind":"execute","outcome":"SUCCEEDED"` and `"posts":` greater than 0 |
| **4. Until all filled** | | | **Watch the fills** on the Autopilot page (Orders). Main's shadow backups at about 8:55, 9:24 and 11:38 AM send nothing | Every order shows **filled**, none open or partly filled. New orders are refused from **1:40 PM** (close − 20 min) |
| **5. After the last fill, by 1:30 PM** | by 3:30 PM | by 20:30 | **Stop, then Start.** Autopilot page → **Stop autopilot**, then **Start**. Start runs a fresh reconcile | The page shows armed again, and the reconcile reads `CLEAN` |
| 2:00 PM | 4:00 PM | 21:00 | Market close | — |
| 3:00–3:59 PM | 5:00–5:59 PM | 22:xx | Automatic: the Vercel monitor records the daily mark (observed at 22:32 UTC) | A worker run (`monitor`) for today ends `DAILY_RECORDED` |
| **6. By 4:00 PM** | 6:00 PM | 23:00 | **Check the mark.** If it is missing, see fallback F4 | `DAILY_RECORDED` exists for 2026-11-30 |
| 6:00–6:59 PM | 8:00–8:59 PM | 01:xx Tue | Automatic (only with #217): `stock-monitor-late` retries the mark. A repeat answers `SLOT_ALREADY_FINISHED` | — |
| **7. After the mark** | | | **Read the gate.** Operations monitor → Run workflow on `main` | The status shows `stockGate.reason` = `STOCK_SUPERVISED_SESSION_VERIFIED` |
| **8. After step 7** | | | Review #102 at exactly `9e23e63` and merge it by hand if you approve. The freeze ends here | — |

## Fallbacks

| # | If | Do | Never |
|---|---|---|---|
| F1 | **No decision run by 5:30 AM** | Weekly decision runs → Run workflow → branch `main`, experiment `stock-v2-weekly-1`, session `2026-11-30`, **initial `false`**. Start it **before 5:55 AM**, once | Never use `initial=true`. Never dispatch after 5:55 AM: a run starting after 7:55 ET is refused or recorded MISSED, and cannot create a late TARGETS |
| F2 | **No TARGETS for 2026-11-30 after 6:15 AM** | No orders today. The next eligible session is **Mon 2026-12-07** | Do not replay, backdate or reuse `initial` |
| F3a | **Your execute shows `"outcome":"SKIPPED"`** with `SLOT_ALREADY_FINISHED` or `SLOT_ALREADY_RUNNING` and `posts:0`. Execute runs are de-duplicated per UTC quarter hour, so a main shadow run in the same quarter hour (for example GitHub's late 13:50 cron) takes it | Wait for the next quarter hour (:00, :15, :30, :45 UTC), then dispatch the execute **once more** exactly as in step 3. A skipped run never contacted the broker; the controller test *"Nov 30 sequence"* covers this | Never dispatch again while a run is queued or running |
| F3b | **Your execute queues** behind a main run in the `paper-auto-stock-v2-weekly-1` concurrency group | Let it queue. If it then reports F3a, follow F3a | Never start a second one alongside it |
| F3c | **Outcome unknown, FAILED, or `SUBMISSIONS_PAUSED` / `UNRESOLVED_SUBMISSION`** | **Do not re-run the execute.** The controller never re-sends an order of unknown outcome. Let the next reconcile find it; after 2:15 PM, an order still uncertain is resolved with Owner actions → `confirm-absent` (experiment and the `pai-…` intent id) | Never re-run to "retry" an order |
| F3d | **`OUTSIDE_EXECUTION_WINDOW` or `NO_EXECUTABLE_DECISION_TODAY`** | Check the time (9:30 ET to close − 20 min) and step 1's decision. Nothing was sent | — |
| F4 | **No `DAILY_RECORDED` by 4:00 PM** | Worker runs → Run workflow → branch `main`, kind `monitor`, experiment `stock-v2-weekly-1`, trigger `manual`. It is accepted **2:15 PM–9:59 PM MST** (16:15 ET to NY midnight) | Before 2:15 PM it skips as `BEFORE_CLOSE`. After 10:00 PM MST the session can never be marked, and the gate cannot pass for this session |
| F5 | **Start refuses**, for example because an order is still working | Wait until it fills or is cancelled, then press **Start** again before 2:00 PM | Do not dispatch other kinds to force it |
| F6 | **The gate reads anything else** | Its reason code names the missing requirement (see "Gate requirements" above). Fix only that step, if its time window is still open | Do not merge #102 |

## What runs on schedule, and why GitHub's lateness no longer matters (verified 2026-11-25 from Nov 16–25 run logs)

| Job | On-time path | Observed | Duplicate protection |
|---|---|---|---|
| **Weekly decision** | Vercel kickoff 09:xx UTC. With #217, a backup at 10:xx UTC | Dispatched at 09:16 UTC every weekday. TARGETS recorded at 13:00 UTC on Nov 16 and Nov 23 | One decision per session in the database. GitHub's 11:20 UTC cron arrives 7–13 h late and is refused: `REFERENCE_CAPTURE_TOO_LATE`, then `SLOT_ALREADY_FINISHED` |
| **Execute** | Owner dispatch on the release branch (step 3). Main's Vercel backups (15/16/18 UTC) are shadow-only | Decision day Nov 23: main's executes recorded `SHADOW_PLAN_ONLY` with `posts:0`. Other days, for example Nov 24 at 15:55, 16:24 and 18:38 UTC: `NO_EXECUTABLE_DECISION_TODAY`. GitHub's runs arrived after the close (23:16, 23:54, 03:42 UTC) and sent nothing | `SHADOW_PLAN_ONLY` on main (writes released OFF). Quarter-hour slot de-duplication. Owner gate. One same-session decision |
| **Close mark** | Vercel monitor 22:xx UTC. With #217, a backup at 01:xx UTC | `DAILY_RECORDED` at 22:32 UTC on every session day Nov 16–24 | Late monitors answer `SLOT_ALREADY_FINISHED` |

The operations monitor's `stock-worker: MISSED_SLOT` describes GitHub's own cron slots only. It does not mean a session lost
its decision, its execute opportunity or its mark.

A shadow plan, a HOLD day, a green workflow or this document is not evidence for any step. Paper fills are not
real-money trading; real money stays off (`realMoneyEnabled:false`) on every branch.
