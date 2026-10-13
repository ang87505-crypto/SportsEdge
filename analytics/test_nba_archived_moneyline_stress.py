"""Fictional miniature NBA moneyline inputs; no source-data redistribution."""
import io
from datetime import date
import unittest

from analytics.nba_archived_moneyline_stress import (
    parse_source, evaluate, _win_profit, _selection, _p,
    STAKE_CENTS, REPLAY_VERSION
)

HEADER="slugSeason,newGameID,idGame,slugTeam,slugOpp,slugMatchup,dateGame,outcomeGame.team1,teamML.team1,oppML.team1\n"

def item(id,day,match="AAA vs. BBB",winner="W",ml1="-110.0",ml2="-110.0",season="2013-14"):
    return f"{season},synth-{id},{id},AAA,BBB,{match},{day},{winner},{ml1},{ml2}\n"

def data(*rows):
    return parse_source(HEADER+"".join(rows))

class NbaMoneylineAuditTests(unittest.TestCase):
    def test_day_batch_predictions_do_not_use_same_day_result(self):
        rows=data(item(1,"2013-10-29",winner="W"),item(2,"2013-10-29",winner="L"))
        result=evaluate(rows)
        self.assertEqual(result["evaluation_games"],2)
        # Both mock fixtures share teams and a calendar date intentionally:
        # earlier same-day outcome MUST NOT affect the later prediction.
        self.assertEqual(_p(1500,1500),_p(1500,1500))
        self.assertEqual(result["whole_evaluation"]["model_flat10"]["bets"],2)
        self.assertEqual(result["whole_evaluation"]["model_flat10"]["wins"],1)
        self.assertEqual(result["last_5000"]["games"],2)
        self.assertEqual(result["scope"],"short_fixture_only")

    def test_conservative_positive_and_negative_moneyline_profit_in_cents(self):
        self.assertEqual(_win_profit(120),1200)
        self.assertEqual(_win_profit(-110),909)
        self.assertEqual(_win_profit(-184),543)
        self.assertEqual(STAKE_CENTS,1000)

    def test_no_fabricated_bet_when_price_missing(self):
        r=data(item(1,"2013-10-29",ml1="",ml2="-110.0"))[0]
        chosen,favorite=_selection(r,.6)
        self.assertIsNone(chosen)
        self.assertIsNone(favorite)

    def test_invalid_market_overround_never_qualifies(self):
        r=data(item(1,"2013-10-29",ml1="-900.0",ml2="-900.0"))[0]
        chosen,favorite=_selection(r,.6)
        self.assertIsNone(chosen)
        self.assertIsNone(favorite)

    def test_no_invented_revenue_from_bets_that_do_not_qualify(self):
        r=data(item(1,"2013-10-29",ml1="-160.0",ml2="130.0"))[0]
        chosen,favorite=_selection(r,.6)
        self.assertIsNone(chosen)
        self.assertIsNotNone(favorite)

    def test_noncanonical_fixture_rejected(self):
        with self.assertRaises(ValueError):
            data(item(1,"2013-10-29",match="AAA-BBB"))
        with self.assertRaises(ValueError):
            data(item(1,"2013-10-29",winner="X"))
        with self.assertRaises(ValueError):
            data(item(1,"2013-10-29"),item(1,"2013-10-30"))

    def test_missing_required_columns_rejected(self):
        with self.assertRaises(ValueError):
            parse_source("day,winner\n2020-01-01,W\n")

    def test_report_is_deterministic_and_explicitly_nonexecutable(self):
        rows=data(item(1,"2013-10-29"),item(2,"2013-10-30",winner="L"),
                  item(3,"2013-10-31",winner="W"))
        a=evaluate(rows)
        self.assertEqual(a,evaluate(rows))
        self.assertEqual(a["version"],REPLAY_VERSION)
        self.assertIs(a["source"]["historical_quote_timestamp_known"],False)
        self.assertIs(a["source"]["sportsbook_identity_known"],False)
        self.assertIn("NOT guaranteed obtainable",a["interpretation"])

    def test_pre_evaluation_matches_train_ratings_without_claiming_test_metrics(self):
        rows=data(item(1,"2012-10-29",season="2012-13"),
                  item(2,"2013-10-29",winner="L"),
                  item(3,"2013-10-30",winner="W"))
        a=evaluate(rows)
        self.assertEqual(a["evaluation_games"],2)

    def test_base_fraction_and_no_vig_rule_fixed(self):
        self.assertAlmostEqual(_p(1500,1500),.5924662305843318,places=4)
        rows=data(item(1,"2013-10-29"))
        a=evaluate(rows)
        self.assertEqual(a["model"]["ev_minimum"],0.02)
        self.assertEqual(a["model"]["home_advantage"],65)

if __name__=="__main__":
    unittest.main()
