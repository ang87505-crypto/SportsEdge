"""Deterministic reporting mathematics. Callers must independently admit datasets.

No selection, optimization, dataset reads, or provider calls. Tests are synthetic.
"""
from datetime import date
import math
import random
import statistics
from .stock_accounting_v2 import require

VERSION='stock-report-statistics-v1'


def monthly_statistics(months, baseline, candidate):
    """Registered paired calendar-year bootstrap of mean monthly difference.

    Requires complete, contiguous calendar years. No cherry-picked/partial blocks.
    Uses 10,000 replicates, seed 20261012, nearest-rank 2.5/97.5 percentiles.
    Fewer than two years produce no interval, never an artificial zero interval.
    """
    require(len(months)==len(baseline)==len(candidate) and len(months)>0, 'Paired samples required')
    for r in baseline+candidate:
        require(type(r) in (int,float) and math.isfinite(r) and r>-1, 'Invalid monthly return')
    parsed=[date.fromisoformat(m+'-01') for m in months]
    serial=[d.year*12+d.month for d in parsed]
    require(serial==list(range(serial[0],serial[0]+len(serial))), 'Contiguous months required')
    require(parsed[0].month==1 and parsed[-1].month==12, 'Complete calendar-year blocks required')
    differences=[c-b for b,c in zip(baseline,candidate)]
    years=len(months)//12
    mean=statistics.mean(differences)
    result=dict(method=VERSION,mean_monthly_difference=mean,year_blocks=years,
                replicates=10000,seed=20261012,confidence_level=0.95,interval=None,
                limitation='Few calendar-year blocks limit inference; historical exposure must be attested separately.')
    if years<2:return result
    block_means=[statistics.mean(differences[i:i+12]) for i in range(0,len(months),12)]
    rng=random.Random(20261012)
    samples=sorted(statistics.mean(block_means[rng.randrange(years)] for _ in range(years)) for _ in range(10000))
    result['interval']=[samples[249],samples[9749]]
    return result


def summarize_equity(dates, nav, *, monthly_returns, monthly_risk_free=None):
    require(len(dates)==len(nav) and len(nav)>=2, 'Equity path requires origin and closes')
    days=[date.fromisoformat(d) for d in dates]
    require(days==sorted(set(days)), 'Unique ordered dates required')
    require(all(type(n) in (int,float) and math.isfinite(n) and n>0 for n in nav), 'Positive finite NAV required')
    require(all(type(r) in (int,float) and math.isfinite(r) and r>-1 for r in monthly_returns), 'Invalid monthly return')
    elapsed=(days[-1]-days[0]).days
    peak=nav[0];max_dd=0.0;peak_day=days[0];longest=0;underwater=False
    for day,value in zip(days,nav):
        if value>=peak:
            if underwater:longest=max(longest,(day-peak_day).days)
            peak=value;peak_day=day;underwater=False
        else:
            underwater=True;max_dd=max(max_dd,1-value/peak)
            longest=max(longest,(day-peak_day).days)
    vol=statistics.stdev(monthly_returns)*math.sqrt(12) if len(monthly_returns)>=2 else None
    sharpe=None
    if monthly_risk_free is not None:
        require(len(monthly_risk_free)==len(monthly_returns) and
                all(type(r) in (int,float) and math.isfinite(r) and r>-1 for r in monthly_risk_free), 'Dated matching risk-free observations required')
        excess=[r-f for r,f in zip(monthly_returns,monthly_risk_free)]
        if len(excess)>=2 and statistics.stdev(excess)>0:
            sharpe=statistics.mean(excess)/statistics.stdev(excess)*math.sqrt(12)
    return dict(net_profit_dollars=nav[-1]-nav[0],cumulative_return=nav[-1]/nav[0]-1,
                cagr=(nav[-1]/nav[0])**(365.25/elapsed)-1,
                maximum_drawdown=max_dd,drawdown_duration_days=longest,
                terminal_drawdown_unrecovered=underwater,annualized_monthly_volatility=vol,sharpe=sharpe)
