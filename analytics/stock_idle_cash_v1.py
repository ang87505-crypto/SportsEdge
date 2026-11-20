"""Idle-cash portfolio policy: descriptive total-account comparison and a measurement-only shadow ledger.

Research only (docs/STOCK_IDLE_CASH_POLICY_PLAN_2026_11_20.md, committed before any computation). Nothing here trades,
registers a challenger or changes a limit. The plan's verdict is NO_NEW_CHALLENGER; these numbers are descriptive and
every historical period was inspected before (rounds 1-4, v3).

Rows (whole shares from $1,000, weekly at the open, 10 bps per side on every trade incl. SPY):
  current                  live momentum rules (round 3 `current`, via the unchanged replay)
  holdrank10               round 3 challenger (unchanged)
  current+spy-fill         current + SPY held at max(0, 50% of equity - sleeve value): idle cash replaced WITHIN the
                           50% gross cap (fractional SPY: idealized, not implementable today)
  current+spy-fill-whole   the same in whole SPY shares (what the $1,000 account could actually do)
  holdrank10+spy-fill      holdrank10 + the same fractional fill
  core-satellite-v3        the registered recipe: mix(SPY 100%, momentum sleeve at 20%/pick fractional, 0.5); gross ~99%,
                           a RISK-POLICY CHANGE, not idle cash
"""
from __future__ import annotations
import argparse
import gzip
import json
import math
import random
from datetime import date
from pathlib import Path
from statistics import fmean, pstdev

from . import stock_weekly_backtest_v1 as bt

CAP = 0.50                       # live planner GROSS_CAP
BOOT_BLOCK, BOOT_REPS, BOOT_SEED = 8, 2000, 20261120
END = '2026-11-18'
MIN_SHADOW_WEEKS = 26
CURRENT_SPEC = bt.ROUND3[bt.CURRENT]
HOLDRANK10_SPEC = bt.ROUND3[bt.CHALLENGER]
CORE_SATELLITE_SLEEVE = {'model': 'momentum', **bt._LIVE, 'weight': 0.20}  # v3 FULL_SPEC
CORE_WEIGHT = 0.5
CATEGORY = {
    'current': 'baseline: idle cash at 0%',
    'holdrank10': 'tested alternative: idle cash at 0%',
    'current+spy-fill': 'A: idle cash replaced within the 50% gross cap (fractional SPY, idealized)',
    'current+spy-fill-whole': 'A: idle cash replaced within the cap in whole SPY shares (implementable today)',
    'holdrank10+spy-fill': 'A: idle cash replaced within the cap (fractional SPY, idealized)',
    'core-satellite-v3': 'B: gross exposure raised to ~99% (risk-policy change; registered lab-stock-v3-core-satellite)',
}


# ---------------------------------------------------------------- replay with an SPY fill inside the cap

