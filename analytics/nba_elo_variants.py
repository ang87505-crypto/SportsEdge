"""Pre-registered NBA Elo variant study (research only; does not change the live model).

Variants are declared before any held-out result is inspected:
  baseline  current production Elo (K=20, home +65, no MOV, no season regression)
  A_mov     margin-of-victory weighted K (FiveThirtyEight-style multiplier)
  B_regress ratings pulled 25% toward 1505 at each new season
  C_rest    back-to-back penalty in Elo points, fitted on the development season only
  D_neutral no home advantage at neutral-site games
  E_all     A + B + C + D

Split: the first season warms ratings up, the second is development (variant choice and
the rest penalty fit), the remaining seasons are the held-out test. As in the existing study,
all forecasts for a UTC day are made before any result from that day updates the ratings.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
import math
import random
from typing import Any, Iterable, Sequence


@dataclass(frozen=True)
class Game:
    game_id: str
    day: date
    season: int
    home: str
    away: str
    home_score: int
    away_score: int
    neutral: bool

    @property
    def home_won(self) -> bool:
        return self.home_score > self.away_score


@dataclass(frozen=True)
class Variant:
    name: str
    k: float = 20.0
    home_advantage: float = 65.0
    mov: bool = False
    season_regression: float = 0.0
    rest_penalty: float = 0.0
    neutral_fix: bool = False
    initial: float = 1500.0
    regression_mean: float = 1505.0
    floor: float = 1e-6

    def __post_init__(self) -> None:
        for label, value, lo, hi in [("k", self.k, 0.0, 100.0), ("home_advantage", self.home_advantage, -400.0, 400.0),
                                     ("season_regression", self.season_regression, 0.0, 1.0), ("rest_penalty", self.rest_penalty, -200.0, 200.0)]:
            if not (math.isfinite(value) and lo <= value <= hi):
                raise ValueError(f"{label} out of range")


def probability(diff: float, floor: float = 1e-6) -> float:
    """Home win probability from an Elo difference that already includes home advantage."""
    p = 1.0 / (1.0 + 10.0 ** (-max(-50.0, min(50.0, diff / 400.0))))
    return min(1.0 - floor, max(floor, p))


def mov_multiplier(margin: int, winner_elo_diff: float) -> float:
    """FiveThirtyEight NBA multiplier: grows with margin, shrinks when a favourite was expected to win."""
    if margin <= 0:
        raise ValueError("Margin must be positive for a decided game")
    return ((margin + 3.0) ** 0.8) / (7.5 + 0.006 * winner_elo_diff)


def back_to_back(games: Sequence[Game]) -> dict[str, tuple[bool, bool]]:
    """For each game id: (home played the previous day, away played the previous day). Same-season only."""
    last: dict[tuple[int, str], date] = {}
    flags: dict[str, tuple[bool, bool]] = {}
    for g in sorted(games, key=lambda x: (x.day, x.game_id)):
        def b2b(team: str) -> bool:
            prev = last.get((g.season, team))
            return prev is not None and (g.day - prev).days == 1
        flags[g.game_id] = (b2b(g.home), b2b(g.away))
        last[(g.season, g.home)] = g.day
        last[(g.season, g.away)] = g.day
    return flags


def walk_forward(games: Iterable[Game], variant: Variant) -> list[dict[str, Any]]:
    """Return one pregame forecast per game, in date order, using only earlier days' results."""
    items = sorted(games, key=lambda g: (g.day, g.game_id))
    if len({g.game_id for g in items}) != len(items):
        raise ValueError("Duplicate game id")
    rest = back_to_back(items) if variant.rest_penalty else {}
    rating: dict[str, float] = {}
    season: int | None = None
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(items):
        day = items[i].day
        batch = []
        while i < len(items) and items[i].day == day:
            batch.append(items[i]); i += 1
        if season is not None and batch[0].season != season and variant.season_regression:
            for team in rating:
                rating[team] = rating[team] * (1 - variant.season_regression) + variant.regression_mean * variant.season_regression
        season = batch[0].season
        diffs = []
        for g in batch:
            hfa = 0.0 if (variant.neutral_fix and g.neutral) else variant.home_advantage
            adj = 0.0
            if variant.rest_penalty:
                hb, ab = rest[g.game_id]
                adj = -variant.rest_penalty * hb + variant.rest_penalty * ab
            diff = rating.get(g.home, variant.initial) + hfa + adj - rating.get(g.away, variant.initial)
            diffs.append(diff)
            out.append({"game_id": g.game_id, "day": g.day.isoformat(), "season": g.season, "p": probability(diff, variant.floor), "home_won": g.home_won})
        # Ratings move only after every forecast for the day exists.
        for g, diff in zip(batch, diffs):
            p = probability(diff, variant.floor)
            k = variant.k
            if variant.mov:
                margin = abs(g.home_score - g.away_score)
                winner_diff = diff if g.home_won else -diff
                k *= mov_multiplier(margin, winner_diff)
            delta = k * (float(g.home_won) - p)
            rating[g.home] = rating.get(g.home, variant.initial) + delta
            rating[g.away] = rating.get(g.away, variant.initial) - delta
    return out


