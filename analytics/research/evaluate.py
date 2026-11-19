"""Evaluations and reports for the research candidates (pre-registered in
docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md). Research only: no orders, no activation."""
from __future__ import annotations
from bisect import bisect_left, bisect_right
from statistics import fmean

from analytics.stock_weekly_backtest_v1 import VARIANTS as WEEKLY_VARIANTS, metrics, replay as weekly_replay

from . import candidates as cand
from . import engine

CAPITAL = 30_000.0
COSTS = (0, 5, 10, 25)
DATA_START = '2016-01-01'
FIRST_EXEC = '2017-02-01'
END = '2026-11-06'
EARLY_END, LATE_START = '2022-12-31', '2023-01-01'
FORWARD_START = '2026-11-10'
FORWARD_MIN = {'momentum-quality-paper-v1': 12, 'qmom-disclosure-follower-v1': 12, 'berkshire-13f-top5-paper-v1': 6}
FORWARD_MIN_SESSIONS = 252
RUN_FIELDS = ('orders', 'filled', 'unfilled_gap', 'unfilled_missing', 'unfilled_cash', 'reduced_for_cash', 'unavailable',
              'blocked_by_unresolved', 'sells_pending', 'stale_marks', 'costs', 'dividends', 'turnover_per_year',
              'avg_exposure', 'cash_end', 'halted_on', 'halt_peak', 'equity_after_halt_exit', 'open_unresolved_at_end')


def yearly(curve) -> dict:
    out, base, year, value = {}, None, None, None
    for d, v in curve:
        if d[:4] != year:
            if year is not None and base is not None:
                out[year] = value / base - 1
            base = value if year is not None else None
            year = d[:4]
        value = v
    if year is not None and base is not None:
        out[year] = value / base - 1
    return out


def summarize(curve, lo: str, hi: str) -> dict:
    return {'full': metrics(curve, lo, hi), 'early': metrics(curve, lo, min(EARLY_END, hi)),
            'late': metrics(curve, max(LATE_START, lo), hi) if hi >= LATE_START else {}, 'years': yearly(curve)}


def window(sessions, first_exec: str, end: str) -> tuple[int, int]:
    return bisect_left(sessions, first_exec), bisect_right(sessions, end) - 1


def hold_curve(sessions, s: dict, start_k: int, end_k: int, capital: float = CAPITAL):
    """Buy-and-hold with distributions: adjusted open of the first session to adjusted closes."""
    base = s['ao'][start_k]
    mark, curve = base, [(sessions[start_k - 1], capital)]
    for k in range(start_k, end_k + 1):
        mark = s['ac'][k] if s['ac'][k] is not None else mark
        curve.append((sessions[k], capital * mark / base))
    return curve


def exposure_matched(sessions, spy: dict, exposure: list, start_k: int, end_k: int, capital: float = CAPITAL):
    """SPY total return scaled each session by the candidate's invested share at the previous close
    (first session: at its own close), the rest in cash at 0%."""
    eq, curve = capital, [(sessions[start_k - 1], capital)]
    for i, k in enumerate(range(start_k, end_k + 1)):
        prev = spy['ao'][k] if i == 0 else spy['ac'][k - 1]
        e = exposure[0] if i == 0 else exposure[i - 1]
        if prev and spy['ac'][k]:
            eq *= 1 + e * (spy['ac'][k] / prev - 1)
        curve.append((sessions[k], eq))
    return curve


def run_series(sessions, series, actions, decisions, start_k, end_k, *, halt: bool, cost: float) -> dict:
    r = engine.simulate(sessions, series, actions, decisions, start_index=start_k, end_index=end_k, capital=CAPITAL,
                        cost_bps=cost, halt=halt)
    lo, hi = sessions[start_k], sessions[end_k]
    return {**summarize(r['curve'], lo, hi), **{f: r[f] for f in RUN_FIELDS},
            'unresolved': r['unresolved'], 'integrity_mismatches': len(r['integrity_mismatches']),
            'integrity_examples': r['integrity_mismatches'][:10], 'executions': len(r['executions']),
            'execution_log': r['executions'][-24:], 'exposure_series': r['exposure'], 'curve_end': r['curve'][-1]}


def run_candidate(sessions, series, actions, decisions, start_k, end_k) -> dict:
    out = {'decisions': len(decisions)}
    for c in COSTS:
        out[f'bps{c}'] = {'as_live': run_series(sessions, series, actions, decisions, start_k, end_k, halt=True, cost=c),
                          'continuous': run_series(sessions, series, actions, decisions, start_k, end_k, halt=False, cost=c)}
    return out


