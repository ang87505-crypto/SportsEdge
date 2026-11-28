# Claude takeover handoff: 2026-11-28

Claude took over as primary SportsEdge agent while GPT's credits were exhausted. This document records what was **independently checked**, what was changed, and what remains. Every live claim below cites a GitHub Actions run on this repository. "Mocked" means hand-built fixtures, a disposable local PostgreSQL or a fake broker; "live" means a read-only run against the real props ledger.

**Production behaviour changed: no.**

- Nothing was merged.
- No rule, model, budget, schedule, migration, broker or exchange setting changed.
- No paid odds request, order or Kalshi call was made.

## Baseline (checked, not taken from earlier notes)

| Item | State |
|---|---|
| main | `374777627189` = merge of #216 (NBA forward research studies), 2026-11-28 06:13Z |
| Production | GitHub deployments API: production deployment of `374777627189` succeeded 06:14:16Z. The Vercel URL is not reachable from the agent container |
| Database | Props project `vfyzbliksooljxrlfadp`. The owner's 13-row readiness check was all READY |
| Release branch | `release/stock-paper-orders` = `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811`, the PR #102 pin |
| Operations monitor | `overall WARN`. The only blocker is `stock-first-session` (expected until Monday). `props-learn`, `kalshi-weather` and `kalshi-offline-check` are RAN_LATE |

## Open PRs created in this takeover

