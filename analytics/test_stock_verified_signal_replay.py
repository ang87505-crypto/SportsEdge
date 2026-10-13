"""End-to-end synthetic stock research tests. No observed prices or claimed ROI."""
from copy import deepcopy
import unittest

from analytics.test_stock_momentum_v1 import fixture
from analytics.stock_momentum_v1 import generate, digest, VERSION
from analytics.stock_execution_planner import plan_run
from analytics.stock_verified_signal_replay import checked_replay, AUDIT_VERSION


def integrated_case(*, slippage_bps=10, fee_cents=25):
    inputs = fixture()
    signal = generate(**inputs)  # Real existing stock selection algorithm.
    assert signal["strategy_version"] == VERSION
    assert [x["symbol"] for x in signal["targets"]] == ["AAA", "BBB"]
    last = inputs["context"]["sessions"][-2]
    next_session = inputs["context"]["sessions"][-1]
    assert last["date"] == "2026-09-30"
    assert next_session["date"] == "2026-10-01"
    market = [{"symbol":s, "security_id":"id-" + s,
               "open":"30.00","close":"30.00"} for s in ("AAA","BBB")]
    cash = 100000
    historical = {
        "kind":"synthetic_fixture", "provider":"synthetic",
        "source_revision":"synthetic-parity-v1", "price_adjustment":"raw",
        "corporate_actions_coverage_complete":True,
        "initial_cash_cents":cash,
        "costs":{"slippage_bps":slippage_bps,"fee_cents":fee_cents},
        "sessions":[
            {"date":last["date"],"open_at":last["open_at"],"close_at":last["close_at"],
             "market":[{**m,"open":"45.20","close":"45.20"} for m in market],
             "actions":[]},
            {"date":next_session["date"],"open_at":next_session["open_at"],
             "close_at":next_session["close_at"],
             "market":market,"actions":[],
             "decision":{"published_at":"2026-10-01T12:00:01Z","signal":signal}}
        ],
    }
    bundle={"replay_input":historical,
            "signal_evidence":[{"signal_id":signal["signal_id"],
                                "generate_args":inputs}]}
    now="2026-10-01T13:30:25Z"
    account={"account_id":"synthetic-virtual-account", "revision":0,
             "cash_cents":cash, "positions":{}, "completed_signal_ids":[]}
    quotes={s:{"symbol":s,"quote_id":"synthetic-quote-"+s,"provider":"synthetic",
               "observed_at":"2026-10-01T13:30:10Z",
               "received_at":"2026-10-01T13:30:11Z",
               "bid":"30.00","ask":"30.00","tradable":True,
               "bid_size":500, "ask_size":500} for s in ("AAA","BBB")}
    costs={s:{"slippage_bps":str(slippage_bps),"fee_cents":fee_cents,
              "assumption_id":"synthetic-costs-v1"} for s in quotes}
    authorization={"mode":"paper","action":"run_once","actor_id":"synthetic-owner",
        "run_id":"synthetic-run-once","signal_id":signal["signal_id"],
        "signal_digest":digest(signal),"account_id":account["account_id"],
        "account_revision":0,"signal_published_at":"2026-10-01T12:00:01Z",
        "authorized_at":"2026-10-01T13:25:00Z",
        "expires_at":"2026-10-01T14:00:00Z",
        "max_buy_debit_cents":20000}
    planner={"signal":signal,"account":account,"quotes":quotes,"costs":costs,
             "authorization":authorization,"now":now,
             "session_open":next_session["open_at"],
             "session_close":next_session["close_at"]}
    return bundle,planner


