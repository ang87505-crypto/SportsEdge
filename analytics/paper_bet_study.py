"""Prospective NBA model paper-bet study: 100 unique games at $10 virtual stake.

This is an *audit/evaluation* utility. It does not select wagers, refresh odds,
place sportsbook orders, or manufacture outcomes. Bet records require external
verification against immutable, timestamped research ledgers before import.
"""
from __future__ import annotations
import json
import sys
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

STUDY_ID = "nba-elo-100x10-v1"
MODEL_VERSION = "nba-elo-k20-h65-2026-04-v1"
STARTED_AT = "2026-10-09T07:34:06Z"
TARGET_BETS = 100
STAKE_CENTS = 1000
INITIAL_BANKROLL_CENTS = 100000
MIN_EXPECTED_VALUE = Decimal("0.02")
ONE = Decimal(1)

class InvalidStudy(ValueError):
    """A record fails a pre-registered audit rule."""

def instant(s, name):
    if not isinstance(s, str):
        raise InvalidStudy(f"{name}: missing timestamp")
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidStudy(f"{name}: invalid timestamp") from exc
    if d.tzinfo is None or d.utcoffset() is None:
        raise InvalidStudy(f"{name}: timezone required")
    return d

def integer(value, name, minimum=1):
    if type(value) is not int or value < minimum:
        raise InvalidStudy(f"{name}: invalid integer")
    return value

def probability(value, name):
    if isinstance(value, bool):
        raise InvalidStudy(f"{name}: invalid probability")
    try:
        p = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise InvalidStudy(f"{name}: invalid probability") from exc
    if not p.is_finite() or not (0 < p < ONE):
        raise InvalidStudy(f"{name}: outside (0,1)")
    return p

def decimal_odds(american):
    if type(american) is not int or -100 < american < 100:
        raise InvalidStudy("american_odds: invalid American odds")
    return ONE + (Decimal(american) / 100 if american > 0 else 100 / Decimal(-american))

def win_profit_cents(stake, american):
    return int((Decimal(stake) * (decimal_odds(american) - ONE))
               .quantize(ONE, rounding=ROUND_HALF_UP))

def validate_bet(b):
    if not isinstance(b, dict):
        raise InvalidStudy("Each bet must be an object")
    integer(b.get("position_id"), "position_id")
    integer(b.get("game_id"), "game_id")
    integer(b.get("quote_id"), "quote_id")
    if b.get("model_version") != MODEL_VERSION:
        raise InvalidStudy("Unregistered NBA model version")
    if b.get("sport") != "nba":
        raise InvalidStudy("Study is NBA-only; do not pool EPL or stocks")
    if not isinstance(b.get("selection"), str) or not b["selection"].strip():
        raise InvalidStudy("Selection is required")
    if integer(b.get("stake_cents"), "stake_cents") != STAKE_CENTS:
        raise InvalidStudy("Each wager must be exactly $10")
    odds = b.get("american_odds")
    decimal_price = decimal_odds(odds)
    p = probability(b.get("model_probability"), "model_probability")
    fair = probability(b.get("no_vig_probability"), "no_vig_probability")
    if p <= fair or p * decimal_price - ONE < MIN_EXPECTED_VALUE:
        raise InvalidStudy("Quote does not satisfy the frozen value rule")
    forecast = instant(b.get("forecast_published_at"), "forecast_published_at")
    observed = instant(b.get("observed_at"), "observed_at")
    ingested = instant(b.get("ingested_at"), "ingested_at")
    placed = instant(b.get("placed_at"), "placed_at")
    starts = instant(b.get("starts_at"), "starts_at")
    if not (instant(STARTED_AT, "study start") <= placed < starts):
        raise InvalidStudy("Retroactive or after-start placement")
    if forecast > placed or observed > placed or ingested > placed:
        raise InvalidStudy("Forecast/quote not available when placed")
    if (placed - observed).total_seconds() > 3600 or (placed - ingested).total_seconds() > 3600:
        raise InvalidStudy("Quote too old when placed")
    if observed >= starts or ingested >= starts:
        raise InvalidStudy("Quote was not recorded before game start")
    outcome = b.get("outcome")
    if outcome not in ("pending", "won", "lost", "void"):
        raise InvalidStudy("Invalid settlement outcome")
    profit = b.get("profit_cents")
    settled = b.get("settled_at")
    if outcome == "pending":
        if profit is not None or settled is not None or b.get("result_source") is not None:
            raise InvalidStudy("Pending positions cannot have settlement data")
    else:
        integer(profit, "profit_cents", minimum=-STAKE_CENTS) if type(profit) is int else None
        if type(profit) is not int:
            raise InvalidStudy("Settled profit must be integer cents")
        settled_at = instant(settled, "settled_at")
        if settled_at < placed or (outcome != "void" and settled_at < starts):
            raise InvalidStudy("Settlement happened before an eligible result")
        if not isinstance(b.get("result_source"), str) or not b["result_source"].startswith("https://"):
            raise InvalidStudy("Official result source is required")
        expected = win_profit_cents(STAKE_CENTS, odds) if outcome == "won" else -STAKE_CENTS if outcome == "lost" else 0
        if profit != expected:
            raise InvalidStudy("Profit does not match deterministic American-odds payout")
    return outcome, profit

def evaluate(payload):
    if not isinstance(payload, dict) or payload.get("study_id") != STUDY_ID or not isinstance(payload.get("bets"), list):
        raise InvalidStudy("Expected the fixed 100x$10 NBA study envelope")
    bets = payload["bets"]
    if len(bets) > TARGET_BETS:
        raise InvalidStudy("More than 100 paper bets")
    games, positions, quotes = set(), set(), set()
    wins = losses = voids = pending = profit = 0
    for b in bets:
        outcome, realized = validate_bet(b)
        if b["game_id"] in games or b["position_id"] in positions or b["quote_id"] in quotes:
            raise InvalidStudy("Duplicate game, position, or sportsbook quote")
        games.add(b["game_id"])
        positions.add(b["position_id"])
        quotes.add(b["quote_id"])
        if outcome == "pending": pending += 1
        else:
            profit += realized
            wins += outcome == "won"
            losses += outcome == "lost"
            voids += outcome == "void"
    resolved = wins + losses
    risked = resolved * STAKE_CENTS
    equity = INITIAL_BANKROLL_CENTS + profit
    available = equity - pending * STAKE_CENTS
    if available < 0:
        raise InvalidStudy("Virtual account has negative available funds")
    return {
        "study_id": STUDY_ID,
        "target_bets": TARGET_BETS,
        "recorded_bets": len(bets),
        "remaining_bets": TARGET_BETS - len(bets),
        "stake_cents_each": STAKE_CENTS,
        "pending": pending,
        "won": wins,
        "lost": losses,
        "void": voids,
        "realized_profit_cents": profit,
        "settled_stake_cents": risked,
        "roi": float(Decimal(profit) / Decimal(risked)) if risked else None,
        "win_rate": float(Decimal(wins) / Decimal(resolved)) if resolved else None,
        "virtual_equity_cents": equity,
        "available_cents": available,
        "status": "complete" if len(bets) == TARGET_BETS and pending == 0 else "incomplete",
        "note": "Audit-only. Model profitability is unvalidated; inputs must be source-verified.",
    }

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python analytics/paper_bet_study.py <study.json>")
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(evaluate(payload), indent=2))

if __name__ == "__main__":
    main()
