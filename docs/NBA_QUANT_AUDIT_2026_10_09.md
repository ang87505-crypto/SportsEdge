# NBA quantitative audit — 2026-10-09

## Decision

The frozen `nba-elo-k20-h65-2026-04-v1` is reproduced, not replaced. Candidate `nba-elo-k20-h65-carry75-research-v1` is implemented for research but NOT promoted: its earlier validation season worsens slightly. Later retrospective improvement cannot override that failed validation gate, and those later seasons were already exposed. No fresh historical holdout exists in the four-season snapshot. No betting ROI is measured.

## Exact scope

Inspected main `261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72`, all analytics modules/tests, source manifests, research snapshots and relevant research docs; PRs #11–16 are open/unmerged. #16 head `46d7de25827fef0618a8287405d3af5611f96f0a` has three successful CI workflows. PR #14 is a proposed new 100 x $10 cohort, not the existing ledger. No existing files, predictions, wagers, PR branches or database rows were edited. The new branch is `research/nba-quant-audit-20261009`.

New files:
- `analytics/nba_quant_audit.py`: independent Elo calculation, explicit season regression, per-game equality checks, calibration and paired uncertainty.
- `analytics/test_nba_quant_audit.py`: six synthetic chronology/math tests.
- `research/nba_quant_20261009/report.json`: machine-readable results, all calibration bins, per-season diagnostics, source hashes and protocol.
- This report.

## Reproduction and source audit

Downloaded all eight assets named by `src/data/research/nba_recent_sources.json`, checked their SHA-256 hashes (8/8 exact), and reran the existing ESPN/NBA Stats mirror reconciliation. Four seasons of 1,230 regular-season games each were admitted (4,920 total). NBA Cup championship and All-Star games are excluded by the existing reconciler. Independent Elo calculation matches all 2,460 stored evaluation probabilities within 1e-12 and every outcome. Summary accuracy, Brier and log loss match within floating-point tolerance.

These are two source families with the SAME mirror publisher, not independent end-to-end archival confirmation. Hashes establish byte identity, not factual truth. The inherited manifest declares CC BY 4.0; exact asset licensing remains a provider-verification task (repository software licensing alone is insufficient). No raw third-party datasets are republished by this change. Current official NBA page inspection supports the existing ATL/BOS spot-check identity; a complete direct-original re-audit was not performed. The inherited Toronto/Brooklyn recap inconsistency remains unresolved. Do not describe the entire dataset as independently verified.

## Chronology and experimental design

The existing model starts every team at 1500, uses K=20, H=65 and forecasts every UTC-day batch before that day's updates. Warmup for its published result is 2022–23 plus 2023–24. Results from earlier evaluation days update ratings; no future outcome is used to form an earlier prediction. This is expanding sequential evaluation, not a static model trained once.

The independent experiment fixes 75% carryover to 1500 once per season: R_new = 1500 + .75*(R_old-1500). K and H stay unchanged. No grid search, recalibration fitting, roster variables or rest coefficients were tried. The candidate choice follows the published idea of NBA offseason Elo regression, not a claim to replicate FiveThirtyEight's full model.

- Initialization/training: 2022–23 (1,230 games).
- Validation: 2023–24 (1,230 games). Candidate fails the directional log-loss/Brier gate; base remains preferred.
- Later diagnostic tests: 2024–25 and 2025–26 (2,460 games). Previously published/exposed, explicitly NOT virgin holdout evidence. Carryover and parameters are not retuned after seeing results.
- Untouched holdout: future 2026–27 regular season. None observed here. Before any activation, freeze a separate prospective shadow protocol, daily result-availability cutoff and neutral-site policy. Review at a prespecified season endpoint rather than repeatedly selecting on interim wins. No new candidate wagers are authorized by this report.

UTC-day grouping is not proof of historical data availability: completed-at/publication/revision times are missing. The minimum same-team scheduled tipoff gap is 21 hours, which reduces ordinary same-team overlap concerns but does not prove final-score receipt times. Reschedules, corrections and vendor latency need explicit future archive timestamps. Team IDs are stable in reconciliation. There are 13 neutral-site regular games across the four seasons; the frozen model applies H=65 to these too. Candidate preserves this behavior to isolate ONE change. Neither model uses playoffs, roster changes or injuries; historical tipoff/rest can support a later separate experiment, but injury snapshots are absent (zero research context records).

## Measured results

Lower Brier and log loss are better. Winner accuracy threshold is p>=.5.

