"""Historical replay of the two weekly PAPER strategies and pre-registered variants.

Exploratory research only (docs/STOCK_WEEKLY_BACKTEST_PLAN_2026_11_01.md, committed before
any result existed). It changes nothing that trades. It is NOT survivorship-free: the
universe is today's hand-reviewed large-cap list mapped backwards, which flatters every
strategy and the benchmark comparison. Results are fractional-share approximations.

Rules mirrored from the live weekly bridge and planner:
- Decide before the open of the first session of each ISO week (or calendar month for the
  monthly variants) from the 253 completed sessions T-252..T; trade at that session's open.
- Total-return index W from Alpaca 'all'-adjusted closes (splits and dividends), raw closes
  and raw volume for the $5 price floor, the $20M 20-day dollar-volume floor and the $95
  price cap (stocks not held above $95 are skipped, as in the live universe file).
- A member needs a bar on every session of the window, otherwise it is skipped. A held
  member that cannot be scored means the live decision is rejected: no trade that week.
- Momentum: W[T-21]/W[T-252]-1 > 0 and W_T above its 200-session mean, ranked highest
  first. Steady: W_T above its 200-session mean, ranked by lowest daily-return volatility.
  At most five picks, at most two per sector. Each pick targets 10% of equity; the rest is
  cash (0% interest). Holdings not picked are sold.
- Costs: COST_BPS per side on traded value. A continuing pick is not rebalanced when the
  change is smaller than one whole share at the raw open (the live planner trades whole
  shares only); everything else is fractional.
"""
from __future__ import annotations
import argparse
from datetime import date
import gzip
import json
import math
import os
from pathlib import Path
from statistics import fmean, pstdev

START_DATA = '2016-01-01'
DEV = ('2017-01-01', '2022-12-31')
HOLDOUT_START = '2023-01-01'
COST_BPS = 10.0
WINDOW = 253
STARTING = 1000.0
PICKS = 5
PER_SECTOR = 2
WEIGHT = 0.10

# Pre-registered (docs/STOCK_WEEKLY_BACKTEST_PLAN_2026_11_01.md). Nothing is added after results.
VARIANTS = {
    'momentum':          {'model': 'momentum', 'cadence': 'weekly', 'buffer': 0, 'lookback': 252},
    'steady':            {'model': 'steady', 'cadence': 'weekly', 'buffer': 0, 'lookback': 252},
    'momentum-buffer10': {'model': 'momentum', 'cadence': 'weekly', 'buffer': 10, 'lookback': 252},
    'steady-buffer10':   {'model': 'steady', 'cadence': 'weekly', 'buffer': 10, 'lookback': 252},
    'momentum-monthly':  {'model': 'momentum', 'cadence': 'monthly', 'buffer': 0, 'lookback': 252},
    'steady-monthly':    {'model': 'steady', 'cadence': 'monthly', 'buffer': 0, 'lookback': 252},
    'momentum-6m':       {'model': 'momentum', 'cadence': 'weekly', 'buffer': 0, 'lookback': 126},
    'steady-6m':         {'model': 'steady', 'cadence': 'weekly', 'buffer': 0, 'lookback': 126},
}
BASELINE_OF = {k: v['model'] for k, v in VARIANTS.items()}

# Round 2 (docs/STOCK_WEEKLY_BACKTEST_ROUND2_PLAN_2026_11_01.md, committed before its run): the two
# account-size limits. `weight` is the share of equity per pick (0.10 live, so at most 50% invested;
# 0.20 means fully invested with five picks); `price_cap` False drops the $95 cap (a larger account).
_LIVE = {'cadence': 'weekly', 'buffer': 0, 'lookback': 252}
ROUND2 = {
    'momentum':                     {'model': 'momentum', **_LIVE},
    'steady':                       {'model': 'steady', **_LIVE},
    'momentum-nocap':               {'model': 'momentum', **_LIVE, 'price_cap': False},
    'steady-nocap':                 {'model': 'steady', **_LIVE, 'price_cap': False},
    'momentum-full':                {'model': 'momentum', **_LIVE, 'weight': 0.20},
    'steady-full':                  {'model': 'steady', **_LIVE, 'weight': 0.20},
    'momentum-nocap-full':          {'model': 'momentum', **_LIVE, 'price_cap': False, 'weight': 0.20},
    'steady-nocap-full':            {'model': 'steady', **_LIVE, 'price_cap': False, 'weight': 0.20},
    'momentum-buffer10-nocap-full': {'model': 'momentum', **_LIVE, 'buffer': 10, 'price_cap': False, 'weight': 0.20},
    'momentum-6m-nocap-full':       {'model': 'momentum', **_LIVE, 'lookback': 126, 'price_cap': False, 'weight': 0.20},
}
# Round 3 (docs/STOCK_CHALLENGER_HOLDRANK10_PREREG_2026_11_19.md, committed before its run): ONE challenger, the
# top-10 hold buffer frozen on 2026-10-12 (analytics/stock_rank_buffer_candidate.py, HOLD_RANK_MAX=10), against the
# live rules, both with the $1,000 account's whole-share sizing. The fractional rows are reference only (not judged).
CURRENT, CHALLENGER = 'current', 'challenger-holdrank10'
ROUND3 = {
    CURRENT:                       {'model': 'momentum', **_LIVE, 'whole_shares': True},
    CHALLENGER:                    {'model': 'momentum', **_LIVE, 'buffer': 10, 'whole_shares': True},
    'current-fractional':          {'model': 'momentum', **_LIVE},
    'challenger-fractional':       {'model': 'momentum', **_LIVE, 'buffer': 10},
}
ROUND3_END = '2026-11-18'
# Round 4 (docs/STOCK_CHALLENGER_CASH_EFFICIENT_PREREG_2026_11_24.md, committed before its run): the SAME picks as the
# live rules (or the frozen hold buffer), sized by a cash-efficient whole-share allocator instead of floor(10%) alone.
# Its three constants come from existing registered limits, not from data: the live planner's 50% gross cap
# (5 picks x 10%), the $150 per-order limit on the $1,000 registration (15%), and half the 10% target (5%).
ALLOCATOR = 'fill-band-v1'
ALLOC_NAME_CAP = 0.15
ALLOC_BAND_LOW = 0.05
R4_CURRENT, R4_HOLD = 'current', 'holdrank10'
R4_FILL, R4_HOLD_FILL = 'current-fill', 'holdrank10-fill'
R4_CHALLENGERS = (R4_FILL, R4_HOLD_FILL)
ROUND4 = {
    R4_CURRENT:           {'model': 'momentum', **_LIVE, 'whole_shares': True},
    R4_HOLD:              {'model': 'momentum', **_LIVE, 'buffer': 10, 'whole_shares': True},
    R4_FILL:              {'model': 'momentum', **_LIVE, 'whole_shares': True, 'allocator': ALLOCATOR},
    R4_HOLD_FILL:         {'model': 'momentum', **_LIVE, 'buffer': 10, 'whole_shares': True, 'allocator': ALLOCATOR},
    'current-fractional': {'model': 'momentum', **_LIVE},
}
ROUND4_END = '2026-11-23'
ROUNDS = {1: VARIANTS, 2: ROUND2, 3: ROUND3, 4: ROUND4}


