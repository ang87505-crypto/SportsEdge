"""Cost-aware momentum research; never imported by a broker, signal bridge or worker.

Fixed hypotheses: docs/STOCK_MOMENTUM_COST_AWARE_PLAN_2026_11_01.md.
Reuses v1's completed-session features and selector. Fractional total-return units,
survivor-selected universe, already-seen history: NOT a verified historical edge.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
from statistics import fmean, pstdev

from . import stock_weekly_backtest_v1 as old

VERSION = 'stock-cost-aware-research-v2'
START = '2017-01-01'
COSTS = (10, 25, 50)
STARTING = 1000.0
SPECS = {
    'current': {'weight': .10, 'price_cap': True, 'buffer': 0, 'band': 0.0, 'ranking': 'momentum'},
    'uncapped': {'weight': .10, 'price_cap': False, 'buffer': 0, 'band': 0.0, 'ranking': 'momentum'},
    'cost-aware': {'weight': .10, 'price_cap': False, 'buffer': 10, 'band': .20, 'ranking': 'momentum'},
    'risk-adjusted': {'weight': .10, 'price_cap': False, 'buffer': 10, 'band': .20, 'ranking': 'momentum/vol'},
    'full-cost-aware': {'weight': .20, 'price_cap': False, 'buffer': 10, 'band': .20, 'ranking': 'momentum'},
}


def finite(value, name, *, positive=False):
    if type(value) not in (int, float) or not math.isfinite(value) or (positive and value <= 0):
        raise ValueError(f'{name}: finite {"positive " if positive else ""}number required')
    return float(value)


def validate(data, universe):
    sessions = data['sessions']
    if not sessions or sessions != sorted(set(sessions)):
        raise ValueError('sessions must be sorted and unique')
    for d in sessions:
        if date.fromisoformat(d).isoformat() != d:
            raise ValueError('invalid session')
    members = [r['symbol'] for r in universe['securities']]
    if not members or len(members) != len(set(members)):
        raise ValueError('universe must be nonempty and unique')
    for sym, b in data['bars'].items():
        days = b['d']
        if days != sorted(set(days)) or not set(days) <= set(sessions):
            raise ValueError(f'{sym}: invalid or duplicate bar dates')
        for key in ('o', 'c', 'v', 'ao', 'ac'):
            if len(b[key]) != len(days):
                raise ValueError(f'{sym}: inconsistent column lengths')
            for x in b[key]:
                finite(x, sym + '.' + key, positive=key != 'v')
                if key == 'v' and x < 0:
                    raise ValueError('negative volume')
    if 'SPY' not in data['bars']:
        raise ValueError('SPY benchmark data required')


def select(scores, sectors, held, spec, cap):
    # No decision-day prices/availability enter ranking. The caller computes these
    # scores exclusively from [k-WINDOW, k), with the unchanged v1 mathematics.
    if spec['ranking'] == 'momentum/vol':
        scores = {s: x | {'momentum': x['momentum'] / x['volatility']}
                  for s, x in scores.items() if x['volatility'] > 0}
    elif spec['ranking'] != 'momentum':
        raise ValueError('unknown ranking')
    return old.select(scores, sectors, held, {'model': 'momentum', 'buffer': spec['buffer']}, cap)


def rebalance(values, cash, targets, raw_prices, *, cost_bps, band=0.0, use_share_threshold=True):
    """Dollar ledger: sell first, then buy pro rata from available cash including costs.

    Continuing positions keep the inherited one-raw-share threshold. A band is a
    fraction of the target value, not a fraction of the account. Exits bypass it.
    The input dictionaries are never mutated. Returned legs support independent
    reconciliation of cash, costs and each position's notional.
    """
    rate = finite(cost_bps, 'cost_bps') / 10000
    if not 0 <= rate < 1 or not 0 <= finite(band, 'band') < 1:
        raise ValueError('invalid costs or band')
    cash = finite(cash, 'cash')
    if cash < 0:
        raise ValueError('negative starting cash')
    holdings = {s: finite(v, s + '.value') for s, v in values.items()}
    goals = {s: finite(v, s + '.target') for s, v in targets.items()}
    if any(v < 0 for v in (*holdings.values(), *goals.values())):
        raise ValueError('long-only values required')
    equity = cash + sum(holdings.values())
    tolerance = 1e-10 * max(1.0, equity)
    if sum(goals.values()) > equity + tolerance:
        raise ValueError('targets exceed unlevered equity')
    sells, buys, legs = [], [], []
    for s in sorted(holdings.keys() | goals.keys()):
        current, target = holdings.get(s, 0.0), goals.get(s, 0.0)
        delta = target - current
        if current > 0 and target > 0:
            threshold = finite(raw_prices[s], s + '.raw_price', positive=True) if use_share_threshold else 0.0
            if abs(delta) < threshold or (band and abs(delta) <= band * target):
                continue
        if delta < 0:
            sells.append((s, -delta))
        elif delta > 0:
            buys.append((s, delta))
    for s, amount in sells:
        fee = amount * rate
        cash += amount - fee
        holdings[s] -= amount
        legs.append({'symbol': s, 'side': 'sell', 'notional': amount, 'cost': fee, 'cash_delta': amount - fee})
    proposed = sum(amount for _, amount in buys)
    scale = min(1.0, cash / (proposed * (1 + rate))) if proposed else 1.0
    for s, amount in buys:
        amount *= scale
        if amount == 0:
            continue
        fee = amount * rate
        cash -= amount + fee
        if cash < -tolerance:
            raise ArithmeticError('cash invariant violated')
        holdings[s] = holdings.get(s, 0.0) + amount
        legs.append({'symbol': s, 'side': 'buy', 'notional': amount, 'cost': fee, 'cash_delta': -amount - fee})
    if cash < -tolerance:
        raise ArithmeticError('cash invariant violated')
    cash = max(0.0, cash)  # only sub-tolerance floating point residue
    holdings = {s: v for s, v in holdings.items() if v > 0}
    fees = sum(x['cost'] for x in legs)
    if not math.isclose(cash + sum(holdings.values()), equity - fees, abs_tol=tolerance, rel_tol=1e-12):
        raise ArithmeticError('equity reconciliation failed')
    return {'values': holdings, 'cash': cash, 'legs': legs, 'cost': fees,
            'traded': sum(x['notional'] for x in legs), 'buy_scale': scale, 'before_equity': equity}


def replay(sessions, series, universe, spec, *, start=START, end=None, cost_bps=10, score_cache=None,
           benchmark_weight=None):
    end = end or sessions[-1]
    sectors = {r['symbol']: r['sector'] for r in universe['securities']}
    members = sorted(set(sectors) & series.keys())
    cap = float(universe['max_last_close']) if spec['price_cap'] and 'max_last_close' in universe else None
    units, cash, curve, ledger, exposures = {}, STARTING, [], [], []
    rejected = decisions = 0

    def price(s, k, field):
        v = series[s][field][k]
        if v is None:
            raise ValueError(f'missing held/benchmark {field}: {s} {sessions[k]}')
        return finite(v, field, positive=True)

    first = next(k for k in range(old.WINDOW, len(sessions)) if sessions[k] >= start)
    for k in range(first, len(sessions)):
        if sessions[k] > end:
            break
        if old.is_decision(sessions, k, 'weekly') or (benchmark_weight is not None and k == first):
            decisions += 1
            held = set(units)
            if benchmark_weight is not None:
                picks = {'SPY'}
            else:
                scores = score_cache[k] if score_cache is not None else {
                    s: x for s in members if (x := old.score(series[s], k, 252)) is not None}
                if not held <= scores.keys():
                    rejected += 1
                    picks = None
                else:
                    picks = set(select(scores, sectors, held, spec, cap))
            if picks is not None:
                needed = held | picks
                if any(series[s]['ao'][k] is None or series[s]['o'][k] is None for s in needed):
                    rejected += 1  # no substitution of a different, now-known tradable pick
                else:
                    prices = {s: price(s, k, 'ao') for s in needed}
                    values = {s: u * prices[s] for s, u in units.items()}
                    equity = cash + sum(values.values())
                    weight = spec['weight'] if benchmark_weight is None else benchmark_weight
                    goals = {s: weight * equity for s in picks}
                    r = rebalance(values, cash, goals, {s: price(s, k, 'o') for s in needed},
                                  cost_bps=cost_bps, band=spec['band'] if benchmark_weight is None else 0,
                                  use_share_threshold=benchmark_weight is None)
                    cash = r['cash']
                    units = {s: v / prices[s] for s, v in r['values'].items()}
                    ledger.append({'date': sessions[k], **{key: r[key] for key in
                                   ('cash', 'cost', 'traded', 'buy_scale', 'before_equity', 'legs')}})
        invested = sum(u * price(s, k, 'ac') for s, u in units.items())
        equity = cash + invested
        if cash < 0 or equity <= 0:
            raise ArithmeticError('unlevered account invariant violated')
        curve.append((sessions[k], equity))
        exposures.append(invested / equity)
    return {'curve': curve, 'ledger': ledger, 'decisions': decisions, 'rejected': rejected,
            'avg_exposure': fmean(exposures) if exposures else 0.0,
            'max_exposure': max(exposures, default=0.0), 'ending_cash': cash}


def metrics(curve, lo, hi):
    pts = [(d, v) for d, v in curve if lo <= d <= hi]
    if len(pts) < 2:
        return {}
    prior = [v for d, v in curve if d < lo]
    values = [prior[-1] if prior else STARTING] + [v for _, v in pts]
    returns = [b / a - 1 for a, b in zip(values, values[1:])]
    sd, years = pstdev(returns), len(returns) / 252
    peak, drawdown = values[0], 0.0
    for v in values:
        peak = max(peak, v)
        drawdown = min(drawdown, v / peak - 1)
    total = values[-1] / values[0] - 1
    return {'total': total, 'cagr': (1 + total) ** (1 / years) - 1,
            'sharpe_zero_rf': fmean(returns) / sd * math.sqrt(252) if sd else None,
            'volatility': sd * math.sqrt(252), 'max_drawdown': drawdown,
            'end_value': values[-1], 'sessions': len(returns)}


def summarize(r, periods):
    years = len(r['curve']) / 252
    trades = [leg for row in r['ledger'] for leg in row['legs']]
    return {**{p: metrics(r['curve'], *bounds) for p, bounds in periods.items()},
            'decisions': r['decisions'], 'rejected': r['rejected'], 'orders': len(trades),
            'total_cost': sum(t['cost'] for t in trades),
            'one_way_turnover_per_year': sum(row['traded'] / (2 * row['before_equity'])
                                             for row in r['ledger']) / years if years else None,
            'cash_limited_rebalances': sum(row['buy_scale'] < 1 - 1e-12 for row in r['ledger']),
            'avg_exposure': r['avg_exposure'], 'max_exposure': r['max_exposure'],
            'ending_cash': r['ending_cash'], 'cash_invariant': 'PASS'}


def evaluate(data, universe, *, source_sha='unrecorded'):
    validate(data, universe)
    sessions, series = old.align(data)
    end = sessions[-1]
    periods = {'full': (START, end), 'development_seen': (START, '2022-12-31'),
               'recent_seen': ('2023-01-01', end)}
    periods.update({str(y): (f'{y}-01-01', min(end, f'{y}-12-31'))
                    for y in range(2017, date.fromisoformat(end).year + 1)})
    sectors = {r['symbol']: r['sector'] for r in universe['securities']}
    cache = {}
    for k in range(old.WINDOW, len(sessions)):
        if sessions[k] >= START and old.is_decision(sessions, k, 'weekly'):
            cache[k] = {s: x for s in sorted(sectors.keys() & series.keys())
                        if (x := old.score(series[s], k, 252)) is not None}
    scenarios = {}
    for cost in COSTS:
        rows = {name: summarize(replay(sessions, series, universe, spec, cost_bps=cost, score_cache=cache), periods)
                for name, spec in SPECS.items()}
        for name, weight in (('SPY-50', .5), ('SPY-100', 1.0)):
            rows[name] = summarize(replay(sessions, series, universe, SPECS['uncapped'], cost_bps=cost,
                                          benchmark_weight=weight), periods)
        scenarios[str(cost)] = rows
    digest = lambda x: hashlib.sha256(json.dumps(x, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    return {'version': VERSION, 'source_sha': source_sha, 'data_sha256': digest(data),
            'universe_sha256': digest(universe), 'periods': periods, 'specs': SPECS,
            'cost_bps_per_side': COSTS, 'scenarios': scenarios, 'status': 'EXPLORATORY_ONLY',
            'survivorship_free': False, 'historical_availability_verified': False,
            'clean_holdout': False, 'live_planner_parity': False, 'promotion_authorized': False,
            'limitations': ['present-day survivor-selected universe and static sectors',
                            'all historical years already inspected', 'fractional total-return units',
                            'open-price fills instead of live 09:50 limit orders',
                            'same-day sale proceeds assumed reusable; settlement not modeled',
                            'zero cash interest and zero Sharpe risk-free rate',
                            'no execution of the paper account drawdown stop']}


def markdown(out):
    pct = lambda x: '—' if x is None else f'{x * 100:.1f}%'
    lines = ['# Cost-aware momentum research', '', '**EXPLORATORY ONLY — no clean holdout or verified edge.**', '',
             f"Source: `{out['source_sha']}`", f"Data SHA256: `{out['data_sha256']}`",
             f"Universe SHA256: `{out['universe_sha256']}`", '',
             'All values start with $1,000. Drawdown is from a prior peak. Targets are not exposure guarantees.', '']
    for cost, rows in out['scenarios'].items():
        lines += [f'## {cost} bps per side', '',
                  '| Strategy | End value | CAGR | Drawdown | Sharpe (rf=0) | Costs | Turnover/year | Avg invested | Cash-limited |',
                  '|---|---|---|---|---|---|---|---|---|']
        for name, r in rows.items():
            m = r['full']
            sharpe = '—' if m['sharpe_zero_rf'] is None else f"{m['sharpe_zero_rf']:.2f}"
            lines.append(f"| {name} | ${m['end_value']:,.2f} | {pct(m['cagr'])} | {pct(m['max_drawdown'])} | "
                         f"{sharpe} | ${r['total_cost']:,.2f} | {r['one_way_turnover_per_year']:.2f} | "
                         f"{pct(r['avg_exposure'])} | {r['cash_limited_rebalances']} |")
        lines += ['', '| Strategy | 2017–2022 CAGR | Seen 2023+ CAGR | Seen 2023+ drawdown | Above 25% full drawdown? | Rejected | Cash invariant |',
                  '|---|---|---|---|---|---|---|']
        for name, r in rows.items():
            a, b = r['development_seen'], r['recent_seen']
            lines.append(f"| {name} | {pct(a.get('cagr'))} | {pct(b.get('cagr'))} | {pct(b.get('max_drawdown'))} | "
                         f"{'YES' if r['full']['max_drawdown'] < -.25 else 'no'} | {r['rejected']} | {r['cash_invariant']} |")
        lines += ['', '| Year | ' + ' | '.join(rows) + ' |', '|---|' + '---|' * len(rows)]
        for year in (p for p in out['periods'] if p.isdigit()):
            lines.append('| ' + year + ' | ' + ' | '.join(pct(r[year].get('total')) for r in rows.values()) + ' |')
        lines.append('')
    lines += ['## Limitations', ''] + ['- ' + x for x in out['limitations']]
    return '\n'.join(lines) + '\n'


def fetch(source, symbols, start, end):
    """Reuse v1 capture with an explicit intraday bound covering the final session.

    Provider daily-bar timestamps occur after UTC midnight. The wrapper changes only
    the bars interval; the calendar and ticker as-of remain bound to the requested day.
    No endpoint other than calendar and historical daily bars is called.
    """
    bound = (date.fromisoformat(end) + timedelta(days=1)).isoformat() + 'T00:00:00Z'

    class DayBoundSource:
        def fetch(self, base, path, query):
            return source.fetch(base, path, query)

        def paged(self, base, path, query):
            return source.paged(base, path, query | {'end': bound})

    return old.fetch(DayBoundSource(), symbols, start, end)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--universe', type=Path, required=True)
    f.add_argument('--end', required=True)
    f.add_argument('--output', type=Path, required=True)
    f.add_argument('--execute-network', action='store_true')
    r = sub.add_parser('run')
    r.add_argument('--universe', type=Path, required=True)
    r.add_argument('--data', type=Path, required=True)
    r.add_argument('--output', type=Path, required=True)
    r.add_argument('--markdown', type=Path, required=True)
    r.add_argument('--source-sha', default='unrecorded')
    args = p.parse_args()
    uni = json.loads(args.universe.read_text())
    if args.command == 'fetch':
        if not args.execute_network:
            p.error('fetch requires --execute-network')
        from .stock_forward_bridge_v1 import Source
        source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID'), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY'), max_requests=200)
        data = fetch(source, sorted({r['symbol'] for r in uni['securities']} | {'SPY'}), old.START_DATA, args.end)
        with gzip.open(args.output, 'wt') as fh:
            json.dump(data, fh, allow_nan=False)
        print(json.dumps({'status': 'FETCHED', 'requests': source.count, 'last_session': data['sessions'][-1]}))
    else:
        with gzip.open(args.data, 'rt') as fh:
            data = json.load(fh)
        out = evaluate(data, uni, source_sha=args.source_sha)
        args.output.write_text(json.dumps(out, indent=2, allow_nan=False) + '\n')
        args.markdown.write_text(markdown(out))
        print(markdown(out))


if __name__ == '__main__':
    main()
