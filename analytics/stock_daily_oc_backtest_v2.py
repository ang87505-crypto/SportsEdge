"""Daily open-to-close PAPER backtest, v2 corrections (docs/STOCK_DAILY_OC_BACKTEST_V2_CORRECTIONS_2026_11_09.md).

Research only. v1 (analytics/stock_daily_oc_backtest_v1.py) and its results are preserved; v2 keeps
the five frozen rules, their signals, the costs, the comparisons and the seven pass/fail conditions,
and corrects four defects found in review:

1. the drawdown peak starts at the starting equity, so a first-session loss can trigger the pause;
2. the pause halts new entries until an explicit owner authorization (a replay has none);
3. an unresolved position blocks new entries, and any unresolved exit blocks qualification;
4. members with missing bars are audited against Alpaca corporate actions: a name change is
   followed to the new symbol, a merger is recorded as a delisting, anything else is listed.

It also reports gross (0 bps) returns and the break-even cost per side. Nothing here trades.
"""
from __future__ import annotations
import argparse
import base64
import copy
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
from statistics import fmean

from . import stock_daily_oc_backtest_v1 as v1
from .stock_daily_oc_backtest_v1 import (CAPITAL, COSTS_BPS, LIMIT_GAP, PAUSE_DRAWDOWN, RULES, SIZING_SLIPPAGE, START,
                                         WEIGHT, _pct, _num, _window, data_quality, fingerprint, periods, picks,
                                         spy_hold, spy_open_close, summarize)
from .stock_weekly_backtest_v1 import VARIANTS as WEEKLY_VARIANTS, align, metrics, replay as weekly_replay

VERSION = 'v2'
END = v1.END
V1_BASE_FINGERPRINT = 'de8a61bddce7e07d9a9dce94d63649528bda44b4007b1eefe55e744c3748f085'
BREAK_EVEN_MAX_BPS = 25.0


# ---------------------------------------------------------------- correction 1 and 2: the safety pause

class SafetyPause:
    """Halts new entries at the first close 10% or more below the peak, the peak starting at the
    starting equity. Only an explicit owner authorization resumes; time alone never does."""

    def __init__(self, start_equity: float):
        self.peak, self.last, self.halted, self.events, self.halted_on = start_equity, start_equity, False, 0, None

    def close(self, equity: float, session: str | None = None):
        self.last = equity
        if self.halted:
            return
        self.peak = max(self.peak, equity)
        if equity <= (1 - PAUSE_DRAWDOWN) * self.peak:
            self.halted, self.events = True, self.events + 1
            self.halted_on = session

    def authorize_resume(self, authorization: str):
        if not isinstance(authorization, str) or not authorization.strip():
            raise ValueError('OWNER_AUTHORIZATION_REQUIRED')
        self.halted, self.peak = False, self.last


# ---------------------------------------------------------------- execution (corrections 1-3)

def simulate(sessions: list[str], series: dict, universe: dict, rule: str, *, start: str, end: str,
             cost_bps: float, pause: bool = True, capital: float = CAPITAL) -> dict:
    cost = cost_bps / 1e4
    first, last = _window(sessions, start, end)
    cash = capital
    carried: list[dict] = []
    curve = [(sessions[first - 1], capital)]
    trades, unresolved = [], []
    orders = filled = unfilled = unfilled_gap = unfilled_missing = unfilled_cash = too_small = blocked = 0
    costs = 0.0
    exposure, active = [], 0
    state = SafetyPause(capital) if pause else None
    for k in range(first, last + 1):
        equity = cash + sum(p['shares'] * p['entry'] for p in carried)
        opened = []
        if state is not None and state.halted:
            chosen = []
        else:
            chosen = picks(sessions, series, universe, k, rule)
            if chosen and carried:
                blocked += 1  # correction 3: no new entries while a position is unresolved
                chosen = []
        for sym in chosen:
            s = series[sym]
            limit = round(s['c'][k - 1] * (1 + LIMIT_GAP), 2)
            shares = math.floor(WEIGHT * equity / (limit * (1 + SIZING_SLIPPAGE)))
            if shares <= 0:
                too_small += 1
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
                unfilled += 1
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
        if state is not None:
            state.close(equity, sessions[k])
    return {'curve': curve, 'trades': trades, 'unresolved': unresolved, 'orders': orders, 'filled': filled,
            'unfilled': unfilled, 'unfilled_gap': unfilled_gap, 'unfilled_missing_bar': unfilled_missing,
            'unfilled_cash': unfilled_cash, 'skipped_under_one_share': too_small,
            'blocked_by_unresolved': blocked, 'costs': costs,
            'avg_exposure': fmean(exposure) if exposure else 0.0,
            'active_share': active / len(exposure) if exposure else 0.0,
            'pauses': state.events if state is not None else 0,
            'halted_on': state.halted_on if state is not None else None,
            'open_unresolved_at_end': sum(1 for u in unresolved if u['resolved'] is None)}


