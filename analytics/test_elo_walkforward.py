import unittest
from elo_walkforward import parse_completed, evaluate_league, summarize, START, END

class WalkforwardTests(unittest.TestCase):
    def test_completed_validation(self):
        sample = {"matches": [
            {"date": "2026-04-01", "team1": "A", "team2": "B", "score": {"ft": [2, 1]}},
            {"date": "2026-04-02", "team1": "A", "team2": "B"},
            {"date": "2026-04-03", "team1": "B", "team2": "A", "score": [0, 0]},
        ]}
        matches = parse_completed(sample, "en", "2025-26")
        self.assertEqual(len(matches), 2)
        self.assertEqual(matches[1]["homeGoals"], 0)

    def test_same_day_future_results_not_used(self):
        rows = []
        for d, h, a, gh, ga in [
            ("2026-04-01", "A", "B", 1, 0),
            ("2026-04-02", "B", "C", 0, 0),
            ("2026-04-03", "C", "A", 0, 1),
            ("2026-04-10", "A", "B", 3, 1),
            ("2026-04-10", "C", "A", 1, 0),
        ]:
            rows.append(dict(date=d, home=h, away=a, homeGoals=gh, awayGoals=ga, league="en"))
        base, info = evaluate_league(rows)
        changed = [dict(x) for x in rows]
        changed[-1] = dict(changed[-1], homeGoals=8, awayGoals=0)
        second, _ = evaluate_league(changed)
        self.assertEqual(base[0]["probabilities"], second[0]["probabilities"])
        self.assertEqual(base[1]["probabilities"], second[1]["probabilities"])
        self.assertEqual(info["training_matches"], 3)
        self.assertEqual(len(base), 2)

    def test_probability_sums(self):
        rows = [
            dict(date="2026-03-01", home="A", away="B", homeGoals=1, awayGoals=0, league="en"),
            dict(date="2026-03-02", home="B", away="C", homeGoals=0, awayGoals=0, league="en"),
            dict(date="2026-03-03", home="C", away="A", homeGoals=0, awayGoals=1, league="en"),
            dict(date="2026-04-11", home="A", away="C", homeGoals=1, awayGoals=1, league="en"),
        ]
        games, _ = evaluate_league(rows)
        self.assertAlmostEqual(sum(games[0]["probabilities"]), 1, places=7)
        self.assertEqual(summarize(games)["games"], 1)

    def test_duplicates_rejected(self):
        sample = {"matches": [{"date":"2026-01-01","team1":"A","team2":"B","score":[1,0]}] * 2}
        with self.assertRaises(ValueError):
            parse_completed(sample, "en", "2025-26")

if __name__ == "__main__":
    unittest.main()
