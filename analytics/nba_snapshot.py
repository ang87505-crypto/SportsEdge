"""Build an NBA Elo rating snapshot as a `research_model_versions` row, for the shadow test.

The live pipeline (`research_publish`) forecasts from a frozen snapshot of team ratings plus a fixed
home advantage. This builder produces such a snapshot for any variant and cutoff day, so the shadow
model (margin-of-victory updates + 25% season regression) can be refreshed weekly through the
existing function with no schema change. It only writes local files; inserting the row is a
separate owner step (see docs/NBA_MODEL_V2_RESEARCH_2026_10_20.md).

Usage:
  python nba_snapshot.py --folder <sources> --manifest src/data/research/nba_recent_sources.json \
      --as-of 2026-10-20 [--current-season-espn nba_schedule_2027.csv] --out-dir <dir>
"""
from __future__ import annotations

import argparse
import csv
from dataclasses import replace
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

from nba_elo_variants import VARIANTS, Game, Variant, mov_multiplier, probability

SHADOW = replace(VARIANTS["baseline"], name="shadow_v2", mov=True, season_regression=0.25)
ALIASES = {'GS': 'GSW', 'NO': 'NOP', 'NY': 'NYK', 'SA': 'SAS', 'UTAH': 'UTA', 'WSH': 'WAS'}


def ratings_as_of(games: Iterable[Game], variant: Variant, cutoff: date, cutoff_season: int) -> tuple[dict[str, float], Game | None]:
    """Ratings using only games played before `cutoff`, as they would stand for a game in `cutoff_season`.

    Season regression is applied at every season boundary, including the one between the last
    result and `cutoff_season`, so a season-start snapshot is already regressed.
    """
    items = sorted((g for g in games if g.day < cutoff), key=lambda g: (g.day, g.game_id))
    rating: dict[str, float] = {}
    season: int | None = None
    last: Game | None = None

    def regress() -> None:
        for team in rating:
            rating[team] = rating[team] * (1 - variant.season_regression) + variant.regression_mean * variant.season_regression

    i = 0
    while i < len(items):
        day = items[i].day
        batch = []
        while i < len(items) and items[i].day == day:
            batch.append(items[i]); i += 1
        if season is not None and batch[0].season != season and variant.season_regression:
            regress()
        season = batch[0].season
        diffs = [rating.get(g.home, variant.initial) + variant.home_advantage - rating.get(g.away, variant.initial) for g in batch]
        for g, diff in zip(batch, diffs):
            p = probability(diff, variant.floor)
            k = variant.k * (mov_multiplier(abs(g.home_score - g.away_score), diff if g.home_won else -diff) if variant.mov else 1.0)
            delta = k * (float(g.home_won) - p)
            rating[g.home] = rating.get(g.home, variant.initial) + delta
            rating[g.away] = rating.get(g.away, variant.initial) - delta
        last = batch[-1]
    if season is not None and cutoff_season != season:
        if cutoff_season < season:
            raise ValueError("Cutoff season precedes the latest result")
        if variant.season_regression:
            regress()
    return rating, last


def refreshed_forecasts(games: Iterable[Game], variant: Variant, season: int, every_days: int | None,
                        rest_penalty: float = 0.0, neutral_fix: bool = False) -> list[dict[str, Any]]:
    """Forecasts for `season` from snapshots refreshed every `every_days` (None = frozen at season start).

    Mirrors the live pipeline: each game is priced from the latest snapshot, built only from results
    before the snapshot day. Optional per-game rest and neutral-site adjustments model a richer
    publish function.
    """
    from nba_elo_variants import back_to_back
    items = sorted(games, key=lambda g: (g.day, g.game_id))
    rest = back_to_back(items)
    target = [g for g in items if g.season == season]
    if not target:
        raise ValueError("No games in the requested season")
    out, snap, snap_day = [], None, None
    for g in target:
        if snap is None or (every_days is not None and (g.day - snap_day).days >= every_days):
            snap_day = g.day
            snap, _ = ratings_as_of(items, variant, snap_day, season)
        hfa = 0.0 if (neutral_fix and g.neutral) else variant.home_advantage
        hb, ab = rest[g.game_id]
        diff = snap.get(g.home, variant.initial) + hfa - snap.get(g.away, variant.initial) - rest_penalty * hb + rest_penalty * ab
        out.append({"game_id": g.game_id, "day": g.day.isoformat(), "season": g.season, "p": probability(diff, variant.floor), "home_won": g.home_won})
    return out


