# Research baseline audit — Day 1 (2026-11-21)

Audited at `main` = `1c6f05d`, with stored records only. No provider credits were used. There were no orders, no
activations and no model or setting changes. Every number below cites its source. Results that lack valid historical
prices and payout math are labelled **watch-only**.

**Status vocabulary:**
- **Operational** — runs on schedule with real forward records.
- **Watch-only** — records and grades, with no valid P/L.
- **Paper-ready** — every gate is met for paper money.
- **Blocked** — named missing evidence or code prevents progress.

## 1. Per-market status

| Market | Active model / challengers | Data, range, sample | Historical vs forward | Calibration and benchmark | Status (evidence) |
|---|---|---|---|---|---|
| **NBA player props** | Active `props-nb-minutes-rate-v1` (`src/lib/props/contract.ts:39`), selection `props-select-v1`. Shadows `props-learn-v1`, `props-learn-v2`. Challenger `props-nb-monotone-cal-v1`: PR #195, `QUALIFIES_FOR_FORWARD_TEST`, not merged. | The Odds API PrizePicks/Pick6 lines with pre-lock predictions; ESPN box-score grading. Forward 2026-11-01 → 11-21: **618** unique graded lines (670 captured, 180 cross-platform duplicates excluded, 21 ties, 7 voids, 24 ungraded); **144** graded picks over **23** games. | Historical: 2023-24 holdout, 70,341 lines (#195), Brier 0.23845. Forward: Brier **0.252**, log loss **0.6976** on 618 lines. | Picks hit **59.0%** [50.9, 66.7] vs 65.0% stated. "More" picks hit **47.6%** vs 64.0% stated: gap +16.3 pts [+2.2, +30.9], the only significant pattern. "Less" is calibrated. Forward Brier 0.252 is no better than an uninformed 0.50 forecast (0.250). PrizePicks virtual: 22 entries, 7–15, **−$5.00** (ROI −4.5%), all 24 entries AUDIT=VERIFIED. Pick6: 11 entries, payout unknown. | **Operational, paper (virtual) accounting.** Promotion blocked by the forward gate: `props-learn-v1` has 503 pairs but 10/14 dates, 18/50 games, 53/100 decisions; `props-learn-v2` has 250/500 lines. Run 44950715831 (props activation preflight, read-only, this audit). |
| **Kalshi weather (NYC high)** | v0 `nws-empirical-error-v0-research` (`src/lib/prediction-markets/kalshi/weather-model.ts`); not admitted. | NOAA only. NWS grid OKX/34,45 hourly forecast (resolved from point 40.7829,−73.9654), plus the NWS CLINYC preliminary daily report for KNYC. Branch `research-data:kalshi-independent/nyc-weather/`: 8 forecasts (targets 11-15…11-22), 3 outcomes (11-18…11-20). | No history beyond these records; no exchange prices. | 3 pairs. Residual (observed − forecast) **+4, +3, +4 °F**: every forecast was too cold. MAE 3.67 °F. n=3 is far too small to estimate bias or skill. | **Blocked: 3 of 30 valid pairs** (section 2). Paper P/L is **watch-only**: the paper ledger and replay use synthetic prices (`docs/KALSHI_OFFLINE_PAPER_LEDGER_2026_11_20.md`). Exchange-data access is pending written permission. |
| **Stocks (Alpaca PAPER)** | Live rules `stock-v2-weekly-1`. Challengers RUNNING: `lab-stock-psychology-v1`, `lab-stock-v3-mom-lowvol`, `lab-stock-v3-core-satellite`, `lab-stock-holdrank10-wholeshare` (all NO_CLEAR_EFFECT). Rejected (8): daily-oc-losers5, momentum-quality, berkshire-13f, daily-reversal5, daily-momentum5d, daily-spy-trend50, spy-tom, lab-stock-v3-riskadj (`research/engine/registry.json`). Open research PRs #196 (fails), #198, #199, #201, #202. | Alpaca daily bars (read-only), SEC 13F and company facts, QMOM holdings (forward only). The ticker universe is a current list, **not survivorship-free**. | Live rules replay (#165): 6.4% vs SPY 20.9%; exposure drag −10.0 pts. Holdrank10 beats the live rules but is below SPY at matched exposure (`docs/STOCK_CHALLENGER_HOLDRANK10_RESULTS_2026_11_19.md`). Forward: **0 real fills**. | INSUFFICIENT DATA. 0 completed trades; the evaluation shows INSUFFICIENT_DATA below 20 trades / 8 clean sessions (`src/lib/stocks/paper-auto-evaluation.ts`). | **Blocked (operations):**<br>• Release gate `STOCK_SUPERVISED_EXECUTE_REQUIRED` (ops-status 2026-11-21T21:08Z).<br>• Nov 16 had TARGETS, but the supervised execute was never dispatched.<br>• The PR #102 watcher expired at 2026-11-21 07:00Z by design (`EXPIRED_REVIEW_REQUIRED`).<br>• Next decision Mon 2026-11-23.<br>• Research data collection is **failing** (defect D1). |
| **Soccer (EPL + 4 leagues)** | `epl-elo-k20-h65-draw-pre20260408-v1` (frozen, experimental). | OpenFootball (pinned commit `e6744429`). Retrospective: 579 games, 2026-04-08 → 10-07, 5 leagues (`src/data/research/elo_2026_10_08.json`). Forward: 10 EPL forecasts for Oct 10–12 (`src/data/research/epl_october_2026_forecasts.json`). | Retrospective **reconstruction, not archived pregame forecasts**: accuracy 49.9% vs 43.2%; log loss 1.022 vs 1.077 (base rate). Forward: 10 forecasts frozen, **never graded**, 0 positions. | Better than the base-rate baseline retrospectively. Not compared with bookmaker fair odds. ROI: none. | **Watch-only, stale since Oct 12.** No settled positions, no result evidence inserted (`docs/EPL_FORWARD_PAPER_RESEARCH.md`). |
| **NFL** | None. | Proposed nflverse schedules archive (CC BY 4.0), draft PR #172 only; no records on `research-data`. | — | — | **Blocked:** no data archive and no predictor. #172 is draft; its live source preflight is unverified. |
| **NHL** | None. | Proposed SportsDataverse schedules archive, draft PR #172 only. | — | — | **Blocked:** same as NFL. |

