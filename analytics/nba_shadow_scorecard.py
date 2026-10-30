"""Score the NBA forward shadow test: production forecasts vs. shadow v2 forecasts on the same games.

Input is a JSON export of `research_forecasts` and `research_results` rows:
  {"forecasts": [{"game_id", "model_version", "home_probability", "published_at", "starts_at"}, ...],
   "results":   [{"game_id", "status", "home_score", "away_score"}, ...]}

Pre-registered decision rule (fixed before the 2026-27 season):
  * Fewer than 300 paired, final games: keep collecting; no conclusion.
  * Otherwise adopt the shadow model only if the paired game-day bootstrap 95% interval for
    Brier(shadow) - Brier(production) lies entirely below zero; else keep production.
Only forecasts published before tip-off count, and each game uses one forecast per model:
the latest one published before tip-off.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from typing import Any

from nba_elo_variants import paired_day_bootstrap, score

PRODUCTION = "nba-elo-k20-h65-2026-04-v1"
SHADOW_PREFIX = "nba-elo-v2-"
MIN_GAMES = 300


def _ts(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Timestamp must be a string")
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Timestamp must include a timezone")
    return dt.astimezone(timezone.utc)


def pick(forecasts: list[dict[str, Any]], is_model) -> dict[str, dict[str, Any]]:
    """Latest pregame forecast per game for one model family."""
    chosen: dict[str, dict[str, Any]] = {}
    for f in forecasts:
        if not is_model(f["model_version"]):
            continue
        p = float(f["home_probability"])
        if not (0 < p < 1) or not math.isfinite(p):
            raise ValueError(f"Invalid probability for game {f['game_id']}")
        published, starts = _ts(f["published_at"]), _ts(f["starts_at"])
        if published >= starts:
            continue  # not a pregame forecast
        gid = str(f["game_id"])
        prev = chosen.get(gid)
        if prev is None or published > prev["_published"]:
            chosen[gid] = {**f, "_published": published, "_starts": starts, "_p": p}
    return chosen


def scorecard(export: dict[str, Any], *, samples: int = 4000) -> dict[str, Any]:
    forecasts, results = export.get("forecasts"), export.get("results")
    if not isinstance(forecasts, list) or not isinstance(results, list):
        raise ValueError("Export needs forecasts and results arrays")
    finals: dict[str, bool] = {}
    for r in results:
        if r.get("status") != "final":
            continue
        hs, as_ = r.get("home_score"), r.get("away_score")
        if type(hs) is not int or type(as_) is not int or hs == as_:
            raise ValueError(f"Invalid final score for game {r.get('game_id')}")
        finals[str(r["game_id"])] = hs > as_
    prod = pick(forecasts, lambda v: v == PRODUCTION)
    shadow = pick(forecasts, lambda v: isinstance(v, str) and v.startswith(SHADOW_PREFIX))
    games = sorted(set(prod) & set(shadow) & set(finals), key=lambda g: (prod[g]["_starts"], g))
    rows = lambda src: [{"game_id": g, "day": src[g]["_starts"].date().isoformat(), "p": src[g]["_p"], "home_won": finals[g]} for g in games]
    out: dict[str, Any] = {"paired_final_games": len(games), "minimum_games": MIN_GAMES,
                           "production_version": PRODUCTION, "shadow_versions": sorted({shadow[g]["model_version"] for g in games})}
    if not games:
        out.update(verdict="collecting", message="No paired final games yet.")
        return out
    a, b = rows(prod), rows(shadow)
    out["production"], out["shadow"] = score(a), score(b)
    out["shadow_minus_production_brier"] = paired_day_bootstrap(a, b, samples=samples)
    if len(games) < MIN_GAMES:
        out.update(verdict="collecting", message=f"{len(games)} of {MIN_GAMES} paired games; too early to conclude.")
    elif out["shadow_minus_production_brier"]["upper_95"] < 0:
        out.update(verdict="adopt_shadow", message="Shadow model is better with a 95% interval below zero.")
    else:
        out.update(verdict="keep_production", message="Shadow model did not clear the pre-registered bar.")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("export", type=Path)
    print(json.dumps(scorecard(json.loads(ap.parse_args().export.read_text())), indent=2))


if __name__ == "__main__":
    main()