def current_season_espn(rows: list[dict[str, str]], season: int, team_ids: dict[str, str]) -> list[Game]:
    """Completed regular-season games from ESPN's current-season schedule (single source, flagged in provenance).

    `team_ids` maps ESPN abbreviations to the NBA Stats team ids used by the pinned seasons, so ratings
    carry over. Unknown teams fail closed rather than starting a fresh rating.
    """
    games, seen = [], set()
    for r in rows:
        if r.get('season_type') != '2' or r.get('status_type_name') != 'STATUS_FINAL' or r.get('status_type_completed') != 'true':
            continue
        notes = r.get('notes_headline', '')
        if 'All-Star' in notes or ('Cup' in notes and 'Championship' in notes):
            continue
        starts = datetime.fromisoformat(r['date'].replace('Z', '+00:00')).astimezone(timezone.utc)
        h, a = ALIASES.get(r['home_abbreviation'], r['home_abbreviation']), ALIASES.get(r['away_abbreviation'], r['away_abbreviation'])
        if h not in team_ids or a not in team_ids:
            raise ValueError(f"Unknown team in current-season file: {h} or {a}")
        hs, as_ = int(r['home_score']), int(r['away_score'])
        if hs == as_ or min(hs, as_) < 0:
            raise ValueError(f"Invalid final score for ESPN event {r['id']}")
        gid = 'espn-' + r['id']
        if gid in seen:
            raise ValueError('Duplicate ESPN event')
        seen.add(gid)
        games.append(Game(gid, starts.date(), season, team_ids[h], team_ids[a], hs, as_, r.get('neutral_site') == 'true'))
    return games


def espn_team_map(folder: Path, manifest: dict[str, Any], payload: dict[str, Any]) -> dict[str, str]:
    """ESPN abbreviation -> NBA Stats team id, learned from events already reconciled across both pinned sources."""
    events = {g['espn_event_id']: g for g in payload['games']}
    mapping: dict[str, str] = {}
    for entry in manifest['espn']:
        for r in csv.DictReader((folder / entry['name']).read_text(encoding='utf-8-sig').splitlines()):
            g = events.get(r['id'])
            if not g:
                continue
            for side in ('home', 'away'):
                abbr = ALIASES.get(r[f'{side}_abbreviation'], r[f'{side}_abbreviation'])
                if mapping.setdefault(abbr, g[f'{side}_team_id']) != g[f'{side}_team_id']:
                    raise ValueError(f'ESPN abbreviation {abbr} maps to two teams')
    return mapping


def model_version(variant: Variant, ratings: dict[str, float], team_names: dict[str, str], last: Game | None,
                  last_starts_at: str, source_revision: str, cutoff: date, provenance: dict[str, Any]) -> dict[str, Any]:
    if not ratings or last is None:
        raise ValueError("Snapshot needs at least one completed game")
    missing = sorted(set(ratings) - set(team_names))
    if missing:
        raise ValueError(f"Team names missing for {missing}")
    version = f"nba-elo-v2-mov-reg25-{cutoff.isoformat()}"
    return {
        "version": version,
        "source_revision": source_revision,
        "ratings_as_of": last_starts_at,
        "home_advantage": variant.home_advantage,
        "ratings": {t: round(r, 6) for t, r in sorted(ratings.items())},
        "team_names": {t: team_names[t] for t in sorted(ratings)},
        "settings": {"k": variant.k, "mov": variant.mov, "season_regression": variant.season_regression, "regression_mean": variant.regression_mean},
        "provenance": provenance,
        "status": "SHADOW: research only; never used for paper bets",
    }