## 2. Kalshi weather: the 30-pair requirement

The gate is `validateTrainingAsOf` plus `MIN_TRAINING_DAYS` (30): a pair qualifies only when all of these hold.
- The forecast source is NWS.
- The observation is from Central Park (official, or NWS CLI preliminary).
- The forecast is available before the outcome.
- The outcome is available before the as-of time.
- The forecast is not issued after the target day.
- There are no duplicate days.

`docs/KALSHI_WEATHER_CONTRACT_MATH_2026_11_20.md` adds 30 within ±6 h of the target lead time. Every record was
recomputed independently from the raw stored files:

| Target (EST day) | Forecast captured (UTC) | Lead (h) | Grid | Hourly in day | Forecast high (recomputed) | CLI issued (UTC) | Observed high (re-parsed from raw text) | Verdict |
|---|---|---|---|---|---|---|---|---|
| 2026-11-15 | 11-14 10:19 | 18.7 | OKX/34,45 | 24 | 50 (50) | — | — | **No outcome archived** |
| 2026-11-16 | 11-15 07:49 | 21.2 | OKX/34,45 | 24 | 52 (52) | — | — | **No outcome archived** |
| 2026-11-17 | 11-16 07:57 | 21.0 | OKX/34,45 | 24 | 57 (57) | — | — | **No outcome archived** |
| 2026-11-18 | 11-17 09:11 | 19.8 | OKX/34,45 | 24 | 60 (60) | 11-19 06:46 | 64 (64) | **Valid pair** |
| 2026-11-19 | 11-18 08:30 | 20.5 | OKX/34,45 | 24 | 61 (61) | 11-20 06:27 | 64 (64) | **Valid pair** |
| 2026-11-20 | 11-19 08:45 | 20.2 | OKX/34,45 | 24 | 64 (64) | 11-21 06:21 | 68 (68) | **Valid pair** |
| 2026-11-21 | 11-20 08:30 | 20.5 | OKX/34,45 | 24 | 60 (60) | pending (expected ~11-22 06:30) | — | Pending |
| 2026-11-22 | 11-21 08:15 | 20.7 | OKX/34,45 | 24 | 61 (61) | pending | — | Pending |

