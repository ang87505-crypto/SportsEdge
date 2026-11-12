"""Next-generation research slate (frozen in docs/STOCK_STRATEGY_NEXTGEN_PREREG_2026_11_10.md).

One change at a time from the immutable baseline B0 (`momentum-quality-paper-v1`). Every decision uses only
information available at the signal session's close; filings count only from the first session after their
filing date. Research only: nothing here places, plans or authorizes an order.
"""
from __future__ import annotations
from bisect import bisect_left
from datetime import date, timedelta
import math
import random
from statistics import fmean, pstdev

from . import candidates as cand

PREREG = 'docs/STOCK_STRATEGY_NEXTGEN_PREREG_2026_11_10.md'
B0 = 'momentum-quality-paper-v1'
IDS = ('mq-recovery-v1', 'mq-buffer-v1', 'mq-invvol-v1', 'mq-wide10-v1', 'mq-fquality-v1',
       'insider-only-v1', 'mq-insider-tiebreak-v1', 'mq-insider-filter-v1')
INTEGRATED = 'mq-buffer-fquality-v1'
COSTS = (0, 5, 10, 25, 50)
REALISTIC_BPS = 5
RECOVERY = {'cooldown': 20, 'scale': 0.5, 'full_after': 3, 'sma': 200}
BUFFER_RANK = 10
VOL_WINDOW, VOL_CAP = 63, 0.30
WIDE_NAMES, WIDE_PER_SECTOR = 10, 3
INSIDER_DAYS = 90
QUALITY_STALE_DAYS = 550
QUALITY_MIN_COVERAGE = 0.80
BOOT_BLOCK, BOOT_REPS, BOOT_SEED = 21, 2000, 20261110


# ---------------------------------------------------------------- shared ranking

def ranked_top20(series, members, k, key=None):
    """B0's top 20 by momentum, ordered by `key` (default: B0's positive fraction, then momentum, symbol)."""
    scored = cand.momentum_quality_scores(series, members, k)
    top = sorted(scored, key=lambda x: (-x['momentum'], x['symbol']))[:cand.TOP_N]
    key = key or (lambda x: (-x['positive_fraction'], -x['momentum'], x['symbol']))
    return sorted(top, key=key)


def pick(ranked, n=cand.MAX_NAMES, per_sector=cand.PER_SECTOR, keep=()):
    """Sector-capped picks in ranking order; `keep` names are placed first (still under the sector cap)."""
    picks, per = [], {}
    by = {x['symbol']: x for x in ranked}
    for x in [by[s] for s in keep if s in by] + [x for x in ranked if x['symbol'] not in keep]:
        if len(picks) == n:
            break
        if per.get(x['sector'], 0) < per_sector:
            picks.append(x['symbol'])
            per[x['sector']] = per.get(x['sector'], 0) + 1
    return picks


def _month_ends(sessions, first_signal, last_exec):
    return [k for k in cand.month_end_indices(sessions) if sessions[k] >= first_signal and sessions[k + 1] <= last_exec]


def _dec(k, sessions, targets, meta=None):
    return {'signal_index': k, 'targets': targets, 'label': 'month-end ' + sessions[k], 'meta': meta or {}}


# ---------------------------------------------------------------- V2 buffer, V3 weights

def buffer_decisions(sessions, series, members, *, first_signal, last_exec, key=None):
    out, held = [], []
    for k in _month_ends(sessions, first_signal, last_exec):
        ranked = ranked_top20(series, members, k, key)
        keep = [s for s in held if s in {x['symbol'] for x in ranked[:BUFFER_RANK]}]
        picks = pick(ranked, keep=keep)
        held = picks
        out.append(_dec(k, sessions, {s: cand.WEIGHT for s in picks}, {'kept': keep}))
    return out


