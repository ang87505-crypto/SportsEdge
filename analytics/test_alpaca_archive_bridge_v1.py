"""Only synthetic Alpaca responses. All tests are offline and never trade."""
from copy import deepcopy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from analytics.alpaca_history_archive import archive, _hash_page
from analytics.alpaca_archive_bridge_v1 import (
    ArchiveBridgeError, bridge_archive, main,
)


def bar(day: str, price: float = 100.0):
    # Alpaca daily bars are timestamped at NY session midnight.
    from datetime import date
    from zoneinfo import ZoneInfo
    d = date.fromisoformat(day)
    t = datetime(d.year, d.month, d.day, tzinfo=ZoneInfo("America/New_York"))
    return {"t": t.astimezone(timezone.utc).isoformat(), "o": price,
            "h": price + 1, "l": price - 1, "c": price, "v": 4000000}


def fixture():
    def provider(url, _headers):
        route = urlsplit(url).path
        if route.endswith("/bars"):
            symbol = route.split("/")[-2]
            return {"bars": ([bar("2026-10-08"), bar("2026-10-09")]
                            if symbol == "AAA" else [bar("2026-10-08", 55.0)]),
                    "next_page_token": None}
        if route.endswith("/corporate-actions"):
            return {"corporate_actions": {}, "next_page_token": None}
        raise AssertionError("Unexpected provider route")
    return archive(symbols=["AAA", "BBB"], start="2026-10-08", end="2026-10-09",
                   asof="2026-10-09", feed="iex", max_requests=4,
                   key_id="offline-test-key-only", secret_key="offline-test-secret-only",
                   captured_at="2026-10-11T21:00:00Z", get=provider)


def resign(x):
    """Simulates altered original JSON with correctly recomputed source hashes."""
    for key in ("stock_bar_source_pages", "corporate_action_source_pages"):
        for p in x[key]:
            p["page_sha256"] = _hash_page(p["payload"])
    x["source_revision"] = "alpaca-pages-" + _hash_page({
        "bars": x["stock_bar_source_pages"],
        "actions": x["corporate_action_source_pages"],
    })


