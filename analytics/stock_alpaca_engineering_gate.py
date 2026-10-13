"""Offline Alpaca market-data archive gate for 2026 engineering diagnostics.

This never admits data to the registered historical stock evaluation, computes
no returns or orders, and makes no network calls. In particular 2017-2025 is
the registered sealed-test window and must not be consumed by this workflow.
"""
from __future__ import annotations
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
from .alpaca_history_archive import VERSION as ARCHIVE_VERSION, _day, _time, _hash_page, HistoricalSourceError

VERSION = "alpaca-2026-engineering-gate-v1"
SEALED_END = date(2025, 12, 31)


def require(condition, message):
    if not condition:
        raise HistoricalSourceError(message)


def assess(archive):
    """Check original page hashes and bounded provenance, NOT historical fitness."""
    require(isinstance(archive, dict), "Expected archived source object")
    require(archive.get("version") == ARCHIVE_VERSION and
            archive.get("provider") == "Alpaca Market Data API", "Wrong source/version")
    query = archive.get("query")
    require(isinstance(query, dict) and query.get("version") == ARCHIVE_VERSION,
            "Missing request plan")
    require(archive.get("price_adjustment") == "raw" and
            query.get("adjustment") == "raw", "Raw unadjusted bars required")
    feed = archive.get("feed")
    require(feed in ("sip", "iex") and feed == query.get("feed"),
            "Missing/contradictory source feed")
    first = _day(query.get("start"), "query.start")
    last = _day(query.get("end"), "query.end")
    require(first > SEALED_END and first <= last,
            "2026+ engineering data required; historical sealed set forbidden")
    captured = _time(archive.get("captured_at"), "captured_at")
    require(last <= captured.date(), "Capture predates requested bars")
    symbols = query.get("symbols")
    require(isinstance(symbols, list) and 1 <= len(symbols) <= 20 and
            all(isinstance(s, str) and s and s == s.upper() for s in symbols) and
            len(set(symbols)) == len(symbols), "Invalid declared symbols")
    require(all(archive.get(name) is False for name in (
        "stock_universe_point_in_time_verified",
        "action_coverage_independently_verified",
        "historical_availability_timestamps_verified",
        "simulated_trading_or_earnings_measured")),
        "Archive must not assert unsupported verification or investment returns")
    bars = archive.get("stock_bar_source_pages")
    actions = archive.get("corporate_action_source_pages")
    require(isinstance(bars, list) and len(bars) > 0 and
            isinstance(actions, list) and len(actions) > 0,
            "Missing bars or action-source pages")
    observed = {s: set() for s in symbols}
    covered_actions = set()
    for kind, pages in (("bars", bars), ("actions", actions)):
        for page in pages:
            require(isinstance(page, dict) and isinstance(page.get("payload"), dict),
                    "Malformed source page")
            require(page.get("page_sha256") == _hash_page(page["payload"]),
                    "Source page hash mismatch")
            args = page.get("query_without_page_token")
            require(isinstance(args, dict) and
                    args.get("start") == query["start"] and
                    args.get("end") == query["end"], "Mixed source periods")
            endpoint = page.get("endpoint")
            if kind == "bars":
                require(isinstance(endpoint, str) and
                        endpoint.startswith("/v2/stocks/") and endpoint.endswith("/bars"),
                        "Unexpected bars endpoint")
                symbol = endpoint[len("/v2/stocks/"):-len("/bars")]
                require(symbol in observed and args.get("feed") == feed and
                        args.get("adjustment") == "raw",
                        "Mixed symbols/feed/adjustments")
                rows = page["payload"].get("bars")
                require(isinstance(rows, list), "Missing bar rows")
                for row in rows:
                    require(isinstance(row, dict), "Malformed bar row")
                    session = _time(row.get("t"), "bar timestamp").date()
                    require(first <= session <= last, "Bar outside range")
                    require(session not in observed[symbol], "Duplicate symbol/session")
                    observed[symbol].add(session)
            else:
                require(endpoint == "/v1/corporate-actions" and
                        args.get("symbols") in observed,
                        "Unexpected corporate action query")
                covered_actions.add(args["symbols"])
    require(set(observed) == covered_actions and all(observed.values()),
            "Missing bars or corporate-action pages for declared symbols")
    require(sum(len(x) for x in observed.values()) == archive.get("distinct_daily_bars"),
            "Recorded bar count does not reconcile")
    return {
        "version": VERSION,
        "sample_kind": "2026_engineering_diagnostics_only",
        "feed_declared": feed,
        "range": [first.isoformat(), last.isoformat()],
        "per_symbol_observed_days": {s: len(observed[s]) for s in sorted(symbols)},
        "original_archive_sha256": hashlib.sha256(json.dumps(
            archive, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()).hexdigest(),
        "source_page_integrity": "passed",
        "declared_consolidated_feed": feed == "sip",
        "historical_backtest_ready": False,
        "performance": None,
        "blockers": [
            "not_registered_development_data",
            "point_in_time_full_universe_and_delisted_membership_unverified",
            "corporate_actions_and_late_publications_unreconciled",
            "exchange_calendar_and_decision_time_unverified",
            "no_strategy_returns_measured",
        ] + ([] if feed == "sip" else ["iex_not_consolidated_liquidity"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    require(not args.output.exists(), "Output exists; refusing overwrite")
    source = json.loads(args.archive.read_text(encoding="utf-8"))
    output = assess(source)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(output, stream, indent=2, allow_nan=False)
        stream.write("\n")


if __name__ == "__main__":
    main()