# ---------------------------------------------------------------- data

def align(data: dict) -> tuple[list[str], dict]:
    """Per-symbol arrays aligned to the session list; None where a bar is missing."""
    sessions = data['sessions']
    pos = {d: i for i, d in enumerate(sessions)}
    out = {}
    for sym, b in data['bars'].items():
        cols = {k: [None] * len(sessions) for k in ('o', 'c', 'v', 'ao', 'ac')}
        for j, d in enumerate(b['d']):
            i = pos.get(d)
            if i is None:
                continue
            for k in cols:
                cols[k][i] = b[k][j]
        out[sym] = cols
    return sessions, out


def is_decision(sessions: list[str], k: int, cadence: str) -> bool:
    a, b = date.fromisoformat(sessions[k - 1]), date.fromisoformat(sessions[k])
    if cadence == 'weekly':
        return a.isocalendar()[:2] != b.isocalendar()[:2]
    return (a.year, a.month) != (b.year, b.month)


# ---------------------------------------------------------------- scoring

def score(series: dict, k: int, lookback: int):
    """Scores from the 253 completed sessions before session k, or None if any bar is missing."""
    lo = k - WINDOW
    if lo < 0:
        return None
    w, raw, vol = series['ac'][lo:k], series['c'][lo:k], series['v'][lo:k]
    if any(x is None or x <= 0 for x in w) or any(x is None or x <= 0 for x in raw) or any(x is None for x in vol):
        return None
    momentum = w[-22] / w[-1 - lookback] - 1
    trend = w[-1] > sum(w[-200:]) / 200
    rets = [b / a - 1 for a, b in zip(w[-1 - lookback:-1], w[-lookback:])]
    m = fmean(rets)
    volatility = math.sqrt(sum((r - m) ** 2 for r in rets) / (len(rets) - 1))
    dollar_volume = fmean(c * v for c, v in zip(raw[-20:], vol[-20:]))
    return {'momentum': momentum, 'trend': trend, 'volatility': volatility,
            'eligible': raw[-1] >= 5 and dollar_volume >= 20_000_000, 'last_raw': raw[-1]}


def select(scores: dict, sectors: dict, held: set, spec: dict, price_cap: float | None) -> list[str]:
    pool = {s: x for s, x in scores.items() if s in held or price_cap is None or x['last_raw'] <= price_cap}
    if spec['model'] == 'momentum':
        ranked = sorted((s for s, x in pool.items() if x['eligible'] and x['trend'] and x['momentum'] > 0),
                        key=lambda s: (-pool[s]['momentum'], s))
    else:
        ranked = sorted((s for s, x in pool.items() if x['eligible'] and x['trend']),
                        key=lambda s: (pool[s]['volatility'], s))
    keep = [s for s in ranked[:spec['buffer']] if s in held] if spec['buffer'] else []
    chosen, per = [], {}
    for s in keep + ranked:
        if s in chosen or per.get(sectors[s], 0) >= PER_SECTOR:
            continue
        if len(chosen) == PICKS:
            break
        chosen.append(s)
        per[sectors[s]] = per.get(sectors[s], 0) + 1
    return chosen


# ---------------------------------------------------------------- replay

