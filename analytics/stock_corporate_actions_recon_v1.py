"""Corporate-action reconciliation between the weekly backtest and the live bridge. Research only.

PR #199's data-quality audit found that the two treat corporate actions differently:
- the backtest (stock_weekly_backtest_v1) scores and marks vendor 'all'-adjusted prices, which include whatever
  the vendor adjusted for (sometimes spin-offs) and nothing it did not (an unadjusted spin-off is booked as a loss);
- the live bridge (stock_weekly_bridge_v2.member_actions) rebuilds total return from RAW prices plus Alpaca split
  and cash-dividend records only, and SKIPS any member with another action (spin-off, merger, name change, ...),
  an ambiguous same-day pair or an invalid record in its 253-session window.

This module measures that gap from real Alpaca corporate-action records. It never invents an action, never repairs
a price and never reads a missing record as "no action":

  fetch      opt-in network: archives /v1/corporate-actions for the universe by calendar year through the bridge's
             own read-only Source (the endpoint the live bridge already uses). Each chunk keeps its query, page
             hashes, retrieval time and whether it completed. Nothing else is requested.
  reconcile  offline and deterministic, from the bars file the backtest uses plus that archive:
             coverage   per year: the fetch completed AND the records explain the vendor's own dividend steps; a year
                        that fails is EVIDENCE_MISSING and every decision whose window touches it is not reconciled
             events     each record against the vendor's adjusted/raw ratio step at its ex-date (CONSISTENT,
                        VENDOR_NOT_ADJUSTED, MAGNITUDE_MISMATCH, ...), and each persistent vendor step that no
                        record explains (STEP_WITHOUT_RECORD)
             decisions  backtest picks (vendor-adjusted scores, every member) against live-rule picks (the bridge's
                        member_actions verbatim, total return from raw closes plus supported records only) at
                        every weekly decision with complete evidence
             returns    for momentum, steady and the hold-buffer challenger: every held position whose holding
                        period crosses an unresolved event, with the daily return the backtest booked; the true
                        return through a spin-off is UNRESOLVED (the spun-off company's price is not in this data)
             cases      the audit's flagged RTX, GE, DHR, EXC and HON dates, each verified against the records

As-of timing: Alpaca records carry no publication time. Like the live bridge, an action is applied only when its
effective date falls inside the window (window start < date <= last completed session before the decision).
Nothing after the decision's last completed session can influence its picks.
"""
from __future__ import annotations
import argparse
import bisect
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
from statistics import fmean, median

from . import stock_weekly_backtest_v1 as bt
from .stock_data_audit_v1 import persistent_steps, classify_step, dataset_digest
from .stock_forward_bridge_v1 import SUPPORTED_ACTIONS, DATE_FIELDS
from .stock_weekly_bridge_v2 import member_actions

VERSION = 'stock-corporate-action-reconciliation-v1'
ARCHIVE_VERSION = 'alpaca-corporate-actions-archive-v1'
# Fixed before any real record was seen. Not tuned.
MATCH_SESSIONS = 3          # a vendor ratio step is attributed to a record within +-3 sessions of its ex-date
STEP_WINDOW = 5             # ratio step = median(5 ratios from the ex-date) / median(5 ratios before), as in #199
SPLIT_REL_TOL = 0.01        # a split is CONSISTENT when the vendor step is within 1% of new_rate / old_rate
DIV_ABS_TOL = 0.0005        # a dividend is CONSISTENT when the vendor's implied yield is within 0.05 points ...
DIV_REL_TOL = 0.10          # ... or 10% of the record's yield (rate / previous raw close), whichever is larger
ADJUSTED_STEP = 0.002       # a ratio step of 0.2% or more means the vendor adjusted for something on that date
COVERAGE_MIN = 0.5          # a year is covered only if records explain at least half of the vendor dividend steps
EVENT_LIST_CAP = 400
STRATEGIES = ('momentum', 'steady', 'momentum-buffer10')
CASES = (('RTX', '2020-04-03'), ('GE', '2023-01-03'), ('GE', '2024-04-02'), ('DHR', '2023-10-03'),
         ('EXC', '2022-02-02'), ('HON', '2026-06-30'))
AUDIT_CLAIMS = {
    ('RTX', '2020-04-03'): 'unadjusted spin-off (Carrier/Otis distribution) booked as a -71% day',
    ('GE', '2023-01-03'): 'spin-off (vendor adjusted; unexplained ratio step)',
    ('GE', '2024-04-02'): 'GE Vernova spin-off; audit asked for the same check as RTX',
    ('DHR', '2023-10-03'): 'spin-off (vendor adjusted; unexplained ratio step)',
    ('EXC', '2022-02-02'): 'spin-off (vendor adjusted; unexplained ratio step)',
    ('HON', '2026-06-30'): 'unexplained FALLING adjusted/raw ratio',
}
SYNTHETIC_NOTE = 'Tests use synthetic fixtures only (analytics/test_stock_corporate_actions_recon_v1.py); ' \
                 'only the archived Alpaca records and the backtest bars file are historical evidence.'


