"""Decision rules for the three research candidates (frozen in docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md).

Each function returns decisions {'signal_index', 'targets': {symbol: weight}, 'label', 'meta'} built only
from information available at the signal session's close. The engine executes them at the next open.
"""
from __future__ import annotations
from bisect import bisect_right
from datetime import datetime, time, timezone
from statistics import fmean
from zoneinfo import ZoneInfo

from . import sec13f

NY = ZoneInfo('America/New_York')
WEIGHT = 0.20
MAX_NAMES = 5
PER_SECTOR = 2
LOOKBACK, SKIP = 252, 21
TOP_N = 20
PRICE_FLOOR = 5.0
DOLLAR_VOLUME_FLOOR = 20_000_000.0
FOLLOWER_CAP = 0.20


def open_utc(day: str) -> str:
    """09:30 New York on a session date, as UTC."""
    dt = datetime.combine(datetime.fromisoformat(day).date(), time(9, 30), NY)
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def close_utc(day: str) -> str:
    """16:00 New York on a session date, as UTC."""
    dt = datetime.combine(datetime.fromisoformat(day).date(), time(16, 0), NY)
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def last_session_on_or_before(sessions: list[str], day: str) -> int:
    return bisect_right(sessions, day) - 1


# ---------------------------------------------------------------- 1. momentum-quality-paper-v1

def month_end_indices(sessions: list[str]) -> list[int]:
    return [k for k in range(len(sessions) - 1) if sessions[k][:7] != sessions[k + 1][:7]]


def momentum_quality_scores(series: dict, members: list[dict], k: int) -> list[dict]:
    """Eligible members at session k with momentum and the fraction of positive days in the formation window."""
    out = []
    for m in members:
        s = series.get(m['symbol'])
        if s is None or k < LOOKBACK:
            continue
        ac = s['ac'][k - LOOKBACK:k + 1]
        if any(x is None or x <= 0 for x in ac):
            continue
        c = s['c'][k]
        window = [(s['c'][i], s['v'][i]) for i in range(k - 19, k + 1)]
        if c is None or c < PRICE_FLOOR or any(x is None or y is None for x, y in window):
            continue
        if fmean(x * y for x, y in window) < DOLLAR_VOLUME_FLOOR:
            continue
        mom = s['ac'][k - SKIP] / s['ac'][k - LOOKBACK] - 1
        if mom <= 0:
            continue
        # daily total returns over T-252..T-21: 231 returns; zero-return days stay in the denominator
        rets = [s['ac'][i] / s['ac'][i - 1] - 1 for i in range(k - LOOKBACK + 1, k - SKIP + 1)]
        out.append({'symbol': m['symbol'], 'sector': m['sector'], 'momentum': mom,
                    'positive_fraction': sum(1 for r in rets if r > 0) / len(rets)})
    return out


def momentum_quality_targets(series: dict, members: list[dict], k: int) -> dict:
    scored = momentum_quality_scores(series, members, k)
    top = sorted(scored, key=lambda x: (-x['momentum'], x['symbol']))[:TOP_N]
    ranked = sorted(top, key=lambda x: (-x['positive_fraction'], -x['momentum'], x['symbol']))
    picks, per = [], {}
    for x in ranked:
        if per.get(x['sector'], 0) < PER_SECTOR:
            picks.append(x['symbol'])
            per[x['sector']] = per.get(x['sector'], 0) + 1
        if len(picks) == MAX_NAMES:
            break
    return {s: WEIGHT for s in picks}


def momentum_quality_decisions(sessions, series, members, *, first_signal: str, last_exec: str) -> list[dict]:
    out = []
    for k in month_end_indices(sessions):
        if sessions[k] < first_signal or sessions[k + 1] > last_exec:
            continue
        out.append({'signal_index': k, 'targets': momentum_quality_targets(series, members, k),
                    'label': 'month-end ' + sessions[k], 'meta': {}})
    return out


# ---------------------------------------------------------------- 2. qmom-disclosure-follower-v1