def sql_insert(row: dict[str, Any]) -> str:
    """Idempotent insert for review. Uses dollar quoting so JSON needs no escaping."""
    for key in ("version", "source_revision", "ratings_as_of"):
        if "$" in str(row[key]) or "'" in str(row[key]):
            raise ValueError(f"Unsafe character in {key}")
    ratings = json.dumps(row["ratings"], sort_keys=True)
    names = json.dumps(row["team_names"], sort_keys=True)
    if "$snap$" in ratings + names:
        raise ValueError("Delimiter collision")
    return ("-- SHADOW model version for the NBA v2 forward test. Review, then run in staging before production.\n"
            "insert into public.research_model_versions(version, source_revision, ratings_as_of, home_advantage, ratings, team_names)\n"
            f"values ('{row['version']}', '{row['source_revision']}', '{row['ratings_as_of']}', {row['home_advantage']},\n"
            f"  $snap${ratings}$snap$::jsonb,\n  $snap${names}$snap$::jsonb)\n"
            "on conflict (version) do nothing;\n")


def main() -> None:
    from nba_recent_source import load_sources
    from nba_elo_variant_study import to_games
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--folder', type=Path, required=True)
    ap.add_argument('--manifest', type=Path, required=True)
    ap.add_argument('--as-of', type=date.fromisoformat, required=True, help='First day the snapshot may be used (results before this day only)')
    ap.add_argument('--season', type=int, default=2027, help='Season (end year) the snapshot forecasts')
    ap.add_argument('--current-season-espn', type=Path)
    ap.add_argument('--out-dir', type=Path, required=True)
    args = ap.parse_args()
    payload, _ = load_sources(args.folder, json.loads(args.manifest.read_text()))
    games = to_games(payload)
    names = {g[s + '_team_id']: g[s + '_name'] for g in payload['games'] for s in ('home', 'away')}
    starts = {g['game_id']: g['starts_at'] for g in payload['games']}
    provenance: dict[str, Any] = {"pinned_sources": payload['source_revision'], "current_season": None}
    revision_parts = [payload['source_revision']]
    if args.current_season_espn:
        raw = args.current_season_espn.read_bytes()
        abbrev = espn_team_map(args.folder, json.loads(args.manifest.read_text()), payload)
        rows = list(csv.DictReader(raw.decode('utf-8-sig').splitlines()))
        extra = current_season_espn(rows, args.season, abbrev)
        games += extra
        for r in rows:
            starts['espn-' + r['id']] = datetime.fromisoformat(r['date'].replace('Z', '+00:00')).astimezone(timezone.utc).isoformat()
        digest = hashlib.sha256(raw).hexdigest()
        provenance["current_season"] = {"file": args.current_season_espn.name, "sha256": digest, "completed_games": len(extra),
                                        "single_source": True, "note": "NBA Stats file for this season was not available; ESPN-only results"}
        revision_parts.append(digest)
    ratings, last = ratings_as_of(games, SHADOW, args.as_of, args.season)
    revision = hashlib.sha256('|'.join(revision_parts).encode()).hexdigest()
    row = model_version(SHADOW, ratings, names, last, starts[last.game_id], revision, args.as_of, provenance)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / f"{row['version']}.json").write_text(json.dumps(row, indent=2) + "\n")
    (args.out_dir / f"{row['version']}.sql").write_text(sql_insert(row))
    top = sorted(row['ratings'].items(), key=lambda kv: -kv[1])[:5]
    print(row['version'], 'ratings_as_of', row['ratings_as_of'], 'teams', len(row['ratings']))
    for t, r in top:
        print(f"  {row['team_names'][t]:28s} {r:.1f}")


if __name__ == '__main__':
    main()