class UnresolvedAction(ValueError):
    """An action the live-rule ledger cannot value from the available data (spin-off, merger, ...)."""


# ---------------------------------------------------------------- accounting (live rules)

class Ledger:
    """A position under the live bridge's supported actions: whole or fractional shares plus cash.
    Splits change the share count; cash dividends pay shares * rate into cash. Anything else is refused."""

    def __init__(self, shares: float, cash: float = 0.0):
        self.shares, self.cash = float(shares), float(cash)

    def apply(self, kind: str, *, split_ratio: float = 1.0, dividend: float = 0.0):
        if kind in ('forward_splits', 'reverse_splits'):
            if not split_ratio > 0:
                raise ValueError('split ratio must be positive')
            self.shares *= split_ratio
        elif kind == 'cash_dividends':
            if dividend < 0:
                raise ValueError('dividend must not be negative')
            self.cash += self.shares * dividend
        else:
            raise UnresolvedAction(kind)

    def value(self, price: float) -> float:
        return self.shares * price + self.cash


def live_wealth(closes: list[float], days: list[str], actions: dict[str, tuple[float, float]]) -> list[float]:
    """Total-return index from raw closes and supported actions, the frozen formula of
    stock_momentum_v1.total_return_index in floating point: W_t/W_(t-1) = (split_t*C_t + div_t)/C_(t-1).
    Actions apply on window sessions after the first, as in the bridge (window[0] < date <= window[-1])."""
    w = [1.0]
    for t in range(1, len(closes)):
        split, div = actions.get(days[t], (1.0, 0.0))
        w.append(w[-1] * (split * closes[t] + div) / closes[t - 1])
    return w


# ---------------------------------------------------------------- archive

def record_date(r: dict) -> str | None:
    return next((r[f] for f in DATE_FIELDS if isinstance(r.get(f), str)), None)


def flatten(archive: dict) -> tuple[list[dict], list[dict]]:
    """(rows, chunks): every record of every COMPLETE chunk once, as {kind, row, date}; chunk status kept.
    Alias chunks hold records filed under a member's FORMER ticker (from the archive's own name_changes records):
    a record dated on or before the change has that ticker replaced by the member's current one, as the live
    bridge would have seen it under the ticker in use at the time (a distribution can share the change date, as
    UTX's did); a record after the change is left out (the member's own chunks cover it). A record listed under
    both tickers on the change date is NOT merged here: for dividends it shows up as a same-day sum mismatch."""
    from .stock_forward_bridge_v1 import SYMBOL_FIELDS
    seen, rows = set(), []
    for c in archive['chunks']:
        if not c.get('complete'):
            continue
        alias = c.get('alias_of') or {}
        for page in c['pages']:
            for kind, items in (page.get('corporate_actions') or {}).items():
                for r in items if isinstance(items, list) else []:
                    if not isinstance(r, dict):
                        continue
                    if alias:
                        when = record_date(r)
                        old, (new, until) = next(iter(alias.items()))
                        if when is None or when > until:
                            continue
                        r = {k: (new if k in SYMBOL_FIELDS and v == old else v) for k, v in r.items()}
                        r['alias_from'] = old
                    key = (kind, json.dumps(r, sort_keys=True))
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append({'kind': kind, 'row': r, 'date': record_date(r)})
    rows.sort(key=lambda x: (x['date'] or '', x['kind'], json.dumps(x['row'], sort_keys=True)))
    return rows, archive['chunks']


def touched(row: dict) -> set[str]:
    from .stock_forward_bridge_v1 import SYMBOL_FIELDS
    return {row[f] for f in SYMBOL_FIELDS if isinstance(row.get(f), str)}


class WindowPages:
    """member_actions expects provider pages; give it only the rows whose date can fall in a window (same rows,
    same rule: the bridge itself filters window[0] < date <= window[1])."""

    def __init__(self, rows: list[dict]):
        self.rows = [r for r in rows if r['date']]
        self.dates = [r['date'] for r in self.rows]

    def pages(self, lo: str, hi: str) -> list[dict]:
        a, b = bisect.bisect_right(self.dates, lo), bisect.bisect_right(self.dates, hi)
        groups: dict = defaultdict(list)
        for r in self.rows[a:b]:
            groups[r['kind']].append(r['row'])
        return [{'corporate_actions': dict(groups), 'next_page_token': None}]