def follower_targets(rows: list[dict], has_price) -> tuple[dict, dict]:
    targets, dropped = {}, {}
    for r in rows:
        w = min(r['weight_pct'] / 100.0, FOLLOWER_CAP)
        sym = r['ticker'].replace('/', '.').replace(' ', '.')
        if r.get('equity_symbol', True) and has_price(sym):
            targets[sym] = targets.get(sym, 0.0) + w
        else:
            dropped[sym] = w
    return targets, dropped


def qmom_follower_decisions(sessions, snapshots: list[dict], has_price_at, *, last_exec: str) -> list[dict]:
    """snapshots: [{'retrieved_at', 'effective_date', 'rows', 'status'}]; only status OK snapshots are used.
    Initialize at the first session after the first valid snapshot was received; then on the first session
    of each later month, using the latest valid snapshot received before the previous session's close."""
    valid = sorted((s for s in snapshots if s['status'] == 'OK'), key=lambda s: s['retrieved_at'])
    if not valid:
        return []
    first_day = datetime.fromisoformat(valid[0]['retrieved_at'].replace('Z', '+00:00')).astimezone(NY).date().isoformat()
    exec_k = bisect_right(sessions, first_day)
    if exec_k >= len(sessions) or sessions[exec_k] > last_exec:
        return []
    plan = [exec_k] + [k for k in range(exec_k + 1, len(sessions))
                       if sessions[k][:7] != sessions[k - 1][:7] and sessions[k] <= last_exec]
    out = []
    for k in plan:
        # initial: anything received before that session's open; later: received by the previous close
        cutoff = open_utc(sessions[k]) if k == exec_k else close_utc(sessions[k - 1])
        known = [s for s in valid if s['retrieved_at'] < cutoff]
        if not known:
            continue
        snap = known[-1]
        targets, dropped = follower_targets(snap['rows'], lambda sym: has_price_at(sym, k - 1))
        out.append({'signal_index': k - 1, 'targets': targets, 'label': 'QMOM holdings ' + snap['effective_date'],
                    'meta': {'retrieved_at': snap['retrieved_at'], 'effective_date': snap['effective_date'],
                             'dropped_weight': round(sum(dropped.values()), 6), 'dropped': dropped}})
    return out


# ---------------------------------------------------------------- 3. berkshire-13f-top5-paper-v1

def berkshire_targets(known: dict, mapping: dict, has_price) -> tuple[dict, list]:
    picks, skipped = [], []
    for h in known['holdings']:
        m = mapping.get(h['cusip']) or {}
        sym = m.get('ticker')
        if not sym:
            skipped.append({'cusip': h['cusip'], 'issuer': h['issuer'], 'why': m.get('unmapped', 'UNMAPPED')})
            continue
        if not has_price(sym):
            skipped.append({'cusip': h['cusip'], 'issuer': h['issuer'], 'symbol': sym, 'why': 'NO_PRICE'})
            continue
        if sym not in picks:
            picks.append(sym)
        if len(picks) == MAX_NAMES:
            break
    return {s: WEIGHT for s in picks}, skipped


def berkshire_decisions(sessions, filings: list[dict], mapping: dict, has_price_at, *, first_exec: str,
                        last_exec: str) -> list[dict]:
    """One decision per public filing event (original or amendment), executed at the first session strictly
    after the acceptance date in New York, plus an initial decision from what was public before `first_exec`."""
    start_k = bisect_right(sessions, first_exec) - 1
    if start_k < 0 or sessions[start_k] != first_exec:
        start_k += 1  # first_exec is not a session: start at the next one
    if start_k < 1:
        raise ValueError('NEED_A_SESSION_BEFORE_FIRST_EXEC')  # never index sessions[-1] (the future)
    events = [(start_k - 1, close_utc(sessions[start_k - 1]), 'initial')]
    for f in filings:
        sig = last_session_on_or_before(sessions, sec13f.acceptance_ny_date(f['accepted_at']))
        if sig + 1 < start_k or sig + 1 >= len(sessions) or sessions[sig + 1] > last_exec:
            continue
        events.append((sig, f['accepted_at'], f['accession']))
    out, by_signal = [], {}
    for sig, as_of, label in sorted(events, key=lambda e: (e[0], e[1])):
        known = sec13f.known_portfolio(filings, as_of)
        if known is None:
            continue
        targets, skipped = berkshire_targets(known, mapping, lambda sym: has_price_at(sym, sig))
        by_signal[sig] = {'signal_index': sig, 'targets': targets, 'label': f'13F {known["period"]} ({label})',
                          'meta': {'period': known['period'], 'sources': known['sources'], 'as_of': as_of, 'skipped': skipped}}
    return [by_signal[k] for k in sorted(by_signal)]


