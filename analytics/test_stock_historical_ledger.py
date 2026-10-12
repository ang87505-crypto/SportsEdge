"""All fixtures are fictional and are NOT a claim of stock-market profit."""
from copy import deepcopy
import tempfile
from pathlib import Path
import unittest

from analytics.stock_historical_ledger import replay, cents, _cost, ENGINE_VERSION
from analytics.stock_momentum_v1 import VERSION


def signal(*, budget=10_000, sid="synthetic-signal-1"):
    return {
        "strategy_version": VERSION, "signal_id": sid, "input_digest": sid,
        "status": "research_targets_only", "performance_measured": False,
        "fills": [], "decision_at": "2025-01-31T22:00:00Z",
        "earliest_execution_at": "2025-02-03T14:30:00Z",
        "targets": [{"symbol":"AAA", "action":"TARGET","target_budget_cents":budget}],
    }


def fixture(*, slippage=0, fee=0):
    return {
        "kind": "synthetic_fixture", "provider": "synthetic",
        "source_revision": "fixture-only-v1", "price_adjustment": "raw",
        "corporate_actions_coverage_complete": True,
        "initial_cash_cents": 100_000, "costs": {"slippage_bps":slippage,"fee_cents":fee},
        "sessions": [
            {
                "date":"2025-01-31","open_at":"2025-01-31T14:30:00Z",
                "close_at":"2025-01-31T21:00:00Z",
                "market":[{"symbol":"AAA","security_id":"SEC-A",
                           "open":"10.00","close":"10.00"}],"actions":[],
            },
            {
                "date":"2025-02-03","open_at":"2025-02-03T14:30:00Z",
                "close_at":"2025-02-03T21:00:00Z",
                "market":[{"symbol":"AAA","security_id":"SEC-A",
                           "open":"10.00","close":"11.00"}],"actions":[],
                "decision":{"published_at":"2025-01-31T22:00:30Z","signal":signal()},
            },
            {
                "date":"2025-02-04","open_at":"2025-02-04T14:30:00Z",
                "close_at":"2025-02-04T21:00:00Z",
                "market":[{"symbol":"AAA","security_id":"SEC-A",
                           "open":"11.00","close":"12.00"}],"actions":[],
            },
        ],
    }


