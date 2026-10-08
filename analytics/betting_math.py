"""Deterministic, dependency-free betting math. Decimal odds and probabilities are not predictions."""
from decimal import Decimal, InvalidOperation

def implied_probability(american_odds: int) -> Decimal:
    """Return bookmaker implied probability for valid American odds."""
    if isinstance(american_odds, bool) or not isinstance(american_odds, int) or -100 < american_odds < 100:
        raise ValueError("American odds must be an integer <= -100 or >= +100")
    odds = Decimal(american_odds)
    return (Decimal(100) / (odds + 100)) if american_odds > 0 else (-odds / (-odds + 100))

def no_vig_probabilities(american_odds: list[int]) -> list[Decimal]:
    """Proportional removal of overround for all mutually exclusive, exhaustive outcomes."""
    if len(american_odds) < 2:
        raise ValueError("At least two outcomes required")
    probabilities = [implied_probability(o) for o in american_odds]
    total = sum(probabilities)
    if total <= 0:
        raise ValueError("Invalid market probabilities")
    return [p / total for p in probabilities]

def net_profit(stake: Decimal, american_odds: int, outcome: str) -> Decimal:
    """Paper bet profit, excluding original stake; push and void return zero."""
    if not isinstance(stake, Decimal) or not stake.is_finite() or stake <= 0:
        raise ValueError("Stake must be a positive finite Decimal")
    implied_probability(american_odds)
    if outcome == "won":
        return stake * (Decimal(american_odds) / 100 if american_odds > 0 else Decimal(100) / -Decimal(american_odds))
    if outcome == "lost":
        return -stake
    if outcome in ("push", "void"):
        return Decimal(0)
    raise ValueError("Outcome must be won, lost, push, or void")