def replay(sessions: list[str], series: dict, universe: dict, spec: dict, *, start: str, end: str,
           cost_bps: float = COST_BPS, adjust=None):
    """`adjust(scores, series, k)` (research overlays only; default None = the registered rules unchanged) may mark
    members ineligible from information before session k. `spec['whole_shares']` (round 3) sizes every pick as the live
    planner does: floor(10% of equity / raw open) whole shares, traded only by whole-share differences."""
    sectors = {u['symbol']: u['sector'] for u in universe['securities']}
    members = [s for s in sorted(sectors) if s in series]
    cap = float(universe['max_last_close']) if 'max_last_close' in universe and spec.get('price_cap', True) else None
    weight = spec.get('weight', WEIGHT)
    units: dict[str, float] = {}
    cash = STARTING
    last_px: dict[str, float] = {}
    curve, decisions, rejected, traded, exposure, cash_blocked = [], 0, 0, 0.0, [], 0

    def px(sym, k, field):
        v = series[sym][field][k]
        if v is not None:
            last_px[sym] = v
        return last_px[sym]

    first = next(k for k in range(WINDOW, len(sessions)) if sessions[k] >= start)
    for k in range(first, len(sessions)):
        if sessions[k] > end:
            break
        if is_decision(sessions, k, spec['cadence']):
            decisions += 1
            scores = {}
            for s in members:
                x = score(series[s], k, spec['lookback'])
                if x is not None and series[s]['ao'][k] is not None:
                    scores[s] = x
            if adjust is not None:
                scores = adjust(scores, series, k)
            held = {s for s, u in units.items() if u > 0}
            if not held <= set(scores):
                rejected += 1  # live: HELD_SECURITY_SKIPPED rejects the decision; hold unchanged
            elif spec.get('whole_shares'):
                ordered = select(scores, sectors, held, spec, cap)
                picks = set(ordered)
                cash, moved, blocked = _whole_share_trades(series, k, units, cash, held | picks, picks, weight,
                                                            cost_bps, order=ordered if spec.get('allocator') else None)
                traded += moved
                cash_blocked += blocked
                units = {s: u for s, u in units.items() if u > 1e-12}
            else:
                picks = set(select(scores, sectors, held, spec, cap))
                equity = cash + sum(u * px(s, k, 'ao') for s, u in units.items())
                for s in sorted(held | picks):
                    p = px(s, k, 'ao')
                    target = weight * equity if s in picks else 0.0
                    delta = target - units.get(s, 0.0) * p
                    if s in picks and s in held and abs(delta) < series[s]['o'][k]:
                        continue  # under one whole share: the live planner would not trade it
                    fee = abs(delta) * cost_bps / 1e4
                    cash -= delta + fee
                    traded += abs(delta)
                    units[s] = target / p
                units = {s: u for s, u in units.items() if u > 1e-12}
        invested = sum(u * px(s, k, 'ac') for s, u in units.items())
        curve.append((sessions[k], cash + invested))
        exposure.append(invested / (cash + invested) if cash + invested > 0 else 0.0)
    return {'curve': curve, 'decisions': decisions, 'rejected': rejected, 'traded': traded,
            'avg_exposure': fmean(exposure) if exposure else 0.0, 'exposure': exposure, 'cash_blocked': cash_blocked}


def fill_band_targets(raw: dict, held: dict, order: list[str], equity: float, weight: float) -> dict:
    """Round 4 allocator `fill-band-v1` (whole shares; pure). `order` is the picks best-first.
    1. Band: a held pick whose value is within [5%, 15%] of equity keeps its shares (no single-share churn).
       Every other pick starts at floor(budget / price), budget = floor(10% of equity) in cents, as live.
    2. Gross: the total may not exceed len(order) x budget (50% with five picks, the live planner's cap). If banded
       positions exceed it, they return to floor(budget / price), worst-ranked first, until the total fits.
    3. Fill: the unused part of that total buys one more share at a time, best-ranked first and in repeated passes,
       while the share fits the remainder and the name stays at or below 15% of equity."""
    budget = math.floor(weight * equity * 100) / 100
    cap, low = ALLOC_NAME_CAP * equity, ALLOC_BAND_LOW * equity
    base = {s: math.floor(budget / raw[s]) for s in order}
    want = {s: held.get(s, 0) if held.get(s, 0) > 0 and low <= held.get(s, 0) * raw[s] <= cap else base[s]
            for s in order}
    total = len(order) * budget
    for s in reversed(order):
        if sum(want[x] * raw[x] for x in order) <= total + 1e-9:
            break
        want[s] = min(want[s], base[s])
    left = total - sum(want[x] * raw[x] for x in order)
    added = True
    while added:
        added = False
        for s in order:
            if raw[s] <= left + 1e-9 and (want[s] + 1) * raw[s] <= cap + 1e-9:
                want[s] += 1
                left -= raw[s]
                added = True
    return want


def _whole_share_trades(series: dict, k: int, units: dict, cash: float, names: set, picks: set, weight: float,
                        cost_bps: float, order: list[str] | None = None):
    """The live planner's sizing at session k's open (src/lib/stocks/paper-strategy-rebalance.ts): budget = 10% of
    equity, target = floor(budget / price) whole shares, held stocks not picked go to 0. Positions are kept in
    all-adjusted units (value = units x adjusted price); held raw shares are recovered with the raw/adjusted ratio, so
    a split never looks like a trade. Sells settle before buys; buys are all-or-nothing on cash, as in the planner."""
    adj = {s: series[s]['ao'][k] for s in names}
    raw = {s: series[s]['o'][k] for s in names}
    equity = cash + sum(u * adj[s] for s, u in units.items())  # every holding is in `names` (held | picks)
    budget = math.floor(weight * equity * 100) / 100
    delta = {}
    filled = None
    if order is not None:  # round 4 allocator; the default path below is rounds 1-3 unchanged
        ok = [s for s in order if raw[s] is not None and adj[s] is not None and raw[s] > 0 and adj[s] > 0]
        held_sh = {s: round(units.get(s, 0.0) * adj[s] / raw[s]) for s in ok}
        filled = fill_band_targets({s: raw[s] for s in ok}, held_sh, ok, equity, weight)
    for s in sorted(names):
        if raw[s] is None or adj[s] is None or raw[s] <= 0 or adj[s] <= 0:
            continue
        held = round(units.get(s, 0.0) * adj[s] / raw[s])
        want = (filled.get(s, 0) if filled is not None else math.floor(budget / raw[s])) if s in picks else 0
        if want != held:
            delta[s] = want - held
    moved, blocked = 0.0, 0
    for s, d in sorted(delta.items()):
        if d < 0:
            value = -d * raw[s]
            cash += value * (1 - cost_bps / 1e4)
            moved += value
            units[s] = (round(units.get(s, 0.0) * adj[s] / raw[s]) + d) * raw[s] / adj[s]
    buys = {s: d for s, d in delta.items() if d > 0}
    need = sum(d * raw[s] * (1 + cost_bps / 1e4) for s, d in buys.items())
    if buys and need > cash + 1e-9:
        return cash, moved, 1
    for s, d in sorted(buys.items()):
        value = d * raw[s]
        cash -= value * (1 + cost_bps / 1e4)
        moved += value
        units[s] = (round(units.get(s, 0.0) * adj[s] / raw[s]) + d) * raw[s] / adj[s]
    return cash, moved, blocked