# ---------------------------------------------------------------- vendor ratio steps

def ratio_series(series: dict) -> list[float | None]:
    return [a / c if a and c and a > 0 and c > 0 else None for a, c in zip(series['ac'], series['c'])]


def step_at(ratios: list, j: int, window: int = STEP_WINDOW) -> float | None:
    if j < 1 or j >= len(ratios):
        return None
    pre = [x for x in ratios[max(0, j - window):j] if x is not None]
    post = [x for x in ratios[j:j + window] if x is not None]
    if not pre or not post:
        return None
    return median(post) / median(pre)


def present(ser: dict, sessions: list[str]):
    """Session indexes with a bar, and the #199 audit's bar layout for persistent_steps."""
    idx = [i for i in range(len(sessions)) if ser['c'][i] is not None]
    return idx, {'d': [sessions[i] for i in idx], 'c': [ser['c'][i] for i in idx], 'ac': [ser['ac'][i] for i in idx]}


def day_return(values: list, j: int) -> float | None:
    if j < 1 or j >= len(values) or not values[j - 1] or not values[j]:
        return None
    return values[j] / values[j - 1] - 1


# ---------------------------------------------------------------- reconciliation

def coverage(rows: list[dict], chunks: list[dict], sessions: list[str], series: dict) -> dict:
    """Per calendar year: did every fetch chunk complete, and do the records explain the vendor's dividend steps?"""
    years = sorted({int(s[:4]) for s in sessions})
    complete = {y: True for y in years}
    fetched = {y: False for y in years}
    for c in chunks:
        y = int(c['start'][:4])
        if y in complete:
            fetched[y] = True
            complete[y] = complete[y] and bool(c.get('complete'))
    pos = {d: i for i, d in enumerate(sessions)}
    div_idx = defaultdict(list)
    for r in rows:
        if r['kind'] == 'cash_dividends' and isinstance(r['row'].get('symbol'), str) and r['date'] in pos:
            div_idx[r['row']['symbol']].append(pos[r['date']])
    steps, matched = Counter(), Counter()
    for sym, ser in series.items():
        if sym == 'SPY':
            continue
        idx, b = present(ser, sessions)
        for jj, step in persistent_steps(b):
            if classify_step(1.0, step) != 'dividend':
                continue
            j = idx[jj]
            y = int(sessions[j][:4])
            steps[y] += 1
            if any(abs(j - k) <= MATCH_SESSIONS for k in div_idx.get(sym, ())):
                matched[y] += 1
    out = {}
    for y in years:
        rate = matched[y] / steps[y] if steps[y] else None
        ok = fetched[y] and complete[y] and (rate is None or rate >= COVERAGE_MIN)
        out[str(y)] = {'fetched': fetched[y], 'fetch_complete': fetched[y] and complete[y],
                       'vendor_dividend_steps': steps[y], 'explained_by_records': matched[y],
                       'explained_share': rate, 'status': 'COVERED' if ok else 'EVIDENCE_MISSING'}
    return out


