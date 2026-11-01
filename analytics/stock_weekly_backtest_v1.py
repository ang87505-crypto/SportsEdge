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
           cost_bps: float = COST_BPS):
    sectors = {u['symbol']: u['sector'] for u in universe['securities']}
    members = [s for s in sorted(sectors) if s in series]
    cap = float(universe['max_last_close']) if 'max_last_close' in universe else None
    units: dict[str, float] = {}
    cash = STARTING
    last_px: dict[str, float] = {}
    curve, decisions, rejected, traded, exposure = [], 0, 0, 0.0, []

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
            held = {s for s, u in units.items() if u > 0}
            if not held <= set(scores):
                rejected += 1  # live: HELD_SECURITY_SKIPPED rejects the decision; hold unchanged
            else:
                picks = set(select(scores, sectors, held, spec, cap))
                equity = cash + sum(u * px(s, k, 'ao') for s, u in units.items())
                for s in sorted(held | picks):
                    p = px(s, k, 'ao')
                    target = WEIGHT * equity if s in picks else 0.0
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
            'avg_exposure': fmean(exposure) if exposure else 0.0}


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


def evaluate(data: dict, universe: dict, end: str | None = None) -> dict:
    sessions, series = align(data)
    end = end or sessions[-1]
    periods = {'dev': DEV, 'holdout': (HOLDOUT_START, end), 'full': (DEV[0], end)}
    out = {'variants': {}, 'benchmarks': {}, 'periods': {k: list(v) for k, v in periods.items()},
           'sessions': [sessions[0], sessions[-1]], 'members_with_data': len([s for s in universe['securities']
                                                                              if s['symbol'] in series])}
    curves = {}
    for name, spec in VARIANTS.items():
        r = replay(sessions, series, universe, spec, start=DEV[0], end=end)
        curves[name] = r['curve']
        years = len(r['curve']) / 252
        out['variants'][name] = {'spec': spec, 'decisions': r['decisions'], 'rejected': r['rejected'],
                                 'turnover_per_year': r['traded'] / STARTING / years if years else None,
                                 'avg_exposure': r['avg_exposure'],
                                 **{p: metrics(r['curve'], *rng) for p, rng in periods.items()}}
    curves['combined'] = combine(curves['momentum'], curves['steady'])
    out['variants']['combined'] = {p: metrics(curves['combined'], *rng) for p, rng in periods.items()}
    if 'SPY' in series:
        for label, weight in (('spy', 1.0), ('spy-50', 0.5)):
            c = benchmark(sessions, series['SPY'], start=DEV[0], end=end, weight=weight)['curve']
            out['benchmarks'][label] = {p: metrics(c, *rng) for p, rng in periods.items()}
    # Cost sensitivity for the two live strategies only.
    for name in ('momentum', 'steady'):
        r = replay(sessions, series, universe, VARIANTS[name], start=DEV[0], end=end, cost_bps=25)
        out['variants'][name]['full_at_25bps'] = metrics(r['curve'], *periods['full'])
    out['verdicts'] = verdicts(out)
    return out


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


def markdown(out: dict) -> str:
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
    lines += ['', '### Pre-registered verdicts', ''] + [f'- {k}: **{v}**' for k, v in out['verdicts'].items()]
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
    out = evaluate(data, universe)
    a.output.write_text(json.dumps(out, indent=1), encoding='utf-8')
    a.markdown.write_text(markdown(out), encoding='utf-8')
    print(markdown(out))


if __name__ == '__main__':
    main()