def benchmark(sessions: list[str], spy: dict, *, start: str, end: str, weight: float):
    """SPY total return held at `weight` of equity (rest cash), rebalanced weekly, no costs."""
    first = next(k for k in range(WINDOW, len(sessions)) if sessions[k] >= start)
    equity, units, cash, curve, last = STARTING, 0.0, STARTING, [], None
    for k in range(first, len(sessions)):
        if sessions[k] > end:
            break
        o, c = spy['ao'][k], spy['ac'][k]
        last = c if c is not None else last
        if is_decision(sessions, k, 'weekly') or k == first:
            p = o if o is not None else last
            equity = cash + units * p
            units, cash = weight * equity / p, (1 - weight) * equity
        curve.append((sessions[k], cash + units * last))
    return {'curve': curve}


# ---------------------------------------------------------------- metrics

def metrics(curve: list[tuple[str, float]], lo: str, hi: str) -> dict:
    pts = [(d, v) for d, v in curve if lo <= d <= hi]
    if len(pts) < 2:
        return {}
    prev = [v for d, v in curve if d < lo]
    base = prev[-1] if prev else pts[0][1]
    values = [base] + [v for _, v in pts]
    rets = [b / a - 1 for a, b in zip(values, values[1:])]
    years = len(rets) / 252
    total = values[-1] / values[0] - 1
    sd = pstdev(rets)
    peak, mdd = values[0], 0.0
    for v in values:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return {'total': total, 'cagr': (1 + total) ** (1 / years) - 1 if years > 0 else None,
            'vol': sd * math.sqrt(252), 'sharpe': fmean(rets) / sd * math.sqrt(252) if sd > 0 else None,
            'max_drawdown': mdd, 'years': years, 'end_value': values[-1]}


def combine(a: list, b: list) -> list:
    assert [d for d, _ in a] == [d for d, _ in b]
    return [(d, x + y) for (d, x), (_, y) in zip(a, b)]


def evaluate(data: dict, universe: dict, end: str | None = None, round_: int = 1) -> dict:
    if round_ == 3:
        return evaluate_round3(data, universe, end)
    if round_ == 4:
        return evaluate_round4(data, universe, end)
    variants = ROUNDS[round_]
    sessions, series = align(data)
    end = end or sessions[-1]
    periods = {'dev': DEV, 'holdout': (HOLDOUT_START, end), 'full': (DEV[0], end)}
    out = {'round': round_, 'variants': {}, 'benchmarks': {}, 'periods': {k: list(v) for k, v in periods.items()},
           'sessions': [sessions[0], sessions[-1]], 'members_with_data': len([s for s in universe['securities']
                                                                              if s['symbol'] in series])}
    curves = {}
    for name, spec in variants.items():
        r = replay(sessions, series, universe, spec, start=DEV[0], end=end)
        curves[name] = r['curve']
        years = len(r['curve']) / 252
        out['variants'][name] = {'spec': spec, 'decisions': r['decisions'], 'rejected': r['rejected'],
                                 'turnover_per_year': r['traded'] / STARTING / years if years else None,
                                 'avg_exposure': r['avg_exposure'],
                                 **{p: metrics(r['curve'], *rng) for p, rng in periods.items()}}
    curves['combined'] = combine(curves['momentum'], curves['steady'])
    out['variants']['combined'] = {p: metrics(curves['combined'], *rng) for p, rng in periods.items()}
    if round_ == 2:
        curves['combined-nocap-full'] = combine(curves['momentum-nocap-full'], curves['steady-nocap-full'])
        out['variants']['combined-nocap-full'] = {p: metrics(curves['combined-nocap-full'], *rng)
                                                  for p, rng in periods.items()}
    if 'SPY' in series:
        for label, weight in (('spy', 1.0), ('spy-50', 0.5)):
            c = benchmark(sessions, series['SPY'], start=DEV[0], end=end, weight=weight)['curve']
            out['benchmarks'][label] = {p: metrics(c, *rng) for p, rng in periods.items()}
    # Cost sensitivity for the two live strategies only.
    for name in ('momentum', 'steady'):
        r = replay(sessions, series, universe, VARIANTS[name], start=DEV[0], end=end, cost_bps=25)
        out['variants'][name]['full_at_25bps'] = metrics(r['curve'], *periods['full'])
    out['verdicts'] = verdicts(out) if round_ == 1 else verdicts_round2(out)
    return out


def weekly_returns(curve: list[tuple[str, float]], lo: str, hi: str) -> dict:
    """Return per ISO week from each week's last value (the first week is measured from the prior value)."""
    last: dict = {}
    for d, v in curve:
        last[date.fromisoformat(d).isocalendar()[:2]] = (d, v)
    weeks = sorted(last.values())
    return {b[0]: b[1] / a[1] - 1 for a, b in zip(weeks, weeks[1:]) if lo <= b[0] <= hi}