def replay_fill(sessions: list, series: dict, universe: dict, spec: dict, *, start: str, end: str,
                cost_bps: float = bt.COST_BPS, whole: bool = False, cap: float = CAP) -> dict:
    """The round-3 whole-share replay of `spec`, plus SPY held at max(0, cap x equity - sleeve value) after the sleeve
    trades at each decision. Sleeve sizing uses total account equity (as the live planner does), and sleeve buys are
    funded from SPY before cash. With cap=0 this is exactly bt.replay."""
    assert spec.get('whole_shares'), 'the fill is defined on the whole-share account'
    spy = series['SPY']
    sectors = {u['symbol']: u['sector'] for u in universe['securities']}
    members = [s for s in sorted(sectors) if s in series]
    pcap = float(universe['max_last_close']) if 'max_last_close' in universe and spec.get('price_cap', True) else None
    weight = spec.get('weight', bt.WEIGHT)
    units: dict[str, float] = {}
    spy_units, cash = 0.0, bt.STARTING
    last: dict = {}
    curve, exposure, fill_w = [], [], []
    decisions = rejected = cash_blocked = 0
    traded = spy_traded = 0.0

    def px(sym, k, field):  # the same last-price fallback as bt.replay (keyed by symbol)
        v = series[sym][field][k]
        if v is not None:
            last[sym] = v
        return last[sym]

    first = next(k for k in range(bt.WINDOW, len(sessions)) if sessions[k] >= start)
    for k in range(first, len(sessions)):
        if sessions[k] > end:
            break
        if bt.is_decision(sessions, k, spec['cadence']):
            decisions += 1
            scores = {}
            for s in members:
                x = bt.score(series[s], k, spec['lookback'])
                if x is not None and series[s]['ao'][k] is not None:
                    scores[s] = x
            held = {s for s, u in units.items() if u > 0}
            if not held <= set(scores):
                rejected += 1
            else:
                picks = set(bt.select(scores, sectors, held, spec, pcap))
                spy_adj, spy_raw = px('SPY', k, 'ao'), px('SPY', k, 'o')
                spy_val = spy_units * spy_adj
                vcash, moved, blocked = bt._whole_share_trades(series, k, units, cash + spy_val, held | picks, picks,
                                                               weight, cost_bps)
                traded += moved
                cash_blocked += blocked
                units = {s: u for s, u in units.items() if u > 1e-12}
                sleeve = sum(u * px(s, k, 'ao') for s, u in units.items())
                equity = vcash + sleeve
                target = max(0.0, cap * equity - sleeve)
                target = min(target, vcash / (1 + cost_bps / 1e4))
                if whole:
                    target = math.floor(target / spy_raw + 1e-9) * spy_raw
                delta = target - spy_val
                # vcash already counts the old SPY holding as cash (it funded sleeve buys), so holding `target` of SPY
                # costs the whole target, plus fees on the traded difference only.
                vcash -= target + abs(delta) * cost_bps / 1e4
                spy_traded += abs(delta)
                spy_units = target / spy_adj
                cash = vcash
        sleeve_c = sum(u * px(s, k, 'ac') for s, u in units.items())
        spy_c = spy_units * px('SPY', k, 'ac')
        total = cash + sleeve_c + spy_c
        curve.append((sessions[k], total))
        exposure.append((sleeve_c + spy_c) / total if total > 0 else 0.0)
        fill_w.append(spy_c / total if total > 0 else 0.0)
    return {'curve': curve, 'exposure': exposure, 'fill_weight': fill_w, 'decisions': decisions, 'rejected': rejected,
            'cash_blocked': cash_blocked, 'traded': traded + spy_traded, 'spy_traded': spy_traded,
            'avg_exposure': fmean(exposure) if exposure else 0.0}


def mix(a: list, b: list, wa: float) -> list:
    """lab-stock-v3 `mix`: buy-and-hold mix of two curves that each start at $1,000."""
    assert [d for d, _ in a] == [d for d, _ in b]
    return [(d, wa * x + (1 - wa) * y) for (d, x), (_, y) in zip(a, b)]


# ---------------------------------------------------------------- metrics and uncertainty

def metrics_ext(curve: list, exposure: list | None, lo: str, hi: str) -> dict:
    m = bt.metrics(curve, lo, hi)
    if not m:
        return {}
    pts = [(d, v) for d, v in curve if lo <= d <= hi]
    prev = [v for d, v in curve if d < lo]
    values = [prev[-1] if prev else pts[0][1]] + [v for _, v in pts]
    rets = [b / a - 1 for a, b in zip(values, values[1:])]
    down = math.sqrt(sum(min(r, 0.0) ** 2 for r in rets) / len(rets))
    m['downside_deviation'] = down * math.sqrt(252)
    m['sortino'] = fmean(rets) / down * math.sqrt(252) if down > 0 else None
    if exposure is not None:
        exp = [x for (d, _), x in zip(curve, exposure) if lo <= d <= hi]
        m['avg_invested'], m['min_invested'] = (fmean(exp), min(exp)) if exp else (None, None)
    return m


def block_bootstrap(a: dict, b: dict, *, block: int = BOOT_BLOCK, reps: int = BOOT_REPS, seed: int = BOOT_SEED):
    """Circular block bootstrap of PAIRED weekly returns: 95% intervals for the annualized Sharpe difference (a - b) and
    the mean weekly difference. Deterministic for a given seed; None when there are too few weeks."""
    weeks = sorted(set(a) & set(b))
    n = len(weeks)
    if n < 2 * block:
        return None
    x, y = [a[w] for w in weeks], [b[w] for w in weeks]

    def sharpe(r):
        sd = pstdev(r)
        return fmean(r) / sd * math.sqrt(52) if sd > 0 else 0.0
    rng = random.Random(seed)
    ds, ms = [], []
    for _ in range(reps):
        idx = []
        while len(idx) < n:
            s0 = rng.randrange(n)
            idx.extend((s0 + j) % n for j in range(block))
        idx = idx[:n]
        xs, ys = [x[i] for i in idx], [y[i] for i in idx]
        ds.append(sharpe(xs) - sharpe(ys))
        ms.append(fmean(xs) - fmean(ys))
    ds.sort()
    ms.sort()
    lo, hi = int(0.025 * reps), math.ceil(0.975 * reps) - 1
    return {'weeks': n, 'sharpe_difference': sharpe(x) - sharpe(y), 'sharpe_difference_95': [ds[lo], ds[hi]],
            'mean_weekly_difference': fmean(x) - fmean(y), 'mean_weekly_difference_95': [ms[lo], ms[hi]],
            'block_weeks': block, 'replicates': reps, 'seed': seed}


