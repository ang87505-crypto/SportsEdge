"""Offline contract tests for the in-QuantConnect raw daily history reader.

No market data is downloaded and no trading API is available in these tests.
"""
from datetime import datetime, timedelta
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from integrations.quantconnect.lean_history_source_v1 import (
    SourceNotAdmitted, read_raw_window, MAX_WINDOW_DAYS)


def row(open_="10", high="11", low="9", close="10.5", volume="100"):
    return dict(open=open_, high=high, low=low, close=close, volume=volume)


def entry(day, *, ticker="AAPL", price=None):
    return ((ticker, datetime(2000, 1, day, 16)), price if price is not None else row())


class FakeFrame:
    def __init__(self, entries):
        self.entries = entries

    def iterrows(self):
        yield from self.entries


class FakeAlgorithm:
    def __init__(self, entries):
        self.entries = entries
        self.requests = []

    def history(self, **kwargs):
        self.requests.append(kwargs)
        return FakeFrame(self.entries)


SYMBOL = types.SimpleNamespace(value="AAPL", id="SID_AAPL")
FROM = datetime(2000, 1, 1)
TO = datetime(2000, 1, 20)
AT = datetime(2000, 2, 1, 8)
fake_imports = types.ModuleType("AlgorithmImports")
fake_imports.Resolution = types.SimpleNamespace(DAILY="daily")
fake_imports.DataNormalizationMode = types.SimpleNamespace(RAW="raw")


def collect(rows, **kwargs):
    algo = FakeAlgorithm(rows)
    with patch.dict(sys.modules, {"AlgorithmImports": fake_imports}):
        result = read_raw_window(algo, SYMBOL, start=FROM, end=TO,
                                 decision_at=AT, **kwargs)
    return algo, result


class CloudHistorySourceTests(unittest.TestCase):
    def test_requests_raw_non_fill_forward_daily_and_fails_closed(self):
        algo, result = collect([entry(3), entry(4)])
        self.assertEqual(algo.requests[0]["data_normalization_mode"], "raw")
        self.assertEqual(algo.requests[0]["resolution"], "daily")
        self.assertEqual(algo.requests[0]["fill_forward"], False)
        self.assertEqual(algo.requests[0]["extended_market_hours"], False)
        self.assertEqual(algo.requests[0]["symbols"], [SYMBOL])
        self.assertEqual(result["bars"][0]["open"], "10")
        self.assertEqual(result["bars"][0]["volume"], 100)
        self.assertFalse(result["bar_publication_time_verified"])
        self.assertFalse(result["historical_source_admitted"])
        self.assertFalse(result["strategy_backtest_completed"])
        self.assertIsNone(result["performance"])

    def test_stable_security_identity_required(self):
        for bad in (types.SimpleNamespace(value="AAPL", id=""),
                    types.SimpleNamespace(value="AAPL/ALT", id="SID"),
                    types.SimpleNamespace(value="", id="SID")):
            with self.subTest(bad=bad), self.assertRaises(SourceNotAdmitted):
                with patch.dict(sys.modules, {"AlgorithmImports": fake_imports}):
                    read_raw_window(FakeAlgorithm([entry(3)]), bad,
                                    start=FROM, end=TO, decision_at=AT)

    def test_future_unbounded_and_intraday_requests_fail_before_provider(self):
        bad = [
            (FROM, datetime(2000, 2, 2), AT),
            (FROM, FROM + timedelta(days=MAX_WINDOW_DAYS + 1), AT + timedelta(days=99)),
            (FROM, TO, AT.replace(hour=9)),
            (FROM.replace(hour=9), TO, AT),
            (TO, FROM, AT),
        ]
        for start, end, at in bad:
            algo = FakeAlgorithm([entry(3)])
            with self.subTest(start=start, end=end, at=at), self.assertRaises(SourceNotAdmitted):
                with patch.dict(sys.modules, {"AlgorithmImports": fake_imports}):
                    read_raw_window(algo, SYMBOL, start=start, end=end, decision_at=at)
            self.assertFalse(algo.requests)

    def test_missing_and_duplicate_bars_are_not_filled(self):
        for items in ([], [entry(3), entry(3)],
                      [entry(4), entry(3)], [entry(3), entry(22)],
                      [entry(3), entry(8, ticker="MSFT")]):
            with self.subTest(items=items), self.assertRaises(SourceNotAdmitted):
                collect(items)

    def test_nonfinite_price_invalid_ohlc_and_volume_rejected(self):
        bad = [
            row(open_="NaN"),
            row(open_="10", high="9", low="8", close="10"),
            row(low="10.6"),
            row(volume="-1"),
            row(volume="3.5"),
            row(volume="Infinity"),
            {"open": "10", "high": "11", "low": "9", "close": "10"},
        ]
        for x in bad:
            with self.subTest(x=x), self.assertRaises(SourceNotAdmitted):
                collect([entry(3, price=x)])

    def test_provider_failure_does_not_retry_with_unsafe_defaults(self):
        class ProviderRaises:
            count = 0
            def history(self, **kwargs):
                self.count += 1
                raise TypeError("No compatible raw history signature")
        obj = ProviderRaises()
        with self.assertRaises(TypeError):
            with patch.dict(sys.modules, {"AlgorithmImports": fake_imports}):
                read_raw_window(obj, SYMBOL, start=FROM, end=TO, decision_at=AT)
        self.assertEqual(obj.count, 1)

    def test_wrong_security_id_in_index_rejected(self):
        other = types.SimpleNamespace(value="AAPL", id="SOME_OTHER_SECURITY")
        with self.assertRaisesRegex(SourceNotAdmitted, "Wrong historical security ID"):
            collect([((other, datetime(2000, 1, 3, 16)), row())])

    def test_weekend_and_future_date_rejected(self):
        with self.assertRaisesRegex(SourceNotAdmitted, "weekend"):
            collect([entry(2)])  # Sunday, 2000-01-02

    def test_no_broker_order_export_or_result_publication_code(self):
        contents = Path(__file__).with_name("lean_history_source_v1.py").read_text()
        for forbidden in (
            ".market_order(", ".set_holdings(", ".liquidate(", ".download(",
            ".object_store.save(", "requests.post(", "urlopen(", "json.dump(",
        ):
            self.assertNotIn(forbidden, contents)


if __name__ == "__main__":
    unittest.main()
