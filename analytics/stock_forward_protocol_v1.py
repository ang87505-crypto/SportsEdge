"""Read-only prospective stock evaluation (docs/STOCK_FORWARD_PROTOCOL_2026_11_20.md). Research only.

Scores ONLY sessions after the last historical data end (2026-11-18), with the frozen rules and no fitting:
  current          stock-mom252-skip21-trend200-v1, whole shares from $1,000 (the live paper rules)
  holdrank10       the previously evaluated hold-buffer challenger (registry RUNNING, forward only)
  SPY matched      SPY held at each strategy's realized gross in the forward window
  SPY 50%          the total-account benchmark for the 50% gross policy
reporting capital utilization, idle cash, costs (10 and 25 bps), turnover, drawdown, provenance and missing data.
A statement is allowed only after MIN_WEEKS forward weeks (the registry minWeeks). Nothing here trades, registers or
promotes; the existing promotion rules (beat the live rules AND SPY at matched exposure) are unchanged.

`live_vs_replay` is the interface for Codex: it compares the live PAPER account's weekly equity (from existing
reconcile snapshots) with the replay of the same rules, so implementation shortfall is measured, not assumed.
"""
from __future__ import annotations
import argparse
import gzip
import json
import math
from pathlib import Path
from statistics import fmean, pstdev

from . import stock_weekly_backtest_v1 as bt
from . import stock_data_audit_v1 as audit

FORWARD_START = '2026-11-19'
MIN_WEEKS = 26
CAP = 0.50
RULES = {'current': bt.ROUND3[bt.CURRENT], 'holdrank10': bt.ROUND3[bt.CHALLENGER]}


def _metrics(curve: list, exposure: list) -> dict:
    if len(curve) < 2:
        return {'sessions': len(curve)}
    values = [v for _, v in curve]
    rets = [b / a - 1 for a, b in zip(values, values[1:])]
    sd = pstdev(rets) if len(rets) > 1 else 0.0
    down = math.sqrt(sum(min(r, 0.0) ** 2 for r in rets) / len(rets))
    peak, mdd = values[0], 0.0
    for v in values:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return {'sessions': len(curve), 'total_return': values[-1] / values[0] - 1, 'max_drawdown': mdd,
            'sharpe': fmean(rets) / sd * math.sqrt(252) if sd > 0 else None,
            'sortino': fmean(rets) / down * math.sqrt(252) if down > 0 else None,
            'avg_gross': fmean(exposure) if exposure else None, 'min_gross': min(exposure) if exposure else None,
            'avg_idle_cash_share': 1 - fmean(exposure) if exposure else None,
            'avg_idle_within_cap': fmean(max(0.0, CAP - x) for x in exposure) if exposure else None}


