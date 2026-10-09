import unittest
from copy import deepcopy
from analytics.paper_bet_study import (
    InvalidStudy, STUDY_ID, MODEL_VERSION, INITIAL_BANKROLL_CENTS,
    evaluate, win_profit_cents,
)

def bet(**overrides):
    row = {
        "position_id": 10001, "game_id": 9001, "quote_id": 45001,
        "sport": "nba", "model_version": MODEL_VERSION,
        "selection": "Boston Celtics", "stake_cents": 1000,
        "american_odds": 120, "model_probability": "0.54",
        "no_vig_probability": "0.45",
        "forecast_published_at": "2026-10-09T07:34:07Z",
        "observed_at": "2026-10-09T08:00:00Z",
        "ingested_at": "2026-10-09T08:00:05Z",
        "placed_at": "2026-10-09T08:01:00Z",
        "starts_at": "2026-10-10T12:00:00Z",
        "outcome": "pending", "profit_cents": None,
        "settled_at": None, "result_source": None,
    }
    row.update(overrides)
    return row

def study(*bets):
    return {"study_id": STUDY_ID, "bets": list(bets)}

class StudyRules(unittest.TestCase):
    def test_empty_study_cannot_claim_results(self):
        result = evaluate(study())
        self.assertEqual(result["recorded_bets"], 0)
        self.assertEqual(result["available_cents"], INITIAL_BANKROLL_CENTS)
        self.assertIsNone(result["roi"])
        self.assertIsNone(result["win_rate"])
        self.assertEqual(result["status"], "incomplete")

    def test_fixed_stake_and_pending_reserves(self):
        result = evaluate(study(bet()))
        self.assertEqual(result["recorded_bets"], 1)
        self.assertEqual(result["pending"], 1)
        self.assertEqual(result["available_cents"], 99000)
        with self.assertRaises(InvalidStudy):
            evaluate(study(bet(stake_cents=990)))
        with self.assertRaises(InvalidStudy):
            evaluate(study(bet(stake_cents=0)))

    def test_wins_losses_and_void_settlement_math(self):
        won=bet(outcome="won", profit_cents=1200,settled_at="2026-10-10T15:00:00Z",
                result_source="https://www.nba.com/game/example")
        lost=bet(position_id=10002,game_id=9002,quote_id=45002,outcome="lost",
                 profit_cents=-1000,settled_at="2026-10-10T15:00:00Z",
                 result_source="https://www.nba.com/game/example2")
        void=bet(position_id=10003,game_id=9003,quote_id=45003,outcome="void",
                 profit_cents=0,settled_at="2026-10-10T15:00:00Z",
                 result_source="https://www.nba.com/game/example3")
        result=evaluate(study(won,lost,void))
        self.assertEqual(result["realized_profit_cents"],200)
        self.assertEqual(result["settled_stake_cents"],2000)
        self.assertAlmostEqual(result["roi"],0.1)
        self.assertAlmostEqual(result["win_rate"],0.5)
        self.assertEqual(result["virtual_equity_cents"],100200)
        with self.assertRaises(InvalidStudy):
            evaluate(study(bet(**{**won, "profit_cents":1199})))

    def test_american_odds_rounding_is_deterministic(self):
        self.assertEqual(win_profit_cents(1000, 120),1200)
        self.assertEqual(win_profit_cents(1000, -150),667)
        self.assertEqual(win_profit_cents(1000, -200),500)

    def test_stale_and_retroactive_bets_rejected(self):
        for field,value in [
            ("placed_at","2026-10-09T07:34:05Z"),
            ("placed_at","2026-10-10T12:00:01Z"),
            ("forecast_published_at","2026-10-09T08:02:00Z"),
            ("observed_at","2026-10-09T06:50:00Z"),
            ("ingested_at","2026-10-09T06:50:00Z"),
            ("ingested_at","2026-10-09T08:02:00Z"),
            ("starts_at","2026-10-09T07:40:00Z"),
        ]:
            with self.subTest(field=field,value=value), self.assertRaises(InvalidStudy):
                evaluate(study(bet(**{field:value})))

    def test_unique_game_and_forecast_scope(self):
        one=bet()
        for duplicate in [dict(one,position_id=10002,quote_id=45002),
                          dict(one,game_id=9002,quote_id=45002),
                          dict(one,position_id=10002,game_id=9002)]:
            with self.assertRaises(InvalidStudy):
                evaluate(study(one,duplicate))
        for invalid in [dict(one,sport="soccer"),dict(one,model_version="epl-elo"),
                        dict(one,model_probability="0.30"),dict(one,no_vig_probability="0.99")]:
            with self.assertRaises(InvalidStudy):
                evaluate(study(invalid))

    def test_profit_and_after_final_required(self):
        for invalid in [
            bet(outcome="won",profit_cents=1200,settled_at="2026-10-09T09:00:00Z",
                result_source="https://www.nba.com/game/example"),
            bet(outcome="won",profit_cents=1200,settled_at="2026-10-10T15:00:00Z",
                result_source=None),
            bet(outcome="pending",profit_cents=0),
        ]:
            with self.assertRaises(InvalidStudy):
                evaluate(study(invalid))
    def test_more_than_100_positions_rejected(self):
        rows=[bet(position_id=20000+i,game_id=10000+i,quote_id=30000+i)
              for i in range(101)]
        with self.assertRaises(InvalidStudy):
            evaluate(study(*rows))

if __name__ == "__main__":
    unittest.main()