# ---------------------------------------------------------------- evaluation (round 5, descriptive)

def evaluate(data: dict, universe: dict, end: str | None = None) -> dict:
    sessions, series = bt.align(data)
    if 'SPY' not in series:
        raise ValueError('SPY_REQUIRED')
    end = end or min(sessions[-1], END)  # the plan's fixed end unless a caller (tests) passes one
    periods = {'dev': bt.DEV, 'holdout': (bt.HOLDOUT_START, end), 'full': (bt.DEV[0], end)}
    years = lambda c: len(c) / 252
    rows, curves25 = {}, {}

    def plain(spec, cost):
        r = bt.replay(sessions, series, universe, spec, start=bt.DEV[0], end=end, cost_bps=cost)
        return {**r, 'spy_traded': 0.0}

    def filled(spec, cost, whole):
        return replay_fill(sessions, series, universe, spec, start=bt.DEV[0], end=end, cost_bps=cost, whole=whole)

    runs = {
        'current': lambda c: plain(CURRENT_SPEC, c),
        'holdrank10': lambda c: plain(HOLDRANK10_SPEC, c),
        'current+spy-fill': lambda c: filled(CURRENT_SPEC, c, False),
        'current+spy-fill-whole': lambda c: filled(CURRENT_SPEC, c, True),
        'holdrank10+spy-fill': lambda c: filled(HOLDRANK10_SPEC, c, False),
    }
    spy100 = bt.benchmark(sessions, series['SPY'], start=bt.DEV[0], end=end, weight=1.0)['curve']
    for name, run in runs.items():
        r, r25 = run(bt.COST_BPS), run(25.0)
        rows[name] = r
        curves25[name] = r25['curve']
    sleeve = bt.replay(sessions, series, universe, CORE_SATELLITE_SLEEVE, start=bt.DEV[0], end=end)
    sleeve25 = bt.replay(sessions, series, universe, CORE_SATELLITE_SLEEVE, start=bt.DEV[0], end=end, cost_bps=25.0)
    cs_curve = mix(spy100, sleeve['curve'], CORE_WEIGHT)
    rows['core-satellite-v3'] = {'curve': cs_curve,
                                 'exposure': [CORE_WEIGHT + (1 - CORE_WEIGHT) * x for x in sleeve['exposure']],
                                 'decisions': sleeve['decisions'], 'rejected': sleeve['rejected'], 'cash_blocked': 0,
                                 'traded': (1 - CORE_WEIGHT) * sleeve['traded'], 'spy_traded': 0.0}
    curves25['core-satellite-v3'] = mix(spy100, sleeve25['curve'], CORE_WEIGHT)

    out = {'round': 5, 'kind': 'descriptive (no challenger; docs/STOCK_IDLE_CASH_POLICY_PLAN_2026_11_20.md)',
           'evidence': 'exploratory: every period inspected before', 'periods': {k: list(v) for k, v in periods.items()},
           'sessions': [sessions[0], sessions[-1]], 'end': end, 'universe_revision': universe.get('revision'),
           'members_with_data': len([s for s in universe['securities'] if s['symbol'] in series]),
           'rows': {}, 'benchmarks': {}, 'matched_spy': {}, 'bootstrap': {}}
    for label, w in (('spy-100', 1.0), ('spy-50', CAP)):
        c = bt.benchmark(sessions, series['SPY'], start=bt.DEV[0], end=end, weight=w)['curve']
        out['benchmarks'][label] = {p: metrics_ext(c, None, *rng) for p, rng in periods.items()}
    matched_curves = {}
    for name, r in rows.items():
        avg_equity = fmean(v for _, v in r['curve'])
        y = years(r['curve'])
        row = {'category': CATEGORY[name], 'decisions': r['decisions'], 'rejected': r['rejected'],
               'cash_blocked': r['cash_blocked'], 'turnover_per_avg_equity': r['traded'] / avg_equity / y,
               'spy_turnover_per_avg_equity': r['spy_traded'] / avg_equity / y,
               'costs_paid': r['traded'] * bt.COST_BPS / 1e4,
               'costs_pct_avg_equity_per_year': r['traded'] * bt.COST_BPS / 1e4 / avg_equity / y,
               **{p: metrics_ext(r['curve'], r['exposure'], *rng) for p, rng in periods.items()},
               'at_25bps': {p: bt.metrics(curves25[name], *rng) for p, rng in periods.items()}}
        if 'fill_weight' in r:
            fw = lambda lo, hi: [x for (d, _), x in zip(r['curve'], r['fill_weight']) if lo <= d <= hi]
            row['avg_fill_weight'] = {p: fmean(fw(lo, hi)) if fw(lo, hi) else None for p, (lo, hi) in periods.items()}
        out['rows'][name] = row
        out['matched_spy'][name] = {}
        for p, rng in periods.items():
            w = row[p].get('avg_invested')
            if w is None:
                continue
            c = bt.benchmark(sessions, series['SPY'], start=bt.DEV[0], end=end, weight=w)['curve']
            matched_curves[(name, p)] = c
            out['matched_spy'][name][p] = {**bt.metrics(c, *rng), 'weight': w}
    wk = lambda c, p: bt.weekly_returns(c, *periods[p])
    spy50_curve = bt.benchmark(sessions, series['SPY'], start=bt.DEV[0], end=end, weight=CAP)['curve']
    for p in periods:
        if ('current+spy-fill', p) not in matched_curves or ('core-satellite-v3', p) not in matched_curves:
            out['bootstrap'][p] = {}
            continue
        out['bootstrap'][p] = {
            'current+spy-fill - current': block_bootstrap(wk(rows['current+spy-fill']['curve'], p), wk(rows['current']['curve'], p)),
            'current+spy-fill - matched SPY': block_bootstrap(wk(rows['current+spy-fill']['curve'], p),
                                                              wk(matched_curves[('current+spy-fill', p)], p)),
            'current+spy-fill - SPY 50%': block_bootstrap(wk(rows['current+spy-fill']['curve'], p), wk(spy50_curve, p)),
            'holdrank10+spy-fill - holdrank10': block_bootstrap(wk(rows['holdrank10+spy-fill']['curve'], p),
                                                                wk(rows['holdrank10']['curve'], p)),
            'core-satellite-v3 - matched SPY': block_bootstrap(wk(rows['core-satellite-v3']['curve'], p),
                                                               wk(matched_curves[('core-satellite-v3', p)], p)),
            'core-satellite-v3 - SPY 100%': block_bootstrap(wk(rows['core-satellite-v3']['curve'], p), wk(spy100, p)),
        }
    k_end = max(i for i, d in enumerate(sessions) if d <= end)
    spy_open = next(series['SPY']['o'][i] for i in range(k_end, -1, -1) if series['SPY']['o'][i] is not None)
    cur = rows['current']
    eq_end = cur['curve'][-1][1]
    out['whole_share_check'] = {
        'spy_raw_open_last_session': spy_open, 'current_equity_end': eq_end,
        'current_gross_end': cur['exposure'][-1],
        'headroom_under_cap_end': max(0.0, CAP - cur['exposure'][-1]) * eq_end,
        'spy_shares_affordable_in_headroom': math.floor(max(0.0, CAP - cur['exposure'][-1]) * eq_end / spy_open),
        'weeks_whole_fill_held_any_spy': sum(1 for x in rows['current+spy-fill-whole']['fill_weight'] if x > 0),
        'sessions': len(rows['current+spy-fill-whole']['fill_weight'])}
    out['integrity'] = {'current_dev_sharpe': out['rows']['current']['dev'].get('sharpe'),
                        'holdrank10_full_sharpe_25bps': out['rows']['holdrank10']['at_25bps']['full'].get('sharpe'),
                        'note': 'must equal round 3 (0.449 and 0.574)'}
    return out


