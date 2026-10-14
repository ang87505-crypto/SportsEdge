"""Reporting from reconciled closing wealth, never from signals or test accuracy.

All ratios use monthly observations. Missing risk-free data gives null Sharpe
and Sortino. No inference of source authenticity or strategy promotion.
"""
from datetime import date
from decimal import Decimal as D
import math
import statistics
from .stock_accounting_v2 import require, exact
from .stock_report_statistics_v1 import summarize_equity


@exact
def wealth_statistics(dates, wealth, risk_free=None):
    require(len(dates) == len(wealth) and len(dates) >= 2, 'Origin and closes required')
    parsed = [date.fromisoformat(d) for d in dates]
    require(parsed == sorted(set(parsed)), 'Ordered unique dates required')
    values = [D(str(v)) for v in wealth]
    require(all(v.is_finite() and v > 0 for v in values), 'Positive finite wealth required')
    ends = {}
    for d, v in zip(dates[1:], values[1:]):
        ends[d[:7]] = (d, v)
    months = list(ends)
    monthly = []; previous = values[0]
    for month in months:
        value = ends[month][1]
        monthly.append(float(value / previous - 1)); previous = value
    rf = None
    if risk_free is not None:
        require(set(risk_free) == set(months), 'Risk-free months must align exactly')
        rf = [risk_free[m] for m in months]
    result = summarize_equity(dates, [float(v) for v in values],
                              monthly_returns=monthly, monthly_risk_free=rf)
    sortino = None
    if rf is not None and len(monthly) >= 2:
        excess = [r - f for r, f in zip(monthly, rf)]
        downside = math.sqrt(sum(min(r, 0) ** 2 for r in excess) / len(excess))
        if downside > 0:
            sortino = statistics.mean(excess) / downside * math.sqrt(12)
    annual = []; previous = values[0]
    for i, month in enumerate(months):
        if i + 1 == len(months) or months[i + 1][:4] != month[:4]:
            value = ends[month][1]
            year_months = [m for m in months if m[:4] == month[:4]]
            annual.append(dict(year=int(month[:4]), net_return=float(value / previous - 1),
                               complete_calendar_year=len(year_months) == 12))
            previous = value
    return dict(**result, sortino=sortino, annual=annual, months=months,
                monthly_returns=monthly,
                cumulative=[dict(date=d, net_return=float(v / values[0] - 1))
                            for d, v in zip(dates, values)],
                ratio_convention='Monthly arithmetic excess returns; annualization sqrt(12); Sortino downside RMS over all months; null if undefined')


@exact
def account_statistics(initial, result, risk_free=None):
    """Receipts must be reconciled before calling. Exposure is close-marked."""
    rows = result['sessions']
    dates = [initial['as_of'][:10]] + [r['session_date'] for r in rows]
    navs = [str(D(initial['settled_cash_cents']) / 100)] + [r['close_nav'] for r in rows]
    report = wealth_statistics(dates, navs, risk_free)
    exposure = []; turnover = []; fees = 0; spread = D(0); slip = D(0); rounding = D(0)
    for row in rows:
        values = [D(row['state']['marks'][sid]['price']) * n
                  for sid, n in row['state']['positions'].items()]
        nav = D(row['close_nav']); gross = sum(values, D(0))
        exposure.append(dict(date=row['session_date'], gross_fraction=float(gross / nav),
            largest_position_fraction=float(max(values, default=D(0)) / nav),
            equity_sleeve_hhi=float(sum((v / gross) ** 2 for v in values)) if gross else None,
            position_count=len(values)))
        bought = D(0); sold = D(0)
        for t in row['trades']:
            # Midpoint notional, so costs are not incorrectly counted as turnover.
            fill = D(t['unit_price']) * t['shares']
            impact = D(t['spread_cost_dollars']) + D(t['slippage_cost_dollars'])
            notional = fill - impact if t['side'] == 'buy' else fill + impact
            if t['side'] == 'buy': bought += notional
            else: sold += notional
            fees += t['fee_cents']; spread += D(t['spread_cost_dollars'])
            slip += D(t['slippage_cost_dollars']); rounding += D(t['rounding_cost_dollars'])
        turnover.append(dict(date=row['session_date'], bought_dollars=str(bought),
            sold_dollars=str(sold), one_way=float((bought + sold) / (2 * D(row['open_nav_before'])))))
    return dict(**report, exposure=exposure, turnover=turnover,
        total_one_way_turnover=sum(t['one_way'] for t in turnover),
        costs=dict(fees_cents=fees, spread_dollars=str(spread), slippage_dollars=str(slip),
                   rounding_dollars=str(rounding), total_dollars=str(D(fees) / 100 + spread + slip + rounding)),
        trades=sum(len(r['trades']) for r in rows),
        settled_cash_constraints=sum(len(r['cash_constraints']) for r in rows),
        rejected_sessions=0, rejection_policy='Any rejected session aborts the entire run')
