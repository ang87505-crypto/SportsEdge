"""Bounded LEAN raw daily-price acquisition for in-cloud SportsEdge research.

This is an ACQUISITION adapter, not a historical backtest data certification.
The returned dict must remain inside QuantConnect Cloud. No prices, identities,
summaries of vendor data, or data hashes are printed, exported or persisted.

Must be invoked by a QCAlgorithm in the authenticated QC research runtime.
Prices are raw, fill-forward explicitly disabled, and every session is checked.
LEAN history/index timestamps do NOT prove data was available by the frozen
08:00 decision cutoff; no PIT universe or lifecycle data is synthesized.
"""
from datetime import datetime
from decimal import Decimal, InvalidOperation
import re

VERSION = "sportsedge-qc-raw-history-acquisition-v1"
SYMBOL_PATTERN = re.compile(r"[A-Z][A-Z0-9.-]{0,9}\Z")
MAX_WINDOW_DAYS = 40
MAX_ROWS = 40


class SourceNotAdmitted(ValueError):
    """Input failed a source guard; never fall back to filled/adjusted data."""


def _need(ok, reason):
    if not ok:
        raise SourceNotAdmitted(reason)


def _decimal(value, field, positive=True):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise SourceNotAdmitted("Invalid " + field) from exc
    _need(number.is_finite() and (number > 0 if positive else number >= 0)
          and number <= Decimal("1000000000000000"), "Invalid " + field)
    return number


def _datetime(value, name):
    _need(isinstance(value, datetime) and value.tzinfo is None,
          name + " must be a naive New York exchange-local datetime")
    return value


def read_raw_window(algorithm, symbol, *, start, end, decision_at):
    """Acquire at most 40 calendar days from QuantConnect, without orders.

    start/end are QC exchange-local naive datetimes, end is EXCLUSIVE.
    decision_at is the unchanged research decision (08:00 New York).
    No source timestamp is promoted to an independently verified publication
    timestamp. Full-market execution must page validated ranges in-cloud.
    """
    start = _datetime(start, "start")
    end = _datetime(end, "end")
    at = _datetime(decision_at, "decision_at")
    _need(at.hour == 8 and at.minute == 0 and at.second == 0
          and at.microsecond == 0, "Frozen 08:00 New York decision required")
    _need(start.hour == end.hour == 0 and start.minute == end.minute == 0
          and start.second == end.second == 0 and start.microsecond == end.microsecond == 0,
          "Half-open history bounds must be exchange-local midnight")
    _need(start < end <= at and 0 < (end - start).days <= MAX_WINDOW_DAYS,
          "Unbounded/future history request")
    ticker = getattr(symbol, "value", None)
    security_id = str(getattr(symbol, "id", "")).strip()
    _need(isinstance(ticker, str) and bool(SYMBOL_PATTERN.fullmatch(ticker))
          and security_id, "Explicit stable LEAN symbol and security ID required")
    # Import only at execution time. This allows offline fake-LEAN regression tests.
    from AlgorithmImports import Resolution, DataNormalizationMode
    # QC documented History API accepts these explicit options. If the runtime
    # rejects them, fail rather than retrying with adjusted/fill-forward defaults.
    history = algorithm.history(
        symbols=[symbol], start=start, end=end,
        resolution=Resolution.DAILY, fill_forward=False,
        extended_market_hours=False,
        data_normalization_mode=DataNormalizationMode.RAW)
    _need(history is not None and hasattr(history, "iterrows"),
          "Historical source must be a LEAN history dataframe")
    result = []
    seen = set()
    for index, item in history.iterrows():
        _need(len(result) < MAX_ROWS, "History exceeded bounded window")
        _need(isinstance(index, tuple) and len(index) == 2,
              "Single-symbol multi-index history required")
        reported_symbol, observed_at = index
        if hasattr(reported_symbol, "id"):
            _need(str(reported_symbol.id) == security_id, "Wrong historical security ID")
        else:
            _need(str(reported_symbol) == ticker, "Unexpected historical ticker")
        _need(isinstance(observed_at, datetime), "Historical index timestamp required")
        day = observed_at.date()
        _need(start.date() <= day < end.date() and day.weekday() < 5,
              "Out-of-window or weekend history observation")
        date_text = day.isoformat()
        _need(date_text not in seen, "Duplicate historical daily bar")
        seen.add(date_text)
        try:
            values = {k: _decimal(item[k], k) for k in ("open", "high", "low", "close")}
            volume = _decimal(item["volume"], "volume", positive=False)
        except (KeyError, IndexError, TypeError) as exc:
            raise SourceNotAdmitted("Missing required OHLCV columns") from exc
        _need(values["low"] <= min(values["open"], values["close"])
              and values["high"] >= max(values["open"], values["close"])
              and values["low"] <= values["high"], "Invalid OHLC relationship")
        _need(volume == volume.to_integral_value(),
              "Nonintegral source volume")
        result.append({
            "session_date": date_text,
            "lean_history_index_time": observed_at.isoformat(),
            "open": str(values["open"]), "high": str(values["high"]),
            "low": str(values["low"]), "close": str(values["close"]),
            "volume": int(volume),
        })
    _need(bool(result), "No historical bars returned")
    _need(result == sorted(result, key=lambda x: x["session_date"]),
          "Unordered historical observations")
    return {
        "version": VERSION,
        "kind": "QC_RAW_HISTORY_UNADMITTED_IN_CLOUD",
        "source": "quantconnect_lean_history",
        "security_id": security_id,
        "requested_ticker": ticker,
        "request_start": start.isoformat(),
        "request_end_exclusive": end.isoformat(),
        "decision_at_local": at.isoformat(),
        "requested_raw_unadjusted": True,
        "requested_fill_forward": False,
        "bars": result,
        "bar_publication_time_verified": False,
        "point_in_time_membership_verified": False,
        "sector_exchange_and_first_listing_verified": False,
        "corporate_actions_and_delisting_economics_verified": False,
        "historical_source_admitted": False,
        "strategy_backtest_completed": False,
        "performance": None,
        "blockers": [
            "independent historical availability and revision timestamps",
            "complete 2000-2011 point-in-time universe, delistings and identifiers",
            "reviewed exchange calendar, classifications and listing evidence",
            "all split, dividend, merger, spinoff and cash-in-lieu economics",
            "reconciliation of source format into frozen full-universe selector/accounting",
            "licensed benchmark, execution-cost and holdout evidence",
        ],
    }
