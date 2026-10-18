"""LEAN corporate-action objects -> frozen accounting-v2 events, or a fixed block.

Mapping only. No acquisition, no orders, no data export. Runs inside the
licensed QuantConnect environment; failures carry FIXED codes and never
vendor values, so callers may surface the code without leaking data.

Verified LEAN semantics this module depends on (QuantConnect/Lean master):
- SecurityPortfolioManager.ApplySplit divides holdings by Split.SplitFactor
  (2-for-1 => 0.5) and credits fractional remainders as cash at the latest
  price. Frozen accounting v2 instead rejects fractional entitlements.
- Dividend.Create derives Distribution from factor-file price ratios and
  rounds it to 2 decimals. Dividend has NO pay, record or declaration date,
  currency or special-dividend flag. Accounting v2 requires pay_at, currency,
  due_bill and the exact per-old-share amount, so these come only from an
  independently reviewed declaration and are cross-checked against LEAN.
- The US Equity Security Master exposes Split, Dividend, SymbolChangedEvent
  and Delisting objects. It supplies no merger consideration, exchange ratio,
  spinoff distribution, OTC continuation or recovery value. Every terminal
  event therefore blocks here; last-price liquidation is never substituted.
Event ids, effective_at and available_at are supplied by the reviewed caller,
never derived from LEAN backtest timestamps (corporate actions are applied at
midnight ET in backtests, which is not publication evidence).
"""
from decimal import Decimal, InvalidOperation
from fractions import Fraction

VERSION = 'sportsedge-qc-lifecycle-mapper-v1'
MAX_SPLIT_TERM = 1000  # accounting v2 bound on numerator/denominator
LEAN_WARNING, LEAN_OCCURRED = 0, 1  # SplitType / DelistingType enum values
DIVIDEND_CROSS_CHECK = Decimal('0.01')  # LEAN rounds to cents; one-cent band


