"""AI 2.0 stock research v3 (lab-stock-v3-2026-11-13). RESEARCH ONLY, historical PAPER replay.

Pre-registered in this file before any run on real data. It never changes the live weekly strategy, the universe, a
release flag, the broker path or PR #102. It reuses the weekly replay (analytics/stock_weekly_backtest_v1.py) and
the block-bootstrap/Holm machinery of lab-stock-psychology-v1 unchanged.

Failure audit (live rules = BASE): five picks at 10% each means at most 50% of equity is ever invested, so part of
the gap to SPY is structural exposure; the rest is selection. The audit separates the two (exposure-matched SPY),
and reports turnover, cost drag (10 vs 25 bps per side), drawdown and dev-vs-holdout stability.

Candidates (a bounded family of 4; nothing is added after results):
  riskadj-mom              rank by 12-1 momentum divided by realised volatility (risk-adjusted momentum); same
                           eligibility, trend filter, sector cap, 10% weights and price cap as BASE
  mom-lowvol               rank by the average of the momentum rank and the (low) volatility rank among
                           positive-momentum names (low volatility as a quality proxy; no point-in-time
                           fundamentals are collected, so true quality is NOT tested)
  core-satellite           50% SPY buy-and-hold + 50% fully invested momentum sleeve (5 picks x 20%), attacking
                           the structural cash drag directly
  core-satellite-riskadj   the same with the risk-adjusted ranking in the sleeve

Decision rule (holdout = 2023-01-01 onward; dev = 2017-2022):
  PROMISING   weekly return vs BASE: Holm p < 0.05 (4-week block bootstrap, 2,000 replicates, seed 20261113)
              AND holdout Sharpe > BASE AND holdout CAGR > exposure-matched SPY (same average exposure)
              AND still ahead of BASE at 25 bps AND dev CAGR > BASE dev CAGR (same direction before the holdout)
  REJECTED    holdout difference vs BASE credibly negative (upper95 < 0) OR below exposure-matched SPY in both
              dev and holdout
  otherwise   NO_CLEAR_EFFECT
  beats_spy   reported separately: holdout CAGR AND Sharpe above SPY 100%. Promotion is never automatic.
Caveats: the universe is NOT survivorship-free (current large caps); historical replay, not Alpaca fills.
"""
from __future__ import annotations
import argparse
from datetime import date
import gzip
import json
import math
from pathlib import Path

from . import stock_weekly_backtest_v1 as wb
from . import stock_psychology_v1 as sp

EXPERIMENT = 'lab-stock-v3-2026-11-13'
BASE_SPEC = dict(sp.BASE_SPEC)
FULL_SPEC = {**BASE_SPEC, 'weight': 0.20}
CANDIDATES = ('riskadj-mom', 'mom-lowvol', 'core-satellite', 'core-satellite-riskadj')
CORE_WEIGHT = 0.5
BOOT = {'replicates': 2000, 'seed': 20261113, 'block_weeks': 4, 'alpha': 0.05}


def riskadj_adjust(scores: dict, series: dict, k: int) -> dict:
    """Rank key := momentum / volatility. Same sign as momentum (volatility > 0), so eligibility is unchanged."""
    return {s: {**x, 'momentum': x['momentum'] / x['volatility'] if x['volatility'] > 0 else -math.inf} for s, x in scores.items()}


def lowvol_adjust(scores: dict, series: dict, k: int) -> dict:
    """Rank key := average of momentum rank (high first) and volatility rank (low first) among positive-momentum,
    eligible, in-trend names; every other name keeps a non-positive key so it is never selected."""
    pool = [s for s, x in scores.items() if x['eligible'] and x['trend'] and x['momentum'] > 0]
    n = len(pool)
    rm = {s: i for i, s in enumerate(sorted(pool, key=lambda s: (-scores[s]['momentum'], s)))}
    rv = {s: i for i, s in enumerate(sorted(pool, key=lambda s: (scores[s]['volatility'], s)))}
    out = {}
    for s, x in scores.items():
        key = (n - (rm[s] + rv[s]) / 2) / n if s in rm else -1.0
        out[s] = {**x, 'momentum': key}
    return out


def mix(a: list, b: list, wa: float) -> list:
    """Buy-and-hold mix of two curves that each start at wb.STARTING: wa of capital in a, the rest in b."""
    assert [d for d, _ in a] == [d for d, _ in b]
    return [(d, wa * x + (1 - wa) * y) for (d, x), (_, y) in zip(a, b)]