| PR | What | Production effect |
|---|---|---|
| [#240](https://github.com/ang87505-crypto/SportsEdge/pull/240) | Manifest snapshot after #216 (`docs/experiments/manifest-2026-11-28.json`); the freeze check uses it | None; CI-only file. The drift against the old manifest was exactly the three approved #216 files |
| [#241](https://github.com/ang87505-crypto/SportsEdge/pull/241) | Read-only NBA pipeline verifier (`src/lib/props/pipeline-verify.ts`, `scripts/props-pipeline-verify.ts`, workflow) | None. The script only gets PostgREST `select()` |

**Merge timing.** Both are safe to merge, but merging deploys main. Merge before the **Sun Nov 29 18:00 MST** freeze, or after Monday's stock gate (step 8 of `docs/STOCK_PAPER_SESSION_2026_11_30.md`). Owner decision.

## Phase 1: NBA reliability (live, read-only)

### Runs used

| Run | Kind | Result |
|---|---|---|
| [46116134660](https://github.com/ang87505-crypto/SportsEdge/actions/runs/46116134660) | Forward paper studies **preflight** on main | READY, 10 tables, `paidRequests:0`, `brokerRequests:0` |
| [46116286889](https://github.com/ang87505-crypto/SportsEdge/actions/runs/46116286889) | Props ledger audit | Covers 1,236 observations. Grading: 1,116 lines recomputed, **0 mismatches**, 0 revisions. Team: 0 mismatches. Layer-1 reproduction: max abs diff **0** on 854 lines. 76 lines await the next settle (Nov 27 games) |
| [46116631405](https://github.com/ang87505-crypto/SportsEdge/actions/runs/46116631405) | Activation preflight + ledger verify (`ledger_from=2026-11-07`) | Every verdict PASS. Budget `props-budget-v2` 7/day, 200/30 days, floor 60; 0 cap breaches. Provider remaining 398. No duplicate runs or claims; entry caps held; last settle 2026-11-27 16:29Z |
| [46117122541](https://github.com/ang87505-crypto/SportsEdge/actions/runs/46117122541) | New pipeline verifier (#241) | See below |

### Findings

1. **Recording of 60%+ predictions meets the owner's rule.**
   - Every captured line has a stored prediction: 1,236/1,236, of which 27 are unscorable (25 player not found, 2 insufficient history).
   - Every one of the 1,236 stored pick decisions matches the frozen `decidePick` re-derived from its own stored probabilities: **0 mismatches**.
   - No recorded pick is outside 60–80% or above the 5% tie limit.
   - Every qualifying line (257) has a recorded pick, with **0 missing**.
   - 6 lines above 80% were skipped as `extreme_disagreement`, per the frozen rule.
   - The 60/70/80%+ watch views (`watch-only.ts`) read these stored predictions.
2. **Chronology is clean.**
   - 0 predictions or decisions at or after lock; 0 data cutoffs after the forecast.
   - Recorded picks were decided 70–480 minutes before lock (median 189).
   - Quotes were at most 3 minutes old at ingest.
3. **Entries and settlement are correct.**
   - 47 entries, 0 construction problems. No entry used the same real line twice for one account.
   - 39 settlements were independently re-graded from box scores and recomputed under the PrizePicks terms (VERIFIED). 4 are pending (Nov 27 games).
   - 4 more are `SETTLED_BUT_UNGRADED` in the old verifier. They depend on DNP voids that have no box-score row:
     - Trey Murphy III, Nov 21 (picks 868/869);
     - De'Aaron Fox, Nov 23 (picks 1017/1028).
   - Both absences are **confirmed by public recaps** (ESPN game 401910027: Murphy out, knee; game 401910045: Fox out, shin). Those settlements are correct. The old verifier's label is a gap: it does not treat absence from a complete box score as void.
   - No stale settlements (no grade revisions exist yet).
   - Bankroll identities hold:
     - `props-prizepicks-v1`: 10W/19L, −$10.00 on $145 staked.
     - `props-pick6-v1`: 14 payout_unknown, never priced.
4. **Picks are not distinguishable from calibrated.** On deduplicated picks (n=161), the hit rate is 59.6% against a mean confidence of 65.1%; the gap is 5.4 pp, z = 1.45. The sample is too small to act on.
5. **Root cause of missed games: the budget design, not a code fault.**
   - 10 of 38 selected games were never claimed.
   - Tick logs for Nov 14 (both games), Nov 19, Nov 21 and Nov 24 show every in-window tick deferring the primary with **`DAILY_CAP`**.
   - Mechanism: the planner sizes 2 games per slate from the per-day budget (7 credits at 3 credits per game). The cap is a **rolling** 24 h window, so the previous slate's evening capture is still counted when today's earlier window opens. Both windows can close before credits free up.
   - Effect: slates 11-14 (0/2), 11-19 (1/2) and 11-24 (1/2) were short. Other days recovered through `late_addition` replacements.
   - Draft #225 fixes only the *display* of such misses.
   - **Proposal for the owner** (changes frozen `capture-plan.ts`, needs approval; spend unchanged):
     - before selecting, have the planner check that the rolling-window credits free by each game's window close cover it;
     - or anchor capture time so daily spend lands at a consistent hour.
   - Not implemented.
6. **Runs are healthy.** 304 runs since Nov 7, with none failed, abandoned or stuck. GitHub schedule lateness: start delay median 37 min, max 10.6 h. Captures are protected by per-game windows.
7. **Penny cohort `penny-paper-entry-v1`: not registered at 06:30Z; registered at 07:37Z (see pending item (b)).**
   - The `record` job of Forward paper studies has never run on main; before #216 there were only PR runs.
   - Registration happens on the first record run, after the next successful props cycle or tick, or at 17:37 UTC.
   - Staking math was re-verified by hand and in #241's tests: 65% × 65% gives 414050 ppm and 8¢, matching the doc.
   - Live stake/return recompute applies once rows exist.

### Still pending from the #216 release (step 5; never backfill)

- (a) `summary.predictions.monotoneShadow.status=OK` with `written>0` after the next collect, and `props-nb-monotone-cal-v1` rows with `predicted_at < lock_at`. No collect has run since the merge; the first is expected tonight.
- (b) **Done (11:06Z follow-up).** The first Forward paper studies **record** run on main was [46122044646](https://github.com/ang87505-crypto/SportsEdge/actions/runs/46122044646) (07:37Z, after capture tick 46122027075, `NOTHING_DUE`). It reported `status: OK` and registered `penny-paper-entry-v1` at 2026-11-28 07:37:37Z, with policy sha `0b79bd54…` matching the SQL check. The next record run, [46135785013](https://github.com/ang87505-crypto/SportsEdge/actions/runs/46135785013) (after settle cycle 46135703633, `COMPLETED`), is also `status: OK`:
  - `paidRequests: 0`, `brokerRequests: 0`;
  - penny 0 source entries (no entry has been made since registration, and none is backfilled), both arms at $500.00;
  - lab report 437 graded / 71 picks, all layers `collecting`.
- Live verifier rerun [46138393012](https://github.com/ang87505-crypto/SportsEdge/actions/runs/46138393012) after that settle:
  - all 1,236 lines graded; all 47 entries settled; 0 stale settlements;
  - pick rule 1,236/1,236 match; coverage 257/257;
  - `penny.registered:true`, 0 entries, 0 mismatches;
  - the only issue is still the 10 `DAILY_CAP` misses (finding 5).
- (c) The engine adds `props-nb-monotone-cal-v1-real-lines`.
- How to check: rerun the Props pipeline verify (#241, or `workflow_dispatch` after merge). Then check `penny.registered`, and that `penny.mismatches` is 0 once entries exist.

## Phase 2: Kalshi weather (evidence branch + docs, read-only)

**Operational status (independent, paper only, exchange DISABLED):**
- The NWS grid forecast memory runs twice daily. 9 graded days (11-18 to 11-26); MAE 3.1 °F; the model is not scored yet.
- The multi-source EMOS paper challenger (`knyc-multisource-emos-v1-research`) freezes SAME_DAY and DAY_AHEAD forecasts daily (Vercel dispatch with GitHub backup). 1 SAME_DAY grade so far (Nov 26; CRPS 1.00 vs GFS MOS corrected 3.57). Owner review needs **50 graded forward days per horizon**.

**Historical backtesting already exists.** `docs/KALSHI_WEATHER_MULTISOURCE_RESULTS_2026_11_26.md`:
- Full-year 2024 and Sep–Nov 2025, on receipt-verified IEM archives.
- Verdict `NO_CLEAR_EFFECT`: about 3% better CRPS than corrected NBM, with the interval spanning 0. It clearly beats GFS MOS.
- No parameter change follows.

**Blocked by external authorization.**
- Kalshi Data Terms and the Developer Agreement do not authorize market-data use without written permission (`docs/KALSHI_API_PERMISSION_REQUEST_2026_11_13.md`).
- So prices, fees as charged, fills and settlement comparison are absent, and forecast skill **is not** profitability.
- Not bypassed. The fee math is documented in `KALSHI_WEATHER_CONTRACT_MATH_2026_11_20.md`.

**Draft PRs still open:** #226 (archive retrieval, owned by GPT), #215, #214, #211, #186. They were not changed.

## Phase 3: Stocks, Monday 2026-11-30 (mocked + read-only)

| Check | Result |
|---|---|
| main stock suites (controller, broker, risk, kickoff, owner, resume, views, performance, evaluation, worker, release gates, ops monitor) | **140/140**. Real PostgreSQL 16 e2e ran, 0 skipped (disposable DB, fake broker) |
| `9e23e63` stock suites (its CI list + scheduled rehearsal + order contract) | **112/112**, 0 skipped |
| `9e23e63` flags | `paperOnly:true`, `brokerWritesEnabled:true`, `scheduledRunsEnabled:true`, `realMoneyEnabled:false` |
| main flags | `brokerWritesEnabled:false` (shadow only), `realMoneyEnabled:false` |
| Code identity | `paper-auto-{controller,broker,risk,store}.ts` are byte-identical between `9e23e63` and main |
| Ops monitor | `stock-decision`, `stock-kickoff` and `stock-worker` are all OK |

**Covered by the e2e tests** (fake broker): the Nov 30 quarter-hour skip sequence, unknown POST never retried, duplicate client order ids, broker rejection stops, external orders/positions/account stop, drawdown and capital ceiling, stale quotes and late slots, the owner STOP kill switch, and DST rotation.

**Not verifiable from here:** hosted ARM state, the Alpaca PAPER account, and Vercel cron delivery. The owner checklist is unchanged and authoritative: `docs/STOCK_PAPER_SESSION_2026_11_30.md`. The supervised owner execute is preserved; nothing was dispatched.

**Research:** `reports/LATEST.md` on `research-data` shows no stock challenger qualifies. Forward ledgers: berkshire −1.8% vs SPY −2.6%, qmom −3.3%. Nothing should be promoted.

## Phase 4 / 5: learning infrastructure (read-only)

- **Before outcomes:** predictions and decisions are stored before lock (chronology 0 violations, finding 2). Model and selection versions are stored per row. Grades are append-only revisions; settlements and penny rows are immutable, with hash or tamper views.
- **Calibration and error tracking:** `props-calibration-audit.mjs` (in the activation preflight) and the ledger audit's real-line Brier vs books. For points, Layer-1 Brier is 0.254 on all 449 deduplicated lines. Where sportsbooks posted the same line (n=330), Layer-1 scores 0.2485 vs the books' 0.2500, a difference whose 95% interval spans 0.
- **No auto-promotion.** The research engine sets REJECTED, continue or READY_FOR_REVIEW only ("never promotion"). `props-gap-shrink-v1` has promotion disabled. Several stock challengers are REJECTED; two props ideas (`lab-props-opponent-rate`, `lab-props-low-minutes`) are PROMISING on history and wait for forward evidence and owner review.
- **No new model components were added.** None showed measurable forward value yet, and the evidence base for adding layers is too small.

## Next steps (in order)

1. Owner: decide on merging #240/#241 before the freeze, or after Monday's gate.
2. After the next props settle (around 10:30Z) and the evening collect, confirm the #216 receipts (a)–(c) and penny registration. Use the pipeline verifier (#241's workflow) and the forward-studies run log.
3. Owner: review the `DAILY_CAP` capture proposal (Phase 1, finding 5). Do not change `capture-plan.ts` without approval.
4. Monday: owner follows `docs/STOCK_PAPER_SESSION_2026_11_30.md`. Agents dispatch nothing on the stock path.
5. Weather: keep accruing forward grades. Kalshi market comparison waits for written permission.