def evaluate_round3(data: dict, universe: dict, end: str | None = None) -> dict:
    """Round 3: the frozen hold-buffer challenger against the live rules, whole shares, SPY at matched exposure."""
    sessions, series = align(data)
    end = end or sessions[-1]
    periods = {'dev': DEV, 'holdout': (HOLDOUT_START, end), 'full': (DEV[0], end)}
    out = {'round': 3, 'variants': {}, 'benchmarks': {}, 'matched_spy': {}, 'periods': {k: list(v) for k, v in periods.items()},
           'sessions': [sessions[0], sessions[-1]], 'end': end, 'universe_revision': universe.get('revision'),
           'members_with_data': len([s for s in universe['securities'] if s['symbol'] in series])}
    curves = {}
    for name, spec in ROUND3.items():
        r = replay(sessions, series, universe, spec, start=DEV[0], end=end)
        curves[name] = r['curve']
        years = len(r['curve']) / 252
        dates = [d for d, _ in r['curve']]
        exp = {p: (fmean([x for d, x in zip(dates, r['exposure']) if lo <= d <= hi]) if any(lo <= d <= hi for d in dates)
                   else None) for p, (lo, hi) in periods.items()}
        row = {'spec': spec, 'judged': bool(spec.get('whole_shares')), 'decisions': r['decisions'],
               'rejected': r['rejected'], 'cash_blocked': r['cash_blocked'],
               'turnover_per_year': r['traded'] / STARTING / years if years else None,
               'avg_exposure': r['avg_exposure'], 'exposure_by_period': exp,
               **{p: metrics(r['curve'], *rng) for p, rng in periods.items()}}
        if spec.get('whole_shares'):
            r25 = replay(sessions, series, universe, spec, start=DEV[0], end=end, cost_bps=25)
            row['full_at_25bps'] = metrics(r25['curve'], *periods['full'])
            row['holdout_at_25bps'] = metrics(r25['curve'], *periods['holdout'])
            if 'SPY' in series:
                out['matched_spy'][name] = {p: metrics(benchmark(sessions, series['SPY'], start=DEV[0], end=end,
                                                                 weight=exp[p])['curve'], *rng)
                                            for p, rng in periods.items() if exp[p] is not None}
                for p in out['matched_spy'][name]:
                    out['matched_spy'][name][p]['weight'] = exp[p]
        out['variants'][name] = row
    if 'SPY' in series:
        for label, weight in (('spy', 1.0), ('spy-50', 0.5)):
            c = benchmark(sessions, series['SPY'], start=DEV[0], end=end, weight=weight)['curve']
            out['benchmarks'][label] = {p: metrics(c, *rng) for p, rng in periods.items()}
    a, b = weekly_returns(curves[CHALLENGER], *periods['holdout']), weekly_returns(curves[CURRENT], *periods['holdout'])
    diff = [a[w] - b[w] for w in sorted(set(a) & set(b))]
    sd = pstdev(diff) if len(diff) > 1 else 0.0
    out['paired_weekly_holdout'] = {'weeks': len(diff), 'mean': fmean(diff) if diff else None,
                                    't_stat': fmean(diff) / (sd / math.sqrt(len(diff))) if sd > 0 else None,
                                    'note': 'descriptive only; not part of the pre-registered rule'}
    out['verdicts'] = verdicts_round3(out)
    return out


def verdicts_round3(out: dict) -> dict:
    """docs/STOCK_CHALLENGER_HOLDRANK10_PREREG_2026_11_19.md. A tie is not better; a missing metric is a failure."""
    def above(x, y, key='sharpe'):
        u, v = (x or {}).get(key), (y or {}).get(key)
        return u is not None and v is not None and u > v
    a, b = out['variants'][CHALLENGER], out['variants'][CURRENT]
    dd = lambda r: (r.get('holdout') or {}).get('max_drawdown')
    r1 = all(above(a.get(p), b.get(p)) for p in ('dev', 'holdout')) and dd(a) is not None and dd(b) is not None \
        and dd(a) >= dd(b) - 0.05 and above(b, a, 'turnover_per_year')
    r2 = above(a.get('full_at_25bps'), b.get('full_at_25bps'))
    m = out.get('matched_spy', {}).get(CHALLENGER, {})
    r3 = all(above(a.get(p), m.get(p)) for p in ('dev', 'holdout'))
    verdict = 'PROMISING' if r1 and r2 and r3 else 'BEATS_CURRENT_BELOW_MATCHED_SPY' if r1 and r2 else 'REJECTED'
    status = {'PROMISING': 'PROMISING', 'BEATS_CURRENT_BELOW_MATCHED_SPY': 'RUNNING', 'REJECTED': 'REJECTED'}[verdict]
    return {'R1_beats_current': r1, 'R2_survives_25bps': r2, 'R3_beats_matched_spy': r3, 'verdict': verdict,
            'registry_status': status}


def _paired(a: dict, b: dict) -> dict:
    diff = [a[w] - b[w] for w in sorted(set(a) & set(b))]
    sd = pstdev(diff) if len(diff) > 1 else 0.0
    return {'weeks': len(diff), 'mean': fmean(diff) if diff else None,
            't_stat': fmean(diff) / (sd / math.sqrt(len(diff))) if sd > 0 else None}


def evaluate_round4(data: dict, universe: dict, end: str | None = None) -> dict:
    """Round 4: cash-efficient whole-share allocator on the live and hold-buffer picks, against the live rules and SPY
    at each strategy's own realized exposure. Costs 10 bps judged, 25 bps robustness."""
    sessions, series = align(data)
    end = end or sessions[-1]
    periods = {'dev': DEV, 'holdout': (HOLDOUT_START, end), 'full': (DEV[0], end)}
    out = {'round': 4, 'variants': {}, 'benchmarks': {}, 'matched_spy': {}, 'periods': {k: list(v) for k, v in periods.items()},
           'sessions': [sessions[0], sessions[-1]], 'end': end, 'universe_revision': universe.get('revision'),
           'members_with_data': len([s for s in universe['securities'] if s['symbol'] in series]),
           'allocator': {'id': ALLOCATOR, 'nameCap': ALLOC_NAME_CAP, 'bandLow': ALLOC_BAND_LOW}}
    curves, matched_curves = {}, {}
    for name, spec in ROUND4.items():
        r = replay(sessions, series, universe, spec, start=DEV[0], end=end)
        curves[name] = r['curve']
        years = len(r['curve']) / 252
        dates = [d for d, _ in r['curve']]
        exp = {p: (fmean([x for d, x in zip(dates, r['exposure']) if lo <= d <= hi]) if any(lo <= d <= hi for d in dates)
                   else None) for p, (lo, hi) in periods.items()}
        row = {'spec': spec, 'judged': bool(spec.get('whole_shares')), 'decisions': r['decisions'],
               'rejected': r['rejected'], 'cash_blocked': r['cash_blocked'],
               'turnover_per_year': r['traded'] / STARTING / years if years else None,
               'avg_exposure': r['avg_exposure'], 'exposure_by_period': exp,
               **{p: metrics(r['curve'], *rng) for p, rng in periods.items()}}
        if spec.get('whole_shares'):
            r25 = replay(sessions, series, universe, spec, start=DEV[0], end=end, cost_bps=25)
            row['full_at_25bps'] = metrics(r25['curve'], *periods['full'])
            row['holdout_at_25bps'] = metrics(r25['curve'], *periods['holdout'])
            if 'SPY' in series:
                out['matched_spy'][name] = {}
                for p, rng in periods.items():
                    if exp[p] is None:
                        continue
                    c = benchmark(sessions, series['SPY'], start=DEV[0], end=end, weight=exp[p])['curve']
                    out['matched_spy'][name][p] = metrics(c, *rng) | {'weight': exp[p]}
                    if p == 'holdout':
                        matched_curves[name] = c
        out['variants'][name] = row
    if 'SPY' in series:
        for label, weight in (('spy', 1.0), ('spy-50', 0.5)):
            c = benchmark(sessions, series['SPY'], start=DEV[0], end=end, weight=weight)['curve']
            out['benchmarks'][label] = {p: metrics(c, *rng) for p, rng in periods.items()}
    hold = periods['holdout']
    out['paired_weekly_holdout'] = {}
    for name in R4_CHALLENGERS:
        a = weekly_returns(curves[name], *hold)
        out['paired_weekly_holdout'][name] = {'vs_current': _paired(a, weekly_returns(curves[R4_CURRENT], *hold))}
        if name in matched_curves:
            out['paired_weekly_holdout'][name]['vs_matched_spy'] = _paired(a, weekly_returns(matched_curves[name], *hold))
    out['paired_weekly_holdout']['note'] = 'descriptive only; not part of the pre-registered rule'
    out['verdicts'] = verdicts_round4(out)
    return out


