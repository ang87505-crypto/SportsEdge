"""Synthetic tests only: none of these scores represent actual NBA games."""
import copy
import math
import unittest
from datetime import date, datetime, timezone, timedelta

from nba_elo_walkforward import (
    EloSettings, NBAGame, _home_probability, parse_completed_nba,
    run_nba_walkforward,
)


def game(code, day, home, away, home_points, away_points, hour=20):
    return NBAGame(code, datetime.fromisoformat(day).replace(
        hour=hour, tzinfo=timezone.utc), home, away, home_points, away_points)


def synthetic_schedule():
    return [
        game("training-1", "2026-01-01", "team-a", "team-b", 101, 95),
        game("training-2", "2026-01-02", "team-b", "team-c", 98, 100),
        game("training-3", "2026-01-03", "team-c", "team-a", 80, 90),
        game("training-4", "2026-01-04", "team-a", "team-c", 88, 93),
        game("evaluation-1", "2026-01-05", "team-a", "team-b", 107, 101),
        game("evaluation-2", "2026-01-05", "team-c", "team-a", 99, 105, 22),
        game("evaluation-3", "2026-01-06", "team-b", "team-c", 120, 119),
    ]


CFG = EloSettings(min_training_games=4)


class NBAEloTests(unittest.TestCase):
    def setUp(self):
        self.games = synthetic_schedule()

    def evaluate(self, records=None):
        return run_nba_walkforward(self.games if records is None else records,
                                   start=date(2026, 1, 5), end=date(2026, 1, 6), config=CFG)

    def test_retro_walkforward_counts_and_metrics(self):
        report = self.evaluate()
        self.assertEqual(report["training_games"], 4)
        self.assertEqual(report["evaluation_games"], 3)
        for metric in ("accuracy", "baseline_accuracy", "log_loss", "baseline_log_loss", "brier", "baseline_brier"):
            self.assertTrue(math.isfinite(report[metric]))
        self.assertFalse(report["roi_available"])
        self.assertFalse(report["odds_available"])
        self.assertFalse(report["result_source_independently_verified"])

    def test_same_day_scores_never_change_predictions(self):
        original = self.evaluate()["predictions"]
        revised = list(self.games)
        revised[4] = game("evaluation-1", "2026-01-05", "team-a", "team-b", 70, 111)
        revised[5] = game("evaluation-2", "2026-01-05", "team-c", "team-a", 125, 100, 22)
        new_predictions = self.evaluate(revised)["predictions"]
        self.assertEqual(
            [p["home_win_probability"] for p in original[:2]],
            [p["home_win_probability"] for p in new_predictions[:2]],
        )

    def test_next_day_may_respond_to_previous_day_result(self):
        original = self.evaluate()["predictions"][-1]["home_win_probability"]
        changed = list(self.games)
        changed[4] = game("evaluation-1", "2026-01-05", "team-a", "team-b", 70, 111)
        self.assertNotEqual(original, self.evaluate(changed)["predictions"][-1]["home_win_probability"])

    def test_baseline_is_fixed_from_training_only(self):
        report = self.evaluate()
        # Four previous synthetic games include one home win, plus Laplace pseudocounts.
        self.assertAlmostEqual(report["baseline_home_win_probability"], 1/3)
        self.assertTrue(all(p["baseline_home_win_probability"] == 1/3 for p in report["predictions"]))
        changed = list(self.games)
        changed[4] = game("evaluation-1", "2026-01-05", "team-a", "team-b", 70, 111)
        self.assertEqual(report["baseline_home_win_probability"], self.evaluate(changed)["baseline_home_win_probability"])

    def test_order_independence(self):
        first = self.evaluate()
        reversed_result = self.evaluate(list(reversed(self.games)))
        self.assertEqual(first, reversed_result)

    def test_probability_bounds_and_no_nans(self):
        for a, b in [(1500, 1500), (1e20, -1e20), (-1e20, 1e20)]:
            p = _home_probability(a, b, CFG)
            self.assertTrue(0 < p < 1)
            self.assertTrue(math.isfinite(-math.log(p)))

    def test_training_and_test_require_minimum_data(self):
        with self.assertRaisesRegex(ValueError, "Insufficient prior"):
            run_nba_walkforward(self.games, start=date(2026, 1, 3), end=date(2026, 1, 6), config=CFG)
        with self.assertRaisesRegex(ValueError, "No held-out"):
            run_nba_walkforward(self.games, start=date(2026, 2, 1), end=date(2026, 2, 2), config=CFG)
        with self.assertRaises(ValueError):
            run_nba_walkforward(self.games, start=date(2026, 1, 7), end=date(2026, 1, 6), config=CFG)

    def test_invalid_config_rejected(self):
        for kwargs in ({"k_factor": 0}, {"k_factor": float("nan")},
                       {"home_advantage": float("inf")}, {"min_training_games": 0},
                       {"min_training_games": True}, {"probability_floor": 0.8}):
            with self.assertRaises(ValueError):
                EloSettings(**kwargs)

    def test_duplicate_identifiers_or_fixtures_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.evaluate(self.games + [self.games[0]])
        conflict = game("different-id", "2026-01-01", "team-a", "team-b", 100, 90)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.evaluate(self.games + [conflict])

    def test_validation_of_finished_score_and_timezone(self):
        for bad in [
            game("bad-tie", "2026-01-01", "h", "a", 95, 95),
            game("bad-negative", "2026-01-01", "h", "a", -1, 95),
            NBAGame("missing-tz", datetime(2026, 1, 1, 8), "h", "a", 101, 99),
            NBAGame("bool-score", datetime(2026, 1, 1, tzinfo=timezone.utc), "h", "a", True, 99),
        ]:
            with self.assertRaises(ValueError):
                self.evaluate(self.games + [bad])

    def test_timezone_normalization_and_grouping(self):
        # Same UTC calendar day even if the source exposes local offset.
        local = NBAGame("timezone-event", datetime(2026, 1, 5, 17, tzinfo=timezone(timedelta(hours=-5))), "x", "y", 99, 90)
        self.assertEqual(local.utc_day, date(2026, 1, 5))

    def test_parser_validates_only_final_regular_nba(self):
        raw = {
            "competition": "nba", "source": "verified-upstream-required", "source_revision": "revision-id",
            "games": [{"game_id": "foo", "starts_at": "2026-01-01T15:00:00Z",
                       "home_team_id": "h", "away_team_id": "a", "home_score": 110,
                       "away_score": 100, "status": "final", "season_type": "regular"}],
        }
        games, metadata = parse_completed_nba(raw)
        self.assertEqual(len(games), 1)
        self.assertEqual(metadata["source_revision"], "revision-id")
        self.assertEqual(games[0].starts_at.tzinfo, timezone.utc)
        for field, value in [("status", "live"), ("season_type", "preseason"),
                             ("home_score", True), ("away_score", 110),
                             ("starts_at", "2026-01-01T15:00:00"),
                             ("away_team_id", "h")]:
            modified = copy.deepcopy(raw)
            modified["games"][0][field] = value
            with self.assertRaises(ValueError):
                parse_completed_nba(modified)
        for metadata_field, value in [("competition", "ncaab"), ("source_revision", " "), ("source", "")]:
            modified = copy.deepcopy(raw)
            modified[metadata_field] = value
            with self.assertRaises(ValueError):
                parse_completed_nba(modified)

    def test_parser_rejects_duplicate_game_id_and_fixture(self):
        item = {"game_id": "foo", "starts_at": "2026-01-01T15:00:00Z",
                "home_team_id": "h", "away_team_id": "a", "home_score": 110,
                "away_score": 100, "status": "final", "season_type": "regular"}
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            parse_completed_nba({"competition": "nba", "source": "s", "source_revision": "r", "games": [item, dict(item)]})

    def test_empty_sample_fails(self):
        with self.assertRaises(ValueError):
            self.evaluate([])


if __name__ == "__main__":
    unittest.main()
