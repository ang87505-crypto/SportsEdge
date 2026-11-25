"""Daily open-to-close PAPER backtest: five pre-registered rules on a $30,000 account.

Research only (docs/STOCK_DAILY_OC_BACKTEST_PLAN_2026_11_09.md, committed before any result).
Nothing here places, schedules or enables an order. It reuses the weekly backtest's Alpaca
fetch and data format, so both are measured on the same bars.

Every order for session T is decided from bars through T-1. Entries are limit-on-open buys at
the previous raw close + 3%, sized in whole shares from equity at the T-1 close; a gap above the
limit or a missing bar leaves the order unfilled. Exits are at the raw close of T; a missing close
leaves the position unresolved until the next available close. Costs are slippage per side.
Daily bars approximate the opening and closing auctions; they are not guaranteed fills.
The universe is today's large-cap list mapped backwards (survivorship bias), and 2016-2026 has
been examined before, so nothing here is an untouched test.
"""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
from statistics import fmean

from .stock_weekly_backtest_v1 import VARIANTS as WEEKLY_VARIANTS, align, metrics, replay as weekly_replay

CAPITAL = 30_000.0
MAX_POSITIONS = 5
WEIGHT = 0.20
LIMIT_GAP = 0.03
SIZING_SLIPPAGE = 0.0025  # shares are sized as if paying 25 bps, so every cost level trades the same shares
PRICE_FLOOR = 5.0
DOLLAR_VOLUME_FLOOR = 20_000_000.0
PAUSE_DRAWDOWN = 0.10
PAUSE_SESSIONS = 5
COSTS_BPS = (5, 10, 25)
START, EARLY_END, LATE_START = '2017-01-03', '2022-12-31', '2023-01-01'
END = '2026-11-06'
RULES = ('losers5', 'gainers5', 'losers5-spy200', 'losers5-volz', 'losers5-spy200-sector2')


# ---------------------------------------------------------------- signals (bars through T-1 only)

def _ok(xs) -> bool:
    return all(x is not None and x > 0 for x in xs)


def _eligible(s: dict, k: int) -> float | None:
    """Yesterday's total return if the member passes the floors from bars through k-1, else None."""
    if k < 21:
        return None
    ac, c, v = s['ac'], s['c'], s['v']
    if not _ok((ac[k - 1], ac[k - 2], c[k - 1], c[k - 2])) or c[k - 1] < PRICE_FLOOR:
        return None
    window = [(c[i], v[i]) for i in range(k - 20, k)]
    if any(x is None or y is None for x, y in window) or fmean(x * y for x, y in window) < DOLLAR_VOLUME_FLOOR:
        return None
    return ac[k - 1] / ac[k - 2] - 1


def _spy_above_200(spy: dict | None, k: int) -> bool:
    if spy is None or k < 200:
        return False
    w = spy['ac'][k - 200:k]
    return _ok(w) and w[-1] > fmean(w)


def _usual_volatility(s: dict, k: int) -> float | None:
    """Sample s.d. of the 20 adjusted daily returns ending at T-2 (prices T-22..T-2)."""
    if k < 22:
        return None
    p = s['ac'][k - 22:k - 1]
    if not _ok(p):
        return None
    r = [b / a - 1 for a, b in zip(p, p[1:])]
    m = fmean(r)
    sd = math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1))
    return sd if sd > 0 else None


def picks(sessions: list[str], series: dict, universe: dict, k: int, rule: str) -> list[str]:
    if rule not in RULES:
        raise ValueError(rule)
    sectors = {u['symbol']: u['sector'] for u in universe['securities']}
    rets = {}
    for sym in sorted(sectors):
        if sym in series and sym != 'SPY':
            r = _eligible(series[sym], k)
            if r is not None:
                rets[sym] = r
    if rule == 'gainers5':
        return [s for s, r in sorted(rets.items(), key=lambda x: (-x[1], x[0])) if r > 0][:MAX_POSITIONS]
    if rule in ('losers5-spy200', 'losers5-spy200-sector2') and not _spy_above_200(series.get('SPY'), k):
        return []
    losers = {s: r for s, r in rets.items() if r < 0}
    if rule == 'losers5-volz':
        z = {}
        for s, r in losers.items():
            sd = _usual_volatility(series[s], k)
            if sd is not None:
                z[s] = r / sd
        return [s for s, _ in sorted(z.items(), key=lambda x: (x[1], x[0]))][:MAX_POSITIONS]
    ranked = [s for s, _ in sorted(losers.items(), key=lambda x: (x[1], x[0]))]
    if rule == 'losers5-spy200-sector2':
        out, per = [], {}
        for s in ranked:
            if per.get(sectors[s], 0) < 2:
                out.append(s)
                per[sectors[s]] = per.get(sectors[s], 0) + 1
        return out[:MAX_POSITIONS]
    return ranked[:MAX_POSITIONS]