def verdicts_round4(out: dict) -> dict:
    """docs/STOCK_CHALLENGER_CASH_EFFICIENT_PREREG_2026_11_24.md. Each challenger is judged on its own against the
    live rules (`current`). A tie is not better; a missing metric is a failure."""
    def above(x, y, key='sharpe'):
        u, v = (x or {}).get(key), (y or {}).get(key)
        return u is not None and v is not None and u > v
    b = out['variants'][R4_CURRENT]
    dd = lambda r: (r.get('holdout') or {}).get('max_drawdown')
    exposure = lambda r: r.get('avg_exposure')
    res = {}
    for name in R4_CHALLENGERS:
        a = out['variants'][name]
        r1 = all(above(a.get(p), b.get(p)) for p in ('dev', 'holdout')) and dd(a) is not None and dd(b) is not None \
            and dd(a) >= dd(b) - 0.05
        r2 = above(a.get('full_at_25bps'), b.get('full_at_25bps'))
        r3 = exposure(a) is not None and exposure(b) is not None and exposure(a) >= exposure(b) + 0.05
        m = out.get('matched_spy', {}).get(name, {})
        r4 = all(above(a.get(p), m.get(p)) for p in ('dev', 'holdout'))
        verdict = 'PROMISING' if r1 and r2 and r3 and r4 else 'BEATS_CURRENT_BELOW_MATCHED_SPY' if r1 and r2 and r3 \
            else 'REJECTED'
        status = {'PROMISING': 'PROMISING', 'BEATS_CURRENT_BELOW_MATCHED_SPY': 'RUNNING', 'REJECTED': 'REJECTED'}[verdict]
        res[name] = {'R1_beats_current': r1, 'R2_survives_25bps': r2, 'R3_invests_more': r3,
                     'R4_beats_matched_spy': r4, 'verdict': verdict, 'registry_status': status}
    return res


def markdown_round4(out: dict) -> str:
    pct = lambda x: '—' if x is None else f'{x * 100:+.1f}%'
    num = lambda x: '—' if x is None else f'{x:.2f}'
    lines = [f"Round 4 · sessions {out['sessions'][0]} to {out['sessions'][1]} · end {out['end']} · universe "
             f"{out['universe_revision']} · members with data {out['members_with_data']} · {COST_BPS:g} bps per side · "
             f"whole shares from $1,000, allocator {out['allocator']['id']} (judged) · NOT survivorship-free", '']
    for p in ('dev', 'holdout', 'full'):
        lo, hi = out['periods'][p]
        lines += [f'### {p} ({lo} to {hi})', '', '| Strategy | Total | CAGR | Volatility | Sharpe | Max drawdown | Avg invested |',
                  '|---|---|---|---|---|---|---|']
        rows = [(n, r, r.get('exposure_by_period', {}).get(p)) for n, r in out['variants'].items()]
        rows += [(f'SPY at {n} exposure', m, m.get(p, {}).get('weight')) for n, m in out['matched_spy'].items()]
        rows += [('SPY (100%)', out['benchmarks'].get('spy', {}), 1.0), ('SPY 50% + cash', out['benchmarks'].get('spy-50', {}), 0.5)]
        for name, r, w in rows:
            m = r.get(p, {})
            if m:
                lines.append(f"| {name} | {pct(m['total'])} | {pct(m['cagr'])} | {pct(m['vol'])} | {num(m['sharpe'])} | "
                             f"{pct(m['max_drawdown'])} | {'—' if w is None else f'{w * 100:.0f}%'} |")
        lines.append('')
    lines += ['### Operations and costs (full period)', '', '| Strategy | Judged | Decisions | Rejected | Cash-blocked | Turnover / yr | '
              'Full Sharpe at 25 bps | Full CAGR at 25 bps | Holdout Sharpe at 25 bps |', '|---|---|---|---|---|---|---|---|---|']
    for name, r in out['variants'].items():
        f25, h25 = r.get('full_at_25bps', {}), r.get('holdout_at_25bps', {})
        lines.append(f"| {name} | {'yes' if r['judged'] else 'reference'} | {r['decisions']} | {r['rejected']} | {r['cash_blocked']} | "
                     f"{r['turnover_per_year']:.1f}× | {num(f25.get('sharpe'))} | {pct(f25.get('cagr'))} | {num(h25.get('sharpe'))} |")
    lines += ['', '### Paired weekly differences in the holdout (descriptive)', '', '| Challenger | Versus | Weeks | Mean | t |',
              '|---|---|---|---|---|']
    for name in R4_CHALLENGERS:
        for versus, x in out['paired_weekly_holdout'].get(name, {}).items():
            lines.append(f"| {name} | {versus} | {x['weeks']} | {pct(x['mean'])} | {num(x['t_stat'])} |")
    lines += ['', '### Pre-registered verdicts', '']
    for name, v in out['verdicts'].items():
        lines.append(f"- **{name}**: R1 beats current {v['R1_beats_current']} · R2 survives 25 bps {v['R2_survives_25bps']} · "
                     f"R3 invests 5+ points more {v['R3_invests_more']} · R4 beats SPY at its own exposure "
                     f"{v['R4_beats_matched_spy']} → **{v['verdict']}** (registry `{v['registry_status']}`)")
    return '\n'.join(lines) + '\n'