def reconcile_records(rows: list[dict], sessions: list[str], series: dict, members: set[str]) -> dict:
    pos = {d: i for i, d in enumerate(sessions)}
    ratios = {s: ratio_series(series[s]) for s in series}
    statuses, listed = Counter(), []
    record_days = defaultdict(set)
    # Several cash dividends on one ex-date (e.g. a regular plus a variable dividend) are one adjustment for the
    # vendor: compare their SUM. The live bridge treats such a pair as AMBIGUOUS and skips the member.
    items, groups = [], {}
    for r in rows:
        syms = sorted(touched(r['row']) & members)
        if not syms or r['date'] is None:
            continue
        row = r['row']
        primary = row.get('symbol') if isinstance(row.get('symbol'), str) and row.get('symbol') in members else syms[0]
        if r['kind'] == 'cash_dividends':
            key = (primary, r['date'])
            if key in groups:
                g = groups[key]
                g['count'] += 1
                try:
                    g['row']['rate'] = str(float(g['row']['rate']) + float(row.get('rate')))
                except (TypeError, ValueError):
                    g['row']['rate'] = None
                continue
            g = groups[key] = {'kind': 'cash_dividends', 'row': dict(row), 'date': r['date'], 'syms': syms,
                               'primary': primary, 'count': 1}
            items.append(g)
        else:
            items.append({'kind': r['kind'], 'row': row, 'date': r['date'], 'syms': syms, 'primary': primary, 'count': 1})
    for it in items:
        kind, row, when, syms, primary = it['kind'], it['row'], it['date'], it['syms'], it['primary']
        j = pos.get(when)
        if j is None and when <= sessions[-1] and when >= sessions[0]:
            j = bisect.bisect_left(sessions, when)  # a non-session effective date takes effect at the next session
        for s in syms:
            if j is not None:
                record_days[s].add(j)
        entry = {'kind': kind, 'symbol': primary, 'touched': syms, 'date': when, 'id': row.get('id'),
                 'records_same_day': it['count'], 'alias_from': row.get('alias_from')}
        if j is None or primary not in series:
            status = 'OUTSIDE_BARS'
        else:
            obs = step_at(ratios[primary], j)
            c_prev = series[primary]['c'][j - 1] if j >= 1 else None
            entry['vendor_ratio_step'] = obs
            entry['adjusted_day_return'] = day_return(series[primary]['ac'], j)
            entry['raw_day_return'] = day_return(series[primary]['c'], j)
            if obs is None:
                status = 'NO_BARS_AT_DATE'
            elif kind == 'cash_dividends':
                try:
                    rate = float(row.get('rate'))
                except (TypeError, ValueError):
                    rate = None
                if rate is None or rate < 0 or not c_prev or rate >= c_prev:
                    status = 'INVALID_RECORD'
                else:
                    exp_y, obs_y = rate / c_prev, 1 - 1 / obs
                    entry['record_yield'], entry['vendor_yield'] = exp_y, obs_y
                    if abs(obs_y - exp_y) <= max(DIV_ABS_TOL, DIV_REL_TOL * exp_y):
                        status = 'CONSISTENT'
                    elif abs(obs_y) < DIV_ABS_TOL:
                        status = 'VENDOR_NOT_ADJUSTED'
                    else:
                        status = 'MAGNITUDE_MISMATCH'
            elif kind in ('forward_splits', 'reverse_splits'):
                try:
                    exp = float(row.get('new_rate')) / float(row.get('old_rate'))
                except (TypeError, ValueError, ZeroDivisionError):
                    exp = None
                entry['record_ratio'] = exp
                if not exp or exp <= 0:
                    status = 'INVALID_RECORD'
                elif abs(obs / exp - 1) <= SPLIT_REL_TOL:
                    status = 'CONSISTENT'
                elif abs(obs - 1) < SPLIT_REL_TOL:
                    status = 'VENDOR_NOT_ADJUSTED'
                else:
                    status = 'MAGNITUDE_MISMATCH'
            else:
                # Unsupported by the live bridge: it skips the member. Report what the vendor series did.
                status = 'UNSUPPORTED_VENDOR_ADJUSTED' if abs(obs - 1) >= ADJUSTED_STEP else 'UNSUPPORTED_VENDOR_NOT_ADJUSTED'
        entry['status'] = status
        statuses[(kind, status)] += 1
        if status != 'CONSISTENT' or kind not in SUPPORTED_ACTIONS:
            listed.append(entry)
    unexplained = []
    for s in sorted(members):
        if s not in series:
            continue
        ser = series[s]
        idx, b = present(ser, sessions)
        for jj, step in persistent_steps(b):
            j = idx[jj]
            if any(abs(j - k) <= MATCH_SESSIONS for k in record_days.get(s, ())):
                continue
            unexplained.append({'symbol': s, 'date': sessions[j], 'vendor_ratio_step': step,
                                'inferred': classify_step(1.0, step), 'status': 'STEP_WITHOUT_RECORD',
                                'adjusted_day_return': day_return(ser['ac'], j), 'raw_day_return': day_return(ser['c'], j)})
    by_status = Counter()
    for (k, st), n in statuses.items():
        by_status[st] += n
    return {'records_in_universe': sum(statuses.values()),
            'by_kind_and_status': {f'{k}:{st}': n for (k, st), n in sorted(statuses.items())},
            'by_status': dict(sorted(by_status.items())),
            'not_consistent_or_unsupported': listed, 'listed_total': len(listed),
            'steps_without_record': unexplained, 'steps_without_record_total': len(unexplained)}


def live_scores(series: dict, sessions: list[str], k: int, lookback: int, sym_actions: list[dict]):
    """The bt.score fields computed the live way: W from raw closes plus supported records only."""
    lo = k - bt.WINDOW
    if lo < 0:
        return None
    raw, vol = series['c'][lo:k], series['v'][lo:k]
    if any(x is None or x <= 0 for x in raw) or any(x is None for x in vol):
        return None
    days = sessions[lo:k]
    acts = {a['session_date']: (float(a['split_ratio']), float(a['cash_dividend_per_old_share'])) for a in sym_actions}
    w = live_wealth(raw, days, acts)
    momentum = w[-22] / w[-1 - lookback] - 1
    trend = w[-1] > sum(w[-200:]) / 200
    rets = [b / a - 1 for a, b in zip(w[-1 - lookback:-1], w[-lookback:])]
    m = fmean(rets)
    volatility = math.sqrt(sum((r - m) ** 2 for r in rets) / (len(rets) - 1))
    dollar_volume = fmean(c * v for c, v in zip(raw[-20:], vol[-20:]))
    return {'momentum': momentum, 'trend': trend, 'volatility': volatility,
            'eligible': raw[-1] >= 5 and dollar_volume >= 20_000_000, 'last_raw': raw[-1]}


