import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from nba_elo_variants import (Game, Variant, VARIANTS, back_to_back, fit_rest_penalty, mov_multiplier,
                              paired_day_bootstrap, probability, score, walk_forward)
from nba_elo_walkforward import NBAGame, run_nba_walkforward


def schedule(seasons=(2023, 2024, 2025), teams=6, rounds=12):
    """Deterministic synthetic league: stronger teams win more often, with some upsets and back-to-backs."""
    games, n = [], 0
    for season in seasons:
        day = date(season - 1, 10, 20)
        for r in range(rounds):
            for i in range(0, teams, 2):
                h, a = (i + r) % teams, (i + 1 + 2 * r) % teams
                if h == a:
                    a = (a + 1) % teams
                strength = (teams - h) - (teams - a)
                home_score = 100 + 3 * strength + (7 if (n * 7) % 5 else -9)
                away_score = 100 + ((n * 3) % 4)
                if home_score == away_score:
                    home_score += 1
                games.append(Game(f"g{n}", day, season, f"T{h}", f"T{a}", home_score, away_score, n % 17 == 0))
                n += 1
            day += timedelta(days=1 if r % 3 == 0 else 2)
    return games


class VariantMath(unittest.TestCase):
    def test_probability_is_symmetric_and_bounded(self):
        self.assertAlmostEqual(probability(0), 0.5)
        self.assertAlmostEqual(probability(100) + probability(-100), 1.0)
        self.assertLess(probability(1e9), 1.0)
        self.assertGreater(probability(-1e9), 0.0)

    def test_mov_multiplier_grows_with_margin_and_shrinks_for_expected_winners(self):
        self.assertGreater(mov_multiplier(20, 0), mov_multiplier(3, 0))
        self.assertGreater(mov_multiplier(10, -100), mov_multiplier(10, 100))
        with self.assertRaises(ValueError):
            mov_multiplier(0, 0)

    def test_back_to_back_is_same_season_consecutive_days_only(self):
        g = [Game("a", date(2024, 1, 1), 2024, "X", "Y", 1, 0, False), Game("b", date(2024, 1, 2), 2024, "X", "Z", 1, 0, False),
             Game("c", date(2024, 1, 4), 2024, "Y", "X", 1, 0, False), Game("d", date(2024, 1, 5), 2025, "X", "Y", 1, 0, False)]
        f = back_to_back(g)
        self.assertEqual(f["b"], (True, False))
        self.assertEqual(f["c"], (False, False))
        self.assertEqual(f["d"], (False, False))

    def test_invalid_variant_settings_fail(self):
        with self.assertRaises(ValueError):
            Variant("bad", season_regression=1.5)


class WalkForward(unittest.TestCase):
    def test_baseline_reproduces_the_production_elo_exactly(self):
        games = schedule()
        mine = [r for r in walk_forward(games, VARIANTS["baseline"]) if r["season"] >= 2024]
        prod = run_nba_walkforward(
            [NBAGame(g.game_id, datetime(g.day.year, g.day.month, g.day.day, 23, tzinfo=timezone.utc), g.home, g.away, g.home_score, g.away_score) for g in games],
            start=date(2023, 10, 1), end=date(2025, 6, 30))
        self.assertEqual(len(mine), len(prod["predictions"]))
        by_id = {p["game_id"]: p["home_win_probability"] for p in prod["predictions"]}
        for r in mine:
            self.assertAlmostEqual(r["p"], by_id[r["game_id"]], places=12)

    def test_same_day_results_never_change_same_day_forecasts(self):
        games = schedule()
        flipped = [replace(g, home_score=g.away_score, away_score=g.home_score) if g.day == games[-1].day else g for g in games]
        for name in ("baseline", "A_mov", "B_regress", "D_neutral"):
            a = {r["game_id"]: r["p"] for r in walk_forward(games, VARIANTS[name])}
            b = {r["game_id"]: r["p"] for r in walk_forward(flipped, VARIANTS[name])}
            self.assertEqual(a, b, name)

    def test_rest_penalty_fit_ignores_test_seasons(self):
        games = schedule()
        altered = [replace(g, home_score=g.away_score, away_score=g.home_score) if g.season == 2025 else g for g in games]
        base = VARIANTS["baseline"]
        self.assertEqual(fit_rest_penalty(games, base, {2024}), fit_rest_penalty(altered, base, {2024}))

    def test_duplicate_ids_fail_closed(self):
        g = schedule()[:2]
        with self.assertRaises(ValueError):
            walk_forward([g[0], replace(g[1], game_id=g[0].game_id)], VARIANTS["baseline"])


class Scoring(unittest.TestCase):
    def test_score_matches_hand_calculation(self):
        rows = [{"p": 0.8, "home_won": True}, {"p": 0.3, "home_won": True}]
        s = score(rows)
        self.assertAlmostEqual(s["brier"], (0.04 + 0.49) / 2)
        self.assertEqual(s["accuracy"], 0.5)

    def test_identical_forecasts_give_zero_bootstrap_difference(self):
        rows = walk_forward(schedule(), VARIANTS["baseline"])
        b = paired_day_bootstrap(rows, rows, samples=200)
        self.assertEqual((b["mean_difference"], b["lower_95"], b["upper_95"]), (0.0, 0.0, 0.0))

    def test_bootstrap_rejects_mismatched_game_sets(self):
        rows = walk_forward(schedule(), VARIANTS["baseline"])
        with self.assertRaises(ValueError):
            paired_day_bootstrap(rows, rows[1:])


if __name__ == "__main__":
    unittest.main()