def decide(c: dict, base: dict, spy_matched: dict, comparison: dict | None, p_adj: float) -> tuple[str, str]:
    h, d = c['holdout'], c['dev']
    bh, bd, b25, c25 = base['holdout'], base['dev'], base['@25bps']['holdout'], c['@25bps']['holdout']
    m_h, m_d = spy_matched['holdout'], spy_matched['dev']
    if comparison and comparison['upper95'] < 0:
        return 'REJECTED', 'Holdout weekly returns credibly below the live rules.'
    if (h.get('cagr') or -9) <= (m_h.get('cagr') or -9) and (d.get('cagr') or -9) <= (m_d.get('cagr') or -9):
        return 'REJECTED', 'Below exposure-matched SPY in both dev and holdout: no selection edge at its exposure.'
    ok = (comparison is not None and p_adj < BOOT['alpha'] and (h.get('sharpe') or -9) > (bh.get('sharpe') or -9)
          and (h.get('cagr') or -9) > (m_h.get('cagr') or -9) and (c25.get('total') or -9) > (b25.get('total') or -9)
          and (d.get('cagr') or -9) > (bd.get('cagr') or -9))
    if ok:
        return 'PROMISING', 'Passes every pre-registered holdout condition; forward PAPER evaluation still required.'
    return 'NO_CLEAR_EFFECT', 'Fails at least one pre-registered condition (significance, Sharpe, exposure-matched SPY, 25 bps or dev consistency).'


def yearly(curve: list) -> dict:
    out, years = {}, sorted({d[:4] for d, _ in curve})
    for y in years:
        m = wb.metrics(curve, f'{y}-01-01', f'{y}-12-31')
        if m:
            out[y] = round(m['total'], 4)
    return out


def evaluate(data: dict, universe: dict, end: str | None = None) -> dict:
    sessions, series = wb.align(data)
    end = end or sessions[-1]
    periods = {'dev': wb.DEV, 'holdout': (wb.HOLDOUT_START, end), 'full': (wb.DEV[0], end)}
    out = {'experiment': EXPERIMENT, 'candidates': list(CANDIDATES), 'periods': {k: list(v) for k, v in periods.items()},
           'boot': BOOT, 'variants': {}, 'benchmarks': {}, 'comparisons': [], 'dispositions': {}, 'yearly': {},
           'caveats': ['Universe is not survivorship-free (current large caps): every result is biased upward.',
                       'Historical replay with fractional shares at the next open; not Alpaca fills, not forward PAPER results.',
                       'Low volatility is a quality PROXY; no point-in-time fundamentals are collected, so true quality is untested.',
                       'Research only: nothing here can change the live weekly strategy or PR #102.']}
    if 'SPY' not in series:
        raise ValueError('SPY_REQUIRED')
    spy_curve = wb.benchmark(sessions, series['SPY'], start=wb.DEV[0], end=end, weight=1.0)['curve']

    def run(spec: dict, adjust, cost: float):
        r = wb.replay(sessions, series, universe, spec, start=wb.DEV[0], end=end, cost_bps=cost, adjust=adjust)
        years = len(r['curve']) / 252
        return r, (r['traded'] / wb.STARTING / years if years else None)

    def record(name: str, curve: list, exposure: float, turnover, curve25: list):
        out['variants'][name] = {'avg_exposure': exposure, 'turnover_per_year': turnover,
                                 **{p: wb.metrics(curve, *rng) for p, rng in periods.items()},
                                 '@25bps': {p: wb.metrics(curve25, *rng) for p, rng in periods.items()}}
        out['yearly'][name] = yearly(curve)
        return curve

    curves = {}
    for name, spec, adjust in (('base', BASE_SPEC, None), ('riskadj-mom', BASE_SPEC, riskadj_adjust), ('mom-lowvol', BASE_SPEC, lowvol_adjust)):
        r, t = run(spec, adjust, wb.COST_BPS)
        r25, _ = run(spec, adjust, 25.0)
        curves[name] = record(name, r['curve'], r['avg_exposure'], t, r25['curve'])
    for name, adjust in (('core-satellite', None), ('core-satellite-riskadj', riskadj_adjust)):
        r, t = run(FULL_SPEC, adjust, wb.COST_BPS)
        r25, _ = run(FULL_SPEC, adjust, 25.0)
        exp = CORE_WEIGHT + (1 - CORE_WEIGHT) * r['avg_exposure']
        curves[name] = record(name, mix(spy_curve, r['curve'], CORE_WEIGHT), exp, (1 - CORE_WEIGHT) * t if t else t,
                              mix(spy_curve, r25['curve'], CORE_WEIGHT))
    out['benchmarks']['spy'] = {'weight': 1.0, **{p: wb.metrics(spy_curve, *rng) for p, rng in periods.items()}}
    out['yearly']['spy'] = yearly(spy_curve)
    matched = {}
    for name, v in out['variants'].items():
        c = wb.benchmark(sessions, series['SPY'], start=wb.DEV[0], end=end, weight=v['avg_exposure'])['curve']
        matched[name] = {p: wb.metrics(c, *rng) for p, rng in periods.items()}
        out['benchmarks']['spy-matched-' + name] = {'weight': v['avg_exposure'], **matched[name]}
    b = out['variants']['base']
    out['failure_audit'] = {
        'avg_exposure': b['avg_exposure'], 'turnover_per_year': b['turnover_per_year'],
        'holdout_cagr': b['holdout'].get('cagr'), 'holdout_spy_cagr': out['benchmarks']['spy']['holdout'].get('cagr'),
        'holdout_exposure_matched_spy_cagr': matched['base']['holdout'].get('cagr'),
        'exposure_drag': (matched['base']['holdout'].get('cagr') or 0) - (out['benchmarks']['spy']['holdout'].get('cagr') or 0),
        'selection_gap': (b['holdout'].get('cagr') or 0) - (matched['base']['holdout'].get('cagr') or 0),
        'cost_drag_25_vs_10bps_holdout_total': (b['@25bps']['holdout'].get('total') or 0) - (b['holdout'].get('total') or 0),
        'max_drawdown_full': b['full'].get('max_drawdown'),
        'dev_vs_holdout_cagr': [b['dev'].get('cagr'), b['holdout'].get('cagr')]}
    lo, hi = periods['holdout']
    base_w = sp.weekly_returns(curves['base'], lo, hi)
    spy_w = sp.weekly_returns(spy_curve, lo, hi)
    raw = []
    for cand in CANDIDATES:
        cw = sp.weekly_returns(curves[cand], lo, hi)
        weeks = sorted(set(cw) & set(base_w))
        raw.append(sp.block_bootstrap([cw[w] - base_w[w] for w in weeks], BOOT['replicates'], BOOT['seed'], BOOT['block_weeks']))
    adj = sp.holm([r['p_improve'] if r else 1.0 for r in raw])
    for cand, r, p in zip(CANDIDATES, raw, adj):
        cw = sp.weekly_returns(curves[cand], lo, hi)
        weeks = sorted(set(cw) & set(spy_w))
        vs_spy = sp.block_bootstrap([cw[w] - spy_w[w] for w in weeks], BOOT['replicates'], BOOT['seed'], BOOT['block_weeks'])
        out['comparisons'].append({'candidate': cand, 'vs_base_holdout': r, 'p_adjusted': p, 'vs_spy_holdout': vs_spy})
        v, s = out['variants'][cand], out['benchmarks']['spy']['holdout']
        status, why = decide(v, b, matched[cand], r, p)
        out['dispositions'][cand] = {'status': status, 'reason': why,
                                     'beats_spy_holdout': (v['holdout'].get('cagr') or -9) > (s.get('cagr') or -9)
                                     and (v['holdout'].get('sharpe') or -9) > (s.get('sharpe') or -9)}
    return out


