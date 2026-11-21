"""Stock data-quality audit: research only, no network, no writes outside the given output path.

Checks the exact bars file the weekly backtests use (the gzip JSON from `stock_weekly_backtest_v1 fetch`) and the
universe file, and records what the data CANNOT tell us (docs/STOCK_DATA_QUALITY_AUDIT_2026_11_20.md):

  bars        per-symbol coverage, gaps inside the traded range, non-positive or missing prices, extreme moves
  actions     corporate actions INFERRED from the adjusted/raw ratio: split-like steps (raw price jumps the adjusted
              series does not show), dividend-like steps, and UNEXPLAINED steps (neither: spin-offs, special
              dividends or vendor revisions) that the live bridge would skip but the backtest silently includes
  universe    members without data, members whose bars start after the declared lower bound, sector concentration
  leakage     for sampled decisions, the momentum picks computed from the full series must equal the picks computed
              from a series truncated after the decision session's open (no later information can change them)

Nothing here repairs data. Findings are reported, never patched.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

from . import stock_weekly_backtest_v1 as bt

SPLIT_TOLERANCE = 0.02       # a ratio step within 2% of a common split ratio is split-like
DIVIDEND_MAX_STEP = 0.10     # adjusted/raw ratio steps below 10% (and not split-like) are dividend-like
STEP_NOISE = 0.001           # vendor adjusted prices are rounded: ratio jitter up to ~0.05%/day is not an event
STEP_WINDOW = 5              # an event is a PERSISTENT step: median of the next 5 ratios vs the previous 5
COMMON_SPLITS = sorted({a / b for a in range(1, 21) for b in range(1, 21) if a != b and max(a, b) <= 20 and min(a, b) <= 4})
EXTREME_DAILY = 0.40         # |adjusted close-to-close| above 40% is reported for review
LEAKAGE_SAMPLES = 24


def _ratio(b: dict, i: int):
    raw, adj = b['c'][i], b['ac'][i]
    return adj / raw if raw and adj and raw > 0 and adj > 0 else None


def classify_step(prev: float, cur: float) -> str | None:
    """Classify a change in adjusted/raw ratio between consecutive bars: None (no event), 'split', 'dividend' or
    'unexplained'. The ratio rises toward 1 over time as earlier dividends/splits are applied backwards."""
    if prev is None or cur is None or prev <= 0 or cur <= 0:
        return None
    r = cur / prev
    if abs(r - 1) < STEP_NOISE:
        return None
    if any(abs(r / s - 1) <= SPLIT_TOLERANCE for s in COMMON_SPLITS):
        return 'split'
    if 1 < r <= 1 + DIVIDEND_MAX_STEP:
        return 'dividend'
    return 'unexplained'


def audit_symbol(sym: str, b: dict, sessions: list[str]) -> dict:
    pos = {d: i for i, d in enumerate(sessions)}
    idx = [pos[d] for d in b['d'] if d in pos]
    out = {'symbol': sym, 'bars': len(b['d']), 'first': b['d'][0] if b['d'] else None, 'last': b['d'][-1] if b['d'] else None,
           'not_in_calendar': len(b['d']) - len(idx), 'gaps_inside_range': 0, 'nonpositive_or_missing': 0,
           'extreme_moves': [], 'events': Counter(), 'unexplained': []}
    if idx:
        out['gaps_inside_range'] = (idx[-1] - idx[0] + 1) - len(idx)
    for j in range(len(b['d'])):
        if any(b[k][j] is None or b[k][j] <= 0 for k in ('o', 'c', 'ao', 'ac')):
            out['nonpositive_or_missing'] += 1
    for j in range(1, len(b['d'])):
        a0, a1 = b['ac'][j - 1], b['ac'][j]
        if a0 and a1 and a0 > 0 and abs(a1 / a0 - 1) > EXTREME_DAILY:
            out['extreme_moves'].append({'date': b['d'][j], 'adjusted_return': a1 / a0 - 1})
    for j, step in persistent_steps(b):
        kind = classify_step(1.0, step)
        if kind:
            out['events'][kind] += 1
            if kind == 'unexplained':
                out['unexplained'].append({'date': b['d'][j], 'ratio_step': step})
    out['events'] = dict(out['events'])
    return out


def persistent_steps(b: dict, window: int = STEP_WINDOW) -> list[tuple[int, float]]:
    """Persistent changes in the adjusted/raw ratio: at bar j, median(ratio[j:j+w]) / median(ratio[j-w:j]). Days whose
    step exceeds STEP_NOISE are grouped into runs, and each run is reported once, at its largest step. Rounding jitter
    (which reverts) does not produce a persistent step; a dividend, split or spin-off does."""
    from statistics import median
    ratios = [_ratio(b, j) for j in range(len(b['d']))]
    raw: list[tuple[int, float]] = []
    for j in range(window, len(ratios) - window + 1):
        pre = [x for x in ratios[j - window:j] if x is not None]
        post = [x for x in ratios[j:j + window] if x is not None]
        if len(pre) < window // 2 + 1 or len(post) < window // 2 + 1:
            continue
        step = median(post) / median(pre)
        if abs(step - 1) >= STEP_NOISE:
            raw.append((j, step))
    events, run = [], []
    for j, step in raw:
        if run and j != run[-1][0] + 1:
            events.append(max(run, key=lambda x: abs(math.log(x[1]))))
            run = []
        run.append((j, step))
    if run:
        events.append(max(run, key=lambda x: abs(math.log(x[1]))))
    return events


def audit_universe(universe: dict, data: dict) -> dict:
    secs = universe['securities']
    bars = data['bars']
    start_floor = data['sessions'][0] if data['sessions'] else None
    late = sorted(s['symbol'] for s in secs if s['symbol'] in bars and bars[s['symbol']]['d']
                  and bars[s['symbol']]['d'][0] > (start_floor or ''))
    ended = sorted(s['symbol'] for s in secs if s['symbol'] in bars and bars[s['symbol']]['d']
                   and bars[s['symbol']]['d'][-1] < data['sessions'][-1])
    sectors = Counter(s['sector'] for s in secs)
    lower_bounds = Counter(s.get('first_traded_on') for s in secs)
    return {'members': len(secs), 'members_without_data': sorted(s['symbol'] for s in secs if s['symbol'] not in bars),
            'members_starting_after_data_start': late, 'members_ending_before_data_end': ended,
            'distinct_first_traded_on': dict(lower_bounds), 'sectors': dict(sorted(sectors.items())),
            'revision': universe.get('revision'),
            'survivorship': 'Every member is a 2026 survivor; no delisted or removed company can appear in any historical '
                            'week. first_traded_on is a declared lower bound, not a membership or listing date.',
            'classification': universe.get('classification')}


def leakage_check(data: dict, universe: dict, samples: int = LEAKAGE_SAMPLES) -> dict:
    """Recompute momentum picks at sampled decisions from a series truncated after the decision session's open bar.
    Any difference means the replay used information from after the decision."""
    sessions, series = bt.align(data)
    sectors = {u['symbol']: u['sector'] for u in universe['securities']}
    members = [s for s in sorted(sectors) if s in series]
    cap = float(universe['max_last_close']) if 'max_last_close' in universe else None
    spec = {'model': 'momentum', **bt._LIVE}
    ks = [k for k in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, k, 'weekly')]
    if not ks:
        return {'checked': 0, 'mismatches': 0, 'decisions': []}
    step = max(1, len(ks) // samples)
    chosen = ks[::step][:samples]
    mismatches, rows = 0, []
    for k in chosen:
        def picks(ser):
            scores = {}
            for s in members:
                x = bt.score(ser[s], k, spec['lookback'])
                if x is not None and ser[s]['ao'][k] is not None:
                    scores[s] = x
            return bt.select(scores, sectors, set(), spec, cap)
        full = picks(series)
        # Truncate: keep everything before session k and only session k's opening prices.
        cut = {s: {f: (v[:k] + [v[k] if f in ('o', 'ao') else None] + [None] * (len(v) - k - 1)) for f, v in series[s].items()}
               for s in members}
        trunc = picks(cut)
        same = full == trunc
        mismatches += 0 if same else 1
        rows.append({'session': sessions[k], 'picks': full, 'same_when_truncated': same})
    return {'checked': len(chosen), 'mismatches': mismatches, 'decisions': rows}


def dataset_digest(data: dict) -> str:
    return hashlib.sha256(json.dumps({'sessions': data['sessions'], 'bars': data['bars']}, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def audit(data: dict, universe: dict, *, leakage_samples: int = LEAKAGE_SAMPLES) -> dict:
    sessions = data['sessions']
    per = {s: audit_symbol(s, b, sessions) for s, b in sorted(data['bars'].items())}
    events = Counter()
    for r in per.values():
        events.update(r['events'])
    flagged = {s: {'gaps_inside_range': r['gaps_inside_range'], 'nonpositive_or_missing': r['nonpositive_or_missing'],
                   'extreme_moves': r['extreme_moves'], 'unexplained': r['unexplained'], 'not_in_calendar': r['not_in_calendar']}
               for s, r in per.items() if r['gaps_inside_range'] or r['nonpositive_or_missing'] or r['extreme_moves']
               or r['unexplained'] or r['not_in_calendar']}
    return {'version': 'stock-data-audit-v1', 'dataset_sha256': dataset_digest(data),
            'feed': data.get('feed'), 'asof': data.get('asof'), 'sessions': [sessions[0], sessions[-1]] if sessions else None,
            'session_count': len(sessions), 'symbols': len(per),
            'symbols_with_gaps': sum(1 for r in per.values() if r['gaps_inside_range']),
            'total_gap_sessions': sum(r['gaps_inside_range'] for r in per.values()),
            'symbols_with_bad_prices': sum(1 for r in per.values() if r['nonpositive_or_missing']),
            'inferred_events': dict(events),
            'symbols_with_unexplained_steps': sorted(s for s, r in per.items() if r['unexplained']),
            'flagged': flagged, 'universe': audit_universe(universe, data),
            'leakage': leakage_check(data, universe, leakage_samples),
            'not_checkable_from_this_data': [
                'historical index or universe membership (needs licensed point-in-time constituents)',
                'delisted, acquired or bankrupt companies (absent from a survivor list and from this file)',
                'point-in-time sector classification (labels are current; GICS changed in 2018 and 2023)',
                'point-in-time fundamentals (not in this file; see the SEC point-in-time audit)',
                'live corporate-action decisions (the live bridge uses raw bars plus Alpaca actions; this file has '
                'vendor-adjusted series)']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--universe', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    universe = json.loads(a.universe.read_text(encoding='utf-8'))
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    out = audit(data, universe)
    a.output.write_text(json.dumps(out, indent=1), encoding='utf-8')
    summary = {k: out[k] for k in ('dataset_sha256', 'sessions', 'session_count', 'symbols', 'symbols_with_gaps',
                                   'total_gap_sessions', 'symbols_with_bad_prices', 'inferred_events',
                                   'symbols_with_unexplained_steps')}
    summary['universe'] = {k: out['universe'][k] for k in ('members', 'members_without_data', 'members_starting_after_data_start',
                                                           'members_ending_before_data_end', 'distinct_first_traded_on')}
    summary['leakage'] = {k: out['leakage'][k] for k in ('checked', 'mismatches')}
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