def inverse_vol_weights(series, picks, k, window=VOL_WINDOW, cap=VOL_CAP):
    inv = {}
    for s in picks:
        ac = series[s]['ac'][k - window:k + 1]
        rets = [b / a - 1 for a, b in zip(ac, ac[1:]) if a and b]
        sd = pstdev(rets) if len(rets) == window else 0.0
        if sd > 0:
            inv[s] = 1 / sd
    if not inv:
        return {}
    w = {s: v / sum(inv.values()) for s, v in inv.items()}
    for _ in range(len(w) + 1):                      # cap and redistribute proportionally
        over = {s for s, x in w.items() if x > cap + 1e-12}
        if not over:
            break
        excess = sum(w[s] - cap for s in over)
        free = {s: x for s, x in w.items() if s not in over and x < cap}
        for s in over:
            w[s] = cap
        if not free:
            break
        tot = sum(free.values())
        for s, x in free.items():
            w[s] = x + excess * x / tot
    return w


def invvol_decisions(sessions, series, members, *, first_signal, last_exec):
    out = []
    for k in _month_ends(sessions, first_signal, last_exec):
        picks = pick(ranked_top20(series, members, k))
        out.append(_dec(k, sessions, inverse_vol_weights(series, picks, k)))
    return out


def wide_decisions(sessions, series, members, *, first_signal, last_exec):
    out = []
    for k in _month_ends(sessions, first_signal, last_exec):
        picks = pick(ranked_top20(series, members, k), n=WIDE_NAMES, per_sector=WIDE_PER_SECTOR)
        out.append(_dec(k, sessions, {s: 1.0 / WIDE_NAMES for s in picks}))
    return out


# ---------------------------------------------------------------- V1 regime

def spy_regime(series_spy, n_sessions, sma=RECOVERY['sma']):
    """regime[k]: SPY adjusted close above its `sma`-session simple average at close k (False without history)."""
    ac = series_spy['ac']
    out = [False] * n_sessions
    for k in range(sma - 1, n_sessions):
        w = ac[k - sma + 1:k + 1]
        if ac[k] is not None and all(x is not None for x in w):
            out[k] = ac[k] > sum(w) / sma
    return out


# ---------------------------------------------------------------- V4 fundamental quality

def quality_key(qual):
    """qual(symbol) -> score in [0, 1] or None. Known scores first (higher better), then momentum."""
    return lambda x: (qual(x['symbol']) is None, -(qual(x['symbol']) or 0.0), -x['momentum'], x['symbol'])


def quality_scores(top, fundamentals_at):
    """Average percentile rank of ROA and safety among the top-20 names with both known."""
    known = {x['symbol']: fundamentals_at(x['symbol']) for x in top}
    known = {s: f for s, f in known.items() if f and f.get('roa') is not None and f.get('safety') is not None}
    if not known:
        return {}

    def pct(field):
        vals = sorted(known, key=lambda s: (known[s][field], s))
        n = len(vals)
        return {s: (i + 1) / n for i, s in enumerate(vals)}
    a, b = pct('roa'), pct('safety')
    return {s: (a[s] + b[s]) / 2 for s in known}


def fquality_decisions(sessions, series, members, fundamentals, *, first_signal, last_exec, buffer=False):
    """fundamentals(symbol, cutoff_date) -> {'roa', 'safety', ...} or None, using only filings before cutoff_date."""
    out, held, coverage = [], [], []
    for k in _month_ends(sessions, first_signal, last_exec):
        top = ranked_top20(series, members, k)
        scores = quality_scores(top, lambda s: fundamentals(s, sessions[k]))
        coverage.append((len(scores), len(top)))
        ranked = sorted(top, key=quality_key(scores.get))
        keep = [s for s in held if s in {x['symbol'] for x in ranked[:BUFFER_RANK]}] if buffer else []
        picks = pick(ranked, keep=keep)
        held = picks
        out.append(_dec(k, sessions, {s: cand.WEIGHT for s in picks}, {'scored': len(scores), 'top': len(top)}))
    known, total = sum(a for a, _ in coverage), sum(b for _, b in coverage)
    return out, (known / total if total else 0.0)