# ---------------------------------------------------------------- execution

class Pause:
    """The 10% drawdown pause: after a close at or below 90% of the running peak, the next
    PAUSE_SESSIONS sessions trade nothing (an owner review), then the peak resets to equity."""

    def __init__(self):
        self.peak, self.last, self.remaining, self.events = None, None, 0, 0

    def paused_today(self) -> bool:
        return self.remaining > 0

    def tick(self):
        self.remaining -= 1
        if self.remaining == 0:
            self.peak = self.last

    def close(self, equity: float):
        self.last = equity
        self.peak = equity if self.peak is None else max(self.peak, equity)
        if equity <= (1 - PAUSE_DRAWDOWN) * self.peak:
            self.events += 1
            self.remaining = PAUSE_SESSIONS


def _window(sessions: list[str], start: str, end: str) -> tuple[int, int]:
    first = next(k for k, d in enumerate(sessions) if d >= start)
    last = max(k for k, d in enumerate(sessions) if d <= end)
    return first, last


def simulate(sessions: list[str], series: dict, universe: dict, rule: str, *, start: str, end: str,
             cost_bps: float, pause: bool = True, capital: float = CAPITAL) -> dict:
    cost = cost_bps / 1e4
    first, last = _window(sessions, start, end)
    cash = capital
    carried: list[dict] = []  # unresolved positions: {symbol, shares, entry, trade}
    curve = [(sessions[first - 1], capital)]
    trades, unresolved = [], []
    orders = filled = unfilled = unfilled_gap = unfilled_missing = unfilled_cash = too_small = 0
    costs = 0.0
    exposure, active = [], 0
    state = Pause() if pause else None
    for k in range(first, last + 1):
        equity = cash + sum(p['shares'] * p['entry'] for p in carried)
        opened = []
        if state is not None and state.paused_today():
            state.tick()
            chosen = []
        else:
            chosen = picks(sessions, series, universe, k, rule)
        for sym in chosen:
            s = series[sym]
            limit = round(s['c'][k - 1] * (1 + LIMIT_GAP), 2)
            shares = math.floor(WEIGHT * equity / (limit * (1 + SIZING_SLIPPAGE)))
            if shares <= 0:
                too_small += 1  # 20% of equity buys less than one share: no order is placed
                continue
            orders += 1
            o = s['o'][k]
            if o is None:
                unfilled += 1
                unfilled_missing += 1
                continue
            if o > limit:
                unfilled += 1
                unfilled_gap += 1
                continue
            if shares * o * (1 + cost) > cash:
                unfilled += 1  # only possible while an unresolved position still holds cash
                unfilled_cash += 1
                continue
            filled += 1
            cash -= shares * o * (1 + cost)
            costs += shares * o * cost
            trade = {'date': sessions[k], 'symbol': sym, 'shares': shares, 'limit': limit, 'entry': o,
                     'exit_on_entry_day': None}
            trades.append(trade)
            opened.append({'symbol': sym, 'shares': shares, 'entry': o, 'trade': trade, 'entered': sessions[k]})
        invested = sum(p['shares'] * p['entry'] for p in opened)
        exposure.append(invested / equity if equity > 0 else 0.0)
        active += bool(opened)
        still = []
        for p in carried + opened:
            c = series[p['symbol']]['c'][k]
            if c is None:
                if p in opened:
                    unresolved.append({'symbol': p['symbol'], 'entered': p['entered'], 'shares': p['shares'],
                                       'resolved': None})
                    p['record'] = unresolved[-1]
                still.append(p)
                continue
            cash += p['shares'] * c * (1 - cost)
            costs += p['shares'] * c * cost
            if p in opened:
                p['trade']['exit_on_entry_day'] = c
            else:
                p['record']['resolved'] = sessions[k]
        carried = still
        equity = cash + sum(p['shares'] * p['entry'] for p in carried)
        curve.append((sessions[k], equity))
        if state is not None and not state.paused_today():
            state.close(equity)
    return {'curve': curve, 'trades': trades, 'unresolved': unresolved, 'orders': orders, 'filled': filled,
            'unfilled': unfilled, 'unfilled_gap': unfilled_gap, 'unfilled_missing_bar': unfilled_missing,
            'unfilled_cash': unfilled_cash, 'skipped_under_one_share': too_small,
            'costs': costs, 'avg_exposure': fmean(exposure) if exposure else 0.0,
            'active_share': active / len(exposure) if exposure else 0.0,
            'pauses': state.events if state is not None else 0,
            'open_unresolved_at_end': sum(1 for u in unresolved if u['resolved'] is None)}