def markdown(out: dict) -> str:
    rows = ['| Variant | Dev CAGR | Holdout CAGR | Holdout Sharpe | Max DD (full) | Exposure | Turnover/yr | Holdout @25bps |',
            '|---|---|---|---|---|---|---|---|']
    pct = lambda x: f'{x * 100:.1f}%' if isinstance(x, (int, float)) else '—'
    for name, x in out['variants'].items():
        rows.append(f"| {name} | {pct(x['dev'].get('cagr'))} | {pct(x['holdout'].get('cagr'))} | {x['holdout'].get('sharpe') or 0:.2f} | "
                    f"{pct(x['full'].get('max_drawdown'))} | {pct(x['avg_exposure'])} | {x['turnover_per_year'] or 0:.1f}x | {pct(x['@25bps']['holdout'].get('cagr'))} |")
    s = out['benchmarks']['spy']
    rows.append(f"| SPY (benchmark) | {pct(s['dev'].get('cagr'))} | {pct(s['holdout'].get('cagr'))} | {s['holdout'].get('sharpe') or 0:.2f} | {pct(s['full'].get('max_drawdown'))} | 100% | — | — |")
    disp = '\n'.join(f"- **{k}**: {v['status']} (beats SPY in holdout: {v['beats_spy_holdout']}). {v['reason']}" for k, v in out['dispositions'].items())
    fa = out['failure_audit']
    audit = (f"Live rules: exposure {pct(fa['avg_exposure'])}, holdout CAGR {pct(fa['holdout_cagr'])} vs SPY {pct(fa['holdout_spy_cagr'])} "
             f"and exposure-matched SPY {pct(fa['holdout_exposure_matched_spy_cagr'])}: exposure drag {pct(fa['exposure_drag'])}, "
             f"selection gap {pct(fa['selection_gap'])}; turnover {fa['turnover_per_year'] or 0:.1f}x/yr; 25 bps costs {pct(fa['cost_drag_25_vs_10bps_holdout_total'])} of holdout total.")
    return f"# {EXPERIMENT} (research only)\n\n## Failure audit\n{audit}\n\n" + '\n'.join(rows) + '\n\n## Dispositions\n' + disp + '\n\n' + '\n'.join('- ' + c for c in out['caveats']) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--universe', required=True)
    ap.add_argument('--data', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--markdown')
    ap.add_argument('--end')
    a = ap.parse_args()
    universe = json.loads(Path(a.universe).read_text())
    opener = gzip.open if a.data.endswith('.gz') else open
    with opener(a.data, 'rt') as f:
        data = json.load(f)
    out = evaluate(data, universe, a.end)
    Path(a.output).write_text(json.dumps(out, indent=1, default=str) + '\n')
    if a.markdown:
        Path(a.markdown).write_text(markdown(out))
    print(markdown(out))


if __name__ == '__main__':
    main()