# ---------------------------------------------------------------- V5 insider purchases

def insider_window(purchases_by_symbol, symbol, cutoff: str, days=INSIDER_DAYS):
    """Qualifying purchases filed strictly before `cutoff` and within `days` calendar days of it."""
    lo = (date.fromisoformat(cutoff) - timedelta(days=days)).isoformat()
    rows = [p for p in purchases_by_symbol.get(symbol, ()) if lo <= p['filed'] < cutoff]
    return {'buyers': len({p['owner_cik'] for p in rows}), 'value': sum(p['value'] for p in rows), 'rows': len(rows)}


def insider_decisions(sessions, series, members, purchases, mode, *, first_signal, last_exec, coverage_end=None):
    """mode: 'only' (V5b), 'tiebreak' (V5c) or 'filter' (V5d). Decisions after `coverage_end` see no new filings
    beyond it (recorded in meta)."""
    out = []
    sector = {m['symbol']: m['sector'] for m in members}
    for k in _month_ends(sessions, first_signal, last_exec):
        cutoff = sessions[k]
        feat = lambda s: insider_window(purchases, s, cutoff)
        meta = {'beyond_coverage': bool(coverage_end and cutoff > coverage_end)}
        if mode == 'only':
            cands = []
            for m in members:
                f = feat(m['symbol'])
                c = series.get(m['symbol'], {}).get('c', [None] * (k + 1))[k]
                if f['buyers'] and c:
                    cands.append({'symbol': m['symbol'], 'sector': sector[m['symbol']], 'buyers': f['buyers'], 'value': f['value']})
            ranked = sorted(cands, key=lambda x: (-x['buyers'], -x['value'], x['symbol']))
            picks = pick(ranked)
        else:
            top = ranked_top20(series, members, k)
            flag = {x['symbol']: feat(x['symbol'])['buyers'] > 0 for x in top}
            if mode == 'tiebreak':
                ranked = sorted(top, key=lambda x: not flag[x['symbol']])     # stable: B0 order inside each group
            else:
                ranked = [x for x in top if flag[x['symbol']]]
            meta['flagged'] = sorted(s for s, f in flag.items() if f)
            picks = pick(ranked)
        out.append(_dec(k, sessions, {s: cand.WEIGHT for s in picks}, meta))
    return out


# ---------------------------------------------------------------- benchmarks and metrics

def exposure_matched_v2(sessions, spy, close_exposure, open_exposure, start_k, end_k, capital):
    """Overnight at the prior close's exposure (first session: none held before the open), open-to-close at the
    exposure right after that session's opening trades. Uses nothing that was unknown before each bar."""
    eq, curve = capital, [(sessions[start_k - 1], capital)]
    for i, k in enumerate(range(start_k, end_k + 1)):
        e_night = 0.0 if i == 0 else close_exposure[i - 1]
        e_day = open_exposure[i]
        if spy['ac'][k - 1] and spy['ao'][k] and spy['ac'][k]:
            eq *= (1 + e_night * (spy['ao'][k] / spy['ac'][k - 1] - 1)) * (1 + e_day * (spy['ac'][k] / spy['ao'][k] - 1))
        curve.append((sessions[k], eq))
    return curve


def daily_returns(curve):
    vals = [v for _, v in curve]
    return [b / a - 1 for a, b in zip(vals, vals[1:])]