# ---------------------------------------------------------------- prospective shadow ledger (measurement only)

def shadow_week(prev: dict, cur: dict, prev_fill_weight: float = 0.0, *, cap: float = CAP, cost_bps: float = 10.0) -> dict:
    """One week of the measurement-only shadow (plan section 6). `prev`/`cur` are after-close snapshots of the live PAPER
    account with keys date, equity, sleeve_value, spy_close (adjusted) and external_flow (deposits/withdrawals in the
    week; must be 0, a flow makes the week unmeasurable). No order, no limit, no state outside the returned row."""
    for x in (prev, cur):
        if not (isinstance(x.get('equity'), (int, float)) and x['equity'] > 0 and isinstance(x.get('sleeve_value'), (int, float))
                and 0 <= x['sleeve_value'] <= x['equity'] * (1 + 1e-9) and isinstance(x.get('spy_close'), (int, float))
                and x['spy_close'] > 0 and isinstance(x.get('date'), str)):
            raise ValueError('SHADOW_INVALID_SNAPSHOT')
    if not prev['date'] < cur['date']:
        raise ValueError('SHADOW_DATES_NOT_INCREASING')
    if cur.get('external_flow', 0) != 0:
        raise ValueError('SHADOW_EXTERNAL_FLOW')
    if not 0 <= prev_fill_weight <= cap:
        raise ValueError('SHADOW_INVALID_FILL')
    actual = cur['equity'] / prev['equity'] - 1
    gross = prev['sleeve_value'] / prev['equity']
    fill = max(0.0, cap - gross)
    spy = cur['spy_close'] / prev['spy_close'] - 1
    cost = lambda bps: abs(fill - prev_fill_weight) * bps / 1e4
    return {'date': cur['date'], 'actual': actual, 'gross_used': gross, 'idle_within_cap': fill, 'idle_beyond_cap': 1 - cap,
            'spy': spy, 'shadow_fill': actual + fill * spy - cost(cost_bps), 'shadow_fill_25bps': actual + fill * spy - cost(25.0),
            'spy_at_actual_gross': gross * spy, 'spy_50': cap * spy, 'spy_100': spy, 'fill_weight': fill}