class StockCrossModuleParityTests(unittest.TestCase):
    def test_exact_model_to_historical_ledger_replay(self):
        bundle, _=integrated_case()
        before=deepcopy(bundle)
        result=checked_replay(bundle)
        ledger=result["portfolio_scenario"]
        self.assertEqual(result["audit_version"],AUDIT_VERSION)
        self.assertEqual(result["recomputed_signals"],1)
        self.assertEqual(ledger["signals_executed"],1)
        self.assertEqual(ledger["proxy_fills"],2)
        self.assertEqual(ledger["equity_curve"][-1]["positions"],{"AAA":3,"BBB":3})
        self.assertEqual(ledger["initial_cash_cents"],100000)
        self.assertEqual(ledger["ending_equity_cents"],99932)
        self.assertEqual(ledger["net_pnl_cents"],-68)
        self.assertFalse(result["real_world_return_verified"])
        self.assertFalse(result["historical_fills_executable_verified"])
        self.assertFalse(result["historical_source_publication_verified"])
        self.assertEqual(bundle,before)
        self.assertEqual(checked_replay(bundle),result)

    def test_current_quote_planner_and_historical_open_proxy_agree(self):
        bundle,planner=integrated_case()
        backtest=checked_replay(bundle)["portfolio_scenario"]
        planned=plan_run(**planner)
        self.assertEqual(planned["status"],"planned_not_executed")
        self.assertEqual(backtest["proxy_fills"],len(planned["simulated_intents"]))
        for actual,projected in zip(backtest["fills"],planned["simulated_intents"]):
            self.assertEqual((actual["symbol"],actual["side"],actual["shares"],
                              actual["cash_delta_cents"]),
                             (projected["symbol"],projected["side"],projected["shares"],
                              projected["cash_delta_cents"]))
        self.assertEqual(planned["projected_after"]["cash_cents"],
                         backtest["equity_curve"][-1]["cash_cents"])
        self.assertEqual(planned["projected_after"]["equity_cents"],
                         backtest["ending_equity_cents"])
        self.assertEqual(planned["projected_positions"],
                         backtest["equity_curve"][-1]["positions"])

    def test_multiple_explicit_cost_assumptions_preserve_parity(self):
        for bps,fee in ((0,0),(10,25),(125,99)):
            with self.subTest(bps=bps,fee=fee):
                bundle,planner=integrated_case(slippage_bps=bps,fee_cents=fee)
                ledger=checked_replay(bundle)["portfolio_scenario"]
                projected=plan_run(**planner)
                self.assertEqual(
                    [(x["symbol"],x["shares"],x["cash_delta_cents"]) for x in ledger["fills"]],
                    [(x["symbol"],x["shares"],x["cash_delta_cents"])
                     for x in projected["simulated_intents"]])

    def test_tampered_model_targets_fail_even_if_id_left_unchanged(self):
        bundle,_=integrated_case()
        bundle["replay_input"]["sessions"][-1]["decision"]["signal"]["targets"][0]["target_budget_cents"]=9000
        with self.assertRaisesRegex(ValueError,"differs from recomputed"):
            checked_replay(bundle)

    def test_tampered_model_score_and_provenance_fail(self):
        for path in ("score","source"):
            with self.subTest(path=path):
                bundle,_=integrated_case()
                signal=bundle["replay_input"]["sessions"][-1]["decision"]["signal"]
                if path=="score":
                    signal["scores"][0]["momentum"]="999999"
                else:
                    signal["source_revision"]="tampered"
                with self.assertRaisesRegex(ValueError,"differs from recomputed"):
                    checked_replay(bundle)

    def test_model_recomputation_enforces_prior_known_bars(self):
        bundle,_=integrated_case()
        inputs=bundle["signal_evidence"][0]["generate_args"]
        # Source now says a last-month-end bar was available only after the
        # decision: recomputation must stop rather than use rewritten history.
        for r in inputs["payload"]["bars"]:
            if r["symbol"]=="AAA" and r["session_date"]=="2026-09-30":
                r["available_at"]="2026-10-01T12:00:00Z"
        with self.assertRaises(ValueError):
            checked_replay(bundle)

    def test_modifying_only_unseen_future_bars_leaves_decisions_unchanged(self):
        bundle,_=integrated_case()
        before=checked_replay(bundle)
        for b in bundle["signal_evidence"][0]["generate_args"]["payload"]["bars"]:
            if b["session_date"]=="2026-10-01":
                for k in ("open","high","low","close"):
                    b[k]="9999"
        self.assertEqual(checked_replay(bundle),before)

    def test_missing_or_unrelated_evidence_blocks_backtest(self):
        for edit in ("missing","extra","wrong_id"):
            with self.subTest(edit=edit):
                bundle,_=integrated_case()
                if edit=="missing":
                    bundle["signal_evidence"]=[]
                elif edit=="extra":
                    bundle["signal_evidence"].append(deepcopy(bundle["signal_evidence"][0]))
                else:
                    bundle["signal_evidence"][0]["signal_id"]="unrelated"
                with self.assertRaises(ValueError):
                    checked_replay(bundle)

    def test_retroactive_publication_after_open_blocks_execution(self):
        bundle,_=integrated_case()
        bundle["replay_input"]["sessions"][-1]["decision"]["published_at"]="2026-10-01T13:30:00Z"
        with self.assertRaisesRegex(ValueError,"future/same-close"):
            checked_replay(bundle)

    def test_signal_model_release_and_replay_outcome_separate(self):
        bundle,planner=integrated_case()
        self.assertEqual(planner["signal"]["fills"],[])
        self.assertEqual(planner["signal"]["performance_measured"],False)
        result=checked_replay(bundle)
        self.assertEqual(result["portfolio_scenario"]["status"],
            "exploratory_historical_price_scenario_not_verified_executable")
        self.assertIsNone(result["portfolio_scenario"]["benchmark"])
        self.assertFalse(result["point_in_time_stock_universe_verified"])


if __name__=="__main__":
    unittest.main()
