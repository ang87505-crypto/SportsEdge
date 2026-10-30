"""Run the pre-registered NBA Elo variant study on the pinned SportsDataverse sources.

Usage: python nba_elo_variant_study.py --folder <downloaded sources> --manifest <nba_recent_sources.json> --output <report.json>

Seasons (by end year): 2023 warm-up, 2024 development, 2025 + 2026 held-out test.
Decision rule, fixed before the run: the candidate with the lowest development Brier score is the
winner; it is recommended only if its held-out Brier improvement has a 95% day-bootstrap interval
entirely below zero. Otherwise the production model stays as it is.
"""
from __future__ import annotations

import argparse
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path

from nba_recent_source import load_sources
from nba_elo_variants import VARIANTS, Game, fit_rest_penalty, paired_day_bootstrap, score, walk_forward

WARMUP, DEV, TEST = 2023, 2024, (2025, 2026)
PUBLISHED_ACCURACY = 0.6646341463414634  # src/data/research/nba_recent_summary.json


def to_games(payload: dict) -> list[Game]:
    out = []
    for g in payload["games"]:
        # Same UTC-day grouping as the production walk-forward (NBAGame.utc_day).
        day = datetime.fromisoformat(g["starts_at"].replace("Z", "+00:00")).astimezone(timezone.utc).date()
        out.append(Game(g["game_id"], day, int(g["season"]), g["home_team_id"], g["away_team_id"], g["home_score"], g["away_score"], bool(g["neutral_site"])))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--folder", type=Path, required=True)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    payload, _ = load_sources(args.folder, json.loads(args.manifest.read_text()))
    games = to_games(payload)

    variants = dict(VARIANTS)
    variants["C_rest"] = replace(variants["C_rest"], rest_penalty=fit_rest_penalty(games, variants["baseline"], {DEV}))
    variants["E_all"] = replace(variants["E_all"], rest_penalty=fit_rest_penalty(games, variants["E_all"], {DEV}))

    forecasts = {name: walk_forward(games, v) for name, v in variants.items()}
    split = lambda rows, seasons: [r for r in rows if r["season"] in seasons]
    results = {name: {"settings": {k: getattr(v, k) for k in ("k", "home_advantage", "mov", "season_regression", "rest_penalty", "neutral_fix")},
                      "development": score(split(forecasts[name], {DEV})),
                      "test": score(split(forecasts[name], set(TEST))),
                      "test_by_season": {str(s): score(split(forecasts[name], {s})) for s in TEST}}
               for name, v in variants.items()}

    base_test = results["baseline"]["test"]
    if abs(base_test["accuracy"] - PUBLISHED_ACCURACY) > 1e-12:
        raise SystemExit(f"Baseline does not reproduce the published study: {base_test['accuracy']}")

    candidates = [n for n in variants if n != "baseline"]
    winner = min(candidates, key=lambda n: results[n]["development"]["brier"])
    beats_dev = results[winner]["development"]["brier"] < results["baseline"]["development"]["brier"]
    interval = paired_day_bootstrap(split(forecasts["baseline"], set(TEST)), split(forecasts[winner], set(TEST)))
    recommend = beats_dev and interval["upper_95"] < 0
    for n in candidates:
        results[n]["test_brier_vs_baseline"] = paired_day_bootstrap(split(forecasts["baseline"], set(TEST)), split(forecasts[n], set(TEST)), samples=2000)

    # How much does the live pipeline's frozen snapshot cost, and how often must it be refreshed?
    from nba_snapshot import SHADOW, refreshed_forecasts
    cadence = {}
    for label, every in (("daily", 1), ("weekly", 7), ("monthly", 30), ("frozen_at_season_start", None)):
        prod_rows = [r for s in TEST for r in refreshed_forecasts(games, variants["baseline"], s, every)]
        shadow_rows = [r for s in TEST for r in refreshed_forecasts(games, SHADOW, s, every)]
        cadence[label] = {"production": score(prod_rows), "shadow_v2_snapshot": score(shadow_rows),
                          "shadow_minus_production_brier": paired_day_bootstrap(prod_rows, shadow_rows, samples=2000)}

    report = {
        "study": "Pre-registered NBA Elo variant comparison",
        "status": "research only; production model unchanged",
        "source_revision": payload["source_revision"],
        "seasons": {"warmup": WARMUP, "development": DEV, "test": list(TEST)},
        "games": {"total": len(games), "development": results["baseline"]["development"]["games"], "test": base_test["games"]},
        "baseline_reproduces_published_accuracy": True,
        "decision_rule": "Lowest development Brier wins; recommend only if the held-out Brier difference has a 95% game-day bootstrap interval entirely below zero.",
        "winner_on_development": winner,
        "winner_test_brier_vs_baseline": interval,
        "recommendation": f"Adopt {winner} for a forward shadow test" if recommend else "Keep the production model; no variant cleared the pre-registered bar",
        "limitations": [
            "The 2024-25 and 2025-26 seasons were already used to report the production model, so the test window is not untouched.",
            "Accuracy and Brier score measure forecasts, not betting profit; no historical prices are used.",
            "Variants use published FiveThirtyEight-style defaults, not values tuned to these seasons; only the rest penalty is fitted, on 2023-24 alone.",
        ],
        "variants": results,
        "refresh_cadence": cadence,
        "refresh_cadence_note": "Live forecasts come from research_publish, which prices games from a stored rating snapshot. 'frozen_at_season_start' is the current production behaviour; shadow_v2_snapshot is margin-of-victory updates plus 25% season regression, which research_publish can serve unchanged.",
    }
    with args.output.open("x") as f:
        json.dump(report, f, indent=2, allow_nan=False)
    print(json.dumps({k: report[k] for k in ("games", "winner_on_development", "winner_test_brier_vs_baseline", "recommendation")}, indent=2))
    for label, c in cadence.items():
        print(f"cadence {label:24s} production brier {c['production']['brier']:.4f} acc {c['production']['accuracy']:.3f} | shadow brier {c['shadow_v2_snapshot']['brier']:.4f} acc {c['shadow_v2_snapshot']['accuracy']:.3f}")
    for n, r in results.items():
        print(f"{n:10s} dev brier {r['development']['brier']:.5f}  test brier {r['test']['brier']:.5f}  acc {r['test']['accuracy']:.4f}  logloss {r['test']['log_loss']:.4f}  ece {r['test']['ece']:.4f}  rest {r['settings']['rest_penalty']}")


if __name__ == "__main__":
    main()