# ---------------------------------------------------------------- daily strategies (docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md)

DAILY_IDS = ('daily-reversal5-v1', 'daily-momentum5d-v1', 'daily-spy-trend50-v1')
DAILY_HISTORY = 60
DAILY_NAMES = 5
DAILY_WEIGHT = 0.20


def _adjusted_window(s: dict, k: int, n: int):
    w = s['ac'][k - n:k + 1]
    return None if k < n or any(x is None or x <= 0 for x in w) else w


def daily_eligible(series: dict, members: list[dict], k: int) -> list[str]:
    """Adjusted closes on k-60..k, raw close >= $5, average dollar volume over k-19..k >= $20M."""
    out = []
    for m in members:
        s = series.get(m['symbol'])
        if s is None or _adjusted_window(s, k, DAILY_HISTORY) is None:
            continue
        c = s['c'][k]
        window = [(s['c'][i], s['v'][i]) for i in range(k - 19, k + 1)]
        if c is None or c < PRICE_FLOOR or any(x is None or y is None for x, y in window):
            continue
        if fmean(x * y for x, y in window) < DOLLAR_VOLUME_FLOOR:
            continue
        out.append(m['symbol'])
    return out


def daily_reversal_targets(series: dict, members: list[dict], k: int) -> dict:
    scored = []
    for sym in daily_eligible(series, members, k):
        ac = series[sym]['ac']
        r = ac[k] / ac[k - 1] - 1
        if r < 0:
            scored.append((r, sym))
    return {sym: DAILY_WEIGHT for _, sym in sorted(scored)[:DAILY_NAMES]}


def daily_momentum_targets(series: dict, members: list[dict], k: int) -> dict:
    scored = []
    for sym in daily_eligible(series, members, k):
        ac = series[sym]['ac']
        r = ac[k] / ac[k - 5] - 1
        if r > 0 and ac[k] > fmean(ac[k - 49:k + 1]):
            scored.append((-r, sym))
    return {sym: DAILY_WEIGHT for _, sym in sorted(scored)[:DAILY_NAMES]}


def daily_spy_trend_targets(series: dict, k: int) -> dict:
    s = series.get('SPY')
    w = _adjusted_window(s, k, 49) if s else None
    return {'SPY': 1.0} if w is not None and w[-1] > fmean(w) else {}


def daily_decisions(sid: str, sessions, series, members, *, first_signal: str, last_exec: str) -> list[dict]:
    """One decision per session close from `first_signal`, executing at the next open on or before `last_exec`."""
    if sid not in DAILY_IDS:
        raise ValueError('UNKNOWN_DAILY_STRATEGY')
    out = []
    for k in range(len(sessions) - 1):
        if sessions[k] < first_signal or sessions[k + 1] > last_exec:
            continue
        if sid == 'daily-reversal5-v1':
            targets = daily_reversal_targets(series, members, k)
        elif sid == 'daily-momentum5d-v1':
            targets = daily_momentum_targets(series, members, k)
        else:
            targets = daily_spy_trend_targets(series, k)
        out.append({'signal_index': k, 'targets': targets, 'label': 'close ' + sessions[k], 'meta': {}})
    return out
