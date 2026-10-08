"""Deterministic, dependency-free betting math. Decimal odds and probabilities are not predictions."""
from decimal import Decimal
from fractions import Fraction

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
    # Normalize exact rational implied probabilities before converting to Decimal.
    # Converting each implied probability first can cause symmetric markets (-110/-110)
    # to round to 0.4999999999 rather than exactly 0.5.
    weights = []
    for odds in american_odds:
        implied_probability(odds)  # Validate odds and reject bool/invalid integers.
        if odds > 0:
            weights.append(Fraction(100, odds + 100))
        else:
            weights.append(Fraction(-odds, -odds + 100))
    total = sum(weights)
    if total <= 0:
        raise ValueError("Invalid market probabilities")
    result = [Decimal((weight / total).numerator) / Decimal((weight / total).denominator) for weight in weights[:-1]]
    # Preserve an exactly normalized total of 1 within Decimal's precision.
    result.append(Decimal(1) - sum(result))
    return result

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
