import unittest
from dataclasses import replace
from datetime import date, timedelta

from nba_elo_variants import VARIANTS, Game, walk_forward
from nba_shadow_scorecard import MIN_GAMES, PRODUCTION, scorecard
from nba_snapshot import SHADOW, current_season_espn, model_version, ratings_as_of, sql_insert
from test_nba_elo_variants import schedule


class Snapshot(unittest.TestCase):
    def test_snapshot_matches_walk_forward_forecasts_for_the_next_day(self):
        games = schedule()
        last_day = max(g.day for g in games)
        cutoff = last_day
        ratings, _ = ratings_as_of(games, VARIANTS["baseline"], cutoff, games[-1].season)
        forecasts = {r["game_id"]: r["p"] for r in walk_forward(games, VARIANTS["baseline"])}
        from nba_elo_variants import probability
        for g in [g for g in games if g.day == last_day]:
            p = probability(ratings.get(g.home, 1500) + 65 - ratings.get(g.away, 1500))
            self.assertAlmostEqual(p, forecasts[g.game_id], places=12)

    def test_results_on_or_after_the_cutoff_are_never_used(self):
        games = schedule()
        cutoff = sorted({g.day for g in games})[20]
        flipped = [replace(g, home_score=g.away_score, away_score=g.home_score) if g.day >= cutoff else g for g in games]
        season = next(g.season for g in sorted(games, key=lambda g: g.day) if g.day >= cutoff)
        self.assertEqual(ratings_as_of(games, SHADOW, cutoff, season)[0], ratings_as_of(flipped, SHADOW, cutoff, season)[0])

    def test_season_start_snapshot_is_regressed(self):
        games = [g for g in schedule() if g.season == 2023]
        same, _ = ratings_as_of(games, SHADOW, date(2030, 1, 1), 2023)
        new, _ = ratings_as_of(games, SHADOW, date(2030, 1, 1), 2024)
        for team in same:
            self.assertAlmostEqual(new[team], same[team] * 0.75 + 1505 * 0.25)
        with self.assertRaises(ValueError):
            ratings_as_of(games, SHADOW, date(2030, 1, 1), 2022)

    def test_model_version_row_and_sql_are_well_formed(self):
        games = schedule()
        ratings, last = ratings_as_of(games, SHADOW, date(2030, 1, 1), 2026)
        names = {t: f"Team {t}" for t in ratings}
        row = model_version(SHADOW, ratings, names, last, "2025-04-01T23:00:00+00:00", "abc", date(2026, 10, 20), {})
        self.assertEqual(row["version"], "nba-elo-v2-mov-reg25-2026-10-20")
        self.assertIn("SHADOW", row["status"])
        sql = sql_insert(row)
        self.assertIn("on conflict (version) do nothing", sql)
        self.assertIn("$snap$", sql)
        with self.assertRaises(ValueError):
            sql_insert({**row, "source_revision": "x'; drop table games; --"})
        with self.assertRaises(ValueError):
            model_version(SHADOW, ratings, {}, last, "2025-04-01T23:00:00+00:00", "abc", date(2026, 10, 20), {})

    def test_daily_refresh_equals_walk_forward_and_frozen_ignores_in_season_results(self):
        from nba_snapshot import refreshed_forecasts
        games = schedule()
        daily = refreshed_forecasts(games, VARIANTS["baseline"], 2025, 1)
        wf = {r["game_id"]: r["p"] for r in walk_forward(games, VARIANTS["baseline"])}
        for r in daily:
            self.assertAlmostEqual(r["p"], wf[r["game_id"]], places=12)
        flipped = [replace(g, home_score=g.away_score, away_score=g.home_score) if g.season == 2025 else g for g in games]
        self.assertEqual([r["p"] for r in refreshed_forecasts(games, SHADOW, 2025, None)],
                         [r["p"] for r in refreshed_forecasts(flipped, SHADOW, 2025, None)])

    def test_current_season_parser_keeps_only_regular_finals_and_fails_on_unknown_teams(self):
        base = {"season_type": "2", "status_type_name": "STATUS_FINAL", "status_type_completed": "true", "notes_headline": "",
                "date": "2026-10-21T23:30Z", "home_abbreviation": "BOS", "away_abbreviation": "NY", "home_score": "110", "away_score": "101", "neutral_site": "false"}
        rows = [{**base, "id": "1"}, {**base, "id": "2", "status_type_name": "STATUS_SCHEDULED", "status_type_completed": "false"},
                {**base, "id": "3", "notes_headline": "NBA Cup Championship"}]
        games = current_season_espn(rows, 2027, {"BOS": "1610612738", "NYK": "1610612752"})
        self.assertEqual([g.game_id for g in games], ["espn-1"])
        self.assertEqual(games[0].away, "1610612752")
        with self.assertRaises(ValueError):
            current_season_espn([{**base, "id": "9", "home_abbreviation": "XXX"}], 2027, {"NYK": "1"})


def export(n, shadow_better=True):
    forecasts, results = [], []
    for i in range(n):
        day = date(2026, 10, 21) + timedelta(days=i // 5)
        home_won = i % 3 != 0
        good, bad = (0.7 if home_won else 0.3), 0.5
        starts = f"{day.isoformat()}T23:30:00+00:00"
        forecasts.append({"game_id": i, "model_version": PRODUCTION, "home_probability": bad if shadow_better else good, "published_at": f"{day.isoformat()}T10:00:00+00:00", "starts_at": starts})
        forecasts.append({"game_id": i, "model_version": "nba-elo-v2-mov-reg25-2026-10-20", "home_probability": good if shadow_better else bad, "published_at": f"{day.isoformat()}T10:05:00+00:00", "starts_at": starts})
        results.append({"game_id": i, "status": "final", "home_score": 110 if home_won else 100, "away_score": 105})
    return {"forecasts": forecasts, "results": results}


class Scorecard(unittest.TestCase):
    def test_too_few_games_never_concludes(self):
        self.assertEqual(scorecard(export(MIN_GAMES - 1), samples=200)["verdict"], "collecting")

    def test_clear_shadow_advantage_is_adopted_and_reverse_is_not(self):
        self.assertEqual(scorecard(export(MIN_GAMES), samples=300)["verdict"], "adopt_shadow")
        self.assertEqual(scorecard(export(MIN_GAMES, shadow_better=False), samples=300)["verdict"], "keep_production")

    def test_post_tipoff_forecasts_are_ignored_and_latest_pregame_wins(self):
        e = export(3)
        late = dict(e["forecasts"][1], home_probability=0.99, published_at="2026-10-22T00:00:00+00:00")
        newer = dict(e["forecasts"][1], model_version="nba-elo-v2-mov-reg25-2026-10-27", home_probability=0.6, published_at="2026-10-21T12:00:00+00:00")
        e["forecasts"] += [late, newer]
        card = scorecard(e, samples=100)
        self.assertIn("nba-elo-v2-mov-reg25-2026-10-27", card["shadow_versions"])
        self.assertEqual(card["paired_final_games"], 3)

    def test_invalid_rows_fail_closed(self):
        e = export(2)
        e["results"][0]["home_score"] = 105
        with self.assertRaises(ValueError):
            scorecard(e)
        e = export(2)
        e["forecasts"][0]["home_probability"] = 1.2
        with self.assertRaises(ValueError):
            scorecard(e)


if __name__ == "__main__":
    unittest.main()
