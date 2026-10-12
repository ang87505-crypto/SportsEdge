"""Bounded, read-only Alpaca historical-data ARCHIVER for stock research.

No network runs on import. CLI defaults to a free, credential-free PLAN.
Only --execute-network makes authenticated API calls. It never sends an order,
writes Supabase, generates stock signals, or pretends raw historical bars
include truthful historical availability timestamps.

Alpaca stock bars: GET https://data.alpaca.markets/v2/stocks/{symbol}/bars
Alpaca corp actions: GET https://data.alpaca.markets/v1/corporate-actions

Store original numeric JSON values and source pages without truncation.
The archive is NOT a backtest-ready point-in-time input; independent
delisting, ticker mapping, exchange calendars and action audits are required.
"""
from __future__ import annotations
import argparse
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Callable, Any
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from zoneinfo import ZoneInfo

BASE = "https://data.alpaca.markets"
VERSION = "alpaca-history-raw-archive-v1"
SYMBOL_RE = re.compile(r"[A-Z][A-Z0-9.-]{0,9}\Z")
NY = ZoneInfo("America/New_York")
MAX_PAGE_BYTES = 12_000_000


class HistoricalSourceError(ValueError):
    pass


def _day(s: Any, name: str) -> date:
    if not isinstance(s, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        raise HistoricalSourceError(f"{name}: YYYY-MM-DD required")
    try:
        out = date.fromisoformat(s)
    except ValueError as e:
        raise HistoricalSourceError(f"{name}: invalid day") from e
    if s != out.isoformat():
        raise HistoricalSourceError(f"{name}: noncanonical day")
    return out


def _time(s: Any, name: str) -> datetime:
    if not isinstance(s, str) or "T" not in s:
        raise HistoricalSourceError(f"{name}: timezone-aware time required")
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as e:
        raise HistoricalSourceError(f"{name}: invalid timestamp") from e
    if d.tzinfo is None or d.utcoffset() is None:
        raise HistoricalSourceError(f"{name}: missing timezone")
    return d.astimezone(timezone.utc)


def _number(v: Any, name: str) -> Decimal:
    if type(v) not in (int, float, str):
        raise HistoricalSourceError(f"{name}: numeric price required")
    try:
        out = Decimal(str(v))
    except InvalidOperation as e:
        raise HistoricalSourceError(f"{name}: invalid number") from e
    if not out.is_finite() or out <= 0 or out > Decimal(10_000_000):
        raise HistoricalSourceError(f"{name}: nonpositive or excessive price")
    return out


def plan(symbols: list[str], *, start: str, end: str, asof: str,
         feed: str, max_requests: int) -> dict:
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 20:
        raise HistoricalSourceError("Choose 1–20 tickers per archived request")
    if any(not isinstance(s, str) or not SYMBOL_RE.fullmatch(s) for s in symbols) \
       or len(set(symbols)) != len(symbols):
        raise HistoricalSourceError("Invalid, duplicate or unnormalized symbols")
    first, last, mapped = _day(start, "start"), _day(end, "end"), _day(asof, "asof")
    if first > last or (last-first).days > 365*25:
        raise HistoricalSourceError("Invalid or unbounded history range")
    if mapped < first:
        raise HistoricalSourceError("asof symbol-mapping day must not predate first bar")
    if feed not in ("iex", "sip"):
        raise HistoricalSourceError("Choose a documented equity source feed: iex or sip")
    if type(max_requests) is not int or not 1 <= max_requests <= 50:
        raise HistoricalSourceError("Explicit maximum must be 1–50 HTTP requests")
    minimum = len(symbols)*2  # one bar page and one corporate actions page/symbol
    if max_requests < minimum:
        raise HistoricalSourceError("Request cap smaller than minimum archive requests")
    return {
        "version": VERSION,"mode": "plan_only_no_network",
        "symbols": symbols,"start": start,"end": end,"symbol_mapping_asof": asof,
        "feed": feed,"adjustment": "raw","max_requests": max_requests,
        "minimum_http_requests": minimum,
        "maximum_http_requests": max_requests,
        "provider_cost_known": False,
        "note": "No prices downloaded; HTTP count is not billed data credits. Only explicit network execution can spend provider quota.",
    }


def _hash_page(payload: dict) -> str:
    b = json.dumps(payload, sort_keys=True, separators=(",", ":"),
                   ensure_ascii=True, allow_nan=False).encode()
    return hashlib.sha256(b).hexdigest()


def provider_get(url: str, headers: dict[str, str]) -> dict:
    # Host is fixed by this module; never forward secrets to an arbitrary URL.
    if not url.startswith(BASE + "/"):
        raise HistoricalSourceError("Unexpected API host")
    try:
        req = Request(url, headers=headers, method="GET")
        with urlopen(req, timeout=20) as response:
            raw = response.read(MAX_PAGE_BYTES+1)
            if len(raw) > MAX_PAGE_BYTES:
                raise HistoricalSourceError("Source response too large")
            data = json.loads(raw)
    except HTTPError as e:
        # Never print or persist response bodies, credentials or signed URLs.
        raise HistoricalSourceError(f"Alpaca returned HTTP {e.code}; no partial archive written") from None
    except (URLError, TimeoutError, ValueError) as e:
        raise HistoricalSourceError("Source request or JSON validation failed; no partial archive written") from None
    if not isinstance(data, dict):
        raise HistoricalSourceError("Alpaca source response must be a JSON object")
    return data


def _check_bar(row: Any, *, start: date, end: date) -> tuple[str, str]:
    if not isinstance(row, dict):
        raise HistoricalSourceError("Market bar must be an object")
    ts = _time(row.get("t"), "bar.t")
    day = ts.astimezone(NY).date()
    if not start <= day <= end or day.weekday() >= 5:
        raise HistoricalSourceError("Bar outside documented session/date range")
    values = {k:_number(row.get(k), f"bar.{k}") for k in ("o","h","l","c")}
    if values["l"]>min(values["o"],values["c"]) or values["h"]<max(values["o"],values["c"]) \
       or values["l"]>values["h"]:
        raise HistoricalSourceError("Inconsistent market OHLC")
    volume = row.get("v")
    if type(volume) is not int or not 0 <= volume <= 10**15:
        raise HistoricalSourceError("Bad bar volume")
    return day.isoformat(),ts.isoformat()


def archive(*, symbols: list[str], start: str, end: str, asof: str,
            feed: str, max_requests: int, key_id: str, secret_key: str,
            get: Callable[[str, dict[str, str]], dict] = provider_get,
            captured_at: str | None = None) -> dict:
    settings = plan(symbols,start=start,end=end,asof=asof,feed=feed,max_requests=max_requests)
    if not isinstance(key_id,str) or not key_id.strip() or not isinstance(secret_key,str) or not secret_key.strip():
        raise HistoricalSourceError("Missing server-only APCA_API_KEY_ID / APCA_API_SECRET_KEY")
    captured = _time(captured_at or datetime.now(timezone.utc).isoformat(),"captured_at")
    if _day(end,"end") > captured.date():
        raise HistoricalSourceError("Do not request future historical bars")
    headers = {"APCA-API-KEY-ID":key_id,"APCA-API-SECRET-KEY":secret_key,"Accept":"application/json"}
    attempts = 0
    first,last = _day(start,"start"),_day(end,"end")
    raw_pages = []
    corp_pages = []
    observed = set()
    def request(endpoint: str, query: dict, sink: list, *, expect_bars: bool) -> None:
        nonlocal attempts
        cursor = None
        cursors = set()
        while True:
            if attempts >= max_requests:
                raise HistoricalSourceError("Provider request cap reached before pagination completed")
            params = dict(query)
            if cursor:
                params["page_token"] = cursor
            url = BASE + endpoint + "?" + urlencode(params)
            attempts += 1
            response = get(url, headers)
            if not isinstance(response,dict):
                raise HistoricalSourceError("Malformed provider page")
            if expect_bars:
                bars=response.get("bars")
                if not isinstance(bars,list):
                    raise HistoricalSourceError("Missing bars array from stock source")
                for bar in bars:
                    day,ts=_check_bar(bar,start=first,end=last)
                    symbol=query["symbol"]
                    key=(symbol,day)
                    if key in observed:
                        raise HistoricalSourceError("Duplicate daily bar, including cross-page repetition")
                    observed.add(key)
            else:
                # Preserve original corporate-action JSON: action payloads vary
                # by type. Presence of a page is NOT proof of action coverage.
                if not isinstance(response.get("corporate_actions",{}),dict):
                    raise HistoricalSourceError("Malformed corporate actions payload")
            token=response.get("next_page_token")
            if token is not None and (not isinstance(token,str) or not token.strip() or len(token)>4096):
                raise HistoricalSourceError("Invalid source pagination cursor")
            sink.append({"endpoint":endpoint,"query_without_page_token":query,
                         "page_sha256":_hash_page(response),"payload":response})
            if token is None:
                break
            if token in cursors:
                raise HistoricalSourceError("Repeated pagination token; source incomplete")
            cursors.add(token)
            cursor=token
    for symbol in symbols:
        encoded=quote(symbol,safe="")
        request(f"/v2/stocks/{encoded}/bars",{
            "symbol":symbol,"timeframe":"1Day","start":start,"end":end,
            "adjustment":"raw","feed":feed,"asof":asof,"limit":10000
        },raw_pages,expect_bars=True)
        request("/v1/corporate-actions",{
            "symbols":symbol,"start":start,"end":end,
            "data_quality":"complete","limit":1000
        },corp_pages,expect_bars=False)
    for symbol in symbols:
        if not any(s==symbol for s,_ in observed):
            raise HistoricalSourceError(f"No historical bars returned for {symbol}")
    return {
        "version":VERSION,"purpose":"archived_provider_responses_for_manual_audit",
        "provider":"Alpaca Market Data API","captured_at":captured.isoformat(),
        "feed":feed,"price_adjustment":"raw","symbol_mapping_asof":asof,
        "source_revision":f"alpaca-pages-{_hash_page({'bars':raw_pages,'actions':corp_pages})}",
        "query":settings,"http_requests_completed":attempts,
        "distinct_daily_bars":len(observed),
        "stock_universe_point_in_time_verified":False,
        "action_coverage_independently_verified":False,
        "historical_availability_timestamps_verified":False,
        "simulated_trading_or_earnings_measured":False,
        "corporate_action_source_pages":corp_pages,"stock_bar_source_pages":raw_pages,
        "limits":[
            "Alpaca historical bar timestamp is a bar time, NOT independently verified publication time.",
            "Alpaca warns some corporate actions are published or processed late; returned records do not prove as-of availability or complete history.",
            "A selected ticker list and asof mapping do not constitute a point-in-time eligible universe; delisted companies may be absent.",
            "IEX-only versus SIP data coverage/permissions affect historical price and volume.",
            "No verified trading opens, bid-ask fills, selection signals, delisting settlement or stock returns were simulated here.",
        ]
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--symbols",required=True,help="Comma-separated uppercase tickers, max 20")
    p.add_argument("--start",required=True)
    p.add_argument("--end",required=True)
    p.add_argument("--asof",required=True,help="Explicit as-of SYMBOL MAPPING date, not a historical-data availability proof")
    p.add_argument("--feed",required=True,choices=("iex","sip"))
    p.add_argument("--max-requests",type=int,required=True)
    p.add_argument("--execute-network",action="store_true",help="Makes authenticated provider GET requests; may use your quota")
    p.add_argument("--output",type=Path,help="New archive output path; refuses to overwrite")
    a = p.parse_args()
    symbols=a.symbols.split(",")
    settings=plan(symbols,start=a.start,end=a.end,asof=a.asof,feed=a.feed,max_requests=a.max_requests)
    if not a.execute_network:
        print(json.dumps(settings,indent=2))
        print("PLAN ONLY. No Alpaca provider request or account charge attempted.")
        return
    if a.output is None:
        p.error("Network collection requires an explicit NEW --output path")
    if a.output.exists():
        p.error("Output already exists; refusing any network calls and overwrite")
    payload=archive(symbols=symbols,start=a.start,end=a.end,asof=a.asof,feed=a.feed,
                    max_requests=a.max_requests,
                    key_id=os.getenv("APCA_API_KEY_ID",""),
                    secret_key=os.getenv("APCA_API_SECRET_KEY",""))
    with a.output.open("x",encoding="utf-8") as f:
        json.dump(payload,f,indent=2,allow_nan=False)
        f.write("\n")
    print(json.dumps({
        "file":str(a.output),"requests":payload["http_requests_completed"],
        "bars":payload["distinct_daily_bars"],
        "verified_market_data":False,"historical_returns_measured":False
    },indent=2))


if __name__=="__main__":
    main()