| Sample/model | Correct / games | Accuracy | Log loss | Brier |
|---|---:|---:|---:|---:|
| Published two seasons, frozen Elo | 1,635 / 2,460 | 66.4634% | 0.618327 | 0.214219 |
| Same games, always-home/prior home rate | 1,351 / 2,460 | 54.9187% | 0.688620 | 0.247738 |
| Same games, p=.5 (ties pick home) | 1,351 / 2,460 | 54.9187% | 0.693147 | 0.250000 |
| Same games, carry75 candidate | 1,637 / 2,460 | 66.5447% | 0.612836 | 0.212213 |
| 2023–24 validation, frozen Elo | 798 / 1,230 | 64.8780% | 0.615098 | 0.214248 |
| 2023–24 validation, carry75 | 788 / 1,230 | 64.0650% | 0.615763 | 0.214426 |
| 2024–25 exposed test, frozen Elo | 805 / 1,230 | 65.4472% | 0.621658 | 0.216377 |
| 2024–25 exposed test, carry75 | 803 / 1,230 | 65.2846% | 0.617456 | 0.214719 |
| 2025–26 exposed test, frozen Elo | 830 / 1,230 | 67.4797% | 0.614996 | 0.212061 |
| 2025–26 exposed test, carry75 | 834 / 1,230 | 67.8049% | 0.608215 | 0.209707 |

Frozen accuracy Wilson 95% interval: 64.57–68.30%; candidate: 64.66–68.38%. These descriptive intervals assume independent Bernoulli observations and do not account fully for repeated teams/seasons. Ten equal-width calibration bins give ECE 0.037025 (base) and 0.032670 (candidate); bin estimates and Wilson ranges are in JSON. ECE depends on bins and sample size. The constant home-rate baseline has lower ECE but much worse predictive scoring: calibration alone is not discrimination or trading value.

Paired candidate-minus-base log loss, nonoverlapping calendar-week cluster bootstrap (2,000 draws, fixed seed 20261009):
- Validation: +0.000666; 95% percentile interval [-0.001595, +0.003234].
- Two later seasons: -0.005491; interval [-0.008298, -0.002981].
Games are paired and weeks resampled as clusters. Dependence across weeks/teams remains; only two later seasons exist. Intervals are conditional descriptive uncertainty, not a cure for prior exposure or failed validation. Small accuracy changes do not establish an economic edge.

## Database evidence (read-only inspection)

One frozen NBA version, source revision `3329d0dc07b1d88e9c4cd2761ad81538f43026faaf3fa5366f3d714258beec41`, ratings through 2026-04-13T00:30Z. Three published NBA forecasts, zero late publications, three positions with 2,970 cents total stake and zero settlements. Sports game table has 46 NBA and 20 EPL fixtures, none final. 709 odds rows from `the_odds_api` are timestamped 2026-10-08 22:47:40–22:52:38 UTC, NOT the historical evaluation window. No source-matched historical no-vig comparison or ROI is possible. No provider quota or paid API was consumed.

## Verification / reproduction

83 existing Python tests passed before additions; 89 total passed after additions. An initial direct-module test exposed the older source module's top-level import convention; the NEW audit moved source loading to its CLI path. Existing source files were not modified.

From repository root (Python 3.12 used here):

```sh
python -m unittest discover -s analytics -p 'test_*.py' -q
python analytics/nba_recent_source.py --folder /path/to/assets --manifest src/data/research/nba_recent_sources.json --output /tmp/fresh-original-replay.json
python analytics/nba_quant_audit.py --folder /path/to/assets --output /tmp/fresh-quant-audit.json
```

Download the eight exact manifest URLs into the assets folder; prefix NBA Stats filenames with `official_`. All output files must be new. The audit refuses mismatched input hashes, per-game forecasts or summary values. Unit fixtures are synthetic and are never reported as historical games.

## Routine development handoff

Review this additive branch without merging automatically. Preserve the existing version and cohorts. The next useful milestone is timestamped, immutable pregame/result-availability snapshots and a separately reviewed 2026–27 shadow protocol. Archive neutral-site and actual rest inputs. Do not add injuries without historical as-of reports. Keep historical probability accuracy separate from matched-price forward paper returns. No UI or database changes are needed to review this research.

References inspected: FiveThirtyEight, https://fivethirtyeight.com/features/how-we-calculate-nba-elo-ratings/ (offseason carryover); scikit-learn, https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split (time-ordered evaluation); source URLs/hashes in attached JSON. These references motivate method, not SportsEdge performance.
