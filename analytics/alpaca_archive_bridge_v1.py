"""Offline, read-only bridge from SportsEdge's Alpaca archive to research evidence.

This is intentionally NOT an as-of price contract or a performance engine.
Alpaca's raw bar timestamps do not prove historical publication time; an as-of
universe, actions, calendar and other source reviews are still required.
"""
from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
from typing import Any

from .alpaca_history_archive import (
    VERSION as ARCHIVE_VERSION, _check_bar, _day, _hash_page, _time,
    _number, plan,
)

VERSION = "alpaca-archive-evidence-bridge-v1"
MAX_ARCHIVE_BYTES = 64_000_000
MAX_PAGES = 50
MAX_BARS = 200_000


class ArchiveBridgeError(ValueError):
    """Invalid, incomplete or inconsistent source archive."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ArchiveBridgeError(message)


def _pages(raw: Any, label: str) -> list[dict]:
    require(isinstance(raw, list) and 0 < len(raw) <= MAX_PAGES,
            label + ": invalid page count")
    for page in raw:
        require(isinstance(page, dict) and
                set(page) == {"endpoint", "query_without_page_token",
                              "page_sha256", "payload"},
                label + ": invalid page envelope")
        require(isinstance(page["payload"], dict) and
                isinstance(page["page_sha256"], str) and
                page["page_sha256"] == _hash_page(page["payload"]),
                label + ": source page hash mismatch")
    return raw


def _group_pages(pages: list[dict], symbol: str, endpoint: str,
                 expected_query: dict) -> list[dict]:
    group = [p for p in pages if p["endpoint"] == endpoint]
    require(bool(group), "Missing source pages for " + symbol)
    require(all(p["query_without_page_token"] == expected_query for p in group),
            "Source query does not match archive configuration")
    # The archive records the prior page's next token, not the subsequent
    # request's page_token. Hence order, token transitions and final null
    # cursor must all be checked from the stored sequence.
    seen_tokens = set()
    for i, page in enumerate(group):
        token = page["payload"].get("next_page_token")
        if i < len(group) - 1:
            require(isinstance(token, str) and bool(token) and
                    token not in seen_tokens, "Missing/reused pagination cursor")
            seen_tokens.add(token)
        else:
            require(token is None, "Source pagination incomplete")
    return group


def bridge_archive(archive: Any) -> dict:
    """Validate an archive and expose raw, UNADMITTED historical bar evidence.

    An output row has no 'available_at' because the source did not prove it.
    This function never calls a broker/provider or computes returns.
    """
    require(isinstance(archive, dict), "Archive must be a JSON object")
    require(archive.get("version") == ARCHIVE_VERSION and
            archive.get("purpose") == "archived_provider_responses_for_manual_audit" and
            archive.get("provider") == "Alpaca Market Data API",
            "Unexpected archive identity")
    require(archive.get("price_adjustment") == "raw" and
            archive.get("feed") in ("iex", "sip"),
            "Unadjusted equity bars and explicit feed required")
    for name in ("stock_universe_point_in_time_verified",
                 "action_coverage_independently_verified",
                 "historical_availability_timestamps_verified",
                 "simulated_trading_or_earnings_measured"):
        require(archive.get(name) is False, "Archive evidence flags do not match source contract")
    query = archive.get("query")
    require(isinstance(query, dict), "Missing original source query")
    require(set(query) == {"version", "mode", "symbols", "start", "end",
                           "symbol_mapping_asof", "feed", "adjustment",
                           "max_requests", "minimum_http_requests",
                           "maximum_http_requests", "provider_cost_known", "note"},
            "Unknown/missing original query fields")
    symbols = query["symbols"]
    require(isinstance(symbols, list), "Missing symbol set")
    # plan() independently checks symbol/date/range bounds.
    try:
        expected = plan(symbols, start=query["start"], end=query["end"],
                        asof=query["symbol_mapping_asof"], feed=query["feed"],
                        max_requests=query["max_requests"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ArchiveBridgeError("Invalid stored provider request plan") from exc
    require(query == expected and query["feed"] == archive["feed"] and
            query["adjustment"] == archive["price_adjustment"] and
            query["mode"] == "plan_only_no_network",
            "Archived request configuration mismatch")
    captured = _time(archive.get("captured_at"), "captured_at")
    require(captured.date() >= _day(query["end"], "end"),
            "Archive captured before requested end")
    bars_pages = _pages(archive.get("stock_bar_source_pages"), "stock bars")
    action_pages = _pages(archive.get("corporate_action_source_pages"), "actions")
    require(len(bars_pages) + len(action_pages) <= MAX_PAGES and
            archive.get("http_requests_completed") == len(bars_pages) + len(action_pages),
            "HTTP request count / page limit mismatch")
    require(archive.get("source_revision") ==
            "alpaca-pages-" + _hash_page({"bars": bars_pages, "actions": action_pages}),
            "Overall source revision mismatch")

    # Enforce complete request coverage, not merely correct individual hashes.
    bar_endpoints = ["/v2/stocks/" + s + "/bars" for s in symbols]
    require(all(p["endpoint"] in bar_endpoints for p in bars_pages),
            "Unexpected or unrequested stock endpoint")
    require(all(p["endpoint"] == "/v1/corporate-actions" for p in action_pages),
            "Unexpected corporate action endpoint")
    expected_action_queries = [
        {"symbols": s, "start": query["start"], "end": query["end"],
         "data_quality": "complete", "limit": 1000} for s in symbols
    ]
    require(all(p["query_without_page_token"] in expected_action_queries
                for p in action_pages), "Unexpected corporate action source query")
    normalized = []
    seen = set()
    per_symbol = {}
    for symbol in symbols:
        bquery = {"timeframe": "1Day", "start": query["start"],
                  "end": query["end"], "adjustment": "raw",
                  "feed": query["feed"], "asof": query["symbol_mapping_asof"],
                  "limit": 10000}
        aquery = {"symbols": symbol, "start": query["start"],
                  "end": query["end"], "data_quality": "complete", "limit": 1000}
        bar_group = _group_pages(bars_pages, symbol, bar_endpoints[symbols.index(symbol)], bquery)
        action_group = _group_pages(
            [p for p in action_pages if p["query_without_page_token"] == aquery],
            symbol, "/v1/corporate-actions", aquery)
        event_counts = {}
        for page in action_group:
            actions = page["payload"].get("corporate_actions", {})
            require(isinstance(actions, dict), "Malformed action source payload")
            for key, values in actions.items():
                require(isinstance(key, str) and isinstance(values, list),
                        "Malformed corporate action category")
                event_counts[key] = event_counts.get(key, 0) + len(values)
        sessions = []
        for page in bar_group:
            raw_bars = page["payload"].get("bars")
            require(isinstance(raw_bars, list), "Missing bars in source page")
            for bar in raw_bars:
                require(len(normalized) < MAX_BARS, "Too many stock observations")
                day, timestamp = _check_bar(bar, start=date.fromisoformat(query["start"]),
                                            end=date.fromisoformat(query["end"]))
                require((symbol, day) not in seen, "Duplicate daily stock bar")
                seen.add((symbol, day))
                sessions.append(day)
                normalized.append({
                    "symbol": symbol, "session_date": day,
                    "provider_bar_time": timestamp,
                    "open": str(_number(bar["o"], "open")),
                    "high": str(_number(bar["h"], "high")),
                    "low": str(_number(bar["l"], "low")),
                    "close": str(_number(bar["c"], "close")),
                    "volume": bar["v"],
                    "source_page_sha256": page["page_sha256"],
                })
        require(bool(sessions), "No bar observations for " + symbol)
        per_symbol[symbol] = {
            "observed_sessions": len(sessions), "first": min(sessions),
            "last": max(sessions), "corporate_action_categories": event_counts,
            "corporate_action_source_pages": len(action_group),
        }

    require(archive.get("distinct_daily_bars") == len(normalized),
            "Archived bar count mismatch")
    normalized.sort(key=lambda row: (row["session_date"], row["symbol"]))
    # Not a valid PIT completeness test: a selected current ticker can hide
    # delisted constituents; missing days need an independently sourced calendar.
    session_union = {row["session_date"] for row in normalized}
    gaps = {
        symbol: sorted(session_union - {r["session_date"] for r in normalized
                                       if r["symbol"] == symbol})
        for symbol in symbols
    }
    return {
        "version": VERSION, "input_archive_revision": archive["source_revision"],
        "provider": "Alpaca Market Data API", "feed": archive["feed"],
        "captured_at": captured.isoformat(), "requested_symbol_mapping_asof":
            query["symbol_mapping_asof"],
        "requested_symbols": list(symbols),
        "bar_count": len(normalized), "observed_session_union_count": len(session_union),
        "per_symbol": per_symbol, "cross_symbol_session_gaps": gaps,
        "raw_bars": normalized,
        "historical_availability_verified": False,
        "point_in_time_universe_verified": False,
        "corporate_actions_independently_verified": False,
        "research_signal_admitted": False, "historical_backtest_ready": False,
        "performance": None,
        "blocking_reviews": [
            "source_rights_and_data_entitlements",
            "historical_bar_publication_availability",
            "full_point_in_time_security_universe_and_classifications",
            "exchange_session_calendar_and_missing_day_explanations",
            "corporate_action_and_delisting_economics",
            "historical_cost_execution_and_benchmark_mapping",
        ],
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archive", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    a = p.parse_args()
    if a.output.exists():
        p.error("Output already exists; no overwrite")
    if a.archive.stat().st_size > MAX_ARCHIVE_BYTES:
        p.error("Archive exceeds bounded local read limit")
    result = bridge_archive(json.loads(a.archive.read_text(encoding="utf-8")))
    with a.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"archive_revision": result["input_archive_revision"],
                      "bars_audited": result["bar_count"],
                      "historical_backtest_ready": False,
                      "performance": None}, indent=2))


if __name__ == "__main__":
    main()
