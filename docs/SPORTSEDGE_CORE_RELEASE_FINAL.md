# SportsEdge core release: final handoff

Written Fri 2026-11-13 ~18:45 UTC. Statuses keep three outcomes apart:
- **CORE ENGINEERING COMPLETE:** implementation and tests done.
- **CORE RELEASED:** approved code deployed and verified in production.
- **CORE OPERATIONALLY ACCEPTED:** genuine scheduled and real Alpaca PAPER evidence exists.

**Status at writing:**

| Outcome | Status |
|---|---|
| CORE ENGINEERING COMPLETE | **Yes** |
| CORE RELEASED | **Yes**: production serves `f014dd1` |
| CORE OPERATIONALLY ACCEPTED | **Not yet**: sports is accepted on real receipts; stocks need Monday's real Alpaca PAPER session |

## 1. Production URL
https://sports-edge-eta.vercel.app

## 2. Production commit
`f014dd1e64e8079cd1863ea9214837e43a0ae57c`
Production serving it was verified by *Experiment freeze check* run [43483981962](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43483981962): production `commitSha` == `main`.

## 3. Merged PRs (owner-approved 2026-11-13; squash merges in this order)

| PR | Merged head (CI) | Main commit |
|---|---|---|
| [#157](https://github.com/ang87505-crypto/SportsEdge/pull/157) readiness, /lab phone fix, accounting, lab preflight, freeze tooling, chat cache | `bd55267` (8 of 8 green) | `d2aab20` |
| [#159](https://github.com/ang87505-crypto/SportsEdge/pull/159) constant-time data-health token | `4f95bd2` (6 of 6) | `dc94589` |
| [#160](https://github.com/ang87505-crypto/SportsEdge/pull/160) provider-failed capture turns the tick red; provider tests | `2c5344d` (7 of 7) | `6ed3d60` |
| [#161](https://github.com/ang87505-crypto/SportsEdge/pull/161) CLOCK_SKEW + Monday rehearsal tests | `2fbef29` (7 of 7, incl. stock `controller`) | `eb72674` |
| [#162](https://github.com/ang87505-crypto/SportsEdge/pull/162) 24 px touch targets; honest assistant footnote | `c546d85` (5 of 5 workflows) | `09b0dbc` |
| [#158](https://github.com/ang87505-crypto/SportsEdge/pull/158) hourly Vercel tick backups | `b37657d` (8 of 8 workflows, incl. PAPER controller) | `f014dd1e64e8079cd1863ea9214837e43a0ae57c` |

- **Not merged:** [#102](https://github.com/ang87505-crypto/SportsEdge/pull/102) stock PAPER orders, which stays pinned at `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811`.

## 4. CI
- **Every merge:** each PR was updated from the then-current `main`, and all its checks were green on that exact head before it merged.
- **Integrated release:** with squash merges, each resulting `main` commit has the identical file tree to the PR head CI tested. Verified for the final commit: `git rev-parse main^{tree}` == the tested PR head's tree (`973968e4…` both).
- **Local suite on the integrated set** (weekend, six branches):
  - tsc 0; eslint 0 errors; build OK;
  - JS 751 tests: 708 passed, 0 failed, 43 skipped. The 43 skips are Postgres-gated; they were run separately and passed: stock e2e 86 of 86, props integration 9 of 9;
  - Python 100 + 423; SQL 7 props suites + the stock contract;
  - browser smoke 52 of 52.

## 5. Production smoke
- **Before release** (`198b27f`, run 43477924049): every route passed except `lab-390` (phone overflow, fixed by #157). Real data rendered: overview, props breakdown, all-predictions, lab and assistant.
- **After release, on `f014dd1`:**
  - Production browser QA, [run 43483987718](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43483987718), against the live site: **52 of 52 route/viewport combinations, 0 failures**. That includes `/lab` on phones and the 24 px touch-target rule. Real data rendered on the overview, props breakdown, all predictions, lab and assistant.
  - Local browser QA (run 43484000628): PASS.
  - Experiment freeze check: production `commitSha` = `main` = `f014dd1`; #102 open at `9e23e63`, not merged.

## 6. Sports pipeline: VERIFIED (real receipts)
- **Capture ticks:** they run on the GitHub schedule plus Vercel backups. Latest receipts: 17:10 and 18:28 UTC.
  - 2026-11-13 17:10 UTC tick `NOTHING_DUE`: budget 6 of 7 credits in 24 h, 35 of 200 in 30 days, provider 470.
  - One capture was deferred by `DAILY_CAP` (budget protection working).
  - The Nov 12 slate captured 2 games; next late window 22:10 UTC.
- **Settle:** runs graded the Nov 12 slate (props-daily scheduled 17:15 UTC, success).
- **Results:**
  - Production (14 days): 294 unique lines, 367 platform records, 12 unscorable. The active model hit 53.9% on 271 graded lines; the challenger 56.0% on 141.
  - Read-only preflight on `f014dd1` ([run 43484015943](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43484015943)):
    - `capture-schema: APPLIED`; `capture-claims-unique: PASS` (0 duplicate claims or plans, 0 claims without an outcome);
    - ledger audit `AUDIT=VERIFIED` for every entry (independent re-grade from box scores);
    - PrizePicks: 12 settled, 4 won, 8 lost, net **$0.00**, `IDENTITY_OK`. Pick6: 6 settled with unknown payouts ($30), excluded from all dollar figures.
  - Calibration (unique lines since Nov 1):
    - 271 graded, Brier 0.2489;
    - recorded picks 43 of 76 (56.6%) vs 64.7% stated (z 1.50, not distinguishable from calibrated);
    - Less 32 of 51, More 11 of 25;
    - expected vs realised PrizePicks: +$24.42 vs $0.00.
- **Failure visibility:** a tick whose capture fails at the provider now turns red (#160). A dropped GitHub slot shows as `MISSED_SLOT` in the ops monitor.
- **Active model, selection, stakes and budget:** unchanged; the freeze manifest shows 0 drift.

## 7. Independent prediction tracking: VERIFIED
`/paper-betting/predictions` (production) shows **every** saved pregame prediction from every model.
- **Coverage:** whether picked or not, entered or not.
- **No entry-cap link:** it is independent of the 3-entries-per-day cap and has no weekly limit.
- **Per row:** date, player, game, stat, DFS line, More/Less, model probability, model version, qualifies, decision ("In a $5 entry" / qualified not entered / skipped with reason / observed only / research only), result with the actual stat (won / lost / tie / void / pending), and platform with same-line duplicates marked.
- **Counting:** accuracy counts each event/player/stat/line once across platforms.
- **Example (production, Nov 12):** 67 unique lines. 5 in entries, 10 qualified but not entered, 52 skipped. 57.6% hit on 66 graded.
- **Limits** (for page and database safety, not virtual-betting rules):
  - 14-day window, which covers the whole experiment since Nov 7 until Nov 21;
  - 600 rows per day in the table, with a "showing 600 of N" note and a model filter.

## 8. Stock planning: VERIFIED (decisions); orders SIMULATED ONLY
- **Running jobs:** weekly decisions, kickoff, worker and monitor jobs are OK in the ops monitor. The controller on `main` plans in shadow, because broker writes are off.
- **Code identity:** the controller, risk and broker code are byte-identical to #102.
- **Simulation:** 87 of 87 on the pinned head (fake broker, real Postgres), including CLOCK_SKEW and a full Monday rehearsal.

## 9. Alpaca PAPER release: WAITING (Monday)
- **#102 status:** pinned at `9e23e63`, draft, mergeable.
- **Gate status:** `STOCK_SUPERVISED_EXECUTE_REQUIRED`. ARM and the clean account check are in place.
- **Watcher (owner-approved):** may squash-merge #102 at the pinned head **only** after genuine evidence:
  - a real PAPER fill;
  - a clean same-session close mark;
  - owner Stop then Start.
  It expires 2026-11-21 07:00 UTC.
- **Real money:** `realMoneyEnabled:false`, and the broker accepts only the Alpaca PAPER host.

## 10. Security: VERIFIED (code and routes); production RLS needs owner SQL
- **Routes:** 22 API routes probed without credentials. Every internal route refuses (401/403/404/405, or 503 fail-closed), and no body leaks a stack trace, host, key or `service_role`.
- **Owner session:** 30-minute HMAC session with a server-enforced expiry; cookie `HttpOnly; Secure; SameSite=Strict`.
- **Bearer and cron:** constant-time bearer checks everywhere (#159); `CRON_SECRET` on scheduler routes.
- **Public chat:** shares the 60 s cache (#157).
- **Secrets:** a secret scan of tracked files is clean, and workflows only print `HAS_*` booleans.
- **Remaining:** the production RLS read-only query (Friday report §8) needs the owner in the Supabase SQL editor; this session has no SQL access. There is no per-IP chat rate limit (low–medium; mitigated by the cache and size limits).

## 11. Automation: VERIFIED with receipts; residual risk disclosed
- **Ops monitor** (17:58 UTC): WARN.
  - Site live checks pass. props-daily, props-learn, stock-decision, stock-kickoff, stock-worker, research-collect and ops-monitor are OK.
  - `MISSED_SLOT`: props-research, props-tick and paper-release (GitHub dropped scheduled runs).
  - props-research was re-dispatched once and succeeded (run 43479910015).
  - props-tick is covered by the Vercel backups.
- **Hourly backups** (#158): 28 of 100 crons.
  - **Coverage:** with GitHub dropped, late-window coverage is guaranteed for delays up to a 0–75 min spread.
  - **Residual:** a 0–90 min spread leaves 4-minute holes. At documented timing, 374 of 661 tip-minutes depend on a single Vercel run. If both schedulers fail, nothing captures, and the dashboard shows `MISSED`.
- **Monday check-ins:**
  - the duplicate 14:35 UTC check-in (`trig_019yCBF3teLoxs5dK82vTLGi`) is **disabled**;
  - the guarded 14:38 UTC execute check-in (`trig_018nhvJDxGeNoky49ZBthdTV`) stays;
  - a new after-close acceptance check (`trig_01Fr4VZpXMpmAdSNc29TrmDA`, Mon 22:15 UTC) replaces the after-close steps the disabled one carried.

## 12. Experiment freeze: PREPARED, not yet taken
- **Candidate:** `docs/experiments/manifest-2026-11-13-candidate.json`. 31 frozen files (code + the SQL defining stakes, caps, budget and risk) and 11 recorded files.
- **Last check** (run [43483981962](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43483981962)): 0 drift; recorded changes are #158's two scheduling files, the approved change to data collection.
- **Scheduled:** the freeze runs Sun 2026-11-15 18:00 UTC through scheduled task `trig_01CXca9LgjZs5ULwWRaK7kNB`:
  1. freeze check;
  2. snapshot `manifest-2026-11-15-freeze.json`, PR'd for owner merge;
  3. ops monitor and preflight.

  After it, no protected-file changes until Monday's close.

## 13. Remaining owner-only actions
1. **Sunday 11:00 AM MT (18:00 UTC):** approve the freeze snapshot PR that the scheduled freeze opens. Merge nothing else until Monday's close.
2. **Monday:** sign in and supervise (runbook below). Press **Stop autopilot**, then **Start**, after real fills.
3. **Production RLS:** run the read-only query in the Supabase SQL editor (Friday report §8).
4. **Optional:** apply `database/props/props_lab_v1.sql` (Learning Lab). The site shows `NOT_APPLIED` / `NOT_MIGRATED`, and nothing in sports or stocks depends on it.

## 14. Monday acceptance evidence
**Not yet:** this needs Monday's market session. The 22:15 UTC check will fill this in with real evidence, or state that fill acceptance remains unverified (e.g. on a HOLD day).

**Runbook (Mountain time, Mon 2026-11-16; close is 2:00 PM MT):**

| Time | Action | Expected |
|---|---|---|
| 7:00 | https://sports-edge-eta.vercel.app/stocks/paper-auto → owner key → **Unlock** | Headline **Planning only** (armed; Start disabled). **Do not press Start.** **Stopped** or **Needs attention** = NO-GO: read its reasons |
| 7:00 | Check the decision for 2026-11-16 | **TARGETS** = go. **HOLD**, MISSED or none = valid no-trade day; stop (fill acceptance stays unverified) |
| 7:38 | The guarded check-in dispatches one execute on `release/stock-paper-orders` | Report `posts>0`, `ORDERS_COMPLETE` / `ORDERS_WORKING` |
| 7:45–8:30 | Confirm genuine fills | Autopilot "Risk and execution": intents **filled** with broker order ids, matching the Alpaca PAPER dashboard. Nothing else counts as a fill |
| After fills, before 1:40 PM | **Stop autopilot** → confirm; then **Start** (or **Start on GitHub**) | **Stopped** with working orders cancelled; then **Planning only** after a clean reconcile |
| After 2:00 PM close, ~2:35–4:00 PM | Wait for the after-close monitor | `DAILY_RECORDED`, cash reconciled: the only proof of the close mark |
| 3:15 PM | Scheduled after-close acceptance check | Gate reason; #102 merged by the watcher only if the evidence passes; production deploy verified |

**NO-GO:**
- the gate reason is not `STOCK_SUPERVISED_EXECUTE_REQUIRED` before the session;
- an unresolved intent or critical alert;
- #102's head has changed;
- freeze drift;
- market closed or clock skew;
- you are unavailable;
- repeated uncertain broker outcomes.

**Stop safely:** **Stop autopilot**. Never re-dispatch an execute whose outcome is unknown.

## 15. Known limitations
- **No real fills yet:** a real Alpaca PAPER fill is unproven until Monday. A HOLD day leaves it unverified.
- **Single-backup exposure:** many capture tip times still depend on one Vercel backup; GitHub drops many scheduled runs.
- **Learning Lab:** not activated (optional SQL).
- **Prediction history:** the predictions page shows 14 days.
- **No chat rate limit:** none per IP.
- **No evidence of edge:** stock strategy 6.0% vs 10.5% for exposure-matched SPY (2023+ holdout); sports picks are not yet distinguishable from calibrated, with a weak More side. Nothing claims profitability.

## 16. Future upgrades intentionally excluded
- conversational language model;
- autonomous internet research (foundations exist, inactive);
- new data sources;
- challenger promotion via the lab;
- new stock strategies;
- live brokerage.
