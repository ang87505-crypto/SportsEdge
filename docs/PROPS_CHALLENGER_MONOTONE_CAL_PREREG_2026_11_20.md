# NBA props challenger `props-nb-monotone-cal-v1`: pre-registration (2026-11-20)

**Committed before any 2021-22, 2022-23 or 2023-24 line was scored, before any calibration map was fit on them, and
before any 2026-27 outcome after 2026-11-18 was opened.** The machine-readable rules are in
`research/props_monotone_cal_v1_20261120/protocol.json`. Nothing below changes after results are seen, and the result
is reported whatever it is.

**Research only.** It does not change:
- the production model `props-nb-minutes-rate-v1` (`src/data/props/model_v1.json`);
- picks, stakes, bankrolls, risk limits or capture budgets;
- the learning registry, engine or promotion gates;
- historical predictions or outcomes;
- Kalshi, stocks or exchange access.

Activation, if ever, belongs to the owner and Codex.

## Audit: what is already known and verified

| Claim | Repository record | Verified |
|---|---|---|
| 80%+ band predicted 86.7%, observed 71.9% | `docs/PROPS_CHALLENGER_AVAILABILITY_RESULTS_2026_11_19.md`, baseline band on all 10,008 **proxy** lines of the 2026-27 holdout (to 2026-11-18) | Yes. Proxy lines, not the live ledger. |
| Brier 0.2493 vs 0.2500 reference on 543 lines | Same PR's pre-registration, live learning run 44635571701 (543 graded real lines, 20 games) | Yes. Real lines, a different and much smaller sample. |
| Earlier challengers did not reliably improve | Registry `research/engine/registry.json`; `lab-sports-challengers-v2` (all NO_CLEAR_EFFECT out of season); role-minutes (no improvement); availability (NO_CLEAR_EFFECT); gap-shrink, side-asym, uncertainty (running prospectively) | Yes |

## Why this hypothesis

**Already tested, and therefore not repeated:**
- log-odds intercept/slope and temperature recalibration;
- separate More/Less slopes;
- shrinkage by minutes CV or history;
- shrinkage by model-vs-line gap;
- the learned layer;
- availability.

Every one of these except availability is **linear in log-odds** (or a shrinkage toward 50%).

**Exploratory diagnostics on the already-inspected 2025-26 season.** Training-style pipeline: 2024-25 priors, dispersion
through 2025-12-31, 45,216 Jan–Apr proxy lines. These choose the hypothesis and are not evidence.

| Baseline decision band | More: confidence → hit | Less: confidence → hit |
|---|---|---|
| 0.50–0.60 | 0.546 → 0.517 | 0.551 → 0.551 |
| 0.60–0.70 | 0.644 → 0.577 | 0.646 → 0.637 |
| 0.70–0.80 | 0.744 → 0.620 | 0.739 → 0.723 |
| 0.80–0.90 | 0.841 → 0.652 | 0.829 → 0.804 |
| 0.90+ | 0.938 → 0.667 (459 lines) | 0.915 → 0.842 (19) |

How the calibration gap (confidence minus hit rate) varies by line feature:

| Feature | Larger gap | Gap |
|---|---|---|
| Standardized line distance \|mean − line\| / SD | z ≥ 1 | +0.207 (vs +0.007 at z < 0.25) |
| Expected minutes | under 15 | +0.102 (vs +0.001 at 32+) |
| History | 3–10 games | about +0.10 |
| Minutes CV | ≥ 0.28 | +0.064 |
| Stat | points | +0.054 (vs +0.018) |

**The key shape.** More hit rates **plateau near 0.62–0.67** while stated confidence rises from 0.74 to 0.94. Less
forecasts are close to calibrated. A log-odds slope can only shrink every forecast by the same factor, so it cannot
flatten a plateau.

**The #191 minutes-spread lead was checked the same way.** Correcting minutes level and spread for every player moved
Brier only from 0.23946 to 0.23885 and left the More 0.90+ gap unchanged (0.271). It is not pursued.

## The challenger

**What it does.** A per-stat, shrinkage-regularized **isotonic** map of the frozen baseline's binary P(more)
(`src/lib/props/monotone-calibration.ts`).

**Fit (training lines only):**
1. **Bins:** 20 equal-width bins on P(more).
2. **Pooled map:** each bin's target is (hits + 100 × mean P) / (n + 100). This shrinks toward the baseline itself with
   100 pseudo-lines. Weighted pool-adjacent-violators (weights n + 100) then makes it non-decreasing.
3. **Per-stat map:** each bin's target is (hits + 100 × pooled map) / (n + 100), followed by the same weighted
   pool-adjacent-violators.
4. **Interpolation:** piecewise-linear between bin means, flat outside them, clamped to [0.01, 0.99].
5. **Minimum data:** at least 2,000 training lines per stat.