def summarize_shadow(rows: list) -> dict:
    """Cumulative shadow results; intervals only after MIN_SHADOW_WEEKS weeks. Measurement, never a promotion."""
    if any(a['date'] >= b['date'] for a, b in zip(rows, rows[1:])):
        raise ValueError('SHADOW_DATES_NOT_INCREASING')
    keys = ('actual', 'shadow_fill', 'shadow_fill_25bps', 'spy_at_actual_gross', 'spy_50', 'spy_100')
    cum = {k: math.prod(1 + r[k] for r in rows) - 1 for k in keys} if rows else {k: None for k in keys}
    out = {'weeks': len(rows), 'cumulative': cum,
           'avg_gross_used': fmean(r['gross_used'] for r in rows) if rows else None,
           'avg_idle_within_cap': fmean(r['idle_within_cap'] for r in rows) if rows else None,
           'status': 'INSUFFICIENT_WEEKS' if len(rows) < MIN_SHADOW_WEEKS else 'MEASURED',
           'note': 'Measurement only. Shadow fill beats the actual account whenever SPY rises; it informs an owner '
                   'policy decision and never promotes or trades.'}
    if len(rows) >= MIN_SHADOW_WEEKS:
        series = lambda k: {r['date']: r[k] for r in rows}
        out['intervals'] = {
            'actual - spy_at_actual_gross': block_bootstrap(series('actual'), series('spy_at_actual_gross'), block=4),
            'shadow_fill - actual': block_bootstrap(series('shadow_fill'), series('actual'), block=4),
            'shadow_fill - spy_50': block_bootstrap(series('shadow_fill'), series('spy_50'), block=4)}
    return out


# ---------------------------------------------------------------- report

