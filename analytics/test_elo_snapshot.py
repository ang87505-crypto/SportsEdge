"""Offline integrity checks for the frozen retrospective audit output."""
import json
import math
import unittest
from pathlib import Path

REPORT = Path(__file__).resolve().parents[1] / "src" / "data" / "research" / "elo_2026_10_08.json"

class FrozenBacktestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(REPORT.read_text(encoding="utf-8"))
        cls.games = cls.data["games"]

    def test_source_and_scope(self):
        self.assertEqual(self.data["sourceCommit"], "e6744429ee395bc86f247348c6184bb08d4eb361")
        self.assertEqual(self.data["license"], "CC0-1.0")
        self.assertEqual(self.data["overall"]["games"], len(self.games))
        self.assertEqual(self.data["trainingGames"], 3154)
        self.assertEqual(len(self.games), 579)
        self.assertIsNone(self.data["roi"])

    def test_each_game_has_consistent_prediction_and_score(self):
        seen = set()
        for match in self.games:
            ident = (match["league"], match["date"], match["home"], match["away"])
            self.assertNotIn(ident, seen)
            seen.add(ident)
            self.assertTrue(self.data["start"] <= match["date"] <= self.data["latestCompletedMatch"])
            self.assertEqual(len(match["probabilities"]), 3)
            self.assertTrue(all(isinstance(x, (float, int)) and 0 < x < 1 for x in match["probabilities"]))
            self.assertAlmostEqual(sum(match["probabilities"]), 1.0, places=6)
            hg, ag = match["score"]
            actual = "H" if hg > ag else "D" if hg == ag else "A"
            self.assertEqual(match["actual"], actual)
            self.assertEqual(match["prediction"], "HDA"[match["probabilities"].index(max(match["probabilities"]))])
            self.assertEqual(match["correct"], match["prediction"] == actual)

    def test_metric_consistency(self):
        self.assertAlmostEqual(sum(game["correct"] for game in self.games) / len(self.games),
                               self.data["overall"]["accuracy"], places=10)
        losses = [-math.log(game["probabilities"]["HDA".index(game["actual"])]) for game in self.games]
        self.assertAlmostEqual(sum(losses) / len(losses), self.data["overall"]["logLoss"], places=6)
        briers = [sum((game["probabilities"][i] - int(game["actual"] == "HDA"[i])) ** 2
                      for i in range(3)) for game in self.games]
        self.assertAlmostEqual(sum(briers) / len(briers), self.data["overall"]["brier"], places=6)

if __name__ == "__main__":
    unittest.main()
