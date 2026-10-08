"""Reproducible chronological 1X2 Elo backtest for CC0 OpenFootball results.

No bookmaker odds or ROI are implied. Prediction timestamps are reconstructed from
historical results: predictions were not logged when the real matches took place.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

UPSTREAM_COMMIT = "e6744429ee395bc86f247348c6184bb08d4eb361"
SEASONS = ("2024-25", "2025-26", "2026-27")
LEAGUES = {"en": "Premier League", "de": "Bundesliga", "es": "La Liga", "it": "Serie A", "fr": "Ligue 1"}
START = "2026-04-08"
END = "2026-10-07"
ELO_K = 20.0
HOME_ADVANTAGE = 65.0
OUTCOMES = ("H", "D", "A")


def parse_completed(data: dict, league: str, season: str) -> list[dict]:
    """Accept only matches with a valid full-time score and date."""
    if not isinstance(data, dict) or not isinstance(data.get("matches"), list):
        raise ValueError("Unexpected OpenFootball schema")
    records = []
    seen = set()
    for entry in data["matches"]:
        if not isinstance(entry, dict):
            continue
        score = entry.get("score")
        ft = score if isinstance(score, list) else score.get("ft") if isinstance(score, dict) else None
        if not isinstance(ft, list) or len(ft) != 2 or any(type(n) is not int or n < 0 for n in ft):
            continue
        try:
            game_date = date.fromisoformat(entry["date"]).isoformat()
        except (ValueError, TypeError, KeyError):
            continue
        home, away = entry.get("team1"), entry.get("team2")
        if not isinstance(home, str) or not isinstance(away, str) or not home.strip() or not away.strip() or home == away:
            continue
        key = (game_date, home, away)
        if key in seen:
            raise ValueError(f"Duplicate completed game: {league} {season} {key}")
        seen.add(key)
        records.append({"league": league, "season": season, "date": game_date,
                        "home": home, "away": away, "homeGoals": ft[0], "awayGoals": ft[1]})
    return records


def outcome(match: dict) -> int:
    return 0 if match["homeGoals"] > match["awayGoals"] else 1 if match["homeGoals"] == match["awayGoals"] else 2


def evaluate_league(matches: list[dict], start: str = START, end: str = END) -> tuple[list[dict], dict]:
    """Use only historical results preceding each day, never same-day results."""
    matches = sorted(matches, key=lambda m: (m["date"], m["home"]))
    training = [m for m in matches if m["date"] < start]
    if len(training) < 3:
        raise ValueError("At least three prior completed games required")
    counts = Counter(outcome(m) for m in training)
    baseline = [counts[i] / len(training) for i in range(3)]
    if min(baseline) <= 0:
        raise ValueError("All three outcomes must be represented in training")
    p_draw = baseline[1]
    elo: dict[str, float] = defaultdict(lambda: 1500.0)
    results = []
    index = 0
    while index < len(matches):
        day = matches[index]["date"]
        current = []
        while index < len(matches) and matches[index]["date"] == day:
            current.append(matches[index])
            index += 1
        # Predictions are computed before processing *any* match on this date.
        for match in current:
            h, a = elo[match["home"]], elo[match["away"]]
            q = 1 / (1 + 10 ** (-(h + HOME_ADVANTAGE - a) / 400))
            pred = [(1 - p_draw) * q, p_draw, (1 - p_draw) * (1 - q)]
            actual = outcome(match)
            if start <= day <= end:
                results.append({
                    "date": day, "league": match["league"], "home": match["home"], "away": match["away"],
                    "actual": OUTCOMES[actual], "score": [match["homeGoals"], match["awayGoals"]],
                    "prediction": OUTCOMES[pred.index(max(pred))],
                    "probabilities": [round(x, 8) for x in pred],
                    "correct": pred.index(max(pred)) == actual,
                    "loss": -math.log(pred[actual]),
                    "baseline_loss": -math.log(baseline[actual]),
                    "brier": sum((pred[i] - int(i == actual)) ** 2 for i in range(3)),
                    "baseline_brier": sum((baseline[i] - int(i == actual)) ** 2 for i in range(3)),
                    "baseline_correct": baseline.index(max(baseline)) == actual,
                })
        for match in current:
            h, a = elo[match["home"]], elo[match["away"]]
            expected = 1 / (1 + 10 ** (-(h + HOME_ADVANTAGE - a) / 400))
            actual = 1.0 if match["homeGoals"] > match["awayGoals"] else .5 if match["homeGoals"] == match["awayGoals"] else 0.0
            update = ELO_K * (actual - expected)
            elo[match["home"]], elo[match["away"]] = h + update, a - update
    return results, {"training_matches": len(training), "baseline_probabilities": baseline}


def summarize(rows: list[dict]) -> dict:
    if not rows:
        raise ValueError("Cannot summarize empty evaluation")
    n = len(rows)
    return {
        "games": n,
        "accuracy": sum(m["correct"] for m in rows) / n,
        "baseline_accuracy": sum(m["baseline_correct"] for m in rows) / n,
        "log_loss": sum(m["loss"] for m in rows) / n,
        "baseline_log_loss": sum(m["baseline_loss"] for m in rows) / n,
        "brier": sum(m["brier"] for m in rows) / n,
        "baseline_brier": sum(m["baseline_brier"] for m in rows) / n,
    }


def load_source(season: str, code: str, cache_dir: Path | None = None) -> dict:
    relative = f"{season}/{code}.1.json"
    local = cache_dir / relative if cache_dir else None
    if local and local.exists():
        return json.loads(local.read_text(encoding="utf-8"))
    url = f"https://raw.githubusercontent.com/openfootball/football.json/{UPSTREAM_COMMIT}/{relative}"
    req = Request(url, headers={"User-Agent": "SportsEdge-Research/0.1"})
    with urlopen(req, timeout=20) as response:
        data = json.load(response)
    if local:
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_text(json.dumps(data), encoding="utf-8")
    return data


def run(cache_dir: Path | None = None) -> dict:
    records = []
    for season in SEASONS:
        for code in LEAGUES:
            records.extend(parse_completed(load_source(season, code, cache_dir), code, season))
    rows = []
    by_league = {}
    for code, name in LEAGUES.items():
        league_rows, metadata = evaluate_league([m for m in records if m["league"] == code])
        if not league_rows:
            raise ValueError(f"No evaluation games for {code}")
        rows.extend(league_rows)
        by_league[code] = {"label": name, **summarize(league_rows), **metadata}
    rows.sort(key=lambda m: (m["date"], m["league"], m["home"]))
    return {
        "study": "Retrospective, reconstructed pregame 1X2 Elo predictions",
        "source": "OpenFootball/football.json (CC0-1.0)",
        "sourceCommit": UPSTREAM_COMMIT,
        "periodStart": START, "periodEnd": END,
        "latestCompletedMatch": max(m["date"] for m in rows),
        "eloK": ELO_K, "homeAdvantagePoints": HOME_ADVANTAGE,
        "historicalTrainingGames": sum(m["training_matches"] for m in by_league.values()),
        "overall": summarize(rows), "leagues": by_league,
        "oddsAvailable": False, "roiAvailable": False,
        "limitations": "Source incomplete after September 20, 2026; no archived pregame odds, market comparison, ROI, or real-time archived model forecasts.",
        "games": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, help="Optional local cache of the pinned source files")
    parser.add_argument("--output", type=Path, help="Write the audited result as JSON")
    args = parser.parse_args()
    result = run(args.cache_dir)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "games"}, indent=2))


if __name__ == "__main__":
    main()
