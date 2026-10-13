"""Offline Alpaca API fixtures only; tests NEVER call a market data provider."""
from copy import deepcopy
from urllib.parse import urlsplit, parse_qs
from unittest.mock import patch
import contextlib
import io
import sys
import unittest
from analytics.alpaca_history_archive import archive, plan, main, HistoricalSourceError

START = "2026-10-08"
END = "2026-10-09"
ASOF = "2026-10-09"
CAPTURED = "2026-10-11T21:00:00Z"

def bar(date="2026-10-08", **changes):
    from datetime import date as D, datetime, timezone
    from zoneinfo import ZoneInfo
    d = D.fromisoformat(date)
    local = datetime(d.year, d.month, d.day, 0, 0, tzinfo=ZoneInfo("America/New_York"))
    return {"t":local.astimezone(timezone.utc).isoformat(), "o":100.0, "h":105.0,
            "l":99.0, "c":102.5, "v":2_000_000, **changes}

def query(**changes):
    return {"symbols":["AAA"],"start":START,"end":END,"asof":ASOF,
            "feed":"iex","max_requests":5,
            "key_id":"test-only-private-id","secret_key":"test-only-private-secret",
            "captured_at":CAPTURED,**changes}

class Recorder:
    def __init__(self, pages=None):
        self.calls=[]
        self.pages=pages if pages is not None else [
            {"bars":[bar()],"next_page_token":None},
            {"corporate_actions":{},"next_page_token":None}
        ]
    def __call__(self, url, headers):
        self.calls.append((url,dict(headers)))
        if len(self.calls)>len(self.pages):
            raise AssertionError("Unexpected extra external provider request")
        return deepcopy(self.pages[len(self.calls)-1])