def forward_report(data: dict, universe: dict, *, start: str = FORWARD_START, end: str | None = None) -> dict:
    sessions, series = bt.align(data)
    end = end or sessions[-1]
    window = [d for d in sessions if start <= d <= end]
    out = {'version': 'stock-forward-protocol-v1', 'window': [start, end], 'sessions': len(window), 'min_weeks': MIN_WEEKS,
           'rules_frozen': {k: v for k, v in RULES.items()}, 'strategies': {}, 'benchmarks': {},
           'provenance': {'dataset_sha256': audit.dataset_digest(data), 'feed': data.get('feed'), 'asof': data.get('asof'),
                          'universe_revision': universe.get('revision')}}
    curves = {}
    for name, spec in RULES.items():
        if not window:
            break
        r = bt.replay(sessions, series, universe, spec, start=start, end=end)
        r25 = bt.replay(sessions, series, universe, spec, start=start, end=end, cost_bps=25.0)
        weeks = len(bt.weekly_returns(r['curve'], start, end))
        curves[name] = r
        avg_equity = fmean(v for _, v in r['curve']) if r['curve'] else None
        out['strategies'][name] = {**_metrics(r['curve'], r['exposure']), 'decisions': r['decisions'],
                                   'rejected_decisions': r['rejected'], 'cash_blocked': r['cash_blocked'],
                                   'traded': r['traded'], 'costs_10bps': r['traded'] * bt.COST_BPS / 1e4,
                                   'turnover_per_avg_equity': r['traded'] / avg_equity if avg_equity else None,
                                   'at_25bps': _metrics(r25['curve'], r25['exposure']), 'weeks': weeks}
    if 'SPY' in series and window:
        for label, w in (('spy-50', CAP), ('spy-100', 1.0)):
            c = bt.benchmark(sessions, series['SPY'], start=start, end=end, weight=w)['curve']
            out['benchmarks'][label] = _metrics(c, [w] * len(c))
        for name, r in curves.items():
            w = fmean(r['exposure']) if r['exposure'] else 0.0
            c = bt.benchmark(sessions, series['SPY'], start=start, end=end, weight=w)['curve']
            out['benchmarks']['spy-matched-' + name] = {**_metrics(c, [w] * len(c)), 'weight': w}
    weeks = min((s.get('weeks', 0) for s in out['strategies'].values()), default=0)
    out['weeks'] = weeks
    if weeks < MIN_WEEKS:
        out['status'] = 'INSUFFICIENT_FORWARD_WEEKS'
        out['statement'] = None
    else:
        s, m = out['strategies'], out['benchmarks']
        beats = lambda a, b: (a or {}).get('sharpe') is not None and (b or {}).get('sharpe') is not None and a['sharpe'] > b['sharpe']
        out['status'] = 'MEASURED'
        out['statement'] = {
            'holdrank10_beats_current': beats(s.get('holdrank10'), s.get('current')),
            'holdrank10_beats_matched_spy': beats(s.get('holdrank10'), m.get('spy-matched-holdrank10')),
            'current_beats_matched_spy': beats(s.get('current'), m.get('spy-matched-current')),
            'note': 'Descriptive forward evidence for the existing registry gate; it never promotes anything.'}
    # Missing data inside the window: members without a bar on a window session.
    missing = {}
    for sym in sorted(u['symbol'] for u in universe['securities']):
        b = series.get(sym)
        n = sum(1 for d in window if b is None or b['c'][sessions.index(d)] is None)
        if n:
            missing[sym] = n
    out['provenance']['members_missing_window_bars'] = missing
    out['provenance']['spy_missing_window_bars'] = (sum(1 for d in window if series['SPY']['c'][sessions.index(d)] is None)
                                                    if 'SPY' in series else None)
    return out


def live_vs_replay(live: list[dict], replay_curve: list[tuple[str, float]]) -> dict:
    """Implementation shortfall. `live` rows: {date, equity, external_flow} from the PAPER reconcile snapshots
    (after close); `replay_curve`: the replay of the same rules over the same window. Weeks with deposits or
    withdrawals are excluded, never netted by guesswork."""
    rep = dict(replay_curve)
    rows = sorted(live, key=lambda r: r['date'])
    if any(not (isinstance(r.get('equity'), (int, float)) and r['equity'] > 0) for r in rows):
        raise ValueError('LIVE_INVALID_EQUITY')
    pairs, excluded = [], 0
    for a, b in zip(rows, rows[1:]):
        if a['date'] not in rep or b['date'] not in rep:
            excluded += 1
            continue
        if b.get('external_flow', 0) != 0:
            excluded += 1
            continue
        pairs.append({'date': b['date'], 'live': b['equity'] / a['equity'] - 1, 'replay': rep[b['date']] / rep[a['date']] - 1})
    diffs = [p['live'] - p['replay'] for p in pairs]
    return {'periods': len(pairs), 'excluded': excluded,
            'mean_shortfall': fmean(diffs) if diffs else None,
            'cumulative_live': math.prod(1 + p['live'] for p in pairs) - 1 if pairs else None,
            'cumulative_replay': math.prod(1 + p['replay'] for p in pairs) - 1 if pairs else None,
            'status': 'INSUFFICIENT_FORWARD_WEEKS' if len(pairs) < MIN_WEEKS else 'MEASURED', 'pairs': pairs}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--universe', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--start', default=FORWARD_START)
    a = p.parse_args()
    universe = json.loads(a.universe.read_text(encoding='utf-8'))
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    out = forward_report(data, universe, start=a.start)
    a.output.write_text(json.dumps(out, indent=1), encoding='utf-8')
    print(json.dumps({k: out[k] for k in ('window', 'sessions', 'weeks', 'status')} |
                     {'strategies': {n: {k: s.get(k) for k in ('decisions', 'total_return', 'avg_gross', 'traded')}
                                     for n, s in out['strategies'].items()},
                      'provenance': {k: out['provenance'][k] for k in ('dataset_sha256', 'spy_missing_window_bars')}},
                     indent=1))


if __name__ == '__main__':
    main()