def markdown(out: dict) -> str:
    pct = lambda x: '—' if x is None else f'{x * 100:+.1f}%'
    num = lambda x: '—' if x is None else f'{x:.2f}'
    lines = [f"Round 5 (idle-cash, DESCRIPTIVE, no challenger) · sessions {out['sessions'][0]} to {out['sessions'][1]} · end "
             f"{out['end']} · universe {out['universe_revision']} · members with data {out['members_with_data']} · "
             f"{bt.COST_BPS:g} bps per side incl. SPY · whole-share sleeve from $1,000 · NOT survivorship-free", '']
    for p, (lo, hi) in out['periods'].items():
        lines += [f'### {p} ({lo} to {hi})', '', '| Row | CAGR | Vol | Sharpe | Sortino | Max DD | Avg gross | Min gross | '
                  'CAGR @25 bps | Sharpe @25 bps |', '|---|---|---|---|---|---|---|---|---|---|']
        for name, r in out['rows'].items():
            m, m25 = r[p], r['at_25bps'][p]
            if not m:
                continue
            lines.append(f"| {name} | {pct(m['cagr'])} | {pct(m['vol'])} | {num(m['sharpe'])} | {num(m['sortino'])} | "
                         f"{pct(m['max_drawdown'])} | {pct(m['avg_invested'])} | {pct(m['min_invested'])} | "
                         f"{pct(m25.get('cagr'))} | {num(m25.get('sharpe'))} |")
        for name in ('current', 'current+spy-fill', 'core-satellite-v3'):
            m = out['matched_spy'][name].get(p)
            if not m:
                continue
            lines.append(f"| SPY at {name} gross ({m['weight'] * 100:.0f}%) | {pct(m['cagr'])} | {pct(m['vol'])} | "
                         f"{num(m['sharpe'])} | — | {pct(m['max_drawdown'])} | | | | |")
        for label in ('spy-50', 'spy-100'):
            m = out['benchmarks'][label][p]
            if not m:
                continue
            lines.append(f"| {label.upper()} | {pct(m['cagr'])} | {pct(m['vol'])} | {num(m['sharpe'])} | {num(m['sortino'])} | "
                         f"{pct(m['max_drawdown'])} | | | | |")
        lines.append('')
    lines += ['### Trading, costs and category (whole run)', '', '| Row | Category | Turnover / avg equity / yr | of which SPY | '
              'Costs % avg equity / yr | Costs paid | Cash-blocked |', '|---|---|---|---|---|---|---|']
    for name, r in out['rows'].items():
        lines.append(f"| {name} | {r['category']} | {r['turnover_per_avg_equity']:.1f}× | {r['spy_turnover_per_avg_equity']:.1f}× | "
                     f"{pct(r['costs_pct_avg_equity_per_year'])} | ${r['costs_paid']:,.2f} | {r['cash_blocked']} |")
    lines += ['', '### Paired weekly block bootstrap (8-week blocks, 95%)', '',
              '| Period | Comparison | Weeks | Sharpe diff | 95% | Mean weekly diff | 95% |', '|---|---|---|---|---|---|---|']
    for p, comps in out['bootstrap'].items():
        for c, b in comps.items():
            if b:
                lines.append(f"| {p} | {c} | {b['weeks']} | {b['sharpe_difference']:+.2f} | [{b['sharpe_difference_95'][0]:+.2f}, "
                             f"{b['sharpe_difference_95'][1]:+.2f}] | {b['mean_weekly_difference'] * 100:+.3f}% | "
                             f"[{b['mean_weekly_difference_95'][0] * 100:+.3f}%, {b['mean_weekly_difference_95'][1] * 100:+.3f}%] |")
    w = out['whole_share_check']
    lines += ['', f"Whole-share check: SPY open on the last session ${w['spy_raw_open_last_session']:,.2f}; current gross at end "
              f"{w['current_gross_end'] * 100:.1f}% of ${w['current_equity_end']:,.2f}; headroom under the cap "
              f"${w['headroom_under_cap_end']:,.2f} = {w['spy_shares_affordable_in_headroom']} SPY shares; the whole-share fill "
              f"held any SPY on {w['weeks_whole_fill_held_any_spy']} of {w['sessions']} sessions.",
              f"Integrity: current dev Sharpe {num(out['integrity']['current_dev_sharpe'])}, holdrank10 full Sharpe at 25 bps "
              f"{num(out['integrity']['holdrank10_full_sharpe_25bps'])} (round 3: 0.45 and 0.57)."]
    return '\n'.join(lines) + '\n'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['run'])
    p.add_argument('--universe', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--markdown', type=Path, required=True)
    a = p.parse_args()
    universe = json.loads(a.universe.read_text(encoding='utf-8'))
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    out = evaluate(data, universe)
    a.output.write_text(json.dumps(out, indent=1), encoding='utf-8')
    a.markdown.write_text(markdown(out), encoding='utf-8')
    print(markdown(out))


if __name__ == '__main__':
    main()