def spy_open_close(sessions: list[str], spy: dict, *, start: str, end: str, cost_bps: float,
                   capital: float = CAPITAL) -> dict:
    cost = cost_bps / 1e4
    first, last = _window(sessions, start, end)
    equity, curve, days = capital, [(sessions[first - 1], capital)], 0
    for k in range(first, last + 1):
        o, c = spy['o'][k], spy['c'][k]
        if o and c:
            equity *= c * (1 - cost) / (o * (1 + cost))
            days += 1
        curve.append((sessions[k], equity))
    return {'curve': curve, 'sessions_traded': days}


def spy_hold(sessions: list[str], spy: dict, *, start: str, end: str, capital: float = CAPITAL) -> dict:
    first, last = _window(sessions, start, end)
    base, mark, curve = spy['ao'][first], None, [(sessions[first - 1], capital)]
    for k in range(first, last + 1):
        mark = spy['ac'][k] if spy['ac'][k] is not None else mark
        curve.append((sessions[k], capital * mark / base))
    return {'curve': curve}


# ---------------------------------------------------------------- metrics and verdicts

def yearly(curve: list[tuple[str, float]]) -> dict:
    out, base, year, value = {}, None, None, None
    for d, v in curve:
        y = d[:4]
        if y != year:
            if year is not None and base is not None:
                out[year] = value / base - 1
            base = value if year is not None else None
            year = y
        value = v
    if year is not None and base is not None:
        out[year] = value / base - 1
    return out


def periods(end: str) -> dict:
    return {'full': (START, end), 'early': (START, EARLY_END), 'late': (LATE_START, end)}


def summarize(curve: list, end: str) -> dict:
    return {**{p: metrics(curve, *rng) for p, rng in periods(end).items()}, 'years': yearly(curve)}


def verdicts(out: dict) -> dict:
    spy_sharpe = out['benchmarks']['spy-hold']['full'].get('sharpe')
    oc_cagr = out['benchmarks']['spy-open-close']['bps10']['full'].get('cagr')
    weekly_sharpe = out['benchmarks']['weekly']['bps10']['full'].get('sharpe')
    gt = lambda a, b: a is not None and b is not None and a > b
    res, passing = {}, []
    for rule, r in out['rules'].items():
        m10, m25 = r['bps10'], r['bps25']
        years = [v for y, v in m10['years'].items() if '2017' <= y <= '2026']
        checks = {
            'cagr_positive_at_10_and_25bps': gt(m10['full'].get('cagr'), 0) and gt(m25['full'].get('cagr'), 0),
            'sharpe_above_spy_buy_and_hold': gt(m10['full'].get('sharpe'), spy_sharpe),
            'cagr_above_spy_open_to_close': gt(m10['full'].get('cagr'), oc_cagr),
            'sharpe_above_weekly': gt(m10['full'].get('sharpe'), weekly_sharpe),
            'max_drawdown_within_35pct': m10['full'].get('max_drawdown') is not None
                                         and m10['full']['max_drawdown'] >= -0.35,
            'both_halves_positive': gt(m10['early'].get('cagr'), 0) and gt(m10['late'].get('cagr'), 0),
            'positive_years': sum(1 for v in years if v > 0) >= 6,
        }
        ok = all(checks.values())
        res[rule] = {'verdict': 'QUALIFIES FOR REVIEW' if ok else 'FAILS', 'checks': checks}
        if ok:
            passing.append(rule)
    res['overall'] = 'QUALIFIES FOR REVIEW: ' + ', '.join(passing) if passing else 'NONE QUALIFIES'
    return res