- **Count: 3 valid pairs.**
  - Timestamps: every forecast was captured before its EST target day began and before its outcome was issued.
  - Station: all forecasts use one grid cell; all outcomes use the KNYC CLI.
  - Horizons: every lead is 18.7–21.2 h, so all are within ±6 h of each other.
- **Why Nov 15–17 have no outcome:** the outcome collector only accepted the CLI heading `TODAY`. The actual report
  labels the completed day `YESTERDAY` (diagnosed in PR #186; repaired on main in #188, 2026-11-19). The preliminary
  CLINYC product only carries the latest report, so those three outcomes **cannot be recovered from that source**.
- **Remaining requirement: 27 more valid pairs.**
  - If every day succeeds, pair 4 is Nov 21 (outcome expected ~Nov 22 06:30Z) and the **30th pair is target
    2026-12-17**.
  - Every missed forecast or outcome adds a day. The minimum is not lowered.
- **Unverified items:**
  - That grid OKX/34,45 is the cell containing KNYC. It is resolved by NWS from Central Park coordinates. It can't be
    re-checked from this audit environment, because NWS was blocked by the network proxy here.
  - That a grid-cell maximum is comparable to the station maximum. This is a known caveat; the cold bias in all three
    pairs is consistent with it but unproven at n=3.

## 3. Confirmed defects, ranked

| # | Severity | Defect | Evidence | Blocks |
|---|---|---|---|---|
| D1 | **High** | The research-data append-only guard refuses the weekly lab ledger's legitimate append (`APPEND_ONLY_VIOLATION: lab/stock-forward-ledger.jsonl`). The whole nightly stock research commit is discarded, including QMOM, 13F, the forward ledgers and the lab freeze. | Research collect runs 44867479053 and 44891899827 (2026-11-21). Ops monitor: `research-collect FAILING`. | **Fixed in this PR.** The lab freeze for the 2026-11-23 decision is lost unless the fix is merged and the collector dispatched before Mon 14:30Z. It runs Tue–Sat only, and a frozen pick cannot be backfilled. |
| D2 | **High** (model validity) | The active NBA model's forward probabilities are no better than 50/50: Brier 0.252 vs 0.250, log loss 0.698 vs 0.693 over 618 lines. "More" picks are significantly overconfident. | Preflight 44950715831: `ALL_LINES`, `BY_SIDE`, `ENGINE_REPORT`. | Any claim of edge, staking or promotion. Supports forward-testing #195. |
| D3 | **High** (operations) | The first supervised stock PAPER execute has not happened. The Nov 16 TARGETS day went unexecuted, and the release watcher expired. | ops-status `stockGate.reason`; no workflow run on `release/stock-paper-orders`. | Stock release (#102); all forward stock trade evidence. |
| D4 | Medium | Three Kalshi forecasts (Nov 15–17) are permanently unpaired because of the earlier CLI parser defect (now fixed). | Section 2. | Kalshi admission is no earlier than the 12-17 target. |
| D5 | Medium | QMOM holdings `PARSE_FAILED` on 2026-11-21 (one observation, not committed because of D1). | Research collect 44891899827 log. | QMOM forward follower data (a forward-only source; gaps are permanent). Confirm on the next run. |
| D6 | Medium | Missed or late props schedule slots (`props-research`, `props-tick` MISSED_SLOT; `props-learn` 6.8 h late). | ops-status 2026-11-21T21:08Z. | Forward sample growth (dates and games for the NBA gate). Infrastructure; GPT. |
| D7 | Low | Pick6 payout is unknown for all 11 entries, so Pick6 P/L can't be measured. | Preflight `BANKROLL props-pick6-v1`. | Pick6 stays watch-only. |
| D8 | Low | The EPL forward forecasts were never graded, and the soccer "accuracy history" is a reconstruction, not archived pregame forecasts. | Files cited in section 1. | Soccer claims beyond research. |
| D9 | Low | The `research-evaluate` monthly job has never run (`PENDING_FIRST_RUN`). | ops-status. | Monthly stock re-evaluation. |

CI: every open research PR (#186, #192, #195, #196, #198–#202) is green. The only red CI on `main` is the scheduled
`Research collect` (D1, fixed here) and the `Independent PAPER release checks`, which exited 1 **by design** when its
window ended (`EXPIRED_REVIEW_REQUIRED`); its retire job succeeded.

## 4. Next experiments (defined before running; existing gates preserved)

| ID | Hypothesis | Data and split | Benchmark | Metrics | Pass / fail (fixed now) |
|---|---|---|---|---|---|
| **E1** NBA monotone recalibration, forward | `props-nb-monotone-cal-v1` (frozen in #195) improves forward probability quality over the active model. | Frozen pre-lock predictions from its first deployed shadow day onward, paired with the active model on the same lines. Cross-platform duplicates count once. No refit. | `props-nb-minutes-rate-v1` on the same lines. | Brier (primary), log loss, ECE, decision hit rate. Game-clustered bootstrap, 1,000 replicates, seed 20261108. | Unchanged `REVIEW_GATE` (`src/lib/props/promotion.ts`). **Pass:** ≥500 lines, ≥14 dates, ≥50 games and ≥100 decisions, Brier-difference upper95 ≤ −0.002, and log loss no worse. **Fail:** lower95 > 0 at the minimum sample. Otherwise collecting. Nothing is promoted automatically. |
| **E2** NBA "More" overconfidence, forward confirmation | The forward "More" gap (+16 pts) is real, not chance. Already registered as `lab-sports-challengers-v2-side-asym`; this adds no new challenger. | All forward graded "More" picks after 2026-11-21, game-clustered. | Stated probability. | Hit-rate gap, clustered 95% CI. | **Confirmed:** ≥100 new More picks over ≥30 games with lower95 > 0. **Not confirmed:** the CI includes 0 at that sample. It reports only; any fix goes through E1 or a new pre-registration. |
| **E3** Kalshi v0 admission and forward skill | The NWS-error distribution model gives a calibrated band probability. | Training is all valid pairs with outcome before as-of; admission at **30 valid pairs** (target 12-17 at the earliest). Evaluation is the next **30 consecutive** post-admission target days, forecasts frozen before the day. | (a) A climatological band-hit base rate from the training pairs. (b) A naive "NWS point inside band = 1" forecast. | Band Brier (primary), log loss, MAE (°F), mean residual. | **Pass:** band Brier is below both baselines, with the paired difference upper95 < 0 (week-block bootstrap), after 30 evaluation days. **Fail:** at or above either baseline. A cold-bias correction is a separate challenger, frozen at pair 30, never earlier. **No paper P/L** without recorded exchange prices. |
| **E4** Kalshi certified-outcome recovery (owner decision) | NCEI GHCN-Daily USW00094728 (certified) daily max equals the CLI preliminary max. | Overlap days 11-18…11-20 (and later). | The CLI preliminary value. | Exact equality. | **Pass:** identical on every overlap day (≥3). Then Nov 15–17 may be admitted as `OFFICIAL_CENTRAL_PARK`, with retrieval time as the available time; the minimum stays 30. **Fail:** any mismatch, so do not admit. One free NOAA request; requires owner approval. |
| **E5** Stock lab continuity | After D1 is fixed, `lab-stock-psychology-v1` freezes each week before the decision. | Weekly freezes from the first successful post-fix run. | Live rules and SPY at matched exposure (existing pre-registration). | Existing (frozen) metrics. | **Integrity pass:** each week has ≥1 frozen row with `frozen_at` < decision open, and earlier rows byte-identical. The week-48 gap is recorded as missing, never backfilled. |
| **E6** EPL forward grading | Grade the 10 frozen October forecasts against official results. | 10 fixtures, 2026-10-10…12, forecasts frozen before kickoff. | League base rate (as in the retrospective). | Log loss, Brier, accuracy. | **Report only.** n=10 can't pass or fail; any soccer claim needs ≥200 forward fixtures and a pre-registered gate against bookmaker fair odds. |
| **E7** NFL/NHL | None yet. First, a source archive (#172) with a verified live preflight. | — | — | — | Blocked until there are 30 days of immutable snapshots **and** a pre-registered predictor exists. |

## 5. Verification run for this audit

- Read-only props preflight 44950715831: success. GET-only; no odds credits were spent by the audit.
- Local suites on `main` plus this fix:
  - Kalshi/NOAA 111/111
  - Kalshi scripts 6/6
  - NBA props 183/183
  - Learning engine and lab 78/78
  - Stock libraries 89/89
  - Data-branch guards 5/5 (new regression included; it failed before the fix)
  - Python research 100/100
  - EPL 5/5
  - Stock weekly v2: pass
