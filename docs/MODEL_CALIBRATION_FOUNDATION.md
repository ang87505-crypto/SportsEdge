# SportsEdge probability calibration diagnostics — foundation

Status 2026-10-08: standalone **descriptive** statistical checks, validated with synthetic fixtures only. No connection to Supabase, no source game results, no forward predictions, no sportsbook prices, and no claim of a profitable model. This module makes no database mutations or HTTP requests.

## Files

- analytics/calibration_diagnostics.py: reusable NBA/binary forecast diagnostics; no dependencies beyond Python standard library.
- analytics/test_calibration_diagnostics.py: 14 synthetic deterministic tests covering bin edges, Brier, log loss, Wilson uncertainty, malformed inputs, duplicate IDs, and order invariance.
- Existing scoring and soccer multi-class evaluation remain unchanged. The binary calibration module does **not** evaluate three-way soccer win/draw/loss probabilities.

## Inputs and safeguards

Input iterable contains exactly one ScoredProbability(game_id: str, probability: float, outcome: int) per game. Predicted probability is the probability of the **chosen binary event** (for the NBA walk-forward baseline, "home team wins"); outcome is 1 if that event happened, otherwise 0.

Reject duplicate or blank game IDs, invalid probabilities outside [0,1], NaN/Infinity, bool probabilities, non-binary outcomes, and empty samples. Never interpret game IDs or declared provenance as externally verified. The caller must independently ensure the game has a reliable final score, the prediction was published *before* game start for forward performance claims, and matches the intended season/competition.

## Metrics and interpretation

- **Brier score:** mean squared error of forecast probability vs 0/1 outcome. Lower is better.
- **Binary logarithmic loss:** cross entropy of the observed class, with numerical clipping at 1e-12 to avoid log(0). Lower is better. The clip is reported in the output.
- **Classification accuracy:** threshold 0.5 predicts the binary event (ties at exactly 0.5 predict yes); compare this with time-appropriate baselines instead of judging alone.
- **Calibration bins:** 10 equally wide intervals by default, lower-inclusive/upper-exclusive except the final inclusive bin. Count, mean forecast probability, observed event frequency, and absolute gap for each populated bin. Empty bins return null statistics rather than fabricated frequencies.
- **Expected calibration error (ECE):** sum of absolute bin gaps weighted by the bin's sample fraction. **Maximum calibration error (MCE):** largest populated-bin gap. These are strongly sensitive to bin definitions and sample size.
- **Wilson score 95% intervals:** illustrative approximate frequentist intervals for observed event frequencies and overall accuracy, **assuming independent binomial trials**. Correlated opponents/teams, within-season dependence and selection bias can make them too narrow. They are not confidence intervals for betting ROI.
- The report always explicitly marks sportsbook odds, ROI and independent source verification as **unavailable**. Small samples (<100) and bins with <20 observations receive warnings; these thresholds are editorial warnings, not proof that larger samples are adequate.

Example with locally supplied verified rows (no sample games or invented outcomes bundled):

~~~python
from calibration_diagnostics import ScoredProbability, diagnose_binary

# Provide unique, independently scored and documented records:
rows = [ScoredProbability(game_id, predicted_home_win_probability, home_won_binary)
        for game_id, predicted_home_win_probability, home_won_binary in source_records]
report = diagnose_binary(rows, bins=10)
~~~

Use 'python -m unittest discover -s analytics -p "test_*.py" -v' to run the tests. Do not add this report to the public dashboard until NBA scores are source-audited and a predetermined held-out period is evaluated. For EPL or other three-way soccer outcomes, add a separate multiclass reliability method with an independent test suite.

## Primary references

- scikit-learn calibration discussion: https://scikit-learn.org/stable/modules/calibration.html
- scikit-learn proper scoring rules and log loss: https://scikit-learn.org/stable/modules/model_evaluation.html
- Python NormalDist and quantiles: https://docs.python.org/3/library/statistics.html#statistics.NormalDist
