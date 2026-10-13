"""LEAN raw-observation -> frozen selector bridge; no acquisition or orders.

Run inside the licensed source environment. Evidence is supplied by a reviewed
source process, NEVER inferred from current metadata or from TradeBar.EndTime.
Passing these structural checks is not independent source certification.
"""
from datetime import date
from decimal import Decimal, localcontext

try:
    from .selection import SourceNotReady, _check, _dec, _timestamp, evaluate_month
except ImportError:
    from selection import SourceNotReady, _check, _dec, _timestamp, evaluate_month


REQUIRED_REVIEWS = (
    'license_scope', 'membership_with_delistings', 'historical_classification',
    'first_trading_dates', 'calendar', 'consolidated_volume',
    'publication_and_corrections', 'corporate_action_completeness',
)


def _evidence(value):
    _check(isinstance(value, str) and bool(value.strip()), 'Missing evidence reference')


def validate_manifest(manifest, decision_at):
    """Require explicit review references; references are not authenticated here."""
    at = _timestamp(decision_at, 'decision_at')
    _check(date(2000, 1, 1) <= at.date() <= date(2011, 12, 31),
           'Reserved evaluation period blocked')
    for key in ('dataset_vintage', 'lean_version', 'reviewer', 'snapshot_sha256'):
        _evidence(manifest.get(key))
    digest = manifest['snapshot_sha256']
    _check(len(digest) == 64 and all(c in '0123456789abcdef' for c in digest),
           'Invalid snapshot digest')
    _check(manifest.get('normalization') == 'RAW', 'Adjusted prices blocked')
    _check(manifest.get('volume_basis') == 'CONSOLIDATED', 'Single-exchange volume blocked')
    _check(manifest.get('runtime_scope') in ('quantconnect_cloud', 'separately_licensed_local'),
           'Missing licensed runtime scope')
    for key in REQUIRED_REVIEWS:
        _evidence(manifest.get('reviews', {}).get(key))
    _check(manifest.get('complete_membership') is True, 'Incomplete membership')