# ---------------------------------------------------------------- data quality

def fingerprint(data: dict) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def data_quality(sessions: list[str], series: dict, universe: dict, end: str) -> dict:
    first, last = _window(sessions, START, end)
    n = last - first + 1
    members = [u['symbol'] for u in universe['securities']]
    missing, adjusted_days = {}, 0
    for sym in members + ['SPY']:
        s = series.get(sym)
        if s is None:
            missing[sym] = n
            continue
        gaps = sum(1 for k in range(first, last + 1) if s['c'][k] is None)
        if gaps:
            missing[sym] = gaps
        for k in range(first, last + 1):
            if _ok((s['c'][k], s['c'][k - 1], s['ac'][k], s['ac'][k - 1])):
                if abs(s['c'][k] / s['c'][k - 1] - s['ac'][k] / s['ac'][k - 1]) > 0.005:
                    adjusted_days += 1
    return {'evaluation_sessions': n, 'members': len(members),
            'members_without_any_bar': sorted(s for s in members if s not in series),
            'missing_bars_by_symbol': dict(sorted(missing.items())),
            'sessions_raw_vs_adjusted_differ_over_0_5pct': adjusted_days}


# ---------------------------------------------------------------- evaluation

def evaluate(data: dict, universe: dict, end: str = END) -> dict:
    sessions, series = align(data)
    out = {'plan': 'docs/STOCK_DAILY_OC_BACKTEST_PLAN_2026_11_09.md', 'window': [START, end],
           'capital': CAPITAL, 'data': {'fingerprint_sha256': fingerprint(data), 'feed': data.get('feed'),
                                        'asof': data.get('asof'), 'sessions': [sessions[0], sessions[-1]],
                                        'symbols': len(data['bars']),
                                        **data_quality(sessions, series, universe, end)},
           'rules': {}, 'benchmarks': {'spy-open-close': {}, 'weekly': {}}}
    for rule in RULES:
        out['rules'][rule] = {'continuous': {}}
        for bps in COSTS_BPS:
            r = simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=bps, pause=True)
            out['rules'][rule][f'bps{bps}'] = {
                **summarize(r['curve'], end),
                **{k: r[k] for k in ('orders', 'filled', 'unfilled', 'unfilled_gap', 'unfilled_missing_bar',
                                     'unfilled_cash', 'skipped_under_one_share', 'costs', 'avg_exposure', 'active_share', 'pauses', 'open_unresolved_at_end')},
                'unresolved_exits': r['unresolved']}
            c = simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=bps, pause=False)
            out['rules'][rule]['continuous'][f'bps{bps}'] = {'full': metrics(c['curve'], START, end),
                                                            'pauses_if_enforced': r['pauses']}
    spy = series['SPY']
    for bps in COSTS_BPS:
        out['benchmarks']['spy-open-close'][f'bps{bps}'] = summarize(
            spy_open_close(sessions, spy, start=START, end=end, cost_bps=bps)['curve'], end)
        w = weekly_replay(sessions, series, universe, WEEKLY_VARIANTS['momentum'], start=START, end=end, cost_bps=bps)
        out['benchmarks']['weekly'][f'bps{bps}'] = {**summarize(w['curve'], end), 'avg_exposure': w['avg_exposure']}
    out['benchmarks']['spy-hold'] = summarize(spy_hold(sessions, spy, start=START, end=end)['curve'], end)
    out['verdicts'] = verdicts(out)
    # Added after the first results were seen (2026-11-09): zero-cost runs show whether any rule
    # has an edge before costs. Diagnostic only; not part of the pre-registered pass/fail.
    out['diagnostics_after_results'] = {'zero_cost': {
        **{rule: metrics(simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=0,
                                  pause=False)['curve'], START, end) for rule in RULES},
        'spy-open-close': metrics(spy_open_close(sessions, spy, start=START, end=end, cost_bps=0)['curve'], START, end)}}
    return out


def _pct(x, d=1):
    return '—' if x is None else f'{x * 100:.{d}f}%'


def _num(x, d=2):
    return '—' if x is None else f'{x:.{d}f}'