def window_years(sessions: list[str], k: int) -> set[str]:
    return {sessions[i][:4] for i in range(max(0, k - bt.WINDOW), k)}


def compare_decisions(rows: list[dict], sessions: list[str], series: dict, universe: dict, years: dict,
                      start: str, end: str, unresolved_days: dict | None = None) -> dict:
    sectors = {u['symbol']: u['sector'] for u in universe['securities']}
    members = [s for s in sorted(sectors) if s in series]
    cap = float(universe['max_last_close']) if 'max_last_close' in universe else None
    wp = WindowPages(rows)
    specs = {name: bt.VARIANTS[name] for name in STRATEGIES}
    # Both treatments start each decision from the backtest's holdings, so a difference isolates the data
    # treatment at that decision (not a path that diverged weeks earlier).
    held_a = {n: set() for n in specs}
    out = {n: {'decisions': 0, 'evidence_missing': 0, 'reconciled': 0, 'same_picks': 0, 'different_picks': 0,
               'backtest_frozen': 0, 'live_frozen': 0, 'live_rejected': [], 'differences': [], 'symbols_differing': Counter(),
               'live_skip_reasons': Counter(), 'cause': Counter(), 'holdings': [], 'pairs': []} for n in specs}
    for k in range(bt.WINDOW, len(sessions)):
        if sessions[k] < start or sessions[k] > end:
            continue
        if not bt.is_decision(sessions, k, 'weekly'):
            continue
        lo, hi = sessions[k - bt.WINDOW], sessions[k - 1]
        evidence = all(years.get(y, {}).get('status') == 'COVERED' for y in window_years(sessions, k))
        kept, skipped = member_actions(wp.pages(lo, hi), set(members), (lo, hi)) if evidence else ([], {})
        by_sym = defaultdict(list)
        for a in kept:
            by_sym[a['symbol']].append(a)
        for name, spec in specs.items():
            o = out[name]
            o['decisions'] += 1
            scores_a = {s: x for s in members if (x := bt.score(series[s], k, spec['lookback'])) is not None
                        and series[s]['ao'][k] is not None}
            if held_a[name] <= set(scores_a):
                picks_a = set(bt.select(scores_a, sectors, held_a[name], spec, cap))
            else:
                picks_a = set(held_a[name]); o['backtest_frozen'] += 1
            o['holdings'].append((k, sorted(picks_a)))
            if not evidence:
                o['evidence_missing'] += 1
                held_a[name] = picks_a
                continue
            scores_b = {}
            for s in members:
                if s in skipped or series[s]['ao'][k] is None:
                    continue
                x = live_scores(series[s], sessions, k, spec['lookback'], by_sym.get(s, []))
                if x is not None:
                    scores_b[s] = x
            for s, why in skipped.items():
                o['live_skip_reasons'][why.split(':')[0]] += 1
            held = held_a[name]
            if held <= set(scores_b):
                picks_b = set(bt.select(scores_b, sectors, held, spec, cap))
            else:
                # The live bridge rejects the decision (HELD_SECURITY_SKIPPED) and keeps the holdings unchanged.
                picks_b = set(held); o['live_frozen'] += 1
                if len(o['live_rejected']) < EVENT_LIST_CAP:
                    o['live_rejected'].append({'session': sessions[k], 'held_but_skipped': sorted(held - set(scores_b)),
                                               'backtest_rebalanced_to': sorted(picks_a)})
            o['reconciled'] += 1
            o['pairs'].append((k, picks_a, picks_b))
            if picks_a != picks_b:
                # Attribution: the bridge's skip rule alone (vendor scores, skipped members removed, same freeze rule)
                # versus the price treatment (raw closes plus supported records instead of vendor adjustment).
                allowed = {s: x for s, x in scores_a.items() if s not in skipped}
                skip_only = set(bt.select(allowed, sectors, held, spec, cap)) if held <= set(allowed) else set(held)
                o['cause']['skip_rule' if skip_only == picks_b else 'price_treatment' if skip_only == picks_a
                           else 'both'] += 1
            if picks_a == picks_b:
                o['same_picks'] += 1
            else:
                o['different_picks'] += 1
                diff = sorted(picks_a ^ picks_b)
                o['symbols_differing'].update(diff)
                if len(o['differences']) < EVENT_LIST_CAP:
                    o['differences'].append({'session': sessions[k], 'backtest_only': sorted(picks_a - picks_b),
                                             'live_only': sorted(picks_b - picks_a),
                                             'live_skipped_in_window': sorted(s for s in diff if s in skipped)})
            held_a[name] = picks_a
    ks = [k for k in range(bt.WINDOW, len(sessions)) if start <= sessions[k] <= end and bt.is_decision(sessions, k, 'weekly')]
    nxt = {k: (ks[i + 1] if i + 1 < len(ks) else None) for i, k in enumerate(ks)}
    for o in out.values():
        o['symbols_differing'] = dict(o['symbols_differing'].most_common())
        o['live_skip_reasons'] = dict(o['live_skip_reasons'])
        o['cause'] = dict(o['cause'])
        o['divergence_return'] = divergence_return(o.pop('pairs'), nxt, series, unresolved_days or {})
    return out