def verdicts(out: dict) -> dict:
    """v1's seven frozen conditions plus correction 3: no unresolved exit and no position left
    unresolved at the end, checked independently at every cost level present (5, 10 and 25 bps)."""
    res = v1.verdicts(out)
    passing = []
    for rule, r in out['rules'].items():
        levels = [r[k] for k in (f'bps{b}' for b in COSTS_BPS) if k in r]
        clean = all(not x.get('unresolved_exits') and not x.get('open_unresolved_at_end') for x in levels)
        res[rule]['checks']['no_unresolved_exits'] = clean
        ok = all(res[rule]['checks'].values())
        res[rule]['verdict'] = 'QUALIFIES FOR REVIEW' if ok else 'FAILS'
        if ok:
            passing.append(rule)
    res['overall'] = 'QUALIFIES FOR REVIEW: ' + ', '.join(passing) if passing else 'NONE QUALIFIES'
    return res


# ---------------------------------------------------------------- correction 4: security identity

def gap_members(data: dict, universe: dict, end: str) -> list[str]:
    sessions, series = align(data)
    first, last = _window(sessions, START, end)
    out = []
    for u in universe['securities']:
        s = series.get(u['symbol'])
        if s is None or any(s['c'][k] is None for k in range(first, last + 1)):
            out.append(u['symbol'])
    return sorted(out)


def classify_gaps(symbols: list[str], pages: list) -> dict:
    """Name change (followed), cash/stock merger (delisted) or unexplained, from Alpaca corporate actions."""
    found = {s: {'kind': 'unexplained'} for s in symbols}
    for page in pages:
        groups = page.get('corporate_actions') if isinstance(page, dict) else None
        if not isinstance(groups, dict):
            raise ValueError('CORPORATE_ACTIONS_PAGE_INVALID')
        for r in groups.get('name_changes') or []:
            old, new = r.get('old_symbol'), r.get('new_symbol')
            if old in found and isinstance(new, str):
                found[old] = {'kind': 'name_change', 'new_symbol': new,
                              'date': r.get('process_date') or r.get('effective_date')}
        for kind in ('cash_mergers', 'stock_mergers', 'stock_and_cash_mergers'):
            for r in groups.get(kind) or []:
                target = r.get('acquiree_symbol')
                if target in found and found[target]['kind'] != 'name_change':
                    found[target] = {'kind': kind[:-1], 'date': r.get('effective_date') or r.get('process_date'),
                                     'acquirer': r.get('acquirer_symbol'),
                                     'rate': r.get('rate') or r.get('cash_rate')}
    return found