def verdicts(out: dict) -> dict:
    """Pre-registered rule: a variant is promising only if its Sharpe beats its baseline in BOTH the
    development and the holdout period, and its holdout drawdown is no more than 5 points worse."""
    v = {}
    for name, base in BASELINE_OF.items():
        if name == base:
            continue
        a, b = out['variants'][name], out['variants'][base]
        sharpe = lambda r, p: r[p].get('sharpe') if r[p].get('sharpe') is not None else -math.inf
        ok = all(sharpe(a, p) > sharpe(b, p) for p in ('dev', 'holdout')) \
            and a['holdout']['max_drawdown'] >= b['holdout']['max_drawdown'] - 0.05
        v[name] = 'PROMISING' if ok else 'NOT_BETTER'
    return v


def verdicts_round2(out: dict) -> dict:
    """Round 2 rules. vs_live: the round-1 rule against the live strategy of the same model.
    vs_spy: Sharpe above the exposure-matched benchmark (SPY 50% + cash for 10% picks, SPY 100% for
    20% picks) in BOTH periods."""
    sharpe = lambda r, p: r[p].get('sharpe') if r[p].get('sharpe') is not None else -math.inf
    vs_live, vs_spy = {}, {}
    for name, spec in ROUND2.items():
        a = out['variants'][name]
        bench = out['benchmarks'].get('spy' if spec.get('weight', WEIGHT) > WEIGHT else 'spy-50')
        if bench:
            vs_spy[name] = 'BEATS_SPY' if all(sharpe(a, p) > sharpe(bench, p) for p in ('dev', 'holdout')) else 'BELOW_SPY'
        if name in ('momentum', 'steady'):
            continue
        b = out['variants'][spec['model']]
        ok = all(sharpe(a, p) > sharpe(b, p) for p in ('dev', 'holdout')) \
            and a['holdout']['max_drawdown'] >= b['holdout']['max_drawdown'] - 0.05
        vs_live[name] = 'PROMISING' if ok else 'NOT_BETTER'
    for name, bench in (('combined', 'spy-50'), ('combined-nocap-full', 'spy')):
        if name in out['variants'] and bench in out['benchmarks']:
            vs_spy[name] = 'BEATS_SPY' if all(sharpe(out['variants'][name], p) > sharpe(out['benchmarks'][bench], p)
                                              for p in ('dev', 'holdout')) else 'BELOW_SPY'
    return {'vs_live': vs_live, 'vs_spy': vs_spy}


def markdown_round3(out: dict) -> str:
    pct = lambda x: '—' if x is None else f'{x * 100:+.1f}%'
    num = lambda x: '—' if x is None else f'{x:.2f}'
    lines = [f"Round 3 · sessions {out['sessions'][0]} to {out['sessions'][1]} · end {out['end']} · universe "
             f"{out['universe_revision']} · members with data {out['members_with_data']} · {COST_BPS:g} bps per side · "
             'whole shares from $1,000 (judged) · NOT survivorship-free', '']
    for p in ('dev', 'holdout', 'full'):
        lo, hi = out['periods'][p]
        lines += [f'### {p} ({lo} to {hi})', '', '| Strategy | Total | CAGR | Volatility | Sharpe | Max drawdown | Avg invested |',
                  '|---|---|---|---|---|---|---|']
        rows = [(n, r, r.get('exposure_by_period', {}).get(p)) for n, r in out['variants'].items()]
        rows += [(f'SPY at {n} exposure', m, m.get(p, {}).get('weight')) for n, m in out['matched_spy'].items()]
        rows += [('SPY (100%)', out['benchmarks'].get('spy', {}), 1.0), ('SPY 50% + cash', out['benchmarks'].get('spy-50', {}), 0.5)]
        for name, r, w in rows:
            m = r.get(p, {})
            if m:
                lines.append(f"| {name} | {pct(m['total'])} | {pct(m['cagr'])} | {pct(m['vol'])} | {num(m['sharpe'])} | "
                             f"{pct(m['max_drawdown'])} | {'—' if w is None else f'{w * 100:.0f}%'} |")
        lines.append('')
    lines += ['### Operations and costs (full period)', '', '| Strategy | Judged | Decisions | Rejected | Cash-blocked | Turnover / yr | '
              'Full Sharpe at 25 bps | Full CAGR at 25 bps |', '|---|---|---|---|---|---|---|---|']
    for name, r in out['variants'].items():
        f25 = r.get('full_at_25bps', {})
        lines.append(f"| {name} | {'yes' if r['judged'] else 'reference'} | {r['decisions']} | {r['rejected']} | {r['cash_blocked']} | "
                     f"{r['turnover_per_year']:.1f}× | {num(f25.get('sharpe'))} | {pct(f25.get('cagr'))} |")
    pw = out['paired_weekly_holdout']
    v = out['verdicts']
    lines += ['', f"Paired weekly difference in the holdout (challenger − current, descriptive): {pw['weeks']} weeks, "
              f"mean {pct(pw['mean'])}, t {num(pw['t_stat'])}.", '', '### Pre-registered verdict', '',
              f"- R1 beats the current rules (Sharpe in both periods, holdout drawdown, turnover): **{v['R1_beats_current']}**",
              f"- R2 survives 25 bps: **{v['R2_survives_25bps']}**",
              f"- R3 beats SPY at its own exposure in both periods: **{v['R3_beats_matched_spy']}**",
              f"- Verdict: **{v['verdict']}** → learning registry `{v['registry_status']}**`".replace('**`', '`')]
    return '\n'.join(lines) + '\n'


