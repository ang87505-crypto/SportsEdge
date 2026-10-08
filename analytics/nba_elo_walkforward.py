"""NBA-only, deterministic retrospective Elo walk-forward evaluation.

This is a model candidate, NOT a trained/validated trading strategy. Scores must
be supplied by a separately audited source; no historical results are bundled.
All same-UTC-day predictions are made before any scores from that day are used.
This prevents same-day hindsight without inventing game-finalization times.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class NBAGame:
    game_id: str
    starts_at: datetime
    home_team_id: str
    away_team_id: str
    home_score: int
    away_score: int

    @property
    def utc_day(self) -> date:
        return self.starts_at.astimezone(timezone.utc).date()

    @property
    def home_won(self) -> bool:
        return self.home_score > self.away_score


@dataclass(frozen=True)
class EloSettings:
    initial_rating: float = 1500.0
    k_factor: float = 20.0
    home_advantage: float = 65.0
    min_training_games: int = 30
    probability_floor: float = 1e-6

    def __post_init__(self) -> None:
        if not (math.isfinite(self.initial_rating) and self.initial_rating > 0):
            raise ValueError("Initial rating must be finite and positive")
        if not (math.isfinite(self.k_factor) and 0 < self.k_factor <= 100):
            raise ValueError("Elo K-factor must be finite in (0, 100]")
        if not (math.isfinite(self.home_advantage) and -400 <= self.home_advantage <= 400):
            raise ValueError("Home advantage must be finite within +/-400 Elo points")
        if type(self.min_training_games) is not int or self.min_training_games < 1:
            raise ValueError("min_training_games must be a positive integer")
        if not (math.isfinite(self.probability_floor) and 0 < self.probability_floor < 0.5):
            raise ValueError("Probability floor must be finite in (0, 0.5)")


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not 0 < len(value.strip()) <= 160 or value != value.strip():
        raise ValueError(f"{label} must be a nonblank, trimmed string (1-160 characters)")
    return value


def _tipoff(value: Any) -> datetime:
    if not isinstance(value, str) or "T" not in value:
        raise ValueError("starts_at must be a timezone-aware ISO 8601 timestamp")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Invalid starts_at timestamp") from exc
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("starts_at must include a timezone")
    return dt.astimezone(timezone.utc)


def parse_completed_nba(payload: Any) -> tuple[list[NBAGame], dict[str, str]]:
    """Fail closed on malformed/unproven NBA scores, rather than skipping rows.

    Provenance strings are recorded for an external audit, not verified here.
    A verified source and immutable revision must be independently established.
    """
    if not isinstance(payload, dict) or payload.get("competition") != "nba":
        raise ValueError("Dataset must declare competition='nba'")
    source = _identifier(payload.get("source"), "source")
    revision = _identifier(payload.get("source_revision"), "source_revision")
    raw = payload.get("games")
    if not isinstance(raw, list) or not raw:
        raise ValueError("Dataset requires nonempty games array")
    games: list[NBAGame] = []
    seen_ids: set[str] = set()
    seen_fixtures: set[tuple[datetime, str, str]] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict) or item.get("status") != "final" or item.get("season_type") != "regular":
            raise ValueError(f"NBA game #{index} must be a final regular-season game")
        game_id = _identifier(item.get("game_id"), "game_id")
        home = _identifier(item.get("home_team_id"), "home_team_id")
        away = _identifier(item.get("away_team_id"), "away_team_id")
        starts = _tipoff(item.get("starts_at"))
        hscore, ascore = item.get("home_score"), item.get("away_score")
        if home == away or type(hscore) is not int or type(ascore) is not int or min(hscore, ascore) < 0:
            raise ValueError(f"Invalid team identity or full-time scores for {game_id}")
        if hscore == ascore:
            raise ValueError(f"Final NBA game {game_id} cannot finish tied")
        fixture = (starts, home, away)
        if game_id in seen_ids or fixture in seen_fixtures:
            raise ValueError(f"Duplicate NBA event or fixture: {game_id}")
        seen_ids.add(game_id)
        seen_fixtures.add(fixture)
        games.append(NBAGame(game_id, starts, home, away, hscore, ascore))
    games.sort(key=lambda game: (game.utc_day, game.starts_at, game.game_id))
    return games, {"source": source, "source_revision": revision}


def _home_probability(home_rating: float, away_rating: float, config: EloSettings) -> float:
    # Difference is clipped only for overflow protection; final probabilities
    # are clipped explicitly to avoid log(0) in probabilistic scoring.
    scaled_difference = max(-50.0, min(50.0, (home_rating + config.home_advantage - away_rating) / 400.0))
    p = 1.0 / (1.0 + 10.0 ** (-scaled_difference))
    return min(1.0 - config.probability_floor, max(config.probability_floor, p))


def _log_loss(p: float, home_won: bool) -> float:
    return -math.log(p if home_won else 1.0 - p)


def run_nba_walkforward(
    games: Iterable[NBAGame], *, start: date, end: date,
    config: EloSettings = EloSettings(),
) -> dict[str, Any]:
    """Fixed pre-period baseline, then strict UTC-day-grouped walk-forward Elo.

    Inputs are historical completed results. This reconstructs hypothetical
    pregame predictions, not originally logged and timestamped predictions.
    """
    if not isinstance(start, date) or isinstance(start, datetime) or not isinstance(end, date) or isinstance(end, datetime) or start > end:
        raise ValueError("start/end must be ordered dates")
    items = list(games)
    if not items:
        raise ValueError("No completed NBA games supplied")
    checked: set[str] = set()
    fixtures: set[tuple[datetime, str, str]] = set()
    for g in items:
        if not isinstance(g, NBAGame):
            raise ValueError("Expected NBAGame records")
        _identifier(g.game_id, "game_id")
        _identifier(g.home_team_id, "home_team_id")
        _identifier(g.away_team_id, "away_team_id")
        if not isinstance(g.starts_at, datetime) or g.starts_at.tzinfo is None or g.starts_at.utcoffset() is None:
            raise ValueError("Game timestamp must be timezone-aware")
        if g.home_team_id == g.away_team_id or type(g.home_score) is not int or type(g.away_score) is not int or min(g.home_score, g.away_score) < 0 or g.home_score == g.away_score:
            raise ValueError("Invalid completed NBA game")
        fixture = (g.starts_at.astimezone(timezone.utc), g.home_team_id, g.away_team_id)
        if g.game_id in checked or fixture in fixtures:
            raise ValueError("Duplicate completed NBA game")
        checked.add(g.game_id)
        fixtures.add(fixture)
    items.sort(key=lambda g: (g.utc_day, g.starts_at, g.game_id))
    training = [g for g in items if g.utc_day < start]
    if len(training) < config.min_training_games:
        raise ValueError("Insufficient prior regular-season games for the configured training minimum")
    test = [g for g in items if start <= g.utc_day <= end]
    if not test:
        raise ValueError("No held-out NBA games in the requested period")

    # Fixed across the evaluation window: no baseline statistics from test data.
    historical_home_wins = sum(g.home_won for g in training)
    baseline_p = (historical_home_wins + 1.0) / (len(training) + 2.0)  # Laplace smoothing
    baseline_p = min(1 - config.probability_floor, max(config.probability_floor, baseline_p))
    rating: dict[str, float] = {}
    predictions: list[dict[str, Any]] = []

    index = 0
    while index < len(items):
        day = items[index].utc_day
        group: list[NBAGame] = []
        while index < len(items) and items[index].utc_day == day:
            group.append(items[index])
            index += 1
        # All forecasts for a calendar day precede that day's Elo updates.
        daily_forecasts = [
            _home_probability(rating.get(g.home_team_id, config.initial_rating),
                              rating.get(g.away_team_id, config.initial_rating), config)
            for g in group
        ]
        if start <= day <= end:
            for g, p in zip(group, daily_forecasts):
                actual = g.home_won
                predictions.append({
                    "game_id": g.game_id,
                    "starts_at": g.starts_at.isoformat(),
                    "home_team_id": g.home_team_id,
                    "away_team_id": g.away_team_id,
                    "home_win_probability": p,
                    "baseline_home_win_probability": baseline_p,
                    "home_won": actual,
                    "correct": (p >= 0.5) == actual,
                    "baseline_correct": (baseline_p >= 0.5) == actual,
                    "log_loss": _log_loss(p, actual),
                    "baseline_log_loss": _log_loss(baseline_p, actual),
                    "brier": (p - float(actual)) ** 2,
                    "baseline_brier": (baseline_p - float(actual)) ** 2,
                })
        for g, expected in zip(group, daily_forecasts):
            home = rating.get(g.home_team_id, config.initial_rating)
            away = rating.get(g.away_team_id, config.initial_rating)
            delta = config.k_factor * (float(g.home_won) - expected)
            rating[g.home_team_id] = home + delta
            rating[g.away_team_id] = away - delta

    n = len(predictions)
    return {
        "study": "Reconstructed retrospective NBA regular-season Elo baseline (not archived pregame predictions)",
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "settings": {
            "k_factor": config.k_factor,
            "home_advantage": config.home_advantage,
            "initial_rating": config.initial_rating,
            "probability_floor": config.probability_floor,
            "min_training_games": config.min_training_games,
        },
        "training_games": len(training),
        "evaluation_games": n,
        "baseline_home_win_probability": baseline_p,
        "accuracy": sum(g["correct"] for g in predictions) / n,
        "baseline_accuracy": sum(g["baseline_correct"] for g in predictions) / n,
        "log_loss": sum(g["log_loss"] for g in predictions) / n,
        "baseline_log_loss": sum(g["baseline_log_loss"] for g in predictions) / n,
        "brier": sum(g["brier"] for g in predictions) / n,
        "baseline_brier": sum(g["baseline_brier"] for g in predictions) / n,
        "odds_available": False,
        "roi_available": False,
        "result_source_independently_verified": False,
        "predictions": predictions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="User-provided completed NBA regular-season results JSON")
    parser.add_argument("--start", required=True, type=date.fromisoformat, help="First UTC evaluation date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, type=date.fromisoformat, help="Last UTC evaluation date (YYYY-MM-DD)")
    parser.add_argument("--output", type=Path, help="Optional output JSON path (must not already exist)")
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    records, provenance = parse_completed_nba(payload)
    results = run_nba_walkforward(records, start=args.start, end=args.end)
    results["declared_provenance"] = provenance
    if args.output is not None:
        # Never silently replace an older reproducibility artifact.
        with args.output.open("x", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2, allow_nan=False)
            fh.write("\n")
    summary = {k: v for k, v in results.items() if k != "predictions"}
    print(json.dumps(summary, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
