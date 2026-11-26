# Release queue and Nov 30 completion plan (final, 2026-11-25)

Prepared by Claude for the owner. ChatGPT owns Kalshi paper-testing automation, production verification and automated
tracking receipt checks; nothing here duplicates that work.

- **Production main:** `8c03239` (#213, #218, #220 live).
- **This is a recommendation, not an approval.** Nothing has been merged, migrated, dispatched or activated.
- **No research, model, gate, sample-minimum, cadence or risk change** is included anywhere below.

**Finish line (Nov 30, core development complete) = Part A, operational readiness.** Algorithm validation (Part B) runs
on its own evidence clock and is not a release blocker.

## FINAL RELEASE QUEUE AND ASTRA HANDOFF (production main `4d26f72`; 2026-11-26 08:45 UTC)

**Merged by the owner at 07:29 UTC:**
- **RC-2** (#217 at `f14b8b7`)
- **RC-1** (#221 at `8c44bc5`)

#219, #222 and #227 were closed as included. Production pages return 200 after the deploy.

### Release candidates for owner approval

| Order | PR | Head | Contents | Owner action |
|---|---|---|---|---|
| 1 | ~~#217 RC-2 (stocks)~~ **MERGED** | `f14b8b7` | #217 + #222: Nov 30 checklist and fallbacks, 2 backup crons, Autopilot research tracking, holdrank10 forward ledger | Approve the crons and merge **before Sun Nov 29 6 PM MST** (by Sat 04:00 UTC for holdrank10's Nov 30 week). Confirm the Vercel deploy |
| 2 | ~~#221 RC-1~~ **MERGED** at `8c44bc5` (this document follows in #223) | `8c44bc5` | #221 + #219 + #227 follow-ups + #223. NBA tracing; engine evidence coverage; stock-research feed; experiments without producers; /lab "Needs attention"; ops fixes (props-tick judged by Vercel hours, research-source-memory and kalshi-weather-shadow tracked). #228's Kalshi code is untouched | Merge outside the freeze |
| 3 | **#102** | `9e23e63` | Stock PAPER orders release | Only after the Nov 30 gate reads `STOCK_SUPERVISED_SESSION_VERIFIED` |
| 4 | **#216** | `f067645` | NBA forward studies (contains #208) | After a hosted readiness run reads 13 rows READY, approval of `props-cycle.ts`, and a new manifest snapshot |

**Still open:** #223 (this queue, docs only), #102 and #216 (gated). **Close:** #225 and #226 (shipped in #228); #208 and its chain (after #216); the superseded lists in section 6.

### Regression on the integrated candidate `ac36dff` (main + RC-1 + RC-2 + #216)

| Suite | Result |
|---|---|
| Node (every `*.test.mjs`) | **1,213 passed, 0 failed** |
| PostgreSQL e2e | **188/188**. Re-run after a worker restart had stopped PostgreSQL mid-run; that run's 5 failures were connection errors |
| Props SQL harness | passes; 18 readiness cases |
| Python | **471/471** |
| ESLint | 0 errors |
| `next build` | passed |
| Stock frozen-file drift | 0 |
| Production | main pages and the Kalshi health endpoint return 200 |

### For Astra: genuine functional defects

1. **NOAA collector timing.** The forecast phase of `kalshi-independent-weather-memory.yml` (cron 01:11 UTC) runs 16–21 h late, and ops correctly shows `kalshi-weather: MISSED_SLOT`. Records stay valid: they are captured before their target day. A Vercel backup would fix the timing, but moving capture about 6 h earlier sits at the edge of the frozen v1 model's ±6 h horizon matching. Decide with the owner; do not change it silently.
2. **Research source `sec-form345-dataset`.** HTTP 404 for SEC `2026q2_form345.zip` and `2026q3_form345.zip` since Nov 10, an ops blocker. Likely a file-naming or publication-lag change at the SEC. It affects Form 4 research only, no production strategy.
3. **#228 rehearsal.** It reads run 45758616949's artifact, which expires about Dec 26. Repoint it or skip on expiry.
4. **Experiments without evidence producers** (listed on /lab). `lab-stock-v3-*` code exists only in unmerged #165; several sports ablation and challenger experiments advance only on owner-supplied results.
5. **Stock lab Nov 23 week lost** (Nov 21 `APPEND_ONLY_VIOLATION`; fixed on main by #203). Verify that the Sat Nov 28 04:43 UTC research-collect run freezes the Nov 30 week.
6. **Verify the first automatic Kalshi shadow freeze** (Vercel 09:xx UTC slot), then the next-morning grade and the Kalshi panel update.

### Cosmetic or cleanup

- 8 existing ESLint warnings.
- The one-off `daily-shadow-test.yml` (Nov 10) can be retired.
- This document's history sections can be trimmed.
- PR descriptions of the consolidated PRs.

### Future validation (time-gated, not defects)

| System | Requirement |
|---|---|
| Kalshi shadow | 50 graded forward days per horizon before owner review. 2024 verdict `NO_CLEAR_EFFECT` |
| Stocks | Nov 30 supervised session, then #102. 26 forward weeks before any strategy verdict |
| NBA | Shadow and challenger samples to their registered minimums |
| Profitability | Not measured anywhere. Market data is unauthorised; exchange access stays disabled |

## 0a. Update, Nov 26 (later): Kalshi connected end to end; integrated regression

**Integrated regression.** Commit `2608799` merges main `9df0934` with all ten queued PRs: #217, #221, #222, #216, #225, #226 (`57a6c4f`), #227, #219, #223 and #102's dependencies.

| Suite | Result |
|---|---|
| Node | **1,209 passed, 0 failed**; 49 database-gated tests skipped there and run below |
| PostgreSQL e2e | **188/188** |
| SQL harness | passes; 18 readiness cases |
| Python | **471/471** |
| ESLint | 0 errors |
| `next build` | passed |
| Hosted CI | every queued PR green; #227 at `dc564e3`: 16 passed |

#219 and #227 no longer conflict.

**Kalshi (#227 with #226)**
- **2024 full-year evaluation** (pre-registered rule): `NO_CLEAR_EFFECT`. The combined model has the lowest holdout CRPS, but its edge over corrected NBM (about 3%) has a 95% interval that includes zero.
- **Conflicting duplicate records** are excluded, never chosen.
- **Shadow paper forecasting** is integrated with #226's `workflow_call`:
  - Vercel-timed, one independent freeze per horizon, with preflight skips (at most one retrieval per horizon per day);
  - archives verified before extraction;
  - actual capture times recorded.
- **Kalshi page panel** shows the 2024 comparison and the forward scorecard.
- **Learning engine:** the weather experiment is RUNNING. Review needs 50 graded forward days per horizon.

**Release order for Kalshi:** #226, then #227, outside the freeze. The first shadow forecasts are frozen at the next 09:xx/12:xx UTC slot after the Vercel deploy.

## 0. Update, Nov 26: three-system status and the integrated regression

**Integrated regression.** Commit `e66048c` merges main `9df0934` with every queued PR: #217, #221, #222, #216, #225, #226, #227, #219 and #223. The only conflict was #219 + #227 in the engine registry, resolved by keeping both entries.

| Suite | Result |
|---|---|
| Node, every `*.test.mjs` | **1,205 passed, 0 failed**; 49 database-gated tests skipped there and run below |
| PostgreSQL e2e (stocks, command) | **188/188** |
| Props SQL harness | passes; **18** readiness cases |
| Python | **471/471** |
| ESLint | 0 errors (the same 8 known warnings) |
| `next build` | passed |
| Hosted CI | green on #222 (`4cf3ec5`) and #227 (`a8af9ae`) |

**Reviews posted:**
- **#225:** releasable. Missed-window diagnosis uses only event-specific, in-window receipts, and the new ops job closes the #224 visibility gap.
- **#226:** retrieval verified and consumed by #227. Changes requested for operation:
  - `start`/`end`/`station` inputs;
  - `workflow_call`;
  - retention ≥ 30 days;
  - one backfill run, 2025-09-01 to 2026-11-25.

| System | Finished | Operational now | Exact remaining blockers |
|---|---|---|---|
| **Kalshi** | #227: pre-registered challenger, receipt-verified historical evaluation, calibration (coverage, PIT) and per-model comparisons, automatic paper freeze, grading and forward scorecard, engine `--weather-forward` | The live NOAA collector and ChatGPT's v1 paper worker. Its forecast slot runs 16–21 h late, but forecasts still land before their target day | (1) **#226** adds `workflow_call` and inputs and runs the 15-month backfill (ChatGPT). (2) Owner merges #226 then #227. Paper forecasting then starts the next morning, because the 30 training days come from history. (3) Owner review needs 50 graded forward days. Exchange stays disabled |
| **Stocks** | #217 timeline and fallbacks; #222 tracking and the holdrank10 forward ledger | Decision, execute and monitor backups (Nov 25 runs on time); release branch at `9e23e63`; nightly research ledgers | (1) Approve and deploy #217 before Sun 6 PM MST. (2) Nov 30 session. (3) #102 after the gate. The `lab-stock-v3` strategies need #165 merged to collect forward evidence. The Nov 23 lab week is lost (Nov 21 `APPEND_ONLY_VIOLATION`, fixed on main by #203) |
| **Sports** | #216 (one NBA release), #221 (tracing and engine evidence) | Collection, settles and the safety brake (95/150, 63.3%, not tripped); 744 graded lines, 27 games; 0 overdue outcomes | #216: hosted readiness READY plus the `props-cycle.ts` approval. #225's missed-window diagnosis needs no budget change |

**Execution readiness vs profitability.** Every "operational" item above is about execution readiness: on-time runs, frozen records, grading and gates. None of it is evidence of profit.
- Stock profitability needs 26+ forward weeks against matched-exposure SPY.
- Kalshi forecast skill is not trading profitability; that needs market data, which is not authorised.

## 1. Work completed in the previous round

| PR | Head | Change |
|---|---|---|
| **#216** | `e0b86c2` | **Now the single NBA release.** Retargeted to `main`. It contains #208 (`4462f09`), the review fixes and main |
| **#221** | `1b3ceb9` | Prediction tracing, plus learning-engine **evidence coverage** on every run |
| **#222** | `46d8cd5` | Stock tracking **finished**: a read-only *Research tracking* panel on the Autopilot page, fail-safe so the page always works. Proven not to affect the #102 gate |
| **#217** | `1329851` | **Final Nov 30 timeline** (MST/ET/UTC), links and fallbacks F1–F6. Covers the same-quarter-hour skipped-execute hazard, pinned by a new PostgreSQL e2e test |
| **#224** | `7953351` | Independent review: releasable. ChatGPT owns its release |

## 2. Test results

**Integrated tree** (main + #216 + #221 + #222 + #217, `82ab4b7`):

| Suite | Result |
|---|---|
| Node: engine, props, props server, research, stocks, release gates, paper-auto, kickoff, ops | **515 passed, 0 failed**. The 44 skipped are database tests, run below |
| Stock and command e2e on real PostgreSQL | **187/187**, not skipped |
| Props SQL harness | all contract suites; **18 readiness cases**, including the shadow lock-guard and append-only cases; exit 0 |

**Per branch:**

| Suite | Result |
|---|---|
| #217: controller, worker, owner, risk, broker and kickoff with PostgreSQL | 97/97 |
| New *"Nov 30 sequence"* controller test | passes |
| #221: engine suites | 65/65 |
| #221: props suites | 188/188 |
| #222: stock suites, ESLint, `next build` | 149/149; ESLint clean; build passed |

**Hosted CI**
- **#221, #222 and #217:** all checks green on their new heads.
- **#216:** green on `e0b86c2` before the retarget (17 passed, 5 main-only jobs skipped).
- **Release-gate test:** the *Independent PAPER release checks* workflow is disabled, so #222's gate test runs locally only.

## 3. NBA release (#216, containing #208 and #221's sibling)

**Nothing in the code blocks it.** The three genuine blockers:
1. **Owner approval of the frozen-file change.** `props-cycle.ts` (`props-paper-v1`) gains an additive shadow hook. Approve it, then take a new manifest snapshot after merge.
2. **A fresh hosted readiness run** from #216's head, returning 13 rows with `OVERALL = READY`, just before merge.
3. **The deploy freeze**, from Sunday 6:00 PM MST until the gate read.

**Safe before Nov 30:**
- **#221**, now.
- **#216**, only if blockers 1 and 2 are cleared before Sunday 6:00 PM MST. It touches no stock file.

Monotone-shadow predictions are traced by #221 (verified on the combined tree).

## 4. Stock scheduling (existing recovery architecture)

**Nov 24–25 run logs confirm the pattern:**
- Vercel backups do the on-time work.
- GitHub's crons arrive after the close and send nothing: `NO_EXECUTABLE_DECISION_TODAY`, `OUTSIDE_EXECUTION_WINDOW`, `SLOT_ALREADY_FINISHED`.

**#217's two backups remove the remaining single points of failure.** These are the 10:xx UTC decision and the 01:xx UTC close mark.

**Protections unchanged:**
- one decision per session;
- quarter-hour slot de-duplication;
- `SHADOW_PLAN_ONLY` on main;
- owner gate;
- close − 20 min refusal;
- no re-sending of an order whose outcome is unknown.

**The one operational hazard found** is now covered in the checklist and a test. An owner execute that starts in the same UTC quarter hour as a finished main shadow run is skipped before any broker call. Dispatch at 7:31–7:44 AM MST. If it is skipped, dispatch once more in the next quarter hour.

## 5. Learning engine: what it receives and reports

| Evidence | Automatic? | Reported |
|---|---|---|
| NBA baseline predictions and outcomes | **Yes.** Production: 1,054 scored, 1,023 graded, 0 overdue | alarms: overconfidence, accuracy below break-even, missing outcomes, contradictory grades, stale data, drift |
| NBA shadow models | Yes, 2 experiments with forward specs | forward pairing → `INSUFFICIENT_DATA`, `FAILED` on stale or absent data, never promotion |
| Other active experiments (15 of 17) | **No.** They advance only on an owner-supplied result | **New:** `report.evidence` lists them, with days since their last change, and flags any quiet for 30+ days |
| Stock PAPER performance | **No.** No `--stock-weeks` producer | **New:** gap `STOCK_EVIDENCE_NOT_SUPPLIED`, instead of silence |
| Kalshi | Graded outside the engine (ChatGPT) | stated as `GRADED_OUTSIDE_ENGINE` |
| Failed and rejected strategies | from the registry | **New:** listed per run. Currently 1 failed and 8 rejected |

Declining performance, missing data and failed strategies are detected and **reported for review only**. Tests cover each case (`fail-closed`, `alarms` and `evidence` suites).

Feeding stock and lab evidence automatically is Part B integration work. It is not needed for Nov 30.

## 6. Merge-ready queue (all 78 open PRs)

### Merge before Sunday 6:00 PM MST

| Order | PR | Condition |
|---|---|---|
| 1 | ~~#224~~ | **Merged** to main (`9df0934`) on Nov 26. The queued PRs below still merge cleanly |
| 2 | **#221** | — |
| 3 | **#217** | You approve its two crons. Confirm the Vercel deploy |
| 4 | **#219**, **#223** | Docs, research record, registry |
| 5 | **#216** (optional) | Only if §3 blockers 1 and 2 are done |

### After the Nov 30 gate reads `STOCK_SUPERVISED_SESSION_VERIFIED`

| Order | PR | Condition |
|---|---|---|
| 6 | **#102** | At exactly `9e23e63`. GitHub reports it mergeable |
| 7 | **#222** | Since `4cf3ec5` it also freezes holdrank10 forward picks. Merging by **Sat Nov 28 04:00Z** captures the Nov 30 week; after Nov 30, the first week is Dec 7. Its Autopilot panel is fail-safe |
| 8 | **#216** | If not merged before. Then close **#208**, **#192**, **#195**, **#199**, **#200**, **#201**, **#202**, **#206** and **#207**: their heads are git ancestors of #216 |

### Close: superseded or stale (verified)

| PR | Reason |
|---|---|
| #211, #214, #215 | Superseded by merged #218 |
| #187 | Stale Nov 23 plan. 13 of 19 files already on main; the rest would revert newer code |
| #171 | Stale Nov 16 prep. It edits the stock ledger and Autopilot page; superseded by #217's checklist and #222 |
| #163 | Stale Nov 13 handoff document |

### Close: likely superseded (the content landed on main in a later form)

Check before closing.

| PR | Evidence |
|---|---|
| #166, #167 | AI 2.0 learning engine and research intake. All files are on main, last changed Nov 19 |
| #168, #174, #177 | Command center. All files are on main, last changed Nov 14. #177: 15 of 16 identical |
| #184 | Early-capture backups. The scheduler was rewritten Nov 24 |

### Close: October stacks (27 PRs, 5–7 weeks old, built on pre-release history)

#20, #21, #22, #23, #24, #25, #26, #32, #35, #36, #37, #43, #44, #45, #46, #48, #50, #53, #69, #74, #75, #76, #77, #78, #79, #80, #83.

- GitHub cannot merge 7 of them.
- Most of the rest target unmerged stack bases.
- The UI, paper controls and Alpaca PAPER areas they touch were rebuilt on main since.
- Closing keeps their branches.

### Owner's call: research records that preserve negative findings

Merge as records after Nov 30, or keep open. **Do not delete their branches.**

| PR | Finding |
|---|---|
| #97 | Cost-aware momentum |
| #109 | Daily open-to-close: none qualifies. Already `REJECTED` in the registry |
| #133, #134 | Next-gen stock slate, buffer ledger |
| #164 | Sports challengers v2: none qualifies |
| #165 | Lab-stock v3: none qualifies |
| #196 | Cash-aware sizing **FAILS** |
| #198 | Idle cash |

#196 and #198 edit the stock backtest workflow that #216 also edits. Merge them after #216 and re-check.

### Owner's call: review documents not carried anywhere else

- **#204, #205:** Nov 21 baseline and cross-review documents. #205's readiness SQL is superseded by #216's stricter query, but these documents are not in #216 (this corrects my earlier note).
- **#212:** Oct 30 NBA batch document. I have not reviewed it in depth.

### Kalshi weather research (added Nov 26; not part of the Nov 30 finish line)

| PR | Status |
|---|---|
| **#226** (ChatGPT) | Reusable retrieval (`workflow_call`) plus full 2024 archive; requested changes done. Verified and consumed by #227. Merge first, outside the freeze |
| **#225** (ChatGPT) | Missed-window diagnosis and ops visibility for the Kalshi offline check. **Releasable**; merge any time outside the freeze |
| **#227** | Pre-registered challenger with shadow paper forecasting. 2024 result: `NO_CLEAR_EFFECT`; combined about 3% better than corrected NBM, not established. Adds a `weather` engine domain, the /lab and Kalshi page views, and two Vercel scheduler slots. Merge after #226, outside the freeze. No conflict with #219 |

### Owner's call: new features or research, outside "finish the platform"

Defer or close:
- **#94:** a second stock strategy. It edits paper-auto workflows and staging SQL. **Not before Nov 30.**
- **#172, #173:** new data memories.
- **#175, #176, #178:** plans and contracts.
- **#185:** UI redesign.
- **#179:** watch-only. Partly landed; the NBA shadows are now in #216.
- **#209:** QMOM diagnostics.

### ChatGPT's area

- **#180:** NOAA archive visibility.
- **#186:** NOAA grading fix. Both conflict with main after #218.

## 7. Remaining checklist

### Part A: operational readiness (the Nov 30 finish line)

1. [ ] **By Sun 6:00 PM MST:** merge #221, #217 (and approve its crons), #219, #223. Optionally #216. (#224 is merged.)
2. [ ] **Freeze** from Sun 6:00 PM MST until step 4.
3. [ ] **Mon Nov 30:** follow `docs/STOCK_PAPER_SESSION_2026_11_30.md` (#217) step by step:
   - decision check by 6:15 AM;
   - arm at 7:00–7:25;
   - execute at 7:31–7:44 AM MST from your own account on `release/stock-paper-orders`;
   - fills;
   - Stop/Start by 1:30 PM;
   - mark by 4:00 PM.
4. [ ] Run the operations monitor. It must read `STOCK_SUPERVISED_SESSION_VERIFIED`.
5. [ ] Merge #102 at `9e23e63`, then #222. Merge #216 if not already done: hosted readiness READY plus the drift approval and a new snapshot.
6. [ ] Close the PRs listed above.

**Core development is complete when 1–6 are done.** No other development task is required.

### Part B: long-term validation (separate clock)

- **NBA monotone shadow and `props-learn` shadows:** forward samples until their registered minimums are met.
- **#219 challengers:** retrospective only. They need a frozen forward shadow before any review.
- **Stock strategy:** 26+ forward weeks against matched-exposure SPY. Add a `--stock-weeks` producer as reviewed integration work before then.
- **Engine feeds for the 15 owner-supplied-only experiments:** connect the forward lab report after #216 has recorded data.
- **Kalshi:** 30 pairs and 50 holdout, unchanged. ChatGPT owns it.
- **Kalshi multi-source challenger (#227):** the historical decision needs #226's 15-month backfill (about 200 holdout days per horizon). Paper forecasting starts at #227's merge. Owner review needs 50 graded forward days.
- **Ops follow-ups** (ChatGPT): register `kalshi-paper-verify` in `config/ops/jobs.json`.
- **Next props release:** the `Number.isFinite` guard in the frozen `rules.ts`.