def markdown(out: dict) -> str:
    L = [f"# Daily open-to-close backtest results ({out['window'][0]} to {out['window'][1]})", '',
         f"Pre-registered plan: `{out['plan']}`. Data fingerprint `{out['data']['fingerprint_sha256']}`, "
         f"feed `{out['data']['feed']}`, asof `{out['data']['asof']}`. Survivorship-biased universe; "
         'no untouched test period; daily bars approximate auction fills.', '',
         f"**Overall: {out['verdicts']['overall']}**", '',
         '| Rule | Cost/side | End value | CAGR | Sharpe | Max DD | Costs paid | Exposure | Days active | Orders | Filled | Unfilled | Pauses |',
         '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for rule, r in out['rules'].items():
        for bps in COSTS_BPS:
            x = r[f'bps{bps}']
            f = x['full']
            L.append(f"| {rule} | {bps} bps | ${f.get('end_value', 0):,.0f} | {_pct(f.get('cagr'))} | "
                     f"{_num(f.get('sharpe'))} | {_pct(f.get('max_drawdown'))} | ${x['costs']:,.0f} | "
                     f"{_pct(x['avg_exposure'])} | {_pct(x['active_share'])} | {x['orders']} | {x['filled']} | "
                     f"{x['unfilled']} | {x['pauses']} |")
    L += ['', '| Comparison | Cost/side | End value | CAGR | Sharpe | Max DD |', '|---|---|---|---|---|---|']
    h = out['benchmarks']['spy-hold']['full']
    L.append(f"| SPY buy-and-hold (dividends) | none | ${h.get('end_value', 0):,.0f} | {_pct(h.get('cagr'))} | "
             f"{_num(h.get('sharpe'))} | {_pct(h.get('max_drawdown'))} |")
    for name, label in (('spy-open-close', 'SPY open-to-close'), ('weekly', 'Weekly strategy ($1,000)')):
        for bps in COSTS_BPS:
            f = out['benchmarks'][name][f'bps{bps}']['full']
            L.append(f"| {label} | {bps} bps | ${f.get('end_value', 0):,.0f} | {_pct(f.get('cagr'))} | "
                     f"{_num(f.get('sharpe'))} | {_pct(f.get('max_drawdown'))} |")
    L += ['', '## Pass/fail at 10 bps (as-live, with the drawdown pause)', '']
    for rule in out['rules']:
        v = out['verdicts'][rule]
        failed = [k for k, ok in v['checks'].items() if not ok]
        L.append(f"- **{rule}: {v['verdict']}**" + (f" (failed: {', '.join(failed)})" if failed else ''))
    years = sorted({y for r in out['rules'].values() for y in r['bps10']['years']})
    L += ['', '## Calendar-year returns at 10 bps', '', '| Rule | ' + ' | '.join(years) + ' |',
          '|---|' + '---|' * len(years)]
    rows = [(rule, r['bps10']['years']) for rule, r in out['rules'].items()]
    rows += [('SPY buy-and-hold', out['benchmarks']['spy-hold']['years']),
             ('SPY open-to-close', out['benchmarks']['spy-open-close']['bps10']['years']),
             ('Weekly strategy', out['benchmarks']['weekly']['bps10']['years'])]
    for name, ys in rows:
        L.append(f'| {name} | ' + ' | '.join(_pct(ys.get(y)) for y in years) + ' |')
    L += ['', '## Descriptive splits at 10 bps (neither is untouched)', '',
          '| Rule | 2017–2022 CAGR | 2017–2022 Sharpe | 2023–2026 CAGR | 2023–2026 Sharpe |', '|---|---|---|---|---|']
    for rule, r in out['rules'].items():
        e, l = r['bps10']['early'], r['bps10']['late']
        L.append(f"| {rule} | {_pct(e.get('cagr'))} | {_num(e.get('sharpe'))} | {_pct(l.get('cagr'))} | {_num(l.get('sharpe'))} |")
    d = out['data']
    L += ['', '## Data', '', f"- Sessions in evaluation: {d['evaluation_sessions']}; members: {d['members']}; "
          f"symbols with bars: {d['symbols']}.",
          f"- Members without any bar: {', '.join(d['members_without_any_bar']) or 'none'}.",
          f"- Sessions where raw and adjusted returns differ by over 0.5% (splits, dividends): "
          f"{d['sessions_raw_vs_adjusted_differ_over_0_5pct']}.",
          f"- Members with missing bars in the window: {len(d['missing_bars_by_symbol'])}."]
    for sym, n in d['missing_bars_by_symbol'].items():
        L.append(f'  - {sym}: {n} of {d["evaluation_sessions"]} sessions without a bar.')
    unresolved = sum(len(r[f'bps{b}']['unresolved_exits']) for r in out['rules'].values() for b in COSTS_BPS)
    L.append(f'- Unresolved exits across all runs: {unresolved}.')
    L += ['', '## Orders that did not fill (as-live)', '',
          '| Rule | Cost/side | Gap above limit | No bar that day | Not enough cash | Under one share (no order) |',
          '|---|---|---|---|---|---|']
    for rule, r in out['rules'].items():
        for bps in COSTS_BPS:
            x = r[f'bps{bps}']
            L.append(f"| {rule} | {bps} bps | {x['unfilled_gap']} | {x['unfilled_missing_bar']} | "
                     f"{x['unfilled_cash']} | {x['skipped_under_one_share']} |")
    L += ['', '## Without the drawdown pause (diagnostic)', '',
          '| Rule | Cost/side | End value | CAGR | Sharpe | Max DD | Pauses if enforced |', '|---|---|---|---|---|---|---|']
    for rule, r in out['rules'].items():
        for bps in COSTS_BPS:
            x = r['continuous'][f'bps{bps}']
            f = x['full']
            L.append(f"| {rule} | {bps} bps | ${f.get('end_value', 0):,.0f} | {_pct(f.get('cagr'))} | "
                     f"{_num(f.get('sharpe'))} | {_pct(f.get('max_drawdown'))} | {x['pauses_if_enforced']} |")
    diag = out.get('diagnostics_after_results', {}).get('zero_cost')
    if diag:
        L += ['', '## Before costs (diagnostic added after results; not part of pass/fail)', '',
              '| Series (0 bps, no pause) | End value | CAGR | Sharpe | Max DD |', '|---|---|---|---|---|']
        for name, f in diag.items():
            L.append(f"| {name} | ${f.get('end_value', 0):,.0f} | {_pct(f.get('cagr'))} | {_num(f.get('sharpe'))} | "
                     f"{_pct(f.get('max_drawdown'))} |")
    return '\n'.join(L) + '\n'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--universe', type=Path, required=True)
    f.add_argument('--end', default=END)
    f.add_argument('--output', type=Path, required=True)
    r = sub.add_parser('run')
    r.add_argument('--universe', type=Path, required=True)
    r.add_argument('--data', type=Path, required=True)
    r.add_argument('--end', default=END)
    r.add_argument('--output', type=Path, required=True)
    r.add_argument('--markdown', type=Path, required=True)
    a = p.parse_args()
    universe = json.loads(a.universe.read_text(encoding='utf-8'))
    if a.command == 'fetch':
        from .stock_forward_bridge_v1 import Source
        from .stock_weekly_backtest_v1 import START_DATA, fetch
        source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''))
        symbols = sorted({s['symbol'] for s in universe['securities']} | {'SPY'})
        data = fetch(source, symbols, START_DATA, a.end)
        with gzip.open(a.output, 'wt', encoding='utf-8') as fh:
            json.dump(data, fh)
        print(json.dumps({'status': 'FETCHED', 'sessions': len(data['sessions']), 'symbols': len(data['bars']),
                          'requests': source.count, 'fingerprint_sha256': fingerprint(data)}))
        return
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    out = evaluate(data, universe, end=a.end)
    text = json.dumps(out, indent=1, sort_keys=True)
    a.output.write_text(text, encoding='utf-8')
    a.markdown.write_text(markdown(out), encoding='utf-8')
    print(markdown(out))
    # The full results also travel in the log, so they can be checked without the artifact.
    blob = base64.b64encode(gzip.compress(text.encode('utf-8'), mtime=0)).decode()
    print('RESULTS_SHA256', hashlib.sha256(text.encode('utf-8')).hexdigest())
    print('RESULTS_B64_BEGIN')
    for i in range(0, len(blob), 4000):
        print(blob[i:i + 4000])
    print('RESULTS_B64_END')


if __name__ == '__main__':
    main()