def apply_identity(data: dict) -> dict:
    """Join each renamed member's new-symbol bars from the change date. The old adjusted prices are
    rescaled so the adjusted return across the join equals the raw return."""
    out = copy.deepcopy({k: v for k, v in data.items() if k != 'supplement'})
    extra = (data.get('supplement') or {}).get('bars', {})
    for sym, info in (data.get('identity') or {}).items():
        if info.get('kind') != 'name_change' or info.get('new_symbol') not in extra or not info.get('date'):
            continue
        new, cut = extra[info['new_symbol']], info['date']
        old = data['bars'].get(sym) or {'d': [], 'o': [], 'c': [], 'v': [], 'ao': [], 'ac': []}
        keep = [i for i, d in enumerate(old['d']) if d < cut]
        take = [i for i, d in enumerate(new['d']) if d >= cut]
        scale = 1.0
        if keep and take:
            j, f = keep[-1], take[0]
            scale = (new['ac'][f] * old['c'][j]) / (new['c'][f] * old['ac'][j])
        joined = {'d': [old['d'][i] for i in keep] + [new['d'][i] for i in take]}
        for k in ('o', 'c', 'v'):
            joined[k] = [old[k][i] for i in keep] + [new[k][i] for i in take]
        for k in ('ao', 'ac'):
            joined[k] = [old[k][i] * scale for i in keep] + [new[k][i] for i in take]
        out['bars'][sym] = joined
    return out


# ---------------------------------------------------------------- break-even cost

def break_even(curve_at, lo: str, hi: str) -> float | None:
    """Cost per side (bps) at which net CAGR is zero; None if it loses before costs; inf above 25 bps."""
    cagr = lambda bps: metrics(curve_at(bps), lo, hi).get('cagr')
    if cagr(0) is None or cagr(0) <= 0:
        return None
    if cagr(BREAK_EVEN_MAX_BPS) > 0:
        return math.inf
    a, b = 0.0, BREAK_EVEN_MAX_BPS
    for _ in range(16):
        m = (a + b) / 2
        a, b = (m, b) if cagr(m) > 0 else (a, m)
    return round((a + b) / 2, 2)


# ---------------------------------------------------------------- evaluation

def evaluate(data: dict, universe: dict, end: str = END) -> dict:
    corrected = apply_identity(data)
    sessions, series = align(corrected)
    out = {'version': VERSION, 'plan': 'docs/STOCK_DAILY_OC_BACKTEST_PLAN_2026_11_09.md',
           'corrections': 'docs/STOCK_DAILY_OC_BACKTEST_V2_CORRECTIONS_2026_11_09.md', 'window': [START, end],
           'capital': CAPITAL,
           'data': {'base_fingerprint_sha256': data.get('base_fingerprint') or fingerprint(
                        {k: v for k, v in data.items() if k in ('sessions', 'bars', 'feed', 'asof')}),
                    'v1_base_fingerprint_sha256': V1_BASE_FINGERPRINT,
                    'supplement_fingerprint_sha256': data.get('supplement_fingerprint'),
                    'feed': data.get('feed'), 'asof': data.get('asof'), 'sessions': [sessions[0], sessions[-1]],
                    'symbols': len(corrected['bars']), 'identity': data.get('identity') or {},
                    **data_quality(sessions, series, universe, end)},
           'rules': {}, 'benchmarks': {'spy-open-close': {}, 'weekly': {}}, 'gross': {}, 'break_even_bps': {}}
    for rule in RULES:
        out['rules'][rule] = {'continuous': {}}
        for bps in COSTS_BPS:
            r = simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=bps, pause=True)
            out['rules'][rule][f'bps{bps}'] = {
                **summarize(r['curve'], end),
                **{k: r[k] for k in ('orders', 'filled', 'unfilled', 'unfilled_gap', 'unfilled_missing_bar',
                                     'unfilled_cash', 'skipped_under_one_share', 'blocked_by_unresolved', 'costs',
                                     'avg_exposure', 'active_share', 'pauses', 'halted_on',
                                     'open_unresolved_at_end')},
                'unresolved_exits': r['unresolved']}
            c = simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=bps, pause=False)
            out['rules'][rule]['continuous'][f'bps{bps}'] = {**summarize(c['curve'], end), 'costs': c['costs']}
        g_live = simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=0, pause=True)
        g_cont = simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=0, pause=False)
        out['gross'][rule] = {'as_live': {**summarize(g_live['curve'], end), 'halted_on': g_live['halted_on']},
                              'continuous': summarize(g_cont['curve'], end)}
        out['break_even_bps'][rule] = break_even(
            lambda bps, rule=rule: simulate(sessions, series, universe, rule, start=START, end=end, cost_bps=bps,
                                            pause=False)['curve'], START, end)
    spy = series['SPY']
    for bps in COSTS_BPS:
        out['benchmarks']['spy-open-close'][f'bps{bps}'] = summarize(
            spy_open_close(sessions, spy, start=START, end=end, cost_bps=bps)['curve'], end)
        w = weekly_replay(sessions, series, universe, WEEKLY_VARIANTS['momentum'], start=START, end=end, cost_bps=bps)
        out['benchmarks']['weekly'][f'bps{bps}'] = {**summarize(w['curve'], end), 'avg_exposure': w['avg_exposure']}
    out['benchmarks']['spy-hold'] = summarize(spy_hold(sessions, spy, start=START, end=end)['curve'], end)
    out['gross']['spy-open-close'] = summarize(spy_open_close(sessions, spy, start=START, end=end, cost_bps=0)['curve'], end)
    out['break_even_bps']['spy-open-close'] = break_even(
        lambda bps: spy_open_close(sessions, spy, start=START, end=end, cost_bps=bps)['curve'], START, end)
    out['verdicts'] = verdicts(out)
    return out