class LifecycleBlocked(ValueError):
    """Fixed, data-free reason code. str(exc) is the code alone."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _need(ok, code):
    if not ok:
        raise LifecycleBlocked(code)


def _decimal(value, code, *, positive=True):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise LifecycleBlocked(code) from None
    _need(number.is_finite() and (number > 0 if positive else number >= 0), code)
    return number


def _label(value, code):
    _need(isinstance(value, str) and bool(value.strip()), code)
    return value


def _kind(obj):
    try:
        kind = int(getattr(obj, 'type'))
    except (AttributeError, TypeError, ValueError):
        raise LifecycleBlocked('EVENT_TYPE_UNREADABLE') from None
    _need(kind in (LEAN_WARNING, LEAN_OCCURRED), 'EVENT_TYPE_UNREADABLE')
    return kind


def _timing(security_id, event_id, effective_at, available_at):
    return dict(event_id=_label(event_id, 'EVENT_ID_REQUIRED'),
                security_id=_label(security_id, 'SECURITY_ID_REQUIRED'),
                effective_at=_label(effective_at, 'EFFECTIVE_AT_REQUIRED'),
                available_at=_label(available_at, 'AVAILABLE_AT_REQUIRED'))


def split_ratio(split_factor, declared=None):
    """Share multiplier (numerator, denominator) for LEAN's price-side factor.

    An exactly terminating factor with small terms (0.5, 0.25, 1.5) is taken
    as the exact ratio; that the vendor did not round it is a review item.
    A rounded factor (0.3333333) is NOT guessed from: reviewed declared terms
    are required and must reproduce the factor at its published precision.
    """
    factor = _decimal(split_factor, 'SPLIT_FACTOR_INVALID')
    exact = Fraction(factor)  # Decimal -> exact rational, no float step
    if declared is None:
        _need(exact.numerator <= MAX_SPLIT_TERM and exact.denominator <= MAX_SPLIT_TERM,
              'SPLIT_FACTOR_ROUNDED_DECLARED_TERMS_REQUIRED')
        shares = 1 / exact
    else:
        _need(isinstance(declared, dict) and set(declared) == {'numerator', 'denominator'},
              'DECLARED_SPLIT_SCHEMA')
        num, den = declared['numerator'], declared['denominator']
        _need(type(num) is int and type(den) is int and 1 <= num <= MAX_SPLIT_TERM
              and 1 <= den <= MAX_SPLIT_TERM, 'DECLARED_SPLIT_SCHEMA')
        shares = Fraction(num, den)
        places = Decimal(1).scaleb(factor.as_tuple().exponent)
        implied = (Decimal(shares.denominator) / Decimal(shares.numerator)).quantize(places)
        _need(implied == factor, 'SPLIT_FACTOR_CONFLICTS_WITH_DECLARATION')
    _need(shares != 1 and shares.numerator <= MAX_SPLIT_TERM
          and shares.denominator <= MAX_SPLIT_TERM, 'SPLIT_RATIO_UNSUPPORTED')
    return shares.numerator, shares.denominator


def map_split(split, *, security_id, event_id, effective_at, available_at, declared=None):
    """None for a LEAN split warning (no economics); else an accounting-v2 split."""
    if _kind(split) == LEAN_WARNING:
        return None
    num, den = split_ratio(getattr(split, 'split_factor', None), declared)
    return dict(_timing(security_id, event_id, effective_at, available_at),
                type='split', numerator=num, denominator=den)


DECLARED_DIVIDEND = {'per_old_share', 'pay_at', 'currency', 'due_bill'}


def map_dividend(dividend, *, security_id, event_id, effective_at, available_at, declared):
    """Accounting-v2 ordinary cash dividend from a reviewed declaration.

    LEAN's rounded, factor-derived Distribution is only a cross-check: the
    declared exact amount must round to within one cent of it.
    """
    _need(declared is not None, 'DIVIDEND_TERMS_NOT_SUPPLIED_BY_LEAN')
    _need(isinstance(declared, dict) and set(declared) == DECLARED_DIVIDEND,
          'DECLARED_DIVIDEND_SCHEMA')
    _need(declared['currency'] == 'USD' and declared['due_bill'] is False,
          'DIVIDEND_CONVENTION_UNSUPPORTED')
    _label(declared['pay_at'], 'DIVIDEND_PAY_AT_REQUIRED')
    exact = _decimal(declared['per_old_share'], 'DECLARED_DIVIDEND_INVALID')
    lean = _decimal(getattr(dividend, 'distribution', None), 'LEAN_DISTRIBUTION_INVALID')
    _need(abs(exact - lean) <= DIVIDEND_CROSS_CHECK, 'DIVIDEND_AMOUNT_CONFLICT')
    return dict(_timing(security_id, event_id, effective_at, available_at),
                type='ordinary_cash_dividend', currency='USD', due_bill=False,
                per_old_share=str(exact), pay_at=declared['pay_at'])


def map_symbol_change(change, *, security_id, event_id, effective_at, available_at):
    """Permanent LEAN Symbol unchanged; only the ticker label moves."""
    old = _label(getattr(change, 'old_symbol', None), 'SYMBOL_CHANGE_UNREADABLE')
    new = _label(getattr(change, 'new_symbol', None), 'SYMBOL_CHANGE_UNREADABLE')
    _need(old != new, 'SYMBOL_CHANGE_UNREADABLE')
    return dict(_timing(security_id, event_id, effective_at, available_at),
                type='rename', old_symbol=old, new_symbol=new)


def map_delisting(delisting):
    """Warnings carry no economics. A delisting itself always blocks: LEAN has
    no consideration, successor, OTC continuation or recovery value to map."""
    if _kind(delisting) == LEAN_WARNING:
        return None
    raise LifecycleBlocked('TERMINAL_EVENT_RECOVERY_NOT_SUPPLIED')


def scoring_action(event, *, symbol, session_date):
    """Accounting-v2 event -> the frozen scorer's context['actions'] row.

    The scorer reads split_ratio as decimal text (a share multiplier), so a
    ratio without an exact terminating decimal (2/3) blocks instead of being
    rounded. A rename carries no return adjustment and yields None.
    """
    _label(symbol, 'SYMBOL_REQUIRED'); _label(session_date, 'SESSION_DATE_REQUIRED')
    if event['type'] == 'rename':
        return None
    ratio, dividend = Decimal(1), Decimal(event.get('per_old_share', '0'))
    if event['type'] == 'split':
        exact = Fraction(event['numerator'], event['denominator'])
        ratio = Decimal(exact.numerator) / Decimal(exact.denominator)
        _need(Fraction(ratio) == exact, 'SPLIT_RATIO_NOT_EXACT_DECIMAL')
    else:
        _need(event['type'] == 'ordinary_cash_dividend', 'UNSUPPORTED_EVENT_TYPE')
    return dict(symbol=symbol, session_date=session_date, source_id=event['event_id'],
                available_at=event['available_at'], split_ratio=str(ratio),
                cash_dividend_per_old_share=str(dividend))


def map_session(security_id, *, splits=(), dividends=(), symbol_changes=(), delistings=(),
                timing, declared_splits=None, declared_dividends=None):
    """All of one security's LEAN events for one session -> at most one event.

    timing = {event_id, effective_at, available_at} from the reviewed source.
    Declared dividends with no LEAN dividend (or vice versa) block, so neither
    source silently overrides the other. Accounting v2 rejects combined
    same-session events, so more than one economic event blocks here first.
    """
    _need(isinstance(timing, dict) and set(timing) == {'event_id', 'effective_at', 'available_at'},
          'EVENT_TIMING_SCHEMA')
    for delisting in delistings:
        map_delisting(delisting)
    declared_splits = list(declared_splits or ())
    declared_dividends = list(declared_dividends or ())
    occurred = [s for s in splits if _kind(s) == LEAN_OCCURRED]
    _need(len(declared_splits) <= len(occurred) <= 1, 'SPLIT_DECLARATION_MISMATCH')
    _need(len(dividends) == len(declared_dividends) and len(dividends) <= 1,
          'DIVIDEND_DECLARATION_MISMATCH')
    events = [map_split(s, security_id=security_id, **timing,
                        declared=declared_splits[0] if declared_splits else None) for s in occurred]
    events += [map_dividend(d, security_id=security_id, **timing, declared=declared_dividends[0])
               for d in dividends]
    events += [map_symbol_change(c, security_id=security_id, **timing) for c in symbol_changes]
    _need(len(events) <= 1, 'COMBINED_SAME_SESSION_EVENTS')
    return events
