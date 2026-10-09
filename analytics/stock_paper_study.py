"""Isolated, forward-only $1,000 stock paper-study accounting.

Audit utility, NOT an order broker, market feed, trading algorithm, or
independent verification of quote/signal authenticity. All amounts are cents;
whole shares only; no leverage, shorting, deposits or withdrawals.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlparse

STUDY_ID = "stock-model-paper-1000-v1"
REGISTERED_AT = "2026-10-09T07:39:46Z"
STARTING_CASH_CENTS = 100_000
SLIPPAGE_BPS = 10
MAX_QUOTE_AGE_SECONDS = 60
MAX_EVENTS = 500
SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")


class InvalidStudy(ValueError):
    """Input violates the prospective stock study contract."""


def required_int(value, name, minimum=0):
    if type(value) is not int or value < minimum:
        raise InvalidStudy(f"{name}: expected integer >= {minimum}")
    return value


def timestamp(value, name):
    if not isinstance(value, str):
        raise InvalidStudy(f"{name}: timestamp required")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidStudy(f"{name}: invalid timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InvalidStudy(f"{name}: timezone required")
    return parsed.astimezone(timezone.utc)


def slippage_cents(notional_cents):
    """Round to nearest cent, half-up; never use binary float for money."""
    required_int(notional_cents, "notional_cents", 1)
    return int((Decimal(notional_cents) * SLIPPAGE_BPS / 10_000).quantize(
        Decimal(1), rounding=ROUND_HALF_UP
    ))


def validate_event(event, *, as_of):
    if not isinstance(event, dict):
        raise InvalidStudy("Event must be an object")
    if event.get("side") not in ("buy", "sell"):
        raise InvalidStudy("side must be buy or sell")
    if not isinstance(event.get("event_id"), str) or not event["event_id"].strip():
        raise InvalidStudy("event_id required")
    sym = event.get("symbol")
    if not isinstance(sym, str) or not SYMBOL_RE.fullmatch(sym):
        raise InvalidStudy("symbol must be a normalized stock ticker")
    shares = required_int(event.get("shares"), "shares", 1)
    reference_price = required_int(event.get("reference_price_cents"), "reference_price_cents", 1)
    if shares * reference_price > 2**53 - 1:
        raise InvalidStudy("Notional exceeds safe integer range")
    if not isinstance(event.get("quote_id"), str) or not event["quote_id"].strip():
        raise InvalidStudy("Original quote ID is required")
    quote_source = event.get("quote_source_url")
    if not isinstance(quote_source, str):
        raise InvalidStudy("Verifiable quote source URL required")
    parsed = urlparse(quote_source)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise InvalidStudy("Quote source must be an HTTPS provider URL")
    if not isinstance(event.get("strategy_version"), str) or not event["strategy_version"].strip():
        raise InvalidStudy("Named, versioned strategy required")
    if not isinstance(event.get("signal_id"), str) or not event["signal_id"].strip():
        raise InvalidStudy("Recorded strategy signal ID required")
    recorded = timestamp(event.get("recorded_at"), "recorded_at")
    observed = timestamp(event.get("quote_observed_at"), "quote_observed_at")
    signaled = timestamp(event.get("signal_published_at"), "signal_published_at")
    if recorded < timestamp(REGISTERED_AT, "registered_at") or recorded > as_of:
        raise InvalidStudy("No backdated or future event")
    if observed > recorded or signaled > recorded:
        raise InvalidStudy("Quote and signal must exist before simulated fill")
    if (recorded - observed).total_seconds() > MAX_QUOTE_AGE_SECONDS:
        raise InvalidStudy("Quote older than 60 seconds at simulated fill")
    if signaled < timestamp(REGISTERED_AT, "registered_at"):
        raise InvalidStudy("No pre-registration model signals admitted")
    return recorded, sym, shares, reference_price


def evaluate(study, *, as_of=None):
    if as_of is None:
        as_of = datetime.now(timezone.utc)
    if not isinstance(as_of, datetime) or as_of.tzinfo is None or as_of.utcoffset() is None:
        raise InvalidStudy("as_of must be timezone-aware")
    as_of = as_of.astimezone(timezone.utc)
    if not isinstance(study, dict) or study.get("study_id") != STUDY_ID:
        raise InvalidStudy("Study identity mismatch")
    if study.get("starting_cash_cents") != STARTING_CASH_CENTS:
        raise InvalidStudy("Study starts with exactly $1,000 virtual cash")
    if study.get("slippage_bps") != SLIPPAGE_BPS:
        raise InvalidStudy("Frozen slippage assumption changed")
    events = study.get("events")
    if not isinstance(events, list) or len(events) > MAX_EVENTS:
        raise InvalidStudy("Invalid or oversized event stream")

    cash = STARTING_CASH_CENTS
    realized_profit = 0
    total_slippage = 0
    purchases = sales = 0
    seen_ids = set()
    holdings = {}  # symbol -> FIFO lots, each lot [shares_remaining, cost_cents_remaining]
    previous = None
    for event in events:
        recorded, symbol, shares, price = validate_event(event, as_of=as_of)
        if event["event_id"] in seen_ids:
            raise InvalidStudy("Duplicate event ID")
        seen_ids.add(event["event_id"])
        if previous is not None and recorded <= previous:
            raise InvalidStudy("Events must be strictly chronological")
        previous = recorded
        notional = price * shares
        slip = slippage_cents(notional)
        total_slippage += slip
        if event["side"] == "buy":
            total_cost = notional + slip
            if total_cost > cash:
                raise InvalidStudy("Insufficient virtual cash: no leverage allowed")
            cash -= total_cost
            holdings.setdefault(symbol, []).append([shares, total_cost])
            purchases += 1
        else:
            lots = holdings.get(symbol, [])
            if sum(qty for qty, _ in lots) < shares:
                raise InvalidStudy("Cannot sell unowned shares or short stock")
            sale_proceeds = notional - slip
            if sale_proceeds < 0:
                raise InvalidStudy("Negative proceeds")
            remaining = shares
            historical_cost = 0
            while remaining:
                lot = lots[0]
                taken = min(lot[0], remaining)
                # Assign exact cents to FIFO lots; remainder stays with remaining shares.
                allocated = lot[1] if taken == lot[0] else int(
                    (Decimal(lot[1]) * taken / lot[0]).quantize(
                        Decimal(1), rounding=ROUND_HALF_UP
                    )
                )
                historical_cost += allocated
                lot[0] -= taken
                lot[1] -= allocated
                remaining -= taken
                if lot[0] == 0:
                    lots.pop(0)
            cash += sale_proceeds
            realized_profit += sale_proceeds - historical_cost
            sales += 1

    open_cost = sum(cost for lots in holdings.values() for _, cost in lots)
    positions = [
        {"symbol": symbol,
         "shares": sum(shares for shares, _ in lots),
         "open_cost_cents": sum(cost for _, cost in lots)}
        for symbol, lots in sorted(holdings.items()) if lots
    ]
    if cash + open_cost != STARTING_CASH_CENTS + realized_profit:
        raise InvalidStudy("Accounting identity failed")
    return {
        "study_id": STUDY_ID, "status": "ready_for_verified_orders" if not events else "running",
        "initial_cash_cents": STARTING_CASH_CENTS, "cash_cents": cash,
        "open_cost_cents": open_cost, "realized_pnl_cents": realized_profit,
        "virtual_equity_at_cost_cents": cash + open_cost,
        "unrealized_pnl_cents": None, "portfolio_return": None,
        "buy_events": purchases, "sell_events": sales,
        "recorded_events": len(events), "total_slippage_cents": total_slippage,
        "positions": positions,
        "note": "No live valuation or verified fills; external quote/signal provenance must be authenticated."
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python analytics/stock_paper_study.py <study.json>")
    source = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(evaluate(source), indent=2))


if __name__ == "__main__":
    main()