def normalize_member(*, symbol, metadata, observations, sessions, decision_at):
    """Map raw LEAN TradeBar objects and explicit action/availability evidence.

Each observation: {bar: TradeBar, session_date, completed_at, available_at,
availability_evidence, action: {kind, evidence, available_at, ...}}.
Kinds: none, split_occurred (lean_split_factor), dividend (distribution).
Dividend distribution must explicitly be per pre-event share. Simultaneous
split/dividend, warnings, mergers, spinoffs and terminations are blocked here.
No absent action is silently turned into a 1/0 adjustment. No default times.
"""
    at = _timestamp(decision_at, 'decision_at')
    sid = str(symbol.id)
    _check(bool(sid.strip()) and sid == metadata.get('security_id'), 'Identity mismatch')
    _check(str(symbol.value) == metadata.get('symbol'), 'Ticker mapping mismatch')
    for field in ('membership', 'sector', 'exchange', 'type', 'first_trade'):
        evidence = metadata.get('evidence', {}).get(field, {})
        _evidence(evidence.get('reference'))
        _check(_timestamp(evidence.get('available_at'), 'metadata available') < at,
               'Late historical metadata')
    _check(_timestamp(metadata['effective_from'], 'metadata effective') <= at,
           'Future metadata interval')
    if metadata.get('effective_until') is not None:
        _check(at < _timestamp(metadata['effective_until'], 'metadata expiry'),
               'Expired metadata interval')
    _check(metadata.get('exchange') in ('NYSE', 'NASDAQ', 'AMEX')
           and metadata.get('type') == 'common_stock', 'Unmapped security type/exchange')
    _evidence(metadata.get('sector'))
    _check(metadata.get('lifecycle_status') == 'ordinary', 'Unresolved security lifecycle')
    first = date.fromisoformat(metadata['first_traded_on'])
    _check(first.isoformat() == metadata['first_traded_on'], 'Noncanonical listing date')
    expected = [s for s in sessions if date.fromisoformat(s['date']) >= first]
    _check(len(observations) == len(expected) and len(expected) > 0,
           'Missing/extra post-listing observations')
    bars = []
    with localcontext() as ctx:
        ctx.prec = 50
        for obs, session in zip(observations, expected):
            bar = obs['bar']
            _check(str(bar.symbol.id) == sid, 'Bar identity mismatch')
            _check(obs['session_date'] == session['date'], 'Unaligned raw session')
            _check(getattr(bar, 'is_fill_forward', None) is False, 'Fill-forward/unknown bar blocked')
            _evidence(obs.get('availability_evidence'))
            close_at = _timestamp(session['close_at'], 'calendar close')
            completed = _timestamp(obs['completed_at'], 'bar completed')
            available = _timestamp(obs['available_at'], 'bar available')
            _check(close_at <= completed <= available < at, 'Invalid raw availability')
            close = _dec(str(bar.close), 'close', positive=True)
            volume = Decimal(str(bar.volume))
            _check(volume.is_finite() and volume >= 0 and volume == volume.to_integral_value()
                   and volume <= 10**15, 'Invalid consolidated volume')
            action = obs['action']
            _evidence(action.get('evidence'))
            _check(_timestamp(action['available_at'], 'action available') < at,
                   'Late action evidence')
            kind = action['kind']
            ratio, dividend = Decimal(1), Decimal(0)
            if kind == 'split_occurred':
                factor = _dec(action['lean_split_factor'], 'LEAN split factor', positive=True)
                ratio = Decimal(1) / factor
            elif kind == 'dividend':
                _check(action.get('share_basis') == 'pre_event_share', 'Ambiguous dividend basis')
                dividend = _dec(action['distribution'], 'cash distribution')
            else:
                _check(kind == 'none', 'Unsupported or ambiguous corporate action')
            bars.append(dict(date=session['date'], close=str(close), volume=int(volume),
                             completed_at=obs['completed_at'], available_at=obs['available_at'],
                             split_ratio=str(ratio), cash_dividend_per_old_share=str(dividend)))
    return dict(security_id=sid, symbol=metadata['symbol'], sector=metadata['sector'],
                exchange=metadata['exchange'], type=metadata['type'],
                first_traded_on=metadata['first_traded_on'],
                first_trade_available_at=metadata['evidence']['first_trade']['available_at'], bars=bars)


def research_decision(*, manifest, members, sessions, next_session, decision_at,
                      incumbent_ids=(), strategy_version, equity_cents=100000):
    """Normalize every expected ID then compute research-only targets atomically.

Missing/extra IDs block the whole decision, including absent incumbent IDs.
Empty/malformed or unresolved sources never become partial portfolios.
The supplied calendar needs external completeness review, not weekday guessing.
"""
    try:
        validate_manifest(manifest, decision_at)
        expected = manifest['expected_security_ids']
        actual = [str(m['symbol'].id) for m in members]
        _check(isinstance(expected, list) and len(expected) > 0
               and all(isinstance(x, str) and x.strip() for x in expected)
               and len(expected) == len(set(expected)), 'Invalid membership manifest')
        _check(len(actual) == len(set(actual)) and set(actual) == set(expected),
               'Membership omitted/duplicated/added')
        normalized = [normalize_member(**m, sessions=sessions, decision_at=decision_at) for m in members]
        result = evaluate_month(universe=normalized, sessions=sessions, next_session=next_session,
                                decision_at=decision_at, incumbent_ids=incumbent_ids,
                                strategy_version=strategy_version, equity_cents=equity_cents,
                                source_complete=True)
        result['source_bridge_version'] = 'lean-raw-source-bridge-v1'
        result['dataset_vintage'] = manifest['dataset_vintage']
        result['snapshot_sha256'] = manifest['snapshot_sha256']
        result['source_review_status'] = 'CALLER_ATTESTED_NOT_INDEPENDENTLY_CERTIFIED'
        return result
    except SourceNotReady:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError) as exc:
        raise SourceNotReady('Malformed or incomplete source evidence') from exc
