"""2026 Alpaca engineering gate: all sample records are synthetic and offline."""
from unittest import TestCase
from analytics.stock_alpaca_engineering_gate import assess
from analytics.alpaca_history_archive import archive, HistoricalSourceError


def fixture(feed="sip"):
    def get(url, headers):
        if "/v2/stocks/" in url:
            return {"bars": [{"t": "2026-03-02T21:00:00Z", "o": 10,
                              "h": 12, "l": 9, "c": 11, "v": 2000000}],
                    "next_page_token": None}
        return {"corporate_actions": {}, "next_page_token": None}
    return archive(symbols=["AAA"], start="2026-03-02", end="2026-03-03",
                   asof="2026-03-03", feed=feed, max_requests=3,
                   key_id="synthetic", secret_key="synthetic",
                   captured_at="2026-03-04T00:00:00Z", get=get)


class AlpacaEngineeringGateTests(TestCase):
    def test_sip_is_never_a_historical_backtest_admission(self):
        report = assess(fixture())
        self.assertEqual(report["source_page_integrity"], "passed")
        self.assertEqual(report["per_symbol_observed_days"], {"AAA": 1})
        self.assertTrue(report["declared_consolidated_feed"])
        self.assertFalse(report["historical_backtest_ready"])
        self.assertIsNone(report["performance"])

    def test_iex_is_not_full_market_liquidity(self):
        report = assess(fixture("iex"))
        self.assertFalse(report["declared_consolidated_feed"])
        self.assertIn("iex_not_consolidated_liquidity", report["blockers"])

    def test_rejects_tampered_source_pages(self):
        raw = fixture()
        raw["stock_bar_source_pages"][0]["payload"]["bars"][0]["c"] = 999
        with self.assertRaisesRegex(HistoricalSourceError, "hash mismatch"):
            assess(raw)

    def test_rejects_sealed_period_instead_of_peeking(self):
        raw = fixture()
        raw["query"]["start"] = "2024-01-01"
        with self.assertRaisesRegex(HistoricalSourceError, "sealed set forbidden"):
            assess(raw)

    def test_rejects_contradictory_feed_and_fake_profitability(self):
        raw = fixture()
        raw["query"]["feed"] = "iex"
        with self.assertRaisesRegex(HistoricalSourceError, "feed"):
            assess(raw)
        raw = fixture()
        raw["simulated_trading_or_earnings_measured"] = True
        with self.assertRaisesRegex(HistoricalSourceError, "unsupported verification"):
            assess(raw)

    def test_rejects_missing_action_pages(self):
        raw = fixture()
        raw["corporate_action_source_pages"] = []
        with self.assertRaisesRegex(HistoricalSourceError, "Missing bars"):
            assess(raw)

    def test_deterministic(self):
        self.assertEqual(assess(fixture()), assess(fixture()))