def score(rows: Sequence[dict[str, Any]]) -> dict[str, float]:
    if not rows:
        raise ValueError("No forecasts to score")
    n = len(rows)
    brier = sum((r["p"] - float(r["home_won"])) ** 2 for r in rows) / n
    log_loss = -sum(math.log(r["p"] if r["home_won"] else 1 - r["p"]) for r in rows) / n
    accuracy = sum((r["p"] >= 0.5) == r["home_won"] for r in rows) / n
    bins = [0] * 10, [0.0] * 10, [0.0] * 10
    for r in rows:
        b = min(9, int(r["p"] * 10))
        bins[0][b] += 1; bins[1][b] += r["p"]; bins[2][b] += float(r["home_won"])
    ece = sum(abs(bins[1][b] - bins[2][b]) for b in range(10)) / n
    return {"games": n, "brier": brier, "log_loss": log_loss, "accuracy": accuracy, "ece": ece}


def fit_rest_penalty(games: Sequence[Game], base: Variant, dev_seasons: set[int], grid: Iterable[float] = range(0, 81, 2)) -> float:
    """Choose the back-to-back penalty that minimises development-season log loss. Test seasons are never read."""
    allowed = [g for g in games if g.season <= max(dev_seasons)]
    best, best_loss = 0.0, math.inf
    for x in grid:
        rows = [r for r in walk_forward(allowed, replace(base, rest_penalty=float(x))) if r["season"] in dev_seasons]
        loss = score(rows)["log_loss"]
        if loss < best_loss - 1e-12:
            best, best_loss = float(x), loss
    return best


def paired_day_bootstrap(a: Sequence[dict[str, Any]], b: Sequence[dict[str, Any]], *, samples: int = 4000, seed: int = 20261020) -> dict[str, float]:
    """95% interval for mean Brier(b) − Brier(a), resampling whole game days (games on a day share information)."""
    if [r["game_id"] for r in a] != [r["game_id"] for r in b]:
        raise ValueError("Forecast sets must cover the same games in the same order")
    by_day: dict[str, list[float]] = {}
    for ra, rb in zip(a, b):
        d = (rb["p"] - float(rb["home_won"])) ** 2 - (ra["p"] - float(ra["home_won"])) ** 2
        by_day.setdefault(ra["day"], []).append(d)
    days = list(by_day.values())
    rng = random.Random(seed)
    stats = []
    for _ in range(samples):
        pick = [days[rng.randrange(len(days))] for _ in days]
        total = sum(sum(x) for x in pick); count = sum(len(x) for x in pick)
        stats.append(total / count)
    stats.sort()
    mean = sum(sum(x) for x in days) / sum(len(x) for x in days)
    return {"mean_difference": mean, "lower_95": stats[int(0.025 * samples)], "upper_95": stats[int(0.975 * samples) - 1], "days": len(days), "samples": samples}


VARIANTS = {
    "baseline": Variant("baseline"),
    "A_mov": Variant("A_mov", mov=True),
    "B_regress": Variant("B_regress", season_regression=0.25),
    "C_rest": Variant("C_rest"),  # penalty fitted on development data before use
    "D_neutral": Variant("D_neutral", neutral_fix=True),
    "E_all": Variant("E_all", mov=True, season_regression=0.25, neutral_fix=True),  # plus fitted rest penalty
}
