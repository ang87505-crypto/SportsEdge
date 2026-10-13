"""Strict, provider-neutral daily US-equities data contract for *research*.

No network calls, stock selection, performance claims, or trade execution.
As-of selection excludes bars not available before the simulated decision.
Provider identity and timestamps are declarations, not independent proof.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
import json
import re
from zoneinfo import ZoneInfo

_NEW_YORK = ZoneInfo("America/New_York")
_SYMBOL = re.compile(r"[A-Z][A-Z0-9.-]{0,9}\Z")
_MONEY = re.compile(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?\Z")
_MAX_ROWS = 100_000


class StockDataError(ValueError):
    """An input fails an as-of-data or schema audit check."""


@dataclass(frozen=True)
class DailyBar:
    symbol: str
    session_date: date
    completed_at: datetime
    available_at: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


@dataclass(frozen=True)
class DailyDataset:
    provider: str
    source_revision: str
    retrieved_at: datetime
    bars: tuple[DailyBar, ...]


def _stamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or "T" not in value:
        raise StockDataError(f"{field}: timezone-aware ISO timestamp required")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise StockDataError(f"{field}: invalid timestamp") from exc
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise StockDataError(f"{field}: timezone is required")
    return dt.astimezone(timezone.utc)


def _day(value: Any) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise StockDataError("session_date: expected YYYY-MM-DD")
    try:
        d = date.fromisoformat(value)
    except ValueError as exc:
        raise StockDataError("session_date: invalid date") from exc
    if d.weekday() >= 5:
        raise StockDataError("session_date: weekend session requires a separate provider audit")
    return d


def _price(raw: Any, field: str) -> Decimal:
    if not isinstance(raw, str) or not _MONEY.fullmatch(raw):
        raise StockDataError(f"{field}: use positive decimal text, up to six decimal places")
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise StockDataError(f"{field}: invalid price") from exc
    if not value.is_finite() or value <= 0:
        raise StockDataError(f"{field}: positive finite price required")
    return value


def _label(value: Any, field: str) -> str:
    if not isinstance(value, str) or value != value.strip() or not 1 <= len(value) <= 160:
        raise StockDataError(f"{field}: nonempty normalized text required")
    return value


def parse_daily_bars(payload: Any) -> DailyDataset:
    """Parse raw, completed US-stock daily bars with declared provider provenance.

    Bars are not independently sourced or authenticated by this parser.
    A runner must separately verify the license, source identity, split handling,
    provider time semantics, and actual availability at the decision cutoff.
    """
    if not isinstance(payload, dict):
        raise StockDataError("Dataset must be an object")
    if (payload.get("asset_class") != "us_equities"
            or payload.get("timeframe") != "1d"
            or payload.get("currency") != "USD"
            or payload.get("price_adjustment") != "raw"):
        raise StockDataError("Require raw, USD, daily US-equity bars; adjusted bars are not supported")
    provider = _label(payload.get("provider"), "provider")
    revision = _label(payload.get("source_revision"), "source_revision")
    retrieved = _stamp(payload.get("retrieved_at"), "retrieved_at")
    records = payload.get("bars")
    if not isinstance(records, list) or not 1 <= len(records) <= _MAX_ROWS:
        raise StockDataError("bars must contain between 1 and 100,000 daily observations")
    seen: set[tuple[str, date]] = set()
    bars: list[DailyBar] = []
    for index, row in enumerate(records):
        if not isinstance(row, dict):
            raise StockDataError(f"bar {index}: object required")
        symbol = row.get("symbol")
        if not isinstance(symbol, str) or not _SYMBOL.fullmatch(symbol):
            raise StockDataError(f"bar {index}: invalid normalized US-equity ticker")
        session = _day(row.get("session_date"))
        key = (symbol, session)
        if key in seen:
            raise StockDataError(f"Duplicate session for ticker {symbol}: {session}")
        seen.add(key)
        if row.get("status") != "complete":
            raise StockDataError(f"bar {index}: only completed sessions admitted")
        completed = _stamp(row.get("completed_at"), "completed_at")
        available = _stamp(row.get("available_at"), "available_at")
        completed_ny = completed.astimezone(_NEW_YORK)
        if completed_ny.date() != session or completed_ny.time() < time(9, 30):
            raise StockDataError(f"bar {index}: closing timestamp inconsistent with New York session")
        if completed > available or available > retrieved:
            raise StockDataError(f"bar {index}: completion, availability and retrieval must be chronological")
        op = _price(row.get("open"), "open")
        hi = _price(row.get("high"), "high")
        lo = _price(row.get("low"), "low")
        cl = _price(row.get("close"), "close")
        if lo > min(op, cl) or hi < max(op, cl) or hi < lo:
            raise StockDataError(f"bar {index}: inconsistent daily OHLC range")
        volume = row.get("volume")
        if type(volume) is not int or not 0 <= volume <= 10**15:
            raise StockDataError(f"bar {index}: nonnegative integer volume required")
        bars.append(DailyBar(symbol, session, completed, available, op, hi, lo, cl, volume))
    bars.sort(key=lambda r: (r.symbol, r.session_date))
    return DailyDataset(provider, revision, retrieved, tuple(bars))


def visible_at(dataset: DailyDataset, decision_at: str) -> tuple[DailyBar, ...]:
    """Only bars already available *strictly before* the decision timestamp.

    A same-timestamp bar is withheld to avoid ambiguous ordering. This does
    not prove vendor timestamps accurately reflect historical availability.
    """
    at = _stamp(decision_at, "decision_at")
    if at > dataset.retrieved_at:
        raise StockDataError("decision_at exceeds dataset retrieval; cannot audit future visibility")
    return tuple(bar for bar in dataset.bars if bar.available_at < at)


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Validate an independently sourced US-equity bar snapshot")
    parser.add_argument("path", type=Path)
    parser.add_argument("--as-of", help="ISO timestamp for no-lookahead visibility audit")
    args = parser.parse_args()
    data = parse_daily_bars(json.loads(args.path.read_text(encoding="utf-8")))
    report = {"provider": data.provider, "source_revision": data.source_revision,
              "bars_validated": len(data.bars), "independently_verified": False,
              "note": "Schema checks cannot authenticate provider prices or as-of publication timestamps"}
    if args.as_of:
        report["visible_bars"] = len(visible_at(data, args.as_of))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