def extra_metrics(curve, spy_curve, exposure, cash_sessions=None):
    r, m = daily_returns(curve), daily_returns(spy_curve)
    n = min(len(r), len(m))
    r, m = r[:n], m[:n]
    down = [x for x in r if x < 0]
    dd_sd = math.sqrt(sum(x * x for x in down) / len(r)) if r else 0.0
    vm = pstdev(m) ** 2 if len(m) > 1 else 0.0
    beta = (sum((a - fmean(r)) * (b - fmean(m)) for a, b in zip(r, m)) / len(r)) / vm if vm else None
    alpha = (fmean(r) - beta * fmean(m)) * 252 if beta is not None else None
    months, last = {}, {}
    for d, v in curve:
        last[d[:7]] = v
    keys = sorted(last)
    worst = min((last[b] / last[a] - 1 for a, b in zip(keys, keys[1:])), default=None)
    peak, peak_i, longest, cur_start = curve[0][1], 0, 0, None
    for i, (_, v) in enumerate(curve):
        if v >= peak:
            if cur_start is not None:
                longest = max(longest, i - cur_start)
            peak, cur_start = v, None
        elif cur_start is None:
            cur_start = i
    if cur_start is not None:
        longest = max(longest, len(curve) - 1 - cur_start)
    return {'sortino': fmean(r) / dd_sd * math.sqrt(252) if dd_sd else None, 'beta': beta, 'alpha_annual': alpha,
            'worst_month': worst, 'longest_underwater_sessions': longest,
            'time_in_cash': (sum(1 for e in exposure if e == 0) / len(exposure)) if exposure else None}


def block_bootstrap(rets, stat, *, block=BOOT_BLOCK, reps=BOOT_REPS, seed=BOOT_SEED, paired=None):
    """Moving-block bootstrap. `paired`: a second aligned return list resampled with the same blocks."""
    n = len(rets)
    if n < block * 4:
        return None
    rnd = random.Random(seed)
    out = []
    for _ in range(reps):
        idx = []
        while len(idx) < n:
            s = rnd.randrange(0, n - block + 1)
            idx.extend(range(s, s + block))
        idx = idx[:n]
        out.append(stat([rets[i] for i in idx], [paired[i] for i in idx] if paired is not None else None))
    out = sorted(x for x in out if x is not None)
    if not out:
        return None
    q = lambda p: out[min(len(out) - 1, max(0, int(p * len(out))))]
    return {'p05': q(0.05), 'p50': q(0.50), 'p95': q(0.95)}


def sharpe(r, _=None):
    sd = pstdev(r)
    return fmean(r) / sd * math.sqrt(252) if sd > 0 else None


def cagr(r, _=None):
    g = 1.0
    for x in r:
        g *= 1 + x
    return g ** (252 / len(r)) - 1 if g > 0 else -1.0


def sharpe_diff(a, b):
    x, y = sharpe(a), sharpe(b)
    return None if x is None or y is None else x - y


def gates(c10, c25, spy_full, matched_v2_full, unresolved_any, halts=None):
    """New-candidate gates (pre-registered). c10/c25: the judged path's summarize() output at 10 and 25 bps."""
    gt = lambda a, b: a is not None and b is not None and a > b
    f = c10['full']
    years = [v for y, v in c10['years'].items() if '2017' <= y <= '2026']
    g = {
        'sharpe_above_spy': gt(f.get('sharpe'), spy_full.get('sharpe')),
        'cagr_above_matched_spy_v2': gt(f.get('cagr'), matched_v2_full.get('cagr')),
        'max_drawdown_within_35pct': f.get('max_drawdown') is not None and f['max_drawdown'] >= -0.35,
        'cagr_positive_at_10_and_25bps': gt(f.get('cagr'), 0) and gt(c25['full'].get('cagr'), 0),
        'halves_positive_and_6_positive_years': gt(c10['early'].get('cagr'), 0) and gt(c10['late'].get('cagr'), 0)
        and sum(1 for v in years if v > 0) >= 6,
        'no_unresolved_at_any_cost': not unresolved_any,
    }
    if halts is not None:
        g['every_halt_exit_within_15pct'] = all(h['exit_equity'] is not None and h['exit_equity'] / h['peak'] - 1 >= -0.15
                                               for h in halts)
    return {'verdict': 'QUALIFIES FOR INDEPENDENT REVIEW' if all(g.values()) else 'FAILS', 'gates': g}
