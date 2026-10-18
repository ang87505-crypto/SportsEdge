"""Adversarial fake-LEAN 253-session RAW lookback tests; no provider secrets/data."""
from datetime import date, datetime, timedelta
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

from integrations.quantconnect.lean_history_source_v1 import SourceNotAdmitted
from integrations.quantconnect.lean_reviewed_lookback_v1 import (
    read_reviewed_lookback, REQUIRED_SESSIONS, PAGE_DAYS)


def days(start=date(2000, 1, 3), count=253, skip=None):
    result = []
    day = start
    while len(result) < count:
        if day.weekday() < 5 and day != skip:
            result.append(day.isoformat())
        day += timedelta(days=1)
    return result


DATES = days()
SYMBOL = types.SimpleNamespace(value="SPY", id="SPY_SECURITY_ID")
AT = datetime(2001, 2, 2, 8)
IMPORTS = types.ModuleType("AlgorithmImports")
IMPORTS.Resolution = types.SimpleNamespace(DAILY="DAILY")
IMPORTS.DataNormalizationMode = types.SimpleNamespace(RAW="RAW")


class Frame:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        yield from self.rows


class FakeAlgorithm:
    def __init__(self, observed, *, missing=None, extra=None):
        self.observed = list(observed)
        self.missing = missing
        self.extra = extra
        self.calls = []

    def history(self, symbols, start, end, **kwargs):
        self.calls.append((symbols, start, end, kwargs))
        actual = [d for d in self.observed if start.date() <= d < end.date()]
        if self.missing in actual:
            actual.remove(self.missing)
        if self.extra is not None and start.date() <= self.extra < end.date():
            actual.append(self.extra)
        actual.sort()
        return Frame([
            ((SYMBOL.value, datetime.combine(d, datetime.min.time()).replace(hour=16)),
             dict(open="101", high="102", low="99", close="100", volume="25000"))
            for d in actual])


def run(algorithm, sessions=DATES, at=AT):
    with patch.dict(sys.modules, {"AlgorithmImports": IMPORTS}):
        return read_reviewed_lookback(
            algorithm, SYMBOL, expected_sessions=sessions, decision_at=at)


class ReviewedLookbackTests(unittest.TestCase):
    def test_full_253_session_source_reconciliation_with_raw_pages(self):
        algorithm = FakeAlgorithm([date.fromisoformat(x) for x in DATES])
        result = run(algorithm)
        self.assertEqual(len(result["bars"]), REQUIRED_SESSIONS)
        self.assertEqual([r["session_date"] for r in result["bars"]], DATES)
        self.assertEqual(result["bounded_pages"], len(algorithm.calls))
        self.assertGreater(len(algorithm.calls), 2)
        self.assertLessEqual(len(algorithm.calls), 15)
        self.assertTrue(all((end - start).days <= PAGE_DAYS
                            for _, start, end, _ in algorithm.calls))
        self.assertTrue(all(kwargs["data_normalization_mode"] == "RAW"
                            and kwargs["fill_forward"] is False
                            and kwargs["extended_market_hours"] is False
                            for _, _, _, kwargs in algorithm.calls))
        self.assertFalse(result["expected_calendar_independently_verified"])
        self.assertFalse(result["historical_source_admitted"])
        self.assertFalse(result["strategy_backtest_completed"])
        self.assertIsNone(result["performance"])

    def test_missing_real_session_cannot_be_silently_skipped(self):
        algorithm = FakeAlgorithm([date.fromisoformat(x) for x in DATES],
                                  missing=date.fromisoformat(DATES[66]))
        with self.assertRaisesRegex(SourceNotAdmitted, "Missing/extra/reordered"):
            run(algorithm)

    def test_extra_real_session_conflicting_with_calendar_is_rejected(self):
        skip = date(2000, 1, 17)
        listing = days(skip=skip)
        algorithm = FakeAlgorithm([date.fromisoformat(x) for x in listing], extra=skip)
        with self.assertRaisesRegex(SourceNotAdmitted, "Missing/extra/reordered"):
            run(algorithm, listing)

    def test_duplicate_and_unsorted_or_partial_expected_sessions_rejected_before_api(self):
        invalid = (DATES[:-1], [DATES[0]] * REQUIRED_SESSIONS,
                   list(reversed(DATES)), DATES[:-1] + ["not-a-day"],
                   DATES[:-1] + ["2000-01-02"])
        for entries in invalid:
            with self.subTest(entries=entries[-1]):
                algorithm = FakeAlgorithm([date.fromisoformat(x) for x in DATES])
                with self.assertRaises(SourceNotAdmitted):
                    run(algorithm, entries)
                self.assertEqual(algorithm.calls, [])

    def test_decision_at_8_and_after_last_session_required(self):
        for decision in (AT.replace(hour=9),
                         datetime.fromisoformat(DATES[-1] + "T08:00:00")):
            algorithm = FakeAlgorithm([date.fromisoformat(x) for x in DATES])
            with self.subTest(decision=decision), self.assertRaises(SourceNotAdmitted):
                run(algorithm, at=decision)
            self.assertEqual(algorithm.calls, [])

    def test_no_trade_export_or_source_approval_shortcuts(self):
        script = Path(__file__).with_name("lean_reviewed_lookback_v1.py").read_text()
        for banned in ("market_order(", "set_holdings(", "liquidate(",
                       "requests.", "urlopen(", "json.dump(", "object_store."):
            self.assertNotIn(banned, script)


if __name__ == "__main__":
    unittest.main()