def divergence_return(pairs, nxt: dict, series: dict, unresolved_days: dict) -> dict:
    """One-week return gap, open to next decision's open, between the backtest's picks and the live-rule picks at
    10% each, valued on the backtest's own vendor-adjusted opens. Weeks where any involved stock has an unresolved
    event (or a missing open) are excluded and counted, never filled in. Positive: backtest picks did better."""
    diffs, excluded = [], 0
    for k, a, b in pairs:
        if a == b:
            continue
        j = nxt.get(k)
        names = a | b
        if j is None or any(series[s]['ao'][k] is None or series[s]['ao'][j] is None for s in names) or \
                any(any(k < d <= j for d in unresolved_days.get(s, ())) for s in names):
            excluded += 1
            continue
        r = lambda S: sum(bt.WEIGHT * (series[s]['ao'][j] / series[s]['ao'][k] - 1) for s in S)
        diffs.append(r(a) - r(b))
    return {'weeks_measured': len(diffs), 'weeks_excluded_unresolved_or_missing': excluded,
            'sum_of_weekly_gaps': sum(diffs), 'mean_weekly_gap': fmean(diffs) if diffs else None,
            'backtest_better_weeks': sum(1 for d in diffs if d > 0), 'live_better_weeks': sum(1 for d in diffs if d < 0),
            'basis': 'vendor-adjusted opens (the backtest convention); 10% per pick; not a portfolio replay'}


def booked_returns(events: list[dict], sessions: list[str], holdings: list[tuple[int, list[str]]]) -> dict:
    """Held positions crossing an unresolved event: bought at decision k's open, held until the next decision's
    open, so an event on session j is experienced when k < j <= next decision (the overnight gap into j)."""
    pos = {d: i for i, d in enumerate(sessions)}
    spans = []
    for i, (k, picks) in enumerate(holdings):
        nxt = holdings[i + 1][0] if i + 1 < len(holdings) else len(sessions) - 1
        spans.append((k, nxt, set(picks)))
    hits, done = [], set()
    for e in events:
        if (e['symbol'], e['date']) in done:
            continue
        done.add((e['symbol'], e['date']))
        j = pos.get(e['date'])
        if j is None:
            continue
        for k, nxt, picks in spans:
            if k < j <= nxt and e['symbol'] in picks:
                r = e.get('adjusted_day_return')
                hits.append({'symbol': e['symbol'], 'date': e['date'], 'kind': e.get('kind') or e.get('inferred'),
                             'status': e['status'], 'decision': sessions[k], 'booked_day_return': r,
                             'raw_day_return': e.get('raw_day_return'),
                             'approx_portfolio_effect_at_target_weight': None if r is None else bt.WEIGHT * r,
                             'true_return': 'UNRESOLVED'})
                break
    known = [h['approx_portfolio_effect_at_target_weight'] for h in hits if h['approx_portfolio_effect_at_target_weight'] is not None]
    return {'held_through_unresolved_events': len(hits), 'events': hits,
            'sum_booked_effect_at_target_weight': sum(known) if known else 0.0}


