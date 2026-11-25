# Release queue and Nov 30 completion plan (final, 2026-11-25)

Prepared by Claude for the owner. ChatGPT owns Kalshi paper-testing automation, production verification and automated
tracking receipt checks; nothing here duplicates that work.

- **Production main:** `8c03239` (#213, #218, #220 live).
- **This is a recommendation, not an approval.** Nothing has been merged, migrated, dispatched or activated.
- **No research, model, gate, sample-minimum, cadence or risk change** is included anywhere below.

**Finish line (Nov 30, core development complete) = Part A, operational readiness.** Algorithm validation (Part B) runs
on its own evidence clock and is not a release blocker.

## 1. Work completed in this round

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
| 1 | **#224** | Merged by ChatGPT or the owner |
| 2 | **#221** | — |
| 3 | **#217** | You approve its two crons. Confirm the Vercel deploy |
| 4 | **#219**, **#223** | Docs, research record, registry |
| 5 | **#216** (optional) | Only if §3 blockers 1 and 2 are done |

### After the Nov 30 gate reads `STOCK_SUPERVISED_SESSION_VERIFIED`

| Order | PR | Condition |
|---|---|---|
| 6 | **#102** | At exactly `9e23e63`. GitHub reports it mergeable |
| 7 | **#222** | — |
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

1. [ ] **By Sun 6:00 PM MST:** merge #224, #221, #217 (and approve its crons), #219, #223. Optionally #216.
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
- **Ops follow-ups** (ChatGPT): register `kalshi-paper-verify` in `config/ops/jobs.json`.
- **Next props release:** the `Number.isFinite` guard in the frozen `rules.ts`.