class HistoricalPortfolioTests(unittest.TestCase):
    def test_one_next_open_buy_exact_cents_and_mark_to_market(self):
        d=replay(fixture())
        self.assertEqual(d["engine_version"], ENGINE_VERSION)
        self.assertEqual(d["proxy_fills"],1)
        self.assertEqual(d["fills"][0]["shares"],10)
        self.assertEqual(d["fills"][0]["reference_open_cents"],1000)
        self.assertEqual(d["fills"][0]["cash_delta_cents"],-10000)
        self.assertEqual(d["ending_equity_cents"],102000)
        self.assertEqual(d["net_pnl_cents"],2000)
        self.assertEqual(d["return_fraction"],"0.02")
        self.assertEqual(d["equity_curve"][0]["positions"],{})
        self.assertEqual(d["equity_curve"][-1]["cash_cents"],90000)
        self.assertIsNone(d["benchmark"])
        self.assertIn("not_verified_executable",d["status"])

    def test_explicit_costs_change_results_and_use_conservative_rounding(self):
        d=replay(fixture(slippage=20,fee=25))
        self.assertEqual(d["fills"][0]["shares"],9)
        self.assertEqual(d["fills"][0]["cash_delta_cents"],-9043)
        self.assertEqual(d["ending_equity_cents"],101757)
        self.assertEqual(_cost(10001,side="buy",bps=10,fee=0),10012)
        self.assertEqual(_cost(10001,side="sell",bps=10,fee=0),9990)

    def test_zero_price_or_fractional_precision_are_rejected(self):
        for price in ("0.00","1.234","NaN","-1","",2.3):
            with self.assertRaises(ValueError):
                cents(price)

    def test_risk_limits_and_duplicate_targets_refuse_overexposure(self):
        for budget in (10001,50001):
            f=fixture()
            f["sessions"][1]["decision"]["signal"]["targets"][0]["target_budget_cents"]=budget
            with self.assertRaisesRegex(ValueError,"exposure"):
                replay(f)
        f=fixture()
        targets=f["sessions"][1]["decision"]["signal"]["targets"]
        targets.append(deepcopy(targets[0]))
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            replay(f)

    def test_split_and_cash_dividend_applied_before_mark(self):
        f=fixture()
        f["sessions"][2]["market"][0].update(open="5.50",close="6.00")
        f["sessions"][2]["actions"]=[{"symbol":"AAA","source_id":"synthetic-2for1",
                                      "split_numerator":2,"split_denominator":1,
                                      "dividend_cents_per_old_share":5}]
        d=replay(f)
        self.assertEqual(d["equity_curve"][-1]["positions"]["AAA"],20)
        self.assertEqual(d["equity_curve"][-1]["cash_cents"],90050)
        self.assertEqual(d["ending_equity_cents"],102050)
        self.assertEqual(d["corporate_actions"][0]["dividend_cents"],50)

    def test_fractional_shares_fail_instead_of_invented_cash_in_lieu(self):
        f=fixture(slippage=20,fee=25)
        f["sessions"][2]["actions"]=[{"symbol":"AAA","source_id":"synthetic-reverse",
                                      "split_numerator":1,"split_denominator":2,
                                      "dividend_cents_per_old_share":0}]
        with self.assertRaisesRegex(ValueError,"Fractional"):
            replay(f)

    def test_unknown_or_changed_security_identity_stops(self):
        f=fixture()
        f["sessions"][2]["market"][0]["security_id"]="DIFFERENT-ID"
        with self.assertRaisesRegex(ValueError,"identity changed"):
            replay(f)

    def test_missing_holding_price_fails_closed(self):
        f=fixture()
        f["sessions"][2]["market"]=[]
        with self.assertRaisesRegex(ValueError,"Missing current close"):
            replay(f)

    def test_same_close_signal_or_future_publication_cannot_trade(self):
        f=fixture()
        f["sessions"][1]["decision"]["signal"]["decision_at"]="2025-02-03T21:00:00Z"
        with self.assertRaisesRegex(ValueError,"future/same-close"):
            replay(f)
        f=fixture()
        f["sessions"][1]["decision"]["published_at"]="2025-02-03T15:00:00Z"
        with self.assertRaisesRegex(ValueError,"future/same-close"):
            replay(f)

    def test_no_duplicate_signals_or_second_rebalance_in_same_month(self):
        f=fixture()
        f["sessions"][2]["decision"]=deepcopy(f["sessions"][1]["decision"])
        f["sessions"][2]["decision"]["signal"]["earliest_execution_at"]="2025-02-04T14:30:00Z"
        with self.assertRaises(ValueError):
            replay(f)

    def test_provenance_and_adjustments_cannot_be_bluffed_by_wrong_schema(self):
        for key,bad in (
            ("price_adjustment","adjusted"),
            ("corporate_actions_coverage_complete",False),
            ("provider",""),
        ):
            f=fixture();f[key]=bad
            with self.assertRaises(ValueError):
                replay(f)
        f=fixture();f["kind"]="real"
        with self.assertRaisesRegex(ValueError,"synthetic"):
            replay(f)

    def test_source_data_not_modified_and_replay_is_deterministic(self):
        f=fixture()
        before=deepcopy(f)
        self.assertEqual(replay(f),replay(f))
        self.assertEqual(f,before)

    def test_cash_held_if_no_signal_and_drawdown_is_recorded(self):
        f=fixture()
        del f["sessions"][1]["decision"]
        d=replay(f)
        self.assertEqual(d["ending_equity_cents"],100000)
        self.assertEqual(d["proxy_fills"],0)
        f=fixture()
        f["sessions"][2]["market"][0]["close"]="4.00"
        d=replay(f)
        self.assertEqual(d["ending_equity_cents"],94000)
        self.assertEqual(d["max_drawdown_cents"],7000)
        self.assertEqual(d["max_drawdown_fraction"],str(__import__("decimal").Decimal(7000)/101000))

    def test_sell_side_and_exit_next_month(self):
        f=fixture()
        f["sessions"].append({
          "date":"2025-02-28","open_at":"2025-02-28T14:30:00Z",
          "close_at":"2025-02-28T21:00:00Z",
          "market":[{"symbol":"AAA","security_id":"SEC-A","open":"12.00","close":"12.00"}],
          "actions":[]})
        f["sessions"].append({
          "date":"2025-03-03","open_at":"2025-03-03T14:30:00Z",
          "close_at":"2025-03-03T21:00:00Z",
          "market":[{"symbol":"AAA","security_id":"SEC-A","open":"12.00","close":"12.00"}],
          "actions":[],
          "decision":{"published_at":"2025-02-28T22:01:00Z",
                      "signal":{"strategy_version":VERSION,"signal_id":"synthetic-exit",
                                "input_digest":"synthetic-exit","status":"research_targets_only",
                                "performance_measured":False,"fills":[],
                                "decision_at":"2025-02-28T22:00:00Z",
                                "earliest_execution_at":"2025-03-03T14:30:00Z",
                                "targets":[{"symbol":"AAA","action":"EXIT",
                                            "target_budget_cents":0}]}}
        })
        d=replay(f)
        self.assertEqual(d["proxy_fills"],2)
        self.assertEqual(d["fills"][-1]["side"],"sell")
        self.assertEqual(d["fills"][-1]["cash_delta_cents"],12000)
        self.assertEqual(d["ending_equity_cents"],102000)
        self.assertEqual(d["equity_curve"][-1]["positions"],{})


if __name__ == "__main__":
    unittest.main()