def benchmarks(sessions, series, universe, start_k, end_k, extra_holds=('BRK.B', 'QMOM')) -> dict:
    lo, hi = sessions[start_k], sessions[end_k]
    out = {'spy-hold': summarize(hold_curve(sessions, series['SPY'], start_k, end_k), lo, hi), 'weekly': {}}
    for sym in extra_holds:
        if sym in series and series[sym]['ao'][start_k]:
            out[sym.lower() + '-hold'] = summarize(hold_curve(sessions, series[sym], start_k, end_k), lo, hi)
    if universe is not None:
        for c in COSTS:
            w = weekly_replay(sessions, series, universe, WEEKLY_VARIANTS['momentum'], start=lo, end=hi, cost_bps=c)
            out['weekly'][f'bps{c}'] = {**summarize(w['curve'], lo, hi), 'avg_exposure': w['avg_exposure']}
    return out


def strip_series(result: dict) -> dict:
    """Drop the long exposure series before serializing."""
    for c in COSTS:
        for kind in ('as_live', 'continuous'):
            result[f'bps{c}'][kind].pop('exposure_series', None)
    return result


def verdict(res: dict, bench: dict, matched: dict) -> dict:
    """The nine pre-registered conditions (continuous series at 10 bps unless stated)."""
    gt = lambda a, b: a is not None and b is not None and a > b
    c10, c25 = res['bps10']['continuous'], res['bps25']['continuous']
    f10 = c10['full']
    years = [v for y, v in c10['years'].items() if '2017' <= y <= '2026']
    live = res['bps10']['as_live']
    halt_ok = live['halted_on'] is None or (live['equity_after_halt_exit'] is not None and live['halt_peak']
                                            and live['equity_after_halt_exit'] / live['halt_peak'] - 1 >= -0.15)
    checks = {
        'cagr_positive_at_10_and_25bps': gt(f10.get('cagr'), 0) and gt(c25['full'].get('cagr'), 0),
        'sharpe_above_spy_buy_and_hold': gt(f10.get('sharpe'), bench['spy-hold']['full'].get('sharpe')),
        'cagr_above_exposure_matched_spy': gt(f10.get('cagr'), matched['full'].get('cagr')),
        'sharpe_above_weekly': gt(f10.get('sharpe'), bench['weekly']['bps10']['full'].get('sharpe')) if bench['weekly'] else False,
        'max_drawdown_within_35pct': f10.get('max_drawdown') is not None and f10['max_drawdown'] >= -0.35,
        'both_halves_positive': gt(c10['early'].get('cagr'), 0) and gt(c10['late'].get('cagr'), 0),
        'at_least_6_positive_years': sum(1 for v in years if v > 0) >= 6,
        'no_unresolved_at_any_cost': all(not res[f'bps{c}'][k]['unresolved'] and not res[f'bps{c}'][k]['open_unresolved_at_end']
                                         for c in COSTS for k in ('as_live', 'continuous')),
        'halt_exit_loss_within_15pct': bool(halt_ok),
    }
    return {'verdict': 'QUALIFIES FOR REVIEW' if all(checks.values()) else 'FAILS', 'checks': checks}


def forward_status(sid: str, res: dict | None, sessions_run: int) -> str:
    if res is None:
        return 'NOT STARTED'
    if res['bps10']['continuous']['executions'] < FORWARD_MIN[sid] or sessions_run < FORWARD_MIN_SESSIONS:
        return 'INSUFFICIENT FORWARD SAMPLE'
    return 'READY FOR PRE-REGISTERED FORWARD REVIEW'


# ---------------------------------------------------------------- report

def _pct(x, d=1):
    return '—' if x is None else f'{x * 100:.{d}f}%'


def _num(x, d=2):
    return '—' if x is None else f'{x:.{d}f}'


def candidate_table(name: str, res: dict) -> list[str]:
    L = [f'| {name} | Series | Cost/side | End value | Total | CAGR | Sharpe | Max DD | Turnover/yr | Exposure | End cash | Costs paid | Halted |',
         '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for c in COSTS:
        for kind in ('continuous', 'as_live'):
            x = res[f'bps{c}'][kind]
            f = x['full']
            L.append(f"| | {kind.replace('_', '-')} | {c} bps | ${f.get('end_value', 0):,.0f} | {_pct(f.get('total'))} | "
                     f"{_pct(f.get('cagr'))} | {_num(f.get('sharpe'))} | {_pct(f.get('max_drawdown'))} | "
                     f"{_num(x['turnover_per_year'], 1)}x | {_pct(x['avg_exposure'], 0)} | ${x['cash_end']:,.0f} | "
                     f"${x['costs']:,.0f} | {x['halted_on'] or 'no'} |")
    return L
