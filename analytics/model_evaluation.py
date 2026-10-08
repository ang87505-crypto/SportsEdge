"""Time-ordered evaluation of pregame binary predictions; no profitability claims."""
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from math import log, isfinite
from typing import Iterable

@dataclass(frozen=True)
class Prediction:
    game_id: str
    prediction_at: datetime
    starts_at: datetime
    model_probability: float
    outcome: int
    american_odds: int | None = None
    stake: Decimal = Decimal("1")

def evaluate(rows: Iterable[Prediction]) -> dict:
    """Score only completed, timestamp-valid predictions; no random train/test leakage."""
    items = list(rows)
    if not items:
        raise ValueError("At least one prediction is required")
    ids = set()
    brier = 0.0
    logloss = 0.0
    profit = Decimal("0")
    wagered = Decimal("0")
    settled = 0
    for r in items:
        if not r.game_id or r.game_id in ids:
            raise ValueError("Game IDs must be unique and nonempty")
        ids.add(r.game_id)
        if r.prediction_at.tzinfo is None or r.starts_at.tzinfo is None or r.prediction_at >= r.starts_at:
            raise ValueError("Prediction must be timestamped before game start, with time zones")
        if not isfinite(r.model_probability) or not 0 < r.model_probability < 1:
            raise ValueError("Probability must be strictly between zero and one")
        if type(r.outcome) is not int or r.outcome not in (0, 1):
            raise ValueError("Outcome must be 0 or 1")
        p = r.model_probability
        brier += (p - r.outcome) ** 2
        logloss -= r.outcome * log(p) + (1 - r.outcome) * log(1 - p)
        if r.american_odds is not None:
            if not isinstance(r.stake, Decimal) or not r.stake.is_finite() or r.stake <= 0:
                raise ValueError("Stake must be positive finite Decimal")
            odds = r.american_odds
            if type(odds) is not int or -100 < odds < 100:
                raise ValueError("Invalid American odds")
            # Outcomes indicate whether the selected side won, not home-team result.
            gain = r.stake * (Decimal(odds) / 100 if odds > 0 else Decimal(100) / -Decimal(odds)) if r.outcome else -r.stake
            profit += gain
            wagered += r.stake
            settled += 1
    n = len(items)
    return {
        "sample_size": n,
        "brier_score": brier / n,
        "log_loss": logloss / n,
        "bets_with_verified_pregame_odds": settled,
        "paper_profit": str(profit) if settled else None,
        "paper_roi": str(profit / wagered) if settled else None,
        "warning": "In-sample metrics are not evidence of predictive skill; use held-out, time-ordered evaluation.",
    }
