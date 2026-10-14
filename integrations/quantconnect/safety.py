"""Read-only safety assessment contract for FUTURE SportsEdge monitoring.

Not an alert delivery service, broker guard, or trading scheduler. Thresholds
must be explicitly approved and independently checked before live use.
"""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json


def _utc(value):
    if not isinstance(value, str):
        raise ValueError('timestamp required')
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('timezone required')
    return parsed.astimezone(timezone.utc)


def _money(value):
    if not isinstance(value, str):
        raise ValueError('money must be exact decimal text')
    try:
        parsed=Decimal(value)
    except InvalidOperation as exc:
        raise ValueError('invalid money amount') from exc
    if not parsed.is_finite():
        raise ValueError('nonfinite money amount')
    return parsed


def assess(snapshot, policy):
    """Return deterministic STOP/REVIEW findings, never permissions/orders.

    snapshot should ultimately come from independently reconciled server
    state, NOT browser-local user-provided telemetry. This function treats
    unreviewed/absent evidence as unsafe; it cannot deliver notifications.
    """
    required_policy={'max_data_age_seconds','max_day_loss_bps','max_drawdown_bps','max_nav_gap_cents'}
    if set(policy)!=required_policy:
        raise ValueError('All risk thresholds must be explicitly supplied')
    if any(type(v) is not int or v < 0 for v in policy.values()):
        raise ValueError('Risk thresholds must be positive integer units')
    findings=[]
    def flag(code):findings.append(code)
    try:
        as_of=_utc(snapshot['as_of'])
        observed=_utc(snapshot['price_observed_at'])
        last_reconcile=_utc(snapshot['last_reconciled_at'])
        if as_of < observed or (as_of-observed).total_seconds()>policy['max_data_age_seconds']:
            flag('STALE_OR_FUTURE_MARKET_DATA')
        if as_of < last_reconcile or (as_of-last_reconcile).total_seconds()>policy['max_data_age_seconds']:
            flag('STALE_OR_FUTURE_RECONCILIATION')
        if snapshot['provider_ok'] is not True:flag('PROVIDER_UNAVAILABLE')
        if snapshot['report_hash_approved'] is not True:flag('UNREVIEWED_REPORT')
        if snapshot['strategy_version_verified'] is not True:flag('STRATEGY_VERSION_MISMATCH')
        if snapshot['unknown_order_count'] != 0:flag('UNCERTAIN_ORDER_STATE')
        if snapshot['unsettled_exception_count'] != 0:flag('UNRECONCILED_CASH_OR_EVENT')
        nav=_money(snapshot['nav_usd'])
        day_open=_money(snapshot['day_open_nav_usd'])
        peak=_money(snapshot['peak_nav_usd'])
        cash=_money(snapshot['cash_usd'])
        holdings=_money(snapshot['position_value_usd'])
        receivables=_money(snapshot['receivables_usd'])
        unsettled=_money(snapshot['unsettled_cash_usd'])
        if nav <= 0 or day_open <= 0 or peak <= 0:flag('INVALID_ACCOUNT_EQUITY')
        else:
            if (day_open-nav)*10000/day_open > policy['max_day_loss_bps']:
                flag('DAY_LOSS_LIMIT_BREACHED')
            if (peak-nav)*10000/peak > policy['max_drawdown_bps']:
                flag('DRAWDOWN_LIMIT_BREACHED')
        gap=abs(nav-(cash+holdings+receivables+unsettled))
        if gap*100 > policy['max_nav_gap_cents']:flag('ACCOUNT_NAV_MISMATCH')
    except (KeyError,TypeError,ValueError,ArithmeticError,OverflowError):
        flag('MISSING_OR_INVALID_SAFETY_EVIDENCE')
    codes=sorted(set(findings))
    payload={'as_of':snapshot.get('as_of'), 'codes':codes}
    return {'status':'HALT_NEW_ORDERS' if codes else 'NO_ALERT_FINDINGS_NOT_AUTHORIZATION',
            'codes':codes,'alert_id':hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest(),
            'notifications_sent':False,'orders_placed':False,'broker_connected':False,
            'future_live_approval':False}
