"""Low-volatility selection for a separately registered weekly PAPER experiment.

Model `stock-lowvol252-trend200-v1` ("steady stocks"). It reuses everything the weekly
momentum variant validates and scores (stock_weekly_scoring_v2: the same 253-session
window, the total-return wealth index W, the 200-session trend filter, the $5 price and
$20M dollar-volume screens, the same universe file, bridge, planner and controller).
Only the ranking differs:

1. Candidates: scored members with `eligible` and `trend_positive` (W_T above the mean of
   its last 200 observations). No momentum requirement.
2. Volatility: the sample standard deviation of the 252 daily total-return ratios
   W_t / W_(t-1) - 1 over the window, computed from the same raw closes and the same
   split/dividend records the scorer used, with the frozen `total_return_index`.
3. Rank by ascending volatility, ties alphabetically by symbol; at most five, at most two
   per sector. Each target is 10% of equity, as for every model the planner accepts.

Frozen in advance; no fitted parameters. This is NOT research evidence and makes no
return claim: a large-cap, price-capped, survivorship-exposed universe on paper.
"""
from __future__ import annotations
from decimal import Decimal as D, localcontext
from .stock_data_contract import parse_daily_bars
from .stock_momentum_v1 import number, total_return_index
from .stock_accounting_v2 import require

VERSION = 'stock-lowvol252-trend200-v1'
WINDOW = 253
MAX_TARGETS = 5
MAX_PER_SECTOR = 2


def volatility_by_symbol(evidence: dict) -> dict[str, D]:
    """Daily total-return volatility of every member with a full 253-session window.

    `evidence` is the scoring bundle the weekly bridge assembles (shards, context, listings,
    decision_at), already accepted by score_universe_weekly. Shorter histories are omitted;
    the scorer reports them as ineligible anyway.
    """
    context = evidence['context']
    symbol_of = {u['security_id']: u['symbol'] for u in context['universe']}
    out: dict[str, D] = {}
    window = None
    with localcontext() as ctx:
        ctx.prec = 50
        for shard in evidence['shards']:
            sym = symbol_of[shard['security_id']]
            bars = sorted(parse_daily_bars(shard['payload']).bars, key=lambda b: b.session_date)
            if len(bars) < WINDOW:
                continue
            bars = bars[-WINDOW:]
            days = [b.session_date.isoformat() for b in bars]
            require(days == sorted(set(days)), 'Duplicate or unordered bars')
            if window is None:
                window = days
            require(days == window, 'Members must share one decision window')
            actions = {}
            for a in context['actions']:
                if a['symbol'] == sym and window[0] < a['session_date'] <= window[-1]:
                    actions[a['session_date']] = (number(a['split_ratio'], 'split', positive=True),
                                                  number(a['cash_dividend_per_old_share'], 'dividend'))
            splits, dividends = zip(*(actions.get(d, (D(1), D(0))) for d in window[1:]))
            wealth = total_return_index([b.close for b in bars],
                                        list(splits), list(dividends))
            returns = [cur / prev - 1 for prev, cur in zip(wealth, wealth[1:])]
            mean = sum(returns) / len(returns)
            variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
            out[sym] = variance.sqrt()
    return out


def choose(scores: list[dict], volatility: dict[str, D]) -> list[dict]:
    """The steady-stocks targets from frozen-math scores and window volatilities."""
    ranked = sorted((s for s in scores if s['eligible'] and s['trend_positive'] and s['symbol'] in volatility),
                    key=lambda s: (volatility[s['symbol']], s['symbol']))
    selected, sectors = [], {}
    for s in ranked:
        if sectors.get(s['sector'], 0) >= MAX_PER_SECTOR:
            continue
        selected.append(s)
        sectors[s['sector']] = sectors.get(s['sector'], 0) + 1
        if len(selected) == MAX_TARGETS:
            break
    return selected
