"""Synthetic fixtures only. No claimed historical prices or verified trades."""
import unittest
from copy import deepcopy
from decimal import Decimal
from analytics.stock_data_contract import StockDataError, parse_daily_bars, visible_at


def payload():
    return {
        "asset_class": "us_equities", "timeframe": "1d", "currency": "USD",
        "price_adjustment": "raw", "provider": "fixture-only",
        "source_revision": "synthetic-unit-test-v1", "retrieved_at": "2026-10-10T00:00:00Z",
        "bars": [{
            "symbol": "TEST", "session_date": "2026-10-08", "status": "complete",
            "completed_at": "2026-10-08T20:00:00Z", "available_at": "2026-10-08T20:01:00Z",
            "open": "20.00", "high": "22.00", "low": "19.00", "close": "21.50", "volume": 1000
        }, {
            "symbol": "TEST", "session_date": "2026-10-09", "status": "complete",
            "completed_at": "2026-10-09T20:00:00Z", "available_at": "2026-10-09T20:01:00Z",
            "open": "21.50", "high": "22.00", "low": "20.20", "close": "20.40", "volume": 2000
        }]
    }


class StockContractTests(unittest.TestCase):
    def test_valid_bars_preserve_decimal_precision_and_times(self):
        dataset = parse_daily_bars(payload())
        self.assertEqual(len(dataset.bars), 2)
        self.assertEqual(dataset.bars[0].close, Decimal("21.50"))
        self.assertEqual(dataset.provider, "fixture-only")

    def test_as_of_excludes_unavailable_and_same_instant(self):
        dataset = parse_daily_bars(payload())
        self.assertEqual(len(visible_at(dataset, "2026-10-08T20:01:00Z")), 0)
        self.assertEqual(len(visible_at(dataset, "2026-10-08T20:01:01Z")), 1)
        self.assertEqual(len(visible_at(dataset, "2026-10-09T20:00:59Z")), 1)
        self.assertEqual(len(visible_at(dataset, "2026-10-09T20:01:01Z")), 2)
        with self.assertRaises(StockDataError):
            visible_at(dataset, "2026-10-10T00:00:01Z")

    def test_shuffled_rows_are_sorted_not_dropped(self):
        case = payload()
        case["bars"].reverse()
        self.assertEqual(parse_daily_bars(case).bars[0].session_date.isoformat(), "2026-10-08")

    def test_identical_symbol_and_date_cannot_repeat(self):
        case = payload()
        case["bars"].append(deepcopy(case["bars"][0]))
        with self.assertRaises(StockDataError):
            parse_daily_bars(case)

    def test_raw_daily_us_equity_scope_is_frozen(self):
        for field, value in [("asset_class", "crypto"), ("timeframe", "1m"),
                             ("currency", "EUR"), ("price_adjustment", "split_adjusted")]:
            case = payload()
            case[field] = value
            with self.subTest(field=field), self.assertRaises(StockDataError):
                parse_daily_bars(case)

    def test_impossible_ohlc_and_malformed_prices_rejected(self):
        for field, value in [("high", "20.00"), ("low", "22.00"),
                             ("open", "NaN"), ("close", "1e2"),
                             ("close", "-1.00"), ("close", 21.50),
                             ("close", "21.1234567")]:
            case = payload()
            case["bars"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(StockDataError):
                parse_daily_bars(case)

    def test_stale_future_or_fabricated_availability_detected(self):
        for field, value in [("available_at", "2026-10-08T19:59:00Z"),
                             ("available_at", "2026-10-11T00:00:00Z"),
                             ("completed_at", "2026-10-09T20:00:00Z"),
                             ("completed_at", "2026-10-08T08:00:00Z"),
                             ("available_at", "2026-10-08T20:00:00")]:
            case = payload()
            case["bars"][0][field] = value
            with self.subTest(field=field), self.assertRaises(StockDataError):
                parse_daily_bars(case)

    def test_no_weekend_session_without_provider_audit(self):
        case = payload()
        case["bars"][0]["session_date"] = "2026-10-10"
        with self.assertRaises(StockDataError):
            parse_daily_bars(case)

    def test_malformed_tickers_and_volume(self):
        for field, value in [("symbol", "foo"), ("symbol", "TEST/US"),
                             ("symbol", "TE\\ST"), ("symbol", ""),
                             ("volume", -1), ("volume", 1.5), ("volume", True)]:
            case = payload()
            case["bars"][0][field] = value
            with self.subTest(field=field), self.assertRaises(StockDataError):
                parse_daily_bars(case)

    def test_missing_provider_revision_and_invalid_retrieval_timestamp(self):
        for field, value in [("provider", ""), ("source_revision", "   "),
                             ("retrieved_at", "2026-10-09T19:59:00Z"),
                             ("retrieved_at", "2026-10-10T00:00:00")]:
            case = payload()
            case[field] = value
            with self.subTest(field=field), self.assertRaises(StockDataError):
                parse_daily_bars(case)

    def test_complete_bars_and_strict_json_shape(self):
        for field, value in [("status", "partial"), ("volume", "1000"),
                             ("close", None)]:
            case = payload()
            case["bars"][0][field] = value
            with self.subTest(field=field), self.assertRaises(StockDataError):
                parse_daily_bars(case)
        for bars in ([], "not a list", None):
            case = payload()
            case["bars"] = bars
            with self.assertRaises(StockDataError):
                parse_daily_bars(case)


if __name__ == "__main__":
    unittest.main()
