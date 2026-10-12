"""Deterministic, offline, long-only stock backtest accounting.

Consumes already frozen stock-momentum signals and historical raw session prices.
Never estimates a fill from a signal-day close. Next-session open is a
scenario/proxy, NOT a verified historical bid/ask or executable quote.
No external network, brokerage, order placement or database mutations.

All monetary arithmetic is integer cents; fee and slippage assumptions MUST
be supplied. Every selected holding requires a current open/close; absent
corporate actions or delisting resolution stop the test (no forward fill).
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import re
from typing import Any

try:
    from .stock_momentum_v1 import VERSION
except ImportError:
    from stock_momentum_v1 import VERSION

STRATEGY = VERSION
ENGINE_VERSION = "stock-historical-cash-ledger-v1"
_TICKER = re.compile(r"[A-Z][A-Z0-9.-]{0,9}\Z")
_CENTS = re.compile(r"(?:0|[1-9]\d*)(?:\.\d{1,2})?\Z")

def integer(x: Any, field: str, minimum: int = 0) -> int:
    if type(x) is not int or x < minimum or x > 10**15:
        raise ValueError(f"{field}: safe integer required")
    return x

def label(x: Any, field: str) -> str:
    if not isinstance(x, str) or not x or x != x.strip() or len(x) > 160:
        raise ValueError(f"{field}: normalized text required")
    return x

def stamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or "T" not in value:
        raise ValueError(f"{field}: timezone-aware ISO time required")
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError(f"{field}: invalid timestamp") from e
    if d.tzinfo is None or d.utcoffset() is None:
        raise ValueError(f"{field}: timestamp must have timezone")
    return d.astimezone(timezone.utc)

def ticker(s: Any) -> str:
    if not isinstance(s, str) or not _TICKER.fullmatch(s):
        raise ValueError("Invalid/unsupported stock symbol")
    return s

def cents(s: Any) -> int:
    if not isinstance(s, str) or not _CENTS.fullmatch(s):
        raise ValueError("Raw open/close must be USD decimal strings at cent precision")
    value = int(Decimal(s) * 100)
    if value <= 0 or value > 10**12:
        raise ValueError("Invalid historical open/close price")
    return value

def ceildiv(n: int, d: int) -> int:
    if d <= 0 or n < 0:
        raise ValueError("Invalid cost calculation")
    return (n + d - 1) // d

def round_half_up(n: int, d: int) -> int:
    if d <= 0 or n < 0:
        raise ValueError("Invalid cost calculation")
    return (2 * n + d) // (2 * d)

def _cost(amount: int, *, side: str, bps: int, fee: int) -> int:
    """Cents: BUY rounds the total debit up, SELL the proceeds down."""
    if side == "buy":
        return ceildiv(amount * (10_000 + bps), 10_000) + fee
    if side == "sell":
        net = amount * (10_000 - bps) // 10_000 - fee
        if net < 0:
            raise ValueError("Fee exceeds historical sale proceeds")
        return net
    raise ValueError("Unknown trade side")

def _market(rows: Any, symbols: dict[str, str]) -> dict[str, tuple[int, int]]:
    if not isinstance(rows, list) or len(rows) > 10_000:
        raise ValueError("Market must be a bounded list")
    out = {}
    for q in rows:
        if not isinstance(q, dict):
            raise ValueError("Malformed historical market record")
        s = ticker(q.get("symbol"))
        security = label(q.get("security_id"), "security_id")
        if s in out:
            raise ValueError("Duplicate historical quote")
        if s in symbols and symbols[s] != security:
            raise ValueError("Ticker/security identity changed: review corporate action")
        symbols.setdefault(s, security)
        out[s] = (cents(q.get("open")), cents(q.get("close")))
    return out

def _actions(rows: Any, positions: dict[str, int],
             cash: int, market: dict[str, tuple[int, int]]) -> tuple[int, list[dict]]:
    if not isinstance(rows, list):
        raise ValueError("Corporate actions list required")
    seen = set()
    events = []
    for a in rows:
        if not isinstance(a, dict):
            raise ValueError("Invalid corporate action")
        symbol = ticker(a.get("symbol"))
        source_id = label(a.get("source_id"), "action source_id")
        if symbol in seen:
            raise ValueError("Multiple same-session actions must be aggregated upstream")
        seen.add(symbol)
        if symbol not in market:
            raise ValueError("Corporate action missing source market")
        numerator = integer(a.get("split_numerator"), "split numerator", 1)
        denominator = integer(a.get("split_denominator"), "split denominator", 1)
        dividend = integer(a.get("dividend_cents_per_old_share"), "cash dividend")
        if numerator > 1000 or denominator > 1000:
            raise ValueError("Unreasonable split ratio: manual review")
        old = positions.get(symbol, 0)
        if old:
            shares_num = old * numerator
            if shares_num % denominator:
                raise ValueError("Fractional shares / cash in lieu require external reconciliation")
            # Dividend is denominated in pre-split shares by this contract.
            cash += old * dividend
            new = shares_num // denominator
            if new:
                positions[symbol] = new
            else:
                positions.pop(symbol, None)
            events.append({"symbol":symbol,"source_id":source_id,
                           "old_shares":old,"new_shares":new,
                           "dividend_cents":old*dividend})
    return cash, events

def _equity(cash: int, positions: dict[str, int],
            market: dict[str, tuple[int, int]], *, close: bool) -> int:
    result = cash
    for s, n in positions.items():
        if s not in market:
            raise ValueError(f"Missing current {'close' if close else 'open'} for holding {s}")
        result += n * market[s][1 if close else 0]
    if result < 0 or result > 10**15:
        raise ValueError("Portfolio equity invalid")
    return result

def _targets(signal: Any, holdings: dict[str, int], open_equity: int) -> dict[str, int]:
    if not isinstance(signal, dict) or signal.get("strategy_version") != STRATEGY or \
       signal.get("status") != "research_targets_only" or signal.get("fills") != [] or \
       signal.get("performance_measured") is not False:
        raise ValueError("Only the frozen, unexecuted stock momentum signal is permitted")
    label(signal.get("signal_id"), "signal_id")
    if signal.get("signal_id") != signal.get("input_digest"):
        raise ValueError("Signal fingerprint mismatch")
    rows = signal.get("targets")
    if not isinstance(rows, list):
        raise ValueError("Signal must include explicit targets")
    targets = {}
    for r in rows:
        if not isinstance(r, dict):
            raise ValueError("Invalid model target")
        s = ticker(r.get("symbol"))
        if s in targets or r.get("action") not in ("TARGET", "EXIT"):
            raise ValueError("Duplicate/invalid stock model target")
        budget = integer(r.get("target_budget_cents"), "stock target")
        if r["action"] == "EXIT" and budget != 0:
            raise ValueError("EXIT must have zero budget")
        if r["action"] == "TARGET" and budget == 0:
            raise ValueError("TARGET must have a positive budget")
        targets[s] = budget
    if not set(holdings).issubset(targets):
        raise ValueError("Signal omitted an existing holding")
    nonzero = [b for b in targets.values() if b]
    if len(nonzero) > 5 or any(b > open_equity//10 for b in nonzero) \
       or sum(nonzero) > open_equity//2:
        raise ValueError("Model targets exceed the strategy's exposure caps")
    return targets

def replay(payload: dict) -> dict:
    """Replay PRECOMPUTED signals at later historical session opens.

    Inputs must originate from verified time-safe signal and market adapters.
    Source labels and action coverage are self-declarations, not provenance proof.
    No signal is fitted or selected by this function.
    """
    if not isinstance(payload, dict):
        raise ValueError("Backtest envelope must be an object")
    if payload.get("price_adjustment") != "raw" or \
       payload.get("corporate_actions_coverage_complete") is not True:
        raise ValueError("Raw price data and audited corporate-action coverage required")
    provider = label(payload.get("provider"), "provider")
    source_revision = label(payload.get("source_revision"), "source revision")
    if provider == "synthetic" and payload.get("kind") != "synthetic_fixture":
        raise ValueError("Do not present synthetic prices as observed market data")
    starting = integer(payload.get("initial_cash_cents"), "starting cash", 1)
    config = payload.get("costs")
    if not isinstance(config, dict):
        raise ValueError("Explicit cost scenario required")
    bps = integer(config.get("slippage_bps"), "slippage_bps")
    fee = integer(config.get("fee_cents"), "fee_cents")
    if bps > 5000:
        raise ValueError("Slippage above 50% is not a supported backtest scenario")
    sessions = payload.get("sessions")
    if not isinstance(sessions, list) or not 2 <= len(sessions) <= 25000:
        raise ValueError("2–25,000 chronological sessions required")
    symbols: dict[str, str] = {}
    positions: dict[str, int] = {}
    cash = starting
    fills = []
    actions = []
    curve = []
    seen_signals = set()
    high = starting
    biggest_dd_cents = 0
    biggest_dd_fraction = Decimal(0)
    prior_close = None
    prev_day = None
    for row in sessions:
        if not isinstance(row, dict):
            raise ValueError("Invalid session")
        day = label(row.get("date"), "session date")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            raise ValueError("Session date must be YYYY-MM-DD")
        open_at = stamp(row.get("open_at"), "open_at")
        close_at = stamp(row.get("close_at"), "close_at")
        if not open_at < close_at or \
           (prior_close is not None and not prior_close < open_at) or \
           (prev_day is not None and day <= prev_day):
            raise ValueError("Sessions must be strictly chronological")
        prev_day = day
        market = _market(row.get("market"), symbols)
        cash, daily_actions = _actions(row.get("actions"), positions, cash, market)
        for act in daily_actions:
            actions.append({"date":day, **act})
        decision = row.get("decision")
        if decision is not None:
            if prior_close is None:
                raise ValueError("No prior-session close for first trading decision")
            if not isinstance(decision, dict):
                raise ValueError("Malformed decision wrapper")
            signal = decision.get("signal")
            if not isinstance(signal, dict):
                raise ValueError("Missing frozen signal")
            signal_id = label(signal.get("signal_id"), "signal_id")
            if signal_id in seen_signals:
                raise ValueError("Replayed signal was executed twice")
            decision_at = stamp(signal.get("decision_at"), "signal decision_at")
            published = stamp(decision.get("published_at"), "signal published_at")
            earliest = stamp(signal.get("earliest_execution_at"), "earliest_execution_at")
            if earliest != open_at or \
               not prior_close < decision_at <= published < open_at:
                raise ValueError("Signal used future/same-close data, was not published, or executed too early")
            if day[:7] == (prior_close.astimezone(timezone.utc).date().isoformat())[:7]:
                raise ValueError("Frozen monthly model may rebalance only in a new month")
            seen_signals.add(signal_id)
            nav = _equity(cash, positions, market, close=False)
            targets = _targets(signal, positions, nav)
            target_shares = {}
            for symbol, budget in targets.items():
                if symbol not in market:
                    raise ValueError(f"Missing next-open fill reference for {symbol}")
                price = market[symbol][0]
                # Conservative, whole-share allocation, using exact integer-cent costs.
                size = max(0, (budget-fee)*10_000 // (price*(10_000+bps))) if budget > fee else 0
                while size and _cost(size*price, side="buy", bps=bps, fee=fee)>budget:
                    size -= 1
                target_shares[symbol] = size
            # Atomic local planning: a rejected session does not produce a partial
            # result; the function raises rather than returning a false success.
            for side in ("sell","buy"):
                for symbol in sorted(target_shares):
                    old = positions.get(symbol, 0)
                    desired = target_shares[symbol]
                    size = old-desired if side=="sell" else desired-old
                    if size <= 0:
                        continue
                    price = market[symbol][0]
                    amount = _cost(size*price, side=side, bps=bps, fee=fee)
                    if side == "buy":
                        if amount > cash:
                            raise ValueError("Historical buy would overdraw virtual cash")
                        cash -= amount
                        positions[symbol] = old+size
                    else:
                        cash += amount
                        if old == size:
                            positions.pop(symbol, None)
                        else:
                            positions[symbol] = old-size
                    fills.append({"date":day,"signal_id":signal_id,
                                  "side":side,"symbol":symbol,"shares":size,
                                  "reference_open_cents":price,
                                  "cash_delta_cents":-amount if side=="buy" else amount,
                                  "status":"HISTORICAL_PROXY_FILL_NOT_AN_ORDER"})
            if cash < 0:
                raise ValueError("Cash fell below zero")
        equity = _equity(cash, positions, market, close=True)
        high = max(high, equity)
        dd = high - equity
        biggest_dd_cents = max(biggest_dd_cents, dd)
        if high:
            biggest_dd_fraction = max(biggest_dd_fraction, Decimal(dd)/Decimal(high))
        curve.append({"date":day,"cash_cents":cash,"equity_cents":equity,
                      "positions":dict(sorted(positions.items()))})
        prior_close = close_at
    return {
        "engine_version":ENGINE_VERSION,"model_version":STRATEGY,
        "source":provider,"source_revision":source_revision,
        "status":"exploratory_historical_price_scenario_not_verified_executable",
        "source_independently_verified":False,
        "initial_cash_cents":starting,"ending_equity_cents":curve[-1]["equity_cents"],
        "net_pnl_cents":curve[-1]["equity_cents"]-starting,
        "return_fraction":str(Decimal(curve[-1]["equity_cents"]-starting)/Decimal(starting)),
        "max_drawdown_cents":biggest_dd_cents,
        "max_drawdown_fraction":str(biggest_dd_fraction),
        "signals_executed":len(seen_signals),"proxy_fills":len(fills),
        "fills":fills,"corporate_actions":actions,"equity_curve":curve,
        "benchmark":None,
        "limits":[
            "Only precomputed signals; source as-of history is not independently authenticated.",
            "Open prices are after-the-fact execution proxies, not historical bid/ask or guaranteed fills.",
            "Fees and slippage are explicit scenarios, not observed execution costs.",
            "Point-in-time universe, delistings, splits and dividends require source-level audits.",
            "No audited benchmark data supplied; no relative outperformance claim.",
        ],
    }

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    report = replay(json.loads(a.input.read_text()))
    with a.output.open("x", encoding="utf-8") as f:
        json.dump(report, f, indent=2, allow_nan=False)
        f.write("\n")

if __name__ == "__main__":
    main()