def _be(x):
    return 'none (loses before costs)' if x is None else ('above 25 bps' if x == math.inf else f'{x:.2f} bps')


def markdown(out: dict) -> str:
    d = out['data']
    same = d['base_fingerprint_sha256'] == d['v1_base_fingerprint_sha256']
    L = [f"# Daily open-to-close backtest, v2 corrected results ({out['window'][0]} to {out['window'][1]})", '',
         f"Plan `{out['plan']}`; corrections `{out['corrections']}`. Base data fingerprint "
         f"`{d['base_fingerprint_sha256']}` ({'matches' if same else 'DOES NOT MATCH'} v1); identity supplement "
         f"`{d['supplement_fingerprint_sha256']}`. Feed `{d['feed']}`, asof `{d['asof']}`. Survivorship-biased "
         'universe; no untouched test period; daily bars approximate auction fills.', '',
         f"**Overall: {out['verdicts']['overall']}**", '', '## Security identity audit', '',
         '| Member | Finding (Alpaca corporate actions) |', '|---|---|']
    for sym, info in sorted(d['identity'].items()):
        L.append(f"| {sym} | {info.get('kind')}" + ''.join(f"; {k} {v}" for k, v in info.items() if k != 'kind') + ' |')
    L += [f"- Members still missing bars after the audit: "
          + (', '.join(f'{s} ({n})' for s, n in d['missing_bars_by_symbol'].items()) or 'none') + '.', '',
          '## Gross, net and break-even (no-pause series unless stated)', '',
          '| Rule | Gross CAGR | Gross end value | Net CAGR 5 bps | Net CAGR 10 bps | Net CAGR 25 bps | Break-even cost/side |',
          '|---|---|---|---|---|---|---|']
    for rule in out['rules']:
        g = out['gross'][rule]['continuous']['full']
        n = {b: out['rules'][rule]['continuous'][f'bps{b}']['full'] for b in COSTS_BPS}
        L.append(f"| {rule} | {_pct(g.get('cagr'))} | ${g.get('end_value', 0):,.0f} | {_pct(n[5].get('cagr'))} | "
                 f"{_pct(n[10].get('cagr'))} | {_pct(n[25].get('cagr'))} | {_be(out['break_even_bps'][rule])} |")
    g = out['gross']['spy-open-close']['full']
    n = {b: out['benchmarks']['spy-open-close'][f'bps{b}']['full'] for b in COSTS_BPS}
    L.append(f"| SPY open-to-close | {_pct(g.get('cagr'))} | ${g.get('end_value', 0):,.0f} | {_pct(n[5].get('cagr'))} | "
             f"{_pct(n[10].get('cagr'))} | {_pct(n[25].get('cagr'))} | {_be(out['break_even_bps']['spy-open-close'])} |")
    h = out['benchmarks']['spy-hold']['full']
    L.append(f"| SPY buy-and-hold (dividends, no costs) | {_pct(h.get('cagr'))} | ${h.get('end_value', 0):,.0f} | | | | |")
    w = {b: out['benchmarks']['weekly'][f'bps{b}']['full'] for b in COSTS_BPS}
    L.append(f"| Weekly strategy ($1,000, ~half invested) | | | {_pct(w[5].get('cagr'))} | {_pct(w[10].get('cagr'))} | "
             f"{_pct(w[25].get('cagr'))} | |")
    L += ['', '## As-live (with the corrected pause), pass/fail basis', '',
          '| Rule | Cost/side | End value | CAGR | Sharpe | Max DD | Halted on | Orders | Filled | Unfilled | Blocked by unresolved | Costs paid |',
          '|---|---|---|---|---|---|---|---|---|---|---|---|']
    for rule, r in out['rules'].items():
        for bps in COSTS_BPS:
            x = r[f'bps{bps}']
            f = x['full']
            L.append(f"| {rule} | {bps} bps | ${f.get('end_value', 0):,.0f} | {_pct(f.get('cagr'))} | "
                     f"{_num(f.get('sharpe'))} | {_pct(f.get('max_drawdown'))} | {x['halted_on'] or 'never'} | "
                     f"{x['orders']} | {x['filled']} | {x['unfilled']} | {x['blocked_by_unresolved']} | ${x['costs']:,.0f} |")
    for rule in out['rules']:
        gl = out['gross'][rule]['as_live']
        L.append(f"- {rule} at 0 bps as-live: end ${gl['full'].get('end_value', 0):,.0f}, halted on "
                 f"{gl['halted_on'] or 'never'}.")
    L += ['', '## Comparisons (as-live dates)', '', '| Comparison | Cost/side | End value | CAGR | Sharpe | Max DD |',
          '|---|---|---|---|---|---|',
          f"| SPY buy-and-hold (dividends) | none | ${h.get('end_value', 0):,.0f} | {_pct(h.get('cagr'))} | "
          f"{_num(h.get('sharpe'))} | {_pct(h.get('max_drawdown'))} |"]
    for name, label in (('spy-open-close', 'SPY open-to-close'), ('weekly', 'Weekly strategy ($1,000)')):
        for bps in COSTS_BPS:
            f = out['benchmarks'][name][f'bps{bps}']['full']
            L.append(f"| {label} | {bps} bps | ${f.get('end_value', 0):,.0f} | {_pct(f.get('cagr'))} | "
                     f"{_num(f.get('sharpe'))} | {_pct(f.get('max_drawdown'))} |")
    L += ['', '## Pass/fail at 10 bps (seven frozen conditions plus no unresolved exits)', '']
    for rule in out['rules']:
        v = out['verdicts'][rule]
        failed = [k for k, ok in v['checks'].items() if not ok]
        L.append(f"- **{rule}: {v['verdict']}**" + (f" (failed: {', '.join(failed)})" if failed else ''))
    years = sorted({y for r in out['rules'].values() for y in r['continuous']['bps10']['years']})
    L += ['', '## Calendar-year net returns at 10 bps, no-pause series', '', '| Series | ' + ' | '.join(years) + ' |',
          '|---|' + '---|' * len(years)]
    rows = [(rule, r['continuous']['bps10']['years']) for rule, r in out['rules'].items()]
    rows += [(f'{rule} (gross)', out['gross'][rule]['continuous']['years']) for rule in out['rules']]
    rows += [('SPY buy-and-hold', out['benchmarks']['spy-hold']['years']),
             ('SPY open-to-close', out['benchmarks']['spy-open-close']['bps10']['years']),
             ('SPY open-to-close (gross)', out['gross']['spy-open-close']['years']),
             ('Weekly strategy', out['benchmarks']['weekly']['bps10']['years'])]
    for name, ys in rows:
        L.append(f'| {name} | ' + ' | '.join(_pct(ys.get(y)) for y in years) + ' |')
    L += ['', '## Descriptive splits at 10 bps, no-pause series (neither is untouched)', '',
          '| Rule | 2017–2022 CAGR | 2023–2026 CAGR | Gross 2017–2022 | Gross 2023–2026 |', '|---|---|---|---|---|']
    for rule, r in out['rules'].items():
        c, g = r['continuous']['bps10'], out['gross'][rule]['continuous']
        L.append(f"| {rule} | {_pct(c['early'].get('cagr'))} | {_pct(c['late'].get('cagr'))} | "
                 f"{_pct(g['early'].get('cagr'))} | {_pct(g['late'].get('cagr'))} |")
    unresolved = sum(len(r[f'bps{b}']['unresolved_exits']) for r in out['rules'].values() for b in COSTS_BPS)
    L += ['', '## Data', '', f"- Sessions in evaluation: {d['evaluation_sessions']}; members: {d['members']}.",
          f"- Sessions where raw and adjusted returns differ by over 0.5% (splits, dividends): "
          f"{d['sessions_raw_vs_adjusted_differ_over_0_5pct']}.", f'- Unresolved exits across all as-live runs: {unresolved}.']
    return '\n'.join(L) + '\n'