def investigate_cases(rows: list[dict], sessions: list[str], series: dict, years: dict, cases=CASES) -> list[dict]:
    pos = {d: i for i, d in enumerate(sessions)}
    out = []
    for sym, when in cases:
        j = pos.get(when)
        res = {'symbol': sym, 'date': when, 'audit_claim': AUDIT_CLAIMS.get((sym, when), ''),
               'year_evidence': years.get(when[:4], {}).get('status', 'EVIDENCE_MISSING')}
        if j is None or sym not in series:
            res['finding'] = 'NOT_IN_BARS'
            out.append(res)
            continue
        ratios = ratio_series(series[sym])
        res['vendor_ratio_step'] = step_at(ratios, j)
        res['adjusted_day_return'] = day_return(series[sym]['ac'], j)
        res['raw_day_return'] = day_return(series[sym]['c'], j)
        lo, hi = sessions[max(0, j - 10)], sessions[min(len(sessions) - 1, j + 10)]
        near = [{'kind': r['kind'], 'date': r['date'], 'record': {k: v for k, v in r['row'].items() if k != 'id'}}
                for r in rows if r['date'] and lo <= r['date'] <= hi and sym in touched(r['row'])]
        res['records_within_10_sessions'] = near
        kinds = sorted({n['kind'] for n in near if n['kind'] not in SUPPORTED_ACTIONS})
        adjusted = res['vendor_ratio_step'] is not None and abs(res['vendor_ratio_step'] - 1) >= ADJUSTED_STEP
        res['vendor_treatment'] = 'ADJUSTED' if adjusted else 'NOT_ADJUSTED'
        if kinds:
            res['finding'] = 'UNSUPPORTED_RECORD:' + ','.join(kinds)
        elif near:
            res['finding'] = 'ONLY_SUPPORTED_RECORDS'
        elif res['year_evidence'] == 'COVERED':
            res['finding'] = 'NO_RECORD_IN_ARCHIVE'
        else:
            res['finding'] = 'EVIDENCE_MISSING'
        out.append(res)
    return out


def archive_digest(archive: dict) -> str:
    return hashlib.sha256(json.dumps([[c.get('start'), c.get('end'), c.get('symbols'), c.get('complete'),
                                       c.get('page_sha256')] for c in archive['chunks']],
                                     sort_keys=True).encode()).hexdigest()


def reconcile(data: dict, universe: dict, archive: dict, *, start: str = bt.DEV[0], end: str | None = None) -> dict:
    sessions, series = bt.align(data)
    end = end or sessions[-1]
    members = {u['symbol'] for u in universe['securities']} & set(series)
    rows, chunks = flatten(archive)
    years = coverage(rows, chunks, sessions, series)
    recs = reconcile_records(rows, sessions, series, members)
    pos = {d: i for i, d in enumerate(sessions)}
    unresolved_days = defaultdict(set)
    for e in recs['not_consistent_or_unsupported'] + recs['steps_without_record']:
        if e['status'] != 'OUTSIDE_BARS' and e['date'] in pos:
            for sym in e.get('touched') or [e['symbol']]:
                unresolved_days[sym].add(pos[e['date']])
    decisions = compare_decisions(rows, sessions, series, universe, years, start, end, unresolved_days)
    for e in recs['not_consistent_or_unsupported'] + recs['steps_without_record']:
        e['year_evidence'] = years.get(e['date'][:4], {}).get('status', 'EVIDENCE_MISSING')
    unresolved = [e for e in recs['not_consistent_or_unsupported'] if e['status'] not in ('OUTSIDE_BARS',)] + \
        recs['steps_without_record']
    returns = {}
    for name in STRATEGIES:
        returns[name] = booked_returns(unresolved, sessions, decisions[name].pop('holdings'))
    for key in ('not_consistent_or_unsupported', 'steps_without_record'):
        recs[key] = recs[key][:EVENT_LIST_CAP]
    return {'version': VERSION, 'dataset_sha256': dataset_digest(data),
            'archive_sha256': archive_digest(archive), 'archive_retrieved_at': archive.get('retrieved_at'),
            'archive_query': {k: archive.get(k) for k in ('start', 'end', 'endpoint')},
            'sessions': [sessions[0], sessions[-1]], 'members': len(members), 'window': [start, end],
            'chunks': {'total': len(chunks), 'complete': sum(1 for c in chunks if c.get('complete')),
                       'failed': [{'start': c['start'], 'symbols': len(c['symbols']), 'error': c.get('error')}
                                  for c in chunks if not c.get('complete')]},
            'records_total': len(rows), 'records_by_kind': dict(Counter(r['kind'] for r in rows)),
            'coverage_by_year': years, 'records': recs, 'decisions': decisions, 'booked_returns': returns,
            'cases': investigate_cases(rows, sessions, series, years),
            'rules': {'supported': list(SUPPORTED_ACTIONS), 'live_rule_source': 'stock_weekly_bridge_v2.member_actions (unchanged)',
                      'as_of_basis': 'effective date only: window start < date <= last completed session before the '
                                     'decision; Alpaca records carry no publication time, so availability before the '
                                     'decision is not verified',
                      'tolerances': {'MATCH_SESSIONS': MATCH_SESSIONS, 'STEP_WINDOW': STEP_WINDOW,
                                     'SPLIT_REL_TOL': SPLIT_REL_TOL, 'DIV_ABS_TOL': DIV_ABS_TOL,
                                     'DIV_REL_TOL': DIV_REL_TOL, 'ADJUSTED_STEP': ADJUSTED_STEP,
                                     'COVERAGE_MIN': COVERAGE_MIN}},
            'synthetic_fixtures': SYNTHETIC_NOTE}