def markdown(out: dict) -> str:
    if out.get('round') == 3:
        return markdown_round3(out)
    if out.get('round') == 4:
        return markdown_round4(out)
    pct = lambda x: '—' if x is None else f'{x * 100:+.1f}%'
    num = lambda x: '—' if x is None else f'{x:.2f}'
    lines = [f"Sessions {out['sessions'][0]} to {out['sessions'][1]} · members with data {out['members_with_data']} · "
             f"costs {COST_BPS:g} bps per side · fractional-share approximation · NOT survivorship-free", '']
    for p in ('dev', 'holdout', 'full'):
        lo, hi = out['periods'][p]
        lines += [f'### {p} ({lo} to {hi})', '',
                  '| Strategy | Total | CAGR | Volatility | Sharpe | Max drawdown | End value of $1,000 |', '|---|---|---|---|---|---|---|']
        rows = list(out['variants'].items()) + [('SPY (100%)', out['benchmarks'].get('spy', {})),
                                                ('SPY 50% + cash 50%', out['benchmarks'].get('spy-50', {}))]
        for name, r in rows:
            m = r.get(p, {})
            if not m:
                continue
            lines.append(f"| {name} | {pct(m['total'])} | {pct(m['cagr'])} | {pct(m['vol'])} | {num(m['sharpe'])} | "
                         f"{pct(m['max_drawdown'])} | ${STARTING * (1 + m['total']):,.0f} |")
        lines.append('')
    lines += ['### Operations (full period)', '', '| Strategy | Decisions | Rejected (held stock unscored) | Turnover / yr | Avg invested | Full total at 25 bps |',
              '|---|---|---|---|---|---|']
    for name, r in out['variants'].items():
        if 'decisions' not in r:
            continue
        lines.append(f"| {name} | {r['decisions']} | {r['rejected']} | {r['turnover_per_year']:.1f}× | "
                     f"{r['avg_exposure'] * 100:.0f}% | {pct(r.get('full_at_25bps', {}).get('total'))} |")
    lines += ['', '### Pre-registered verdicts', '']
    if out.get('round', 1) == 1:
        lines += [f'- {k}: **{v}**' for k, v in out['verdicts'].items()]
    else:
        for rule, items in out['verdicts'].items():
            lines += [f'**{rule}**', ''] + [f'- {k}: **{v}**' for k, v in items.items()] + ['']
    return '\n'.join(lines) + '\n'


# ---------------------------------------------------------------- fetch (network, opt-in)

def fetch(source, symbols: list[str], start: str, end: str) -> dict:
    from .stock_forward_bridge_v1 import DATA, PAPER
    calendar = source.fetch(PAPER, '/v2/calendar', {'start': start, 'end': end})
    sessions = sorted(r['date'] for r in calendar)
    bars: dict = {}
    for adjustment, keys in (('raw', ('o', 'c', 'v')), ('all', ('ao', 'ac'))):
        for i in range(0, len(symbols), 40):
            group = symbols[i:i + 40]
            pages = source.paged(DATA, '/v2/stocks/bars', {'symbols': ','.join(group), 'timeframe': '1Day',
                                                            'start': start, 'end': end, 'adjustment': adjustment,
                                                            'feed': 'sip', 'asof': end, 'limit': 10000})
            for page in pages:
                for sym, rows in (page.get('bars') or {}).items():
                    b = bars.setdefault(sym, {})
                    for r in rows:
                        d = r['t'][:10]
                        row = b.setdefault(d, {})
                        if adjustment == 'raw':
                            row.update(o=float(r['o']), c=float(r['c']), v=float(r['v']))
                        else:
                            row.update(ao=float(r['o']), ac=float(r['c']))
    out = {}
    for sym, rows in bars.items():
        days = sorted(d for d, r in rows.items() if len(r) == 5)
        out[sym] = {'d': days, **{k: [rows[d][k] for d in days] for k in ('o', 'c', 'v', 'ao', 'ac')}}
    return {'sessions': sessions, 'bars': out, 'feed': 'sip', 'asof': end}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--universe', type=Path, required=True)
    f.add_argument('--end', required=True)
    f.add_argument('--output', type=Path, required=True)
    r = sub.add_parser('run')
    r.add_argument('--universe', type=Path, required=True)
    r.add_argument('--data', type=Path, required=True)
    r.add_argument('--output', type=Path, required=True)
    r.add_argument('--markdown', type=Path, required=True)
    r.add_argument('--round', type=int, choices=sorted(ROUNDS), default=1)
    a = p.parse_args()
    universe = json.loads(a.universe.read_text(encoding='utf-8'))
    if a.command == 'fetch':
        from .stock_forward_bridge_v1 import Source
        source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''))
        symbols = sorted({s['symbol'] for s in universe['securities']} | {'SPY'})
        data = fetch(source, symbols, START_DATA, a.end)
        with gzip.open(a.output, 'wt', encoding='utf-8') as fh:
            json.dump(data, fh)
        print(json.dumps({'status': 'FETCHED', 'sessions': len(data['sessions']), 'symbols': len(data['bars']),
                          'requests': source.count}))
        return
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    out = evaluate(data, universe, round_=a.round)
    a.output.write_text(json.dumps(out, indent=1), encoding='utf-8')
    a.markdown.write_text(markdown(out), encoding='utf-8')
    print(markdown(out))


if __name__ == '__main__':
    main()
