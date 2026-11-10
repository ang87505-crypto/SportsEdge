"""Forward-only virtual tracking for mq-buffer-v1, and the historical audit of its result. Research only.

  python -m analytics.research.forward_cli predict  --ledger forward-ledger      # after a month-end close
  python -m analytics.research.forward_cli evaluate --ledger forward-ledger      # outcomes; predictions untouched
  python -m analytics.research.forward_cli dry-run  --signal 2026-10-30 --out <scratch dir>   # never the ledger
  python -m analytics.research.forward_cli audit    --data research-data --end 2026-11-06

Read-only Alpaca market data (existing paper key pair, environment only). No orders, no activation, no schedule.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import copy
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess

from . import candidates as cand
from . import cli
from . import data as rdata
from . import engine
from . import evaluate as ev
from . import forward_ledger as fl
from . import nextgen as ng

HISTORY_DAYS = 420     # calendar days of bars before a signal: covers the 252-session lookback with margin
CALENDAR_AHEAD = 45


def _calendar(source, start: str, today: str) -> list[str]:
    return rdata.fetch_calendar(source, start, (date.fromisoformat(today) + timedelta(days=CALENDAR_AHEAD)).isoformat())


def _market(source, members, start: str, end: str, end_time: str | None):
    md = cli.market_data(source, {m['symbol'] for m in members} | {'SPY'}, start, end, {}, end_time=end_time)
    sessions, series = rdata.assemble(md['sessions'], md['bars'])
    return md, sessions, series


def commit_times(ledger_dir: Path) -> dict:
    """signal -> commit time that first added predictions/<signal>.json (needs the ledger's git history)."""
    out = {}
    for p in sorted((ledger_dir / 'predictions').glob('*.json')):
        try:
            t = subprocess.run(['git', '-C', str(ledger_dir), 'log', '--diff-filter=A', '--format=%cI', '--', f'predictions/{p.name}'],
                               capture_output=True, text=True, timeout=30).stdout.strip().splitlines()
        except (OSError, subprocess.SubprocessError):
            t = []
        if t:
            out[p.stem] = datetime.fromisoformat(t[-1]).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return out


def cmd_predict(ledger_dir: Path, now: datetime, *, first_signal=fl.FIRST_SIGNAL, label='FORWARD') -> dict:
    source = cli.alpaca()
    _, members = cli.universe_members()
    today = now.astimezone(cand.NY).date().isoformat()
    start = (date.fromisoformat(today) - timedelta(days=HISTORY_DAYS)).isoformat()
    calendar = _calendar(source, start, today)

    def market(end_time):
        _, sessions, series = _market(source, members, start, today, end_time)
        return sessions, series
    return fl.predict(fl.Ledger(ledger_dir), now=now, calendar=calendar, market=market, members=members,
                      code_commit=os.getenv('GITHUB_SHA', 'local'), first_signal=first_signal, label=label)


def cmd_evaluate(ledger_dir: Path, now: datetime) -> dict:
    source = cli.alpaca()
    _, members = cli.universe_members()
    today = (now - timedelta(days=1)).date().isoformat()
    start = (date.fromisoformat(fl.FIRST_SIGNAL) - timedelta(days=HISTORY_DAYS)).isoformat()
    calendar = _calendar(source, start, today)
    md, sessions, series = _market(source, members, start, today, cli.forward_end_time(now))
    return fl.evaluate(fl.Ledger(ledger_dir), now=now, calendar=calendar, sessions=sessions, series=series,
                       actions=md['actions'], members=members, data_fingerprint=md['fingerprint'],
                       code_commit=os.getenv('GITHUB_SHA', 'local'), commit_times=commit_times(ledger_dir))


def cmd_dry_run(signal: str, out_dir: Path) -> dict:
    """A real-data rehearsal for a past month-end, as if run 40 minutes after its close. Written to a scratch
    directory labelled DRY_RUN, never to the forward ledger."""
    now = fl.utc(cand.close_utc(signal)) + timedelta(minutes=40)
    return cmd_predict(out_dir, now, first_signal=signal, label='DRY_RUN')


# ---------------------------------------------------------------- historical audit of mq-buffer-v1

@contextmanager
def engine_setting(name, value):
    old = getattr(engine, name)
    setattr(engine, name, value)
    try:
        yield
    finally:
        setattr(engine, name, old)


def _sim(sessions, series, actions, decisions, start_k, end_k, cost, capital=ev.CAPITAL, halt=False):
    return engine.simulate(sessions, series, actions, decisions, start_index=start_k, end_index=end_k, capital=capital,
                           cost_bps=cost, halt=halt)


def _m(r, sessions, start_k, end_k):
    f = ev.summarize(r['curve'], sessions[start_k], sessions[end_k])['full']
    return {k: f.get(k) for k in ('cagr', 'sharpe', 'max_drawdown', 'end_value')} | {
        'turnover': r['turnover_per_year'], 'costs': r['costs'], 'orders': r['orders'], 'filled': r['filled'],
        'unfilled_gap': r['unfilled_gap'], 'reduced_for_cash': r['reduced_for_cash'], 'zero_share_targets': r['zero_share_targets']}


def trade_key(t):
    return (t['date'], t['symbol'], t['side'])


def cost_decomposition(base, other, cost_bps):
    """First-order split of (end value at 0 bps − end value at `cost_bps`) into the cost drag on the 0-bps trade path
    and the path effect (different trades because equity, sizing, cash and the rebalance band moved)."""
    curve0 = dict(base['curve'])
    v_end = base['curve'][-1][1]
    drag = sum(t['shares'] * t['price'] * cost_bps / 1e4 * v_end / curve0.get(t['date'], v_end) for t in base['trades'])
    total = v_end - other['curve'][-1][1]
    a = {trade_key(t): t for t in base['trades']}
    b = {trade_key(t): t for t in other['trades']}
    only_a, only_b = sorted(set(a) - set(b)), sorted(set(b) - set(a))
    qty = sorted(k for k in set(a) & set(b) if a[k]['shares'] != b[k]['shares'])
    first = min(only_a + only_b + qty) if (only_a or only_b or qty) else None
    # The 0-bps trades with costs charged: each day's cost removes that share of equity, later returns unchanged.
    cost_on = {}
    for t in base['trades']:
        cost_on[t['date']] = cost_on.get(t['date'], 0.0) + t['shares'] * t['price'] * cost_bps / 1e4
    factor, fixed = 1.0, []
    for d, v in base['curve']:
        if d in cost_on and v > 0:
            factor *= 1 - cost_on[d] / v
        fixed.append((d, v * factor))
    lo = base['curve'][1][0] if len(base['curve']) > 1 else base['curve'][0][0]
    fm = ev.summarize(fixed, lo, base['curve'][-1][0])['full']
    return {'end_value_gap': total, 'first_order_cost_drag': drag, 'path_effect': total - drag,
            'fixed_path_cagr': fm.get('cagr'), 'fixed_path_sharpe': fm.get('sharpe'), 'fixed_path_max_drawdown': fm.get('max_drawdown'),
            'trades_only_at_0bps': len(only_a), 'trades_only_at_this_cost': len(only_b), 'same_trade_different_shares': len(qty),
            'first_divergence': first, 'examples_only_at_0bps': [a[k] for k in only_a[:8]],
            'examples_only_at_this_cost': [b[k] for k in only_b[:8]]}


def cmd_audit(data: Path, end: str, now: datetime) -> dict:
    universe, members = cli.universe_members()
    md, sessions, series = _market(cli.alpaca(), members, ev.DATA_START, end, None)
    start_k, end_k = ev.window(sessions, ev.FIRST_EXEC, end)
    kw = {'first_signal': sessions[start_k - 1], 'last_exec': end}
    decs = {'mq-buffer-v1': ng.buffer_decisions(sessions, series, members, **kw),
            ng.B0: cand.momentum_quality_decisions(sessions, series, members, **kw)}
    out = {'kind': 'buffer-audit', 'at': cli.stamp(now), 'window': [sessions[start_k], sessions[end_k]],
           'label': 'POST-HOC DIAGNOSTICS (not gates; the pre-registered verdict is unchanged)',
           'data': {'fingerprint': md['fingerprint'], 'missing': md['missing'], 'actions_dropped': len(md['actions_dropped']),
                    'joins': md['joins']}, 'code_commit': os.getenv('GITHUB_SHA', 'local')}
    # A. data and execution integrity on the as-tested runs
    runs = {sid: {c: _sim(sessions, series, md['actions'], d, start_k, end_k, c) for c in ng.COSTS} for sid, d in decs.items()}
    checks = {}
    for sid, by_cost in runs.items():
        r = by_cost[10]
        off_open = [t for t in r['trades'] if t['why'] != 'halt' and abs(t['price'] - series[t['symbol']]['o'][sessions.index(t['date'])]) > 1e-9]
        held = {t['symbol'] for t in r['trades']}
        checks[sid] = {'integrity_mismatches': len(r['integrity_mismatches']), 'integrity_examples': r['integrity_mismatches'][:10],
                       'unresolved': r['unresolved'], 'stale_marks': r['stale_marks'], 'unavailable': r['unavailable'],
                       'unfilled_missing': r['unfilled_missing'], 'sells_pending': r['sells_pending'],
                       'fills_not_at_the_raw_open': len(off_open),
                       'corporate_actions_on_traded_names': sum(1 for a in md['actions'] if a.get('symbol') in held
                                                                and sessions[start_k] <= a['date'] <= sessions[end_k]),
                       'symbols_traded': len(held)}
    out['integrity'] = checks
    # B. benchmark checks
    spy_adj = ev.summarize(ev.hold_curve(sessions, series['SPY'], start_k, end_k), sessions[start_k], sessions[end_k])['full']
    spy_engine = _sim(sessions, series, md['actions'], [{'signal_index': start_k - 1, 'targets': {'SPY': 0.99}}], start_k, end_k, 0)
    rb = runs['mq-buffer-v1'][10]
    m1 = ev.summarize(ev.exposure_matched(sessions, series['SPY'], rb['exposure'], start_k, end_k), sessions[start_k], sessions[end_k])['full']
    m2 = ev.summarize(ng.exposure_matched_v2(sessions, series['SPY'], rb['exposure'], rb['open_exposure'], start_k, end_k, ev.CAPITAL),
                      sessions[start_k], sessions[end_k])['full']
    out['benchmarks'] = {'spy_adjusted_hold': spy_adj,
                         'spy_through_engine_raw_prices_and_dividends_99pct': _m(spy_engine, sessions, start_k, end_k),
                         'buffer_matched_v1': m1, 'buffer_matched_v2': m2}
    # C. execution and timing sensitivities at 10 bps (buffer and B0 under identical changes)
    spy_curve = ev.hold_curve(sessions, series['SPY'], start_k, end_k)
    variants = {}

    def both(name, ser=series, shift=0, drop=0, setting=None):
        res = {}
        for sid, d in decs.items():
            dd = [dict(x, signal_index=x['signal_index'] + shift) for x in d[drop:]]
            sk = start_k if not drop else d[drop]['signal_index'] + 1
            if setting:
                with engine_setting(*setting):
                    r = _sim(sessions, ser, md['actions'], dd, sk, end_k, 10)
            else:
                r = _sim(sessions, ser, md['actions'], dd, sk, end_k, 10)
            res[sid] = _m(r, sessions, sk, end_k)
            res['spy_sharpe_same_window'] = ev.summarize(ev.hold_curve(sessions, series['SPY'], sk, end_k), sessions[sk], sessions[end_k])['full']['sharpe']
        res['buffer_beats_spy_sharpe'] = res['mq-buffer-v1']['sharpe'] > res['spy_sharpe_same_window']
        res['buffer_beats_b0_sharpe'] = res['mq-buffer-v1']['sharpe'] > res[ng.B0]['sharpe']
        variants[name] = res
    both('as_tested')
    at_close = {s: dict(v, o=v['c'][:], ao=v['ac'][:]) for s, v in series.items()}
    both('fill_at_execution_day_close', ser=at_close)
    both('execute_one_session_later', shift=1)
    both('rebalance_band_0', setting=('BAND', 0.0))
    both('rebalance_band_40pct', setting=('BAND', 0.40))
    both('limit_gap_1pct', setting=('LIMIT_GAP', 0.01))
    both('no_limit_price', setting=('LIMIT_GAP', 10.0))
    both('start_one_month_later', drop=1)
    both('start_two_months_later', drop=2)
    out['execution_sensitivities'] = variants
    # D. why the buffer looks almost cost-insensitive from 0 to 10 bps
    cost = {}
    for sid, by_cost in runs.items():
        cost[sid] = {f'{c}bps': {**_m(by_cost[c], sessions, start_k, end_k), **(cost_decomposition(by_cost[0], by_cost[c], c) if c else {})}
                     for c in ng.COSTS}
    out['cost_sensitivity'] = cost
    path = cli.write_new(data / 'results' / f"buffer-audit-{cli.stamp(now).replace(':', '')}.json", out)
    cli.append_run(data, {'command': 'buffer-audit', 'at': cli.stamp(now), 'file': str(path), 'dataset_fingerprint': md['fingerprint']})
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=('predict', 'evaluate', 'dry-run', 'audit'))
    p.add_argument('--ledger', type=Path)
    p.add_argument('--data', type=Path)
    p.add_argument('--out', type=Path)
    p.add_argument('--signal')
    p.add_argument('--end', default=ev.END)
    a = p.parse_args()
    now = cli.now_utc()
    if a.command == 'predict':
        print(json.dumps(cmd_predict(a.ledger, now)))
    elif a.command == 'evaluate':
        out = cmd_evaluate(a.ledger, now)
        print(json.dumps({k: out.get(k) for k in ('status', 'latest_session', 'month_statuses', 'first_execution', 'sessions',
                                                  'rebalances', 'revisions', 'commit_time_unverified')}))
    elif a.command == 'dry-run':
        ev_ = cmd_dry_run(a.signal, a.out)
        rec = fl.Ledger(a.out).prediction(a.signal)
        print(json.dumps({'event': ev_, 'record': rec}, indent=1))
    else:
        a.data.mkdir(parents=True, exist_ok=True)
        out = cmd_audit(a.data, a.end, now)
        print(json.dumps({'integrity': {k: {x: v[x] for x in ('integrity_mismatches', 'stale_marks', 'fills_not_at_the_raw_open', 'unfilled_missing')}
                                        for k, v in out['integrity'].items()},
                          'cost': {k: {c: {x: v[c].get(x) for x in ('cagr', 'sharpe', 'costs', 'end_value_gap', 'first_order_cost_drag',
                                                                    'path_effect', 'fixed_path_cagr', 'fixed_path_sharpe')}
                                       for c in v} for k, v in out['cost_sensitivity'].items()}}, indent=1, default=str))


if __name__ == '__main__':
    main()
