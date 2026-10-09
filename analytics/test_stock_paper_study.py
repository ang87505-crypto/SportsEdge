import unittest
from datetime import datetime, timezone
from analytics.stock_paper_study import (
    STUDY_ID, STARTING_CASH_CENTS, InvalidStudy, evaluate, slippage_cents
)

AS_OF = datetime(2026, 10, 11, tzinfo=timezone.utc)

def envelope(*events):
    return {
        "study_id": STUDY_ID, "starting_cash_cents": STARTING_CASH_CENTS,
        "slippage_bps": 10, "events": list(events)
    }

def buy(**update):
    event = {
        "event_id": "evt-1", "side": "buy", "symbol": "TEST",
        "shares": 2, "reference_price_cents": 10000,
        "quote_id": "quote-1", "quote_source_url": "https://example.test/market/quote-1",
        "strategy_version": "example-only-model-v1", "signal_id": "example-signal-1",
        "signal_published_at": "2026-10-09T08:00:00Z",
        "quote_observed_at": "2026-10-09T08:00:01Z",
        "recorded_at": "2026-10-09T08:00:10Z"
    }
    event.update(update)
    return event

def sell(**update):
    event = buy(
        event_id="evt-2", side="sell", shares=1,
        quote_id="quote-2", signal_id="example-signal-2",
        reference_price_cents=11000,
        signal_published_at="2026-10-10T08:00:00Z",
        quote_observed_at="2026-10-10T08:00:01Z",
        recorded_at="2026-10-10T08:00:10Z"
    )
    event.update(update)
    return event

class StockPaperStudyTests(unittest.TestCase):
    def test_empty_1000_study_not_fake_performance(self):
        result = evaluate(envelope(), as_of=AS_OF)
        self.assertEqual(result["cash_cents"], 100000)
        self.assertEqual(result["recorded_events"], 0)
        self.assertEqual(result["realized_pnl_cents"], 0)
        self.assertIsNone(result["unrealized_pnl_cents"])
        self.assertIsNone(result["portfolio_return"])

    def test_deterministic_slippage_and_fifo_realized_profit(self):
        state = evaluate(envelope(buy(), sell()), as_of=AS_OF)
        self.assertEqual(slippage_cents(20000), 20)
        self.assertEqual(slippage_cents(11000), 11)
        self.assertEqual(state["cash_cents"], 90969)
        self.assertEqual(state["realized_pnl_cents"], 979)
        self.assertEqual(state["open_cost_cents"], 10010)
        self.assertEqual(state["total_slippage_cents"], 31)
        self.assertEqual(state["positions"], [{"symbol":"TEST","shares":1,"open_cost_cents":10010}])

    def test_full_closure_preserves_accounting_identity(self):
        result = evaluate(envelope(buy(), sell(shares=2)), as_of=AS_OF)
        self.assertEqual(result["open_cost_cents"], 0)
        self.assertEqual(result["positions"], [])
        self.assertEqual(result["cash_cents"], 101958)
        self.assertEqual(result["realized_pnl_cents"], 1958)

    def test_cannot_borrow_or_sell_unowned_shares(self):
        for event in [buy(shares=1000), sell(), buy(shares=0), buy(shares=-1)]:
            with self.subTest(event=event), self.assertRaises(InvalidStudy):
                evaluate(envelope(event), as_of=AS_OF)
        with self.assertRaises(InvalidStudy):
            evaluate(envelope(buy(), sell(shares=3)), as_of=AS_OF)

    def test_reject_bad_study_identity_or_funds(self):
        for edit in [{"study_id":"another"}, {"starting_cash_cents":1000000},
                     {"slippage_bps":0}]:
            payload=envelope()
            payload.update(edit)
            with self.assertRaises(InvalidStudy):
                evaluate(payload, as_of=AS_OF)

    def test_no_future_retroactive_or_stale_quotes(self):
        cases = [
            {"recorded_at":"2026-10-09T07:39:45Z"},
            {"recorded_at":"2026-10-12T08:00:01Z"},
            {"recorded_at":"2026-10-09T08:02:00Z"},
            {"quote_observed_at":"2026-10-09T08:00:20Z"},
            {"signal_published_at":"2026-10-09T08:00:20Z"},
            {"signal_published_at":"2026-10-09T07:39:45Z"},
            {"quote_source_url":"http://example.test/q"},
            {"quote_source_url":"https://user:secret@example.test/q"},
            {"quote_id":""}, {"strategy_version":""},
            {"symbol":"fake symbol"}, {"symbol":"TE\\\\ST"}, {"shares":1.25},
            {"reference_price_cents":2.25}, {"side":"short"}
        ]
        for update in cases:
            with self.subTest(update=update), self.assertRaises(InvalidStudy):
                evaluate(envelope(buy(**update)), as_of=AS_OF)

    def test_cannot_reuse_ids_or_backdate_events(self):
        with self.assertRaises(InvalidStudy):
            evaluate(envelope(buy(), buy()), as_of=AS_OF)
        with self.assertRaises(InvalidStudy):
            evaluate(envelope(buy(), sell(recorded_at="2026-10-09T07:50:00Z",
                                          quote_observed_at="2026-10-09T07:49:59Z",
                                          signal_published_at="2026-10-09T07:49:58Z")), as_of=AS_OF)

    def test_no_unverified_value_claim(self):
        state=evaluate(envelope(buy()), as_of=AS_OF)
        self.assertEqual(state["open_cost_cents"],20020)
        self.assertIsNone(state["portfolio_return"])
        self.assertIsNone(state["unrealized_pnl_cents"])

if __name__=="__main__": unittest.main()