# ---------------------------------------------------------------- fetch (network, opt-in) and CLI

def fetch(source, universe: dict, end: str) -> dict:
    from .stock_forward_bridge_v1 import DATA
    from .stock_weekly_backtest_v1 import START_DATA, fetch as base_fetch
    symbols = sorted({s['symbol'] for s in universe['securities']} | {'SPY'})
    base = base_fetch(source, symbols, START_DATA, end)
    data = dict(base, base_fingerprint=fingerprint(base))
    gaps = gap_members(base, universe, end)
    pages = source.paged(DATA, '/v1/corporate-actions', {'symbols': ','.join(gaps), 'start': START_DATA, 'end': end,
                                                         'limit': 1000}) if gaps else []
    identity = classify_gaps(gaps, pages)
    renamed = sorted({i['new_symbol'] for i in identity.values() if i['kind'] == 'name_change'})
    extra = base_fetch(source, renamed, START_DATA, end)['bars'] if renamed else {}
    supplement = {'corporate_actions_pages': pages, 'bars': extra}
    data.update(identity=identity, supplement=supplement, supplement_fingerprint=fingerprint(supplement))
    return data


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--universe', type=Path, required=True)
    f.add_argument('--end', default=END)
    f.add_argument('--output', type=Path, required=True)
    f.add_argument('--expect-base-fingerprint', default=V1_BASE_FINGERPRINT)
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
        source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''))
        data = fetch(source, universe, a.end)
        print(json.dumps({'status': 'FETCHED', 'sessions': len(data['sessions']), 'symbols': len(data['bars']),
                          'requests': source.count, 'base_fingerprint_sha256': data['base_fingerprint'],
                          'supplement_fingerprint_sha256': data['supplement_fingerprint'],
                          'identity': data['identity']}))
        if data['base_fingerprint'] != a.expect_base_fingerprint:
            raise SystemExit('BASE_FINGERPRINT_MISMATCH: expected ' + a.expect_base_fingerprint)
        with gzip.open(a.output, 'wt', encoding='utf-8') as fh:
            json.dump(data, fh)
        return
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    out = evaluate(data, universe, end=a.end)
    text = json.dumps(out, indent=1, sort_keys=True, default=str)
    a.output.write_text(text, encoding='utf-8')
    a.markdown.write_text(markdown(out), encoding='utf-8')
    print(markdown(out))
    print('RESULTS_SHA256', hashlib.sha256(text.encode('utf-8')).hexdigest())


if __name__ == '__main__':
    main()
