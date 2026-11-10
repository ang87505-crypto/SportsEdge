"""One-session, pre-open frozen daily research. No broker orders or strategy activation.
Signal functions are unchanged from PR #109 at 7791a7c; the failed backtest remains permanent.
Only received, completed T-1 bars decide T. Frozen orders are graded once from later daily bars.
Daily OHLC prices approximate auctions; these are simulated observations, never Alpaca fills.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
from statistics import fmean
from zoneinfo import ZoneInfo

MAX_POSITIONS, WEIGHT, LIMIT_GAP, SIZING_SLIPPAGE = 5, 0.20, 0.03, 0.0025
PRICE_FLOOR, DOLLAR_VOLUME_FLOOR = 5.0, 20_000_000.0
RULES = ('losers5', 'gainers5', 'losers5-spy200', 'losers5-volz', 'losers5-spy200-sector2')
COSTS_BPS = (0, 5, 10, 25)
NY = ZoneInfo('America/New_York')
SESSION = '2026-11-10'
CONFIG = Path(__file__).resolve().parents[1] / 'config/research/daily-shadow-20261110.json'

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


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def instant(day, clock):
    return datetime.fromisoformat(day + 'T' + clock).replace(tzinfo=NY).astimezone(timezone.utc)


def valid_price(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def build_plan(data, config, session, previous, now):
    """Pure pre-open capture. Refuse a late plan or any T/future signal input."""
    from .stock_weekly_backtest_v1 import align
    if session['date'] != SESSION or config['session'] != SESSION:
        raise ValueError('WRONG_SESSION')
    if not instant(previous['date'], previous['close']) + timedelta(minutes=15) <= now < instant(SESSION, session['open']):
        raise ValueError('OUTSIDE_PREOPEN_CAPTURE_WINDOW')
    if not data['sessions'] or data['sessions'][-1] != previous['date'] or any(d >= SESSION for d in data['sessions']):
        raise ValueError('INCOMPLETE_OR_FUTURE_HISTORY')
    if any(d >= SESSION for row in data['bars'].values() for d in row['d']):
        raise ValueError('FUTURE_BAR')
    days, series = align(data)
    k = len(days)
    if k < 200 or not _ok(series.get('SPY', {}).get('ac', [])[-200:]) or 'SPY' not in series:
        raise ValueError('SPY_HISTORY_REQUIRED')
    orders = {}
    for rule in RULES:
        chosen = picks(days, series, config, k, rule)
        orders[rule] = []
        for symbol in chosen:
            close = series[symbol]['c'][-1]
            limit = round(close * (1 + LIMIT_GAP), 2)
            qty = math.floor(WEIGHT * config['capital'] / (limit * (1 + SIZING_SLIPPAGE)))
            if qty:
                orders[rule].append({'symbol': symbol, 'shares': qty, 'limit': limit, 'previous_close': close})
    spy_close = series['SPY']['c'][-1]
    orders['spy-open-close'] = [{'symbol': 'SPY', 'shares': math.floor(config['capital'] / (spy_close * 1.03 * 1.0025)),
                                 'limit': round(spy_close * 1.03, 2), 'previous_close': spy_close}]
    unavailable = [u['symbol'] for u in config['securities']
                   if u['symbol'] not in series or not _ok(series[u['symbol']]['ac'][-22:])]
    out = {'schema': 'daily-shadow-plan-v1', 'session': SESSION, 'captured_at': now.isoformat(),
           'open_at': instant(SESSION, session['open']).isoformat(), 'close_at': instant(SESSION, session['close']).isoformat(),
           'last_signal_session': days[-1], 'config_sha256': digest(config), 'input_sha256': digest(data),
           'capital_per_rule': config['capital'], 'cost_bps_per_side': list(COSTS_BPS), 'orders': orders,
           'missing_history_symbols': unavailable, 'broker_orders': 0, 'historical_verdict': 'NONE QUALIFIES'}
    return {**out, 'plan_sha256': digest(out)}


def grade(plan, data, now, config):
    frozen = {k: v for k, v in plan.items() if k != 'plan_sha256'}
    if plan['plan_sha256'] != digest(frozen) or plan['config_sha256'] != digest(config):
        raise ValueError('FROZEN_PLAN_MISMATCH')
    if plan['session'] != SESSION or not datetime.fromisoformat(plan['captured_at']) < datetime.fromisoformat(plan['open_at']):
        raise ValueError('PLAN_NOT_PREOPEN')
    if now < datetime.fromisoformat(plan['close_at']) + timedelta(minutes=30):
        raise ValueError('FINAL_BARS_NOT_DUE')
    rows = {}
    for symbol, bars in data['bars'].items():
        if SESSION in bars['d']:
            n = bars['d'].index(SESSION)
            rows[symbol] = {field: bars[field][n] for field in ('o', 'c')}
    results = {}
    for rule, orders in plan['orders'].items():
        fills, gaps, unresolved = [], [], []
        for order in orders:
            row = rows.get(order['symbol'])
            if row is None or not valid_price(row['o']):
                unresolved.append({'symbol': order['symbol'], 'reason': 'OPEN_UNAVAILABLE'})
            elif row['o'] > order['limit']:
                gaps.append(order['symbol'])
            elif not valid_price(row['c']):
                unresolved.append({'symbol': order['symbol'], 'reason': 'EXIT_UNAVAILABLE'})
            else:
                fills.append({**order, 'entry': row['o'], 'exit': row['c']})
        gross = sum(f['shares'] * (f['exit'] - f['entry']) for f in fills)
        turnover = sum(f['shares'] * (f['exit'] + f['entry']) for f in fills)
        results[rule] = {'status': 'UNKNOWN' if unresolved else 'MEASURED', 'simulated_fills': fills,
                         'unfilled_gap': gaps, 'unresolved': unresolved,
                         'pnl': {str(b): None if unresolved else round(gross - turnover * b / 10000, 2) for b in COSTS_BPS}}
    return {'schema': 'daily-shadow-result-v1', 'session': SESSION, 'graded_at': now.isoformat(),
            'plan_sha256': plan['plan_sha256'], 'input_sha256': digest(data), 'results': results,
            'broker_orders': 0, 'activation': False, 'qualification': 'NOT_ASSESSED_ONE_SESSION'}


def report(result):
    lines = ['# Daily research test: November 10, 2026', '',
             'Simulated observations only. No orders were submitted to Alpaca. Daily bars approximate auctions.',
             'The historical verdict remains NONE QUALIFIES. One session cannot qualify a strategy.', '',
             '| Rule | Status | Simulated fills | Gross P/L | P/L at 5 bps | P/L at 10 bps | P/L at 25 bps |',
             '|---|---|---|---|---|---|---|']
    money = lambda v: 'Unknown' if v is None else f'${v:+,.2f}'
    for name, row in result['results'].items():
        lines.append(f"| {name} | {row['status']} | {len(row['simulated_fills'])} | " +
                     ' | '.join(money(row['pnl'][str(b)]) for b in COSTS_BPS) + ' |')
    lines += ['', f"Frozen plan SHA-256: `{result['plan_sha256']}`.", f"Graded at {result['graded_at']}.",
              'A missing open or exit makes that rule unknown; it is never reported as zero profit.']
    return '\n'.join(lines) + '\n'


def market_data(source, symbols, start, end, close_time='16:00'):
    """Only GET market data, ending at the completed exchange close.

    Daily bars are timestamped at the start of their New York day. The close bound includes that
    day's bar without requesting future midnight/latest SIP data, which a Basic plan refuses.
    """
    from .stock_forward_bridge_v1 import DATA, PAPER
    sessions = sorted(r['date'] for r in source.fetch(PAPER, '/v2/calendar', {'start': start, 'end': end}))
    raw = {}
    for adjustment in ('raw', 'all'):
        for i in range(0, len(symbols), 40):
            params = {'symbols': ','.join(symbols[i:i+40]), 'timeframe': '1Day', 'start': start,
                      'end': instant(end, close_time).isoformat(), 'adjustment': adjustment,
                      'feed': 'sip', 'asof': end, 'limit': 10000}
            for page in source.paged(DATA, '/v2/stocks/bars', params):
                for symbol, bars in (page.get('bars') or {}).items():
                    for bar in bars:
                        day = datetime.fromisoformat(bar['t'].replace('Z', '+00:00')).astimezone(NY).date().isoformat()
                        if not start <= day <= end:
                            raise ValueError('PROVIDER_BAR_OUTSIDE_WINDOW')
                        row = raw.setdefault(symbol, {}).setdefault(day, {})
                        if adjustment == 'raw':
                            row.update(o=float(bar['o']), c=float(bar['c']), v=float(bar['v']))
                        else:
                            row.update(ao=float(bar['o']), ac=float(bar['c']))
    out = {}
    for symbol, rows in raw.items():
        days = sorted(d for d, r in rows.items() if len(r) == 5)
        if any(not valid_price(rows[d][f]) for d in days for f in ('o', 'c', 'ao', 'ac')):
            raise ValueError('INVALID_PROVIDER_PRICE')
        out[symbol] = {'d': days, **{f: [rows[d][f] for d in days] for f in ('o', 'c', 'v', 'ao', 'ac')}}
    return {'sessions': sessions, 'bars': out, 'feed': 'sip', 'asof': end}


def save(path, value):
    with path.open('x') as f:
        json.dump(value, f, indent=1, sort_keys=True, allow_nan=False)
        f.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['plan', 'grade'])
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--execute-network', action='store_true')
    a = parser.parse_args()
    if not a.execute_network:
        parser.error('network collection requires --execute-network')
    config = json.loads(CONFIG.read_text())
    root = a.data / 'daily-shadow-20261110'
    root.mkdir(parents=True, exist_ok=True)
    target = root / ('plan.json' if a.phase == 'plan' else 'result.json')
    if target.exists():
        if a.phase == 'grade' and not (root / 'REPORT.md').exists():
            with (root / 'REPORT.md').open('x') as f:
                f.write(report(json.loads(target.read_text())))
        print(json.dumps({'status': 'ALREADY_RECORDED', 'phase': a.phase, 'session': SESSION}))
        return
    now = datetime.now(timezone.utc)
    from .stock_forward_bridge_v1 import Source, PAPER
    source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''))
    if a.phase == 'plan':
        # Do not start any provider request outside the only authorized capture window.
        if not instant('2026-11-09', '16:15') <= now < instant(SESSION, '09:30'):
            raise ValueError('OUTSIDE_PREOPEN_CAPTURE_WINDOW')
        calendar = source.fetch(PAPER, '/v2/calendar', {'start': '2026-11-01', 'end': SESSION})
        session = next(r for r in calendar if r['date'] == SESSION)
        previous = [r for r in calendar if r['date'] < SESSION][-1]
        symbols = sorted({u['symbol'] for u in config['securities']} | {'SPY'})
        data = market_data(source, symbols, '2025-01-01', previous['date'], previous['close'])
        out = build_plan(data, config, session, previous, datetime.now(timezone.utc))
    else:
        if not (root / 'plan.json').exists():
            raise ValueError('NO_PREOPEN_PLAN_NO_RETROSPECTIVE_PICKS')
        plan = json.loads((root / 'plan.json').read_text())
        if now < datetime.fromisoformat(plan['close_at']) + timedelta(minutes=30):
            raise ValueError('FINAL_BARS_NOT_DUE')
        symbols = sorted({o['symbol'] for orders in plan['orders'].values() for o in orders})
        close_time = datetime.fromisoformat(plan['close_at']).astimezone(NY).strftime('%H:%M')
        data = market_data(source, symbols, SESSION, SESSION, close_time)
        out = grade(plan, data, datetime.now(timezone.utc), config)
    inputs_path = root / f'{a.phase}-inputs-{digest(data)}.json.gz'
    if not inputs_path.exists():
        with gzip.open(inputs_path, 'xt', encoding='utf-8') as f:
            json.dump(data, f, sort_keys=True, allow_nan=False)
    save(target, out)
    if a.phase == 'grade':
        with (root / 'REPORT.md').open('x') as f:
            f.write(report(out))
        print(report(out))
    print(json.dumps({'status': 'FROZEN' if a.phase == 'plan' else 'GRADED', 'session': SESSION,
                      'broker_orders': 0, 'plan_sha256': out['plan_sha256']}))


if __name__ == '__main__':
    main()
