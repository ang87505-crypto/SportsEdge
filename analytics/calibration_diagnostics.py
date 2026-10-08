"""Deterministic binary probability diagnostics, independent of any odds feed.

A calibration curve is DESCRIPTIVE, not proof of future predictive skill or ROI.
Input games/provenance must be verified by a separate source audit.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from statistics import NormalDist
from typing import Any, Iterable


@dataclass(frozen=True)
class ScoredProbability:
    game_id: str
    probability: float
    outcome: int  # 1 if the selected binary outcome occurred, else 0.


def wilson_interval(successes: int, trials: int, confidence: float = 0.95) -> tuple[float, float]:
    """Approximate binomial Wilson score interval for a descriptive frequency.

    Assumes independent, identically distributed binary observations; sports
    observations often violate that assumption. Do not call it an ROI interval.
    """
    if type(successes) is not int or type(trials) is not int or trials < 1 or successes < 0 or successes > trials:
        raise ValueError("Wilson interval needs integer successes in [0, trials] with trials >= 1")
    if type(confidence) is not float or not math.isfinite(confidence) or not 0 < confidence < 1:
        raise ValueError("confidence must be a finite float strictly between 0 and 1")
    z = NormalDist().inv_cdf((1.0 + confidence) / 2)
    n = float(trials)
    p = successes / n
    denom = 1.0 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = z / denom * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    # Correct machine-roundoff at the exact 0/1 extremes.
    lower = 0.0 if successes == 0 else max(0.0, center - margin)
    upper = 1.0 if successes == trials else min(1.0, center + margin)
    return lower, upper


def diagnose_binary(rows: Iterable[ScoredProbability], *, bins: int = 10) -> dict[str, Any]:
    """Compute sample-weighted calibration error and binary scoring metrics.

    Unweighted: exactly one validated prediction per unique game ID. This
    function neither verifies source results nor assumes predictions were
    logged before kickoff, so it cannot establish forward performance.
    """
    if type(bins) is not int or not 2 <= bins <= 50:
        raise ValueError("bins must be an integer from 2 to 50")
    games = list(rows)
    if not games:
        raise ValueError("At least one completed binary forecast is required")
    seen = set()
    buckets: list[list[ScoredProbability]] = [[] for _ in range(bins)]
    brier_sum = 0.0
    logloss_sum = 0.0
    correct = 0
    for item in games:
        if not isinstance(item, ScoredProbability):
            raise ValueError("Expected ScoredProbability records")
        if not isinstance(item.game_id, str) or not item.game_id.strip() or item.game_id in seen:
            raise ValueError("game_id must be unique and nonblank")
        seen.add(item.game_id)
        p, outcome = item.probability, item.outcome
        if type(p) not in (int, float) or not math.isfinite(p) or not 0.0 <= p <= 1.0:
            raise ValueError("Probability must be finite and within [0, 1]")
        if type(outcome) is not int or outcome not in (0, 1):
            raise ValueError("Outcome must be exactly binary integer 0 or 1")
        # Accept boundary probabilities for calibration; use a declared fixed
        # numerical floor only for logloss, avoiding -log(0).
        clipped = min(1.0 - 1e-12, max(1e-12, p))
        brier_sum += (p - outcome) ** 2
        logloss_sum += -(outcome * math.log(clipped) + (1 - outcome) * math.log1p(-clipped))
        correct += int((p >= 0.5) == bool(outcome))
        buckets[min(int(p * bins), bins - 1)].append(item)
    n = len(games)
    data: list[dict[str, Any]] = []
    ece = 0.0
    mce = 0.0
    nonempty = 0
    for index, bucket in enumerate(buckets):
        count = len(bucket)
        report: dict[str, Any] = {
            "lower_bound": index / bins,
            "upper_bound": (index + 1) / bins,
            "upper_bound_inclusive": index == bins - 1,
            "sample_size": count,
            "mean_probability": None,
            "observed_frequency": None,
            "absolute_gap": None,
            "observed_frequency_wilson_95": None,
        }
        if count:
            nonempty += 1
            mean_p = sum(x.probability for x in bucket) / count
            successes = sum(x.outcome for x in bucket)
            observed = successes / count
            gap = abs(mean_p - observed)
            ece += (count / n) * gap
            mce = max(mce, gap)
            report.update({
                "mean_probability": mean_p,
                "observed_frequency": observed,
                "absolute_gap": gap,
                "observed_frequency_wilson_95": list(wilson_interval(successes, count)),
            })
        data.append(report)
    warnings = [
        "Descriptive retrospective metrics: no verified source, forward timing, sportsbook odds, or ROI established.",
        "Wilson intervals assume independent Bernoulli trials; repeated team/season games may be correlated.",
    ]
    if n < 100:
        warnings.append("Small sample (<100): do not interpret calibration bins as evidence of predictive skill.")
    if any(0 < len(bucket) < 20 for bucket in buckets):
        warnings.append("Some populated calibration bins have fewer than 20 games; bin rates are unstable.")
    return {
        "sample_size": n,
        "bins_requested": bins,
        "bins_populated": nonempty,
        "classification_threshold": 0.5,
        "classification_accuracy": correct / n,
        "classification_accuracy_wilson_95": list(wilson_interval(correct, n)),
        "brier_score": brier_sum / n,
        "log_loss": logloss_sum / n,
        "log_loss_probability_clip": 1e-12,
        "expected_calibration_error": ece,
        "max_calibration_error": mce,
        "calibration_bins": data,
        "odds_available": False,
        "roi_available": False,
        "source_independently_verified": False,
        "warnings": warnings,
    }