class ArchiveBridgeTests(unittest.TestCase):
    def test_real_archive_contract_is_normalized_without_imaginary_visibility(self):
        source = fixture()
        result = bridge_archive(source)
        self.assertEqual(result["bar_count"], 3)
        self.assertEqual(result["requested_symbols"], ["AAA", "BBB"])
        self.assertEqual(result["cross_symbol_session_gaps"], {"AAA": [], "BBB": ["2026-10-09"]})
        self.assertEqual(result["raw_bars"][0]["symbol"], "AAA")
        self.assertEqual(result["raw_bars"][-1]["session_date"], "2026-10-09")
        self.assertEqual(result["raw_bars"][0]["open"], "100.0")
        self.assertFalse(result["historical_availability_verified"])
        self.assertFalse(result["point_in_time_universe_verified"])
        self.assertFalse(result["historical_backtest_ready"])
        self.assertIsNone(result["performance"])
        self.assertNotIn("available_at", result["raw_bars"][0])
        self.assertNotIn("security_id", result["raw_bars"][0])
        self.assertNotIn("offline-test-secret-only", json.dumps(result))

    def test_output_is_deterministic_for_same_archive(self):
        source = fixture()
        self.assertEqual(bridge_archive(source), bridge_archive(deepcopy(source)))

    def test_tampered_page_fails_even_if_outer_archive_not_modified(self):
        source = fixture()
        source["stock_bar_source_pages"][0]["payload"]["bars"][0]["c"] = 42
        with self.assertRaisesRegex(ArchiveBridgeError, "hash mismatch"):
            bridge_archive(source)

    def test_tampered_global_digest_fails(self):
        source = fixture()
        source["source_revision"] = "alpaca-pages-" + ("0" * 64)
        with self.assertRaisesRegex(ArchiveBridgeError, "revision mismatch"):
            bridge_archive(source)

    def test_valid_hashes_do_not_hide_missing_stock_pages(self):
        source = fixture()
        source["stock_bar_source_pages"].pop()
        source["http_requests_completed"] -= 1
        source["distinct_daily_bars"] = 2
        resign(source)
        with self.assertRaisesRegex(ArchiveBridgeError, "Missing source pages"):
            bridge_archive(source)

    def test_valid_hashes_do_not_hide_missing_action_pages(self):
        source = fixture()
        source["corporate_action_source_pages"].pop()
        source["http_requests_completed"] -= 1
        resign(source)
        with self.assertRaisesRegex(ArchiveBridgeError, "Missing source pages"):
            bridge_archive(source)

    def test_provider_query_must_match_original_authorized_plan(self):
        source = fixture()
        source["stock_bar_source_pages"][0]["query_without_page_token"]["feed"] = "sip"
        resign(source)
        with self.assertRaisesRegex(ArchiveBridgeError, "Source query"):
            bridge_archive(source)

    def test_unknown_corporate_action_source_query_rejected(self):
        source = fixture()
        source["corporate_action_source_pages"][0]["query_without_page_token"]["symbols"] = "CCC"
        resign(source)
        with self.assertRaisesRegex(ArchiveBridgeError, "Unexpected corporate action source query"):
            bridge_archive(source)

    def test_rehashed_duplicate_daily_bar_is_still_rejected(self):
        source = fixture()
        source["stock_bar_source_pages"][0]["payload"]["bars"].append(
            deepcopy(source["stock_bar_source_pages"][0]["payload"]["bars"][0]))
        resign(source)
        with self.assertRaisesRegex(ArchiveBridgeError, "Duplicate daily"):
            bridge_archive(source)

    def test_unsupported_action_category_structure_fails(self):
        source = fixture()
        source["corporate_action_source_pages"][0]["payload"]["corporate_actions"] = {
            "splits": {"unverified": "unexpected"}}
        resign(source)
        with self.assertRaisesRegex(ArchiveBridgeError, "Malformed corporate action"):
            bridge_archive(source)

    def test_present_actions_remain_unverified_not_ignored(self):
        source = fixture()
        source["corporate_action_source_pages"][0]["payload"]["corporate_actions"] = {
            "splits": [{"id": "synthetic-only"}]}
        resign(source)
        x = bridge_archive(source)
        self.assertEqual(x["per_symbol"]["AAA"]["corporate_action_categories"]["splits"], 1)
        self.assertFalse(x["corporate_actions_independently_verified"])

    def test_pagination_cannot_have_unfinished_last_page(self):
        source = fixture()
        source["stock_bar_source_pages"][0]["payload"]["next_page_token"] = "missing"
        resign(source)
        with self.assertRaisesRegex(ArchiveBridgeError, "pagination incomplete"):
            bridge_archive(source)

    def test_archive_count_and_unverified_flags_are_enforced(self):
        source = fixture()
        source["distinct_daily_bars"] = 4
        with self.assertRaisesRegex(ArchiveBridgeError, "bar count mismatch"):
            bridge_archive(source)
        source = fixture()
        source["historical_availability_timestamps_verified"] = True
        with self.assertRaisesRegex(ArchiveBridgeError, "flags"):
            bridge_archive(source)

    def test_read_only_cli_refuses_output_overwrite_and_never_uses_network(self):
        source = fixture()
        with TemporaryDirectory() as folder:
            root = Path(folder)
            inp, out = root / "archive.json", root / "bridge.json"
            inp.write_text(json.dumps(source), encoding="utf-8")
            args = ["bridge", "--archive", str(inp), "--output", str(out)]
            with patch.object(sys, "argv", args), patch("sys.stdout", new_callable=io.StringIO):
                main()
            self.assertEqual(json.loads(out.read_text())["bar_count"], 3)
            with patch.object(sys, "argv", args):
                with self.assertRaises(SystemExit):
                    main()
            self.assertEqual(json.loads(out.read_text())["bar_count"], 3)


if __name__ == "__main__":
    unittest.main()