**Safeguards:**
- **Small bins:** stay near the baseline.
- **Ordering:** the map is monotone, so the baseline's ranking of lines is kept (adjacent bins may tie) and the
  strongest forecasts remain the strongest.
- **No direction flag:** More/Less asymmetry is learned from where P sits, with no explicit direction input.
- **Fixed constants:** κ = 100, 20 bins and the clamp are fixed now and never tuned.

## Data and evaluation

**Primary: retrospective, untouched season.** The design is the existing backtest design
(`scripts/props-model-fit.ts backtest`):
- every season is scored walk-forward with priors and NB dispersion from the **previous** season only;
- **training** is 2022-23, scored from 2021-22, and the calibrator is fit here;
- **holdout** is 2023-24, scored from 2022-23 by the identical procedure.

The challenger never sees a 2023-24 outcome before evaluation.

| File | SHA-256 | Role |
|---|---|---|
| `player_box_2022.csv` | `1a639a8c…03e6` | 2021-22 priors and dispersion for training |
| `player_box_2023.csv` | `1b797107…9493` | 2022-23: training; prior season for the holdout |
| `player_box_2024.csv` | `c52a708a…9ae2` | **2023-24 holdout** |

**Why 2023-24 counts as untouched.** It was previously used only as *prior-season input* to the 2024-25 backtest (league
rates, player priors and one NB dispersion moment). No probability, calibration or hit rate on its games was ever
computed or reported. Every 2024-25, 2025-26 and 2026-27 (to 2026-11-18) result has been inspected and is **not** used as
evidence here.

**Lines and outcomes.**
- **Lines:** proxy lines (floor of the last-10 median + 0.5), as in every props study. They are half-point lines, so
  pushes cannot occur.
- **Integer lines:** the scorer excludes an exact tie as a push. No tie-aware multiclass score is computed or compared
  with binary scores.

**Uncertainty:** paired bootstrap of whole games, 2,000 replicates, seed 20261121.

**Requirements for `QUALIFIES_FOR_FORWARD_TEST`** (all must hold; challenger minus frozen baseline on the 2023-24
holdout):

| | Requirement |
|---|---|
| R0 | Holdout ≥ 20,000 lines and ≥ 500 games; ≥ 2,000 training lines per stat (otherwise `INSUFFICIENT_EVIDENCE`) |
| R1 | Brier difference upper 95% < 0 |
| R2 | Log-loss difference upper 95% < 0 |
| R3 | ECE (10 bins) difference upper 95% < 0 |
| R4 | On the fixed set of lines where the **baseline** confidence is ≥ 0.70: Brier difference upper 95% < 0 |
| R5 | No credible harm: Brier difference lower 95% ≤ 0 for More, for Less (baseline direction), and for each stat |
| R6 | No excessive compression, all three of: resolution ≥ 0.80 × baseline; AUC ≥ baseline − 0.002; SD of P(more) ≥ 0.50 × baseline |
| R7 | Beyond the tested method: Brier below the single-slope recalibration fit on the same training lines (point estimate) |

| Verdict | Condition |
|---|---|
| `FAILS` | Brier or log-loss difference lower 95% > 0 |
| `QUALIFIES_FOR_FORWARD_TEST` | R1 to R7 all hold |
| `NO_CLEAR_EFFECT` | otherwise |

**Descriptive only** (cannot change the verdict):
- confidence bands 0.5/0.6/0.7/0.8/0.9 by direction for each model;
- reliability tables and Murphy decomposition;
- per-stat and per-direction splits;
- the comparator.

**No verdict promotes anything.**

**Forward arm: frozen now, evaluated later.**
- **Calibrator:** fit once on 2025-26 using the PR #191 training pipeline, and committed before any forward outcome is
  opened.
- **Scoring:** the production artifact exactly, on 2026-27 games starting at or after 2026-11-19T12:00Z.
- **Minimum:** 150 games and 5,000 lines; below that the forward status is `INSUFFICIENT_EVIDENCE`.
- **Real lines:** graded real platform lines go through the existing 500-line / 14-date / 50-game review gate and are
  never mixed with proxy lines.

## Known limits, stated before results

- **Proxy lines measure probability quality only.** Real platform lines are harder, and the More weakness was first seen
  there. A pass says nothing about profit.
- **Season gap:** the holdout is three seasons before the production artifact, and its baseline parameters come from
  2022-23, not from `model_v1.json`. The procedure is identical, but miscalibration could differ in the current season.
  That is why the forward arm exists.
- **One training season;** calibration shape can drift.
- **The fit depends only on the baseline's probability and the stat.** It cannot fix errors driven by unobserved
  information (injuries, rotation). It is a recalibration, not a better model.