class AlpacaHistoryArchiveTests(unittest.TestCase):
    def test_planning_needs_no_account_or_network(self):
        x=plan(["AAA"],start=START,end=END,asof=ASOF,feed="iex",max_requests=2)
        self.assertEqual(x["minimum_http_requests"],2)
        self.assertIs(x["provider_cost_known"],False)
        self.assertEqual(x["mode"],"plan_only_no_network")
        with patch.object(sys,"argv",["test","--symbols","AAA","--start",START,
               "--end",END,"--asof",ASOF,"--feed","iex","--max-requests","2"]):
            out=io.StringIO()
            with contextlib.redirect_stdout(out):
                main()
            self.assertIn("PLAN ONLY",out.getvalue())

    def test_one_symbol_preserves_source_pages_and_reports_unverified_fields(self):
        rec=Recorder()
        output=archive(**query(),get=rec)
        self.assertEqual(len(rec.calls),2)
        self.assertEqual(output["http_requests_completed"],2)
        self.assertEqual(output["distinct_daily_bars"],1)
        self.assertFalse(output["historical_availability_timestamps_verified"])
        self.assertFalse(output["stock_universe_point_in_time_verified"])
        self.assertFalse(output["action_coverage_independently_verified"])
        self.assertFalse(output["simulated_trading_or_earnings_measured"])
        self.assertEqual(output["stock_bar_source_pages"][0]["payload"]["bars"][0]["c"],102.5)
        self.assertNotIn("test-only-private-id",str(output))
        self.assertNotIn("test-only-private-secret",str(output))
        self.assertEqual(output["source_revision"],archive(**query(),get=Recorder())["source_revision"])
        url,headers=rec.calls[0]
        self.assertTrue(url.startswith("https://data.alpaca.markets/v2/stocks/AAA/bars?"))
        self.assertEqual(parse_qs(urlsplit(url).query)["adjustment"],["raw"])
        self.assertEqual(parse_qs(urlsplit(url).query)["feed"],["iex"])
        self.assertEqual(headers["APCA-API-KEY-ID"],"test-only-private-id")

    def test_two_paged_market_responses_are_not_truncated(self):
        pages=[
            {"bars":[bar()],"next_page_token":"bar-page-2"},
            {"bars":[bar("2026-10-09")],"next_page_token":None},
            {"corporate_actions":{},"next_page_token":"corp-page-2"},
            {"corporate_actions":{"cash_dividends":[{"id":"fixture-cash"}]},"next_page_token":None}
        ]
        rec=Recorder(pages)
        x=archive(**query(),get=rec)
        self.assertEqual(x["http_requests_completed"],4)
        self.assertEqual(x["distinct_daily_bars"],2)
        self.assertEqual(len(x["stock_bar_source_pages"]),2)
        self.assertEqual(len(x["corporate_action_source_pages"]),2)
        self.assertIn("page_token=bar-page-2",rec.calls[1][0])
        self.assertIn("page_token=corp-page-2",rec.calls[3][0])

    def test_provider_request_cap_never_returns_partial_success(self):
        rec=Recorder([
            {"bars":[bar()],"next_page_token":"another"},
            {"bars":[bar("2026-10-09")],"next_page_token":"one-more"}
        ])
        with self.assertRaisesRegex(HistoricalSourceError,"cap reached"):
            archive(**query(max_requests=2),get=rec)
        self.assertEqual(len(rec.calls),2)

    def test_repeated_page_token_fails_closed(self):
        rec=Recorder([
            {"bars":[bar()],"next_page_token":"same"},
            {"bars":[bar("2026-10-09")],"next_page_token":"same"}
        ])
        with self.assertRaisesRegex(HistoricalSourceError,"Repeated pagination"):
            archive(**query(),get=rec)

    def test_duplicate_bar_in_same_source_or_across_pages_rejected(self):
        rec=Recorder([{"bars":[bar(),bar()],"next_page_token":None}])
        with self.assertRaisesRegex(HistoricalSourceError,"Duplicate daily"):
            archive(**query(),get=rec)
        rec=Recorder([
            {"bars":[bar()],"next_page_token":"second"},
            {"bars":[bar()],"next_page_token":None}
        ])
        with self.assertRaisesRegex(HistoricalSourceError,"Duplicate daily"):
            archive(**query(),get=rec)

    def test_strict_source_data_validation(self):
        broken=[
            {"v":-1},{"o":-10},{"o":3,"h":2},{"c":"NaN"},
            {"t":"2030-01-01T00:00:00Z"},{"t":"tomorrow"},
            {"l":200}, {"h":0}, {"v":1.5}
        ]
        for change in broken:
            with self.subTest(change=change):
                rec=Recorder([{"bars":[bar(**change)],"next_page_token":None}])
                with self.assertRaises(HistoricalSourceError):
                    archive(**query(),get=rec)

    def test_invalid_identity_or_date_does_not_call_api(self):
        cases=[
            {"symbols":["aaa"]},{"symbols":["AAA","AAA"]},
            {"symbols":["AAA","BBB"],"max_requests":2},
            {"asof":"2020-01-01"},{"start":"2026-10-10"},
            {"feed":"unlicensed"},{"end":"2035-10-09"}
        ]
        for changes in cases:
            with self.subTest(changes=changes):
                rec=Recorder()
                with self.assertRaises(HistoricalSourceError):
                    archive(**query(**changes),get=rec)
                self.assertEqual(rec.calls,[])

    def test_unauthenticated_archive_stops_before_network(self):
        rec=Recorder()
        with self.assertRaisesRegex(HistoricalSourceError,"Missing server-only"):
            archive(**query(key_id=""),get=rec)
        self.assertEqual(rec.calls,[])

    def test_unexpected_provider_response_never_claims_coverage(self):
        for bad in ({},[],{"bars":"not an array"},{"bars":[],"next_page_token":88}):
            with self.subTest(bad=bad):
                rec=Recorder([bad])
                with self.assertRaises(HistoricalSourceError):
                    archive(**query(),get=rec)
        rec=Recorder([
            {"bars":[bar()],"next_page_token":None},
            {"corporate_actions":[],"next_page_token":None}
        ])
        with self.assertRaisesRegex(HistoricalSourceError,"corporate"):
            archive(**query(),get=rec)

    def test_do_not_silently_accept_no_source_bars(self):
        rec=Recorder([
            {"bars":[],"next_page_token":None},
            {"corporate_actions":{},"next_page_token":None}
        ])
        with self.assertRaisesRegex(HistoricalSourceError,"No historical bars"):
            archive(**query(),get=rec)

if __name__=="__main__":
    unittest.main()