# ---------------------------------------------------------------- fetch (network, opt-in)

def fetch(source, symbols: list[str], start: str, end: str, group: int = 40) -> dict:
    """Archive Alpaca corporate actions by calendar year and symbol group. A chunk that fails is kept as failed
    (with the provider's reason); its year is then EVIDENCE_MISSING, never 'no action'."""
    from .stock_forward_bridge_v1 import DATA, Rejected, sha256
    chunks = []
    for y in range(int(start[:4]), int(end[:4]) + 1):
        lo, hi = max(start, f'{y}-01-01'), min(end, f'{y}-12-31')
        for i in range(0, len(symbols), group):
            part = symbols[i:i + group]
            c = {'start': lo, 'end': hi, 'symbols': part}
            try:
                pages = source.paged(DATA, '/v1/corporate-actions', {'symbols': ','.join(part), 'start': lo, 'end': hi,
                                                                     'limit': 1000})
                c.update(complete=True, pages=pages, page_sha256=[sha256(p) for p in pages],
                         retrieved_at=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
            except Rejected as e:
                c.update(complete=False, pages=[], page_sha256=[], error=e.reasons[:5])
            chunks.append(c)
    # Former tickers, from the name_changes records just archived: request each one up to its change date.
    members = set(symbols)
    aliases = {}
    for r, _ in ((r, k) for c in chunks if c['complete'] for p in c['pages']
                 for k, rs in (p.get('corporate_actions') or {}).items() if k == 'name_changes' for r in rs):
        old, new, when = r.get('old_symbol'), r.get('new_symbol'), record_date(r)
        if new in members and isinstance(old, str) and old not in members and when:
            aliases[old] = (new, min(when, aliases.get(old, (new, when))[1]))
    for old, (new, until) in sorted(aliases.items()):
        for y in range(int(start[:4]), int(until[:4]) + 1):
            lo, hi = max(start, f'{y}-01-01'), min(end, f'{y}-12-31', until)
            c = {'start': lo, 'end': hi, 'symbols': [old], 'alias_of': {old: [new, until]}}
            try:
                pages = source.paged(DATA, '/v1/corporate-actions', {'symbols': old, 'start': lo, 'end': hi, 'limit': 1000})
                c.update(complete=True, pages=pages, page_sha256=[sha256(p) for p in pages],
                         retrieved_at=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
            except Rejected as e:
                c.update(complete=False, pages=[], page_sha256=[], error=e.reasons[:5])
            chunks.append(c)
    return {'version': ARCHIVE_VERSION, 'endpoint': '/v1/corporate-actions', 'start': start, 'end': end,
            'aliases': {k: list(v) for k, v in sorted(aliases.items())},
            'retrieved_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'chunks': chunks,
            'note': 'Alpaca corporate-action records as returned; coverage is not attested by the provider.'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--universe', type=Path, required=True)
    f.add_argument('--end', required=True)
    f.add_argument('--output', type=Path, required=True)
    r = sub.add_parser('reconcile')
    for name in ('universe', 'data', 'archive', 'output'):
        r.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    universe = json.loads(a.universe.read_text(encoding='utf-8'))
    if a.command == 'fetch':
        from .stock_forward_bridge_v1 import Source
        if a.output.exists():
            p.error('output exists; refusing to overwrite')
        source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''))
        symbols = sorted({s['symbol'] for s in universe['securities']})
        archive = fetch(source, symbols, bt.START_DATA, a.end)
        with gzip.open(a.output, 'wt', encoding='utf-8') as fh:
            json.dump(archive, fh)
        print(json.dumps({'status': 'ARCHIVED', 'chunks': len(archive['chunks']),
                          'complete': sum(1 for c in archive['chunks'] if c['complete']), 'requests': source.count}))
        return
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    with gzip.open(a.archive, 'rt', encoding='utf-8') as fh:
        archive = json.load(fh)
    out = reconcile(data, universe, archive)
    a.output.write_text(json.dumps(out, indent=1, default=str), encoding='utf-8')
    print(json.dumps({k: out[k] for k in ('dataset_sha256', 'archive_sha256', 'records_total', 'records_by_kind', 'chunks')},
                     indent=1))


if __name__ == '__main__':
    main()
