import unittest
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from model_evaluation import Prediction, evaluate

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
def row(game_id="g1", **kwargs):
    data = dict(game_id=game_id, prediction_at=NOW, starts_at=NOW + timedelta(hours=2), model_probability=0.7, outcome=1)
    data.update(kwargs)
    return Prediction(**data)

class EvaluationTests(unittest.TestCase):
    def test_scoring_without_odds(self):
        result = evaluate([row()])
        self.assertAlmostEqual(result["brier_score"], 0.09)
        self.assertIsNone(result["paper_roi"])
        self.assertEqual(result["sample_size"], 1)
    def test_settlement(self):
        result = evaluate([row(american_odds=150, stake=Decimal("10")), row("g2", outcome=0, american_odds=-110, stake=Decimal("10"))])
        self.assertEqual(result["paper_profit"], "5.0")
        self.assertEqual(result["paper_roi"], "0.25")
    def test_reject_lookahead(self):
        with self.assertRaises(ValueError):
            evaluate([row(prediction_at=NOW + timedelta(hours=3))])
    def test_reject_duplicate(self):
        with self.assertRaises(ValueError):
            evaluate([row(), row()])
    def test_reject_bad_probability(self):
        with self.assertRaises(ValueError):
            evaluate([row(model_probability=1)])
    def test_reject_no_rows(self):
        with self.assertRaises(ValueError):
            evaluate([])
    def test_reject_naive_dates(self):
        with self.assertRaises(ValueError):
            evaluate([row(prediction_at=datetime(2026, 1, 1))])

if __name__ == "__main__":
    unittest.main()
