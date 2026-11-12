"""Stock market psychology ablation (lab-stock-psychology-v1). RESEARCH ONLY, historical PAPER replay.

Pre-registered before any run (this file and docs/AI_LEARNING_LAB_2026_11_12.md are the registration). It never
changes the live weekly strategy, the universe, a release flag or an order path, and it does not interfere with the
supervised Alpaca PAPER release. It reuses the weekly backtest replay (analytics/stock_weekly_backtest_v1.py) with the
live strategy's rules ('momentum', weekly, 252-day lookback, $95 cap, 10% per pick) as the BASE, and tests behavioural
overlays computed only from completed daily bars before each decision:

  attention_spike        skip a name whose 20-session mean volume is >= 2.0x its prior 252-session mean
                         (attention-driven buying tends to overshoot, then reverse)
  volatility_shock       skip a name whose 20-session realised volatility is >= 1.75x its prior 252-session volatility
                         (panic or euphoria regimes; momentum is least reliable there)
  short_term_overreaction skip a name whose 21-session return is in the top 10% of scorable members that week
                         (one-month reversal: recent big winners give some of it back)
  market_regime          hold no stock while SPY's last completed close is below its 200-session mean
                         (risk-off regime filter; sells existing holdings at the next decision)

Layers that need data SportsEdge does not lawfully collect with timestamps are registered as UNSUPPORTED and never
run: news sentiment, earnings surprises, search-based attention, crowd/retail concentration.

Variants: base, base + each layer, combined, combined minus each layer (10). Benchmarks: SPY held at the same average
exposure as each variant (exposure-matched), SPY 100%, SPY 50%. Costs: 10 bps per side, and a 25 bps per side
spread/slippage sensitivity. Trades occur at the next session's open; whole-share and missing-bar rules are the
replay's. Statistics: weekly return differences vs base, 4-week block bootstrap (2,000 replicates, seed 20261112),
one-sided p-value, Holm across all 9 comparisons. A layer "helps" only if, in the 2023+ holdout, its addition AND
its removal both favour it with Holm p < 0.05, its holdout Sharpe is not lower, and it still beats base at 25 bps.
The universe is NOT survivorship-free (inherited caveat); results are exploratory and never activate anything.
"""
from __future__ import annotations
import argparse
from datetime import date
import gzip
import json
import math
import random
from pathlib import Path
from statistics import fmean, pstdev

from . import stock_weekly_backtest_v1 as wb

EXPERIMENT = 'lab-stock-psychology-v1'
RULES = {'attention_ratio': 2.0, 'volatility_ratio': 1.75, 'overreaction_top_share': 0.10,
         'short_window': 20, 'long_window': 252, 'reversal_window': 21}
LAYERS = ('market_regime', 'attention_spike', 'volatility_shock', 'short_term_overreaction')
UNSUPPORTED = {
    'news_sentiment': 'No licensed, timestamped news-sentiment feed is collected.',
    'earnings_surprise': 'No point-in-time earnings estimates and announcement times are collected.',
    'search_attention': 'No timestamped search/attention data is collected.',
    'crowd_concentration': 'No point-in-time retail-flow or holdings-concentration data is collected.',
}
BASE_SPEC = {'model': 'momentum', 'cadence': 'weekly', 'buffer': 0, 'lookback': 252}
BOOT = {'replicates': 2000, 'seed': 20261112, 'block_weeks': 4, 'alpha': 0.05}


def variants() -> dict[str, tuple[str, ...]]:
    out = {'base': ()}
    for layer in LAYERS:
        out['base+' + layer] = (layer,)
    out['combined'] = LAYERS
    for layer in LAYERS:
        out['combined-' + layer] = tuple(x for x in LAYERS if x != layer)
    return out


def _vol(xs: list[float]) -> float:
    rets = [b / a - 1 for a, b in zip(xs, xs[1:])]
    return pstdev(rets) if len(rets) > 1 else 0.0


def features(series: dict, k: int) -> dict | None:
    """Behavioural features from completed sessions before k only; None when any needed bar is missing."""
    R = RULES
    lo = k - R['long_window'] - R['short_window']
    if lo < 0:
        return None
    vol, ac = series['v'][lo:k], series['ac'][lo:k]
    if any(x is None for x in vol) or any(x is None or x <= 0 for x in ac):
        return None
    short, prior = vol[-R['short_window']:], vol[:-R['short_window']]
    prior_mean = fmean(prior)
    long_vol = _vol(ac[:-R['short_window']])
    return {'attention_ratio': fmean(short) / prior_mean if prior_mean > 0 else None,
            'volatility_ratio': _vol(ac[-R['short_window'] - 1:]) / long_vol if long_vol > 0 else None,
            'r21': ac[-1] / ac[-1 - R['reversal_window']] - 1}


def risk_off(spy: dict | None, k: int) -> bool:
    """SPY's last completed total-return close below its 200-session mean (sessions k-200..k-1). Unknown = not risk-off."""
    if spy is None or k < 200:
        return False
    w = spy['ac'][k - 200:k]
    if any(x is None or x <= 0 for x in w):
        return False
    return w[-1] < fmean(w)


def make_adjust(layers: tuple[str, ...]):
    """Overlay for replay(): marks members ineligible under each active layer. Uses bars before k only."""
    if not layers:
        return None

    def adjust(scores: dict, series: dict, k: int) -> dict:
        if 'market_regime' in layers and risk_off(series.get('SPY'), k):
            return {s: {**x, 'eligible': False} for s, x in scores.items()}
        feats = {s: features(series[s], k) for s in scores}
        r21 = sorted(f['r21'] for f in feats.values() if f is not None)
        cut = r21[int(len(r21) * (1 - RULES['overreaction_top_share']))] if r21 else math.inf
        out = {}
        for s, x in scores.items():
            f, flagged = feats[s], False
            if f is not None:
                if 'attention_spike' in layers and f['attention_ratio'] is not None and f['attention_ratio'] >= RULES['attention_ratio']:
                    flagged = True
                if 'volatility_shock' in layers and f['volatility_ratio'] is not None and f['volatility_ratio'] >= RULES['volatility_ratio']:
                    flagged = True
                if 'short_term_overreaction' in layers and f['r21'] >= cut:
                    flagged = True
            out[s] = {**x, 'eligible': x['eligible'] and not flagged}
        return out
    return adjust


def weekly_returns(curve: list[tuple[str, float]], lo: str, hi: str) -> dict[str, float]:
    """Week-over-week equity changes, keyed by ISO week, for weeks whose last session is within [lo, hi]."""
    last: dict[str, tuple[str, float]] = {}
    for d, v in curve:
        y, w, _ = date.fromisoformat(d).isocalendar()
        last['%d-W%02d' % (y, w)] = (d, v)
    keys = sorted(last)
    return {b: last[b][1] / last[a][1] - 1 for a, b in zip(keys, keys[1:]) if lo <= last[b][0] <= hi}


def block_bootstrap(diffs: list[float], replicates: int, seed: int, block: int) -> dict | None:
    """Mean weekly difference with a moving-block bootstrap; p = P(mean <= 0) (one-sided, candidate better)."""
    n = len(diffs)
    if n < 2 * block:
        return None
    rng = random.Random(seed)
    starts = list(range(n - block + 1))
    means = []
    for _ in range(replicates):
        sample = []
        while len(sample) < n:
            i = rng.choice(starts)
            sample.extend(diffs[i:i + block])
        means.append(fmean(sample[:n]))
    means.sort()
    not_better = sum(1 for m in means if m <= 0)
    return {'mean_weekly': fmean(diffs), 'lower95': means[int(0.025 * replicates)], 'upper95': means[int(0.975 * replicates) - 1],
            'weeks': n, 'p_improve': (not_better + 1) / (replicates + 1)}


def holm(ps: list[float]) -> list[float]:
    order = sorted(range(len(ps)), key=lambda i: (ps[i], i))
    out, running = [1.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        out[i] = running
    return out


def evaluate(data: dict, universe: dict, end: str | None = None) -> dict:
    sessions, series = wb.align(data)
    return evaluate_series(sessions, series, universe, end or sessions[-1])


def evaluate_series(sessions: list[str], series: dict, universe: dict, end: str) -> dict:
    """The registered ablation on session-aligned series (the research pipeline's `assemble` format)."""
    periods = {'dev': wb.DEV, 'holdout': (wb.HOLDOUT_START, end), 'full': (wb.DEV[0], end)}
    out = {'experiment': EXPERIMENT, 'rules': RULES, 'unsupported': UNSUPPORTED, 'base_spec': BASE_SPEC,
           'periods': {k: list(v) for k, v in periods.items()}, 'variants': {}, 'benchmarks': {}, 'comparisons': [],
           'caveats': ['Universe is not survivorship-free (inherited from the weekly backtest).',
                       'Historical replay with fractional shares; not Alpaca fills and not a forward PAPER result.',
                       'Research only: no layer can change the live weekly strategy.']}
    curves = {}
    for name, layers in variants().items():
        for cost in (wb.COST_BPS, 25.0):
            r = wb.replay(sessions, series, universe, BASE_SPEC, start=wb.DEV[0], end=end, cost_bps=cost, adjust=make_adjust(layers))
            key = name if cost == wb.COST_BPS else name + '@25bps'
            curves[key] = r['curve']
            years = len(r['curve']) / 252
            out['variants'][key] = {'layers': list(layers), 'cost_bps': cost, 'avg_exposure': r['avg_exposure'],
                                    'turnover_per_year': r['traded'] / wb.STARTING / years if years else None,
                                    **{p: wb.metrics(r['curve'], *rng) for p, rng in periods.items()}}
    if 'SPY' in series:
        for label, weight in (('spy', 1.0), ('spy-50', 0.5), ('spy-exposure-matched', out['variants']['base']['avg_exposure'])):
            c = wb.benchmark(sessions, series['SPY'], start=wb.DEV[0], end=end, weight=weight)['curve']
            out['benchmarks'][label] = {'weight': weight, **{p: wb.metrics(c, *rng) for p, rng in periods.items()}}
    # Paired weekly comparisons in the holdout, Holm across the family.
    lo, hi = periods['holdout']
    base_w = weekly_returns(curves['base'], lo, hi)
    tests = []
    for layer in LAYERS:
        tests.append(('added', layer, 'base+' + layer, 'base'))
        tests.append(('removed', layer, 'combined', 'combined-' + layer))
    tests.append(('vs_base', None, 'combined', 'base'))
    raw = []
    for kind, layer, cand, ref in tests:
        cw, rw = weekly_returns(curves[cand], lo, hi), (base_w if ref == 'base' else weekly_returns(curves[ref], lo, hi))
        weeks = sorted(set(cw) & set(rw))
        raw.append(block_bootstrap([cw[w] - rw[w] for w in weeks], BOOT['replicates'], BOOT['seed'], BOOT['block_weeks']))
    adj = holm([r['p_improve'] if r else 1.0 for r in raw])
    for (kind, layer, cand, ref), r, p in zip(tests, raw, adj):
        out['comparisons'].append({'kind': kind, 'layer': layer, 'candidate': cand, 'reference': ref, 'holdout': r, 'p_adjusted': p})
    out['verdicts'] = verdicts(out)
    return out


def verdicts(out: dict) -> dict:
    v = out['variants']
    res = {}
    for layer in LAYERS:
        comps = [c for c in out['comparisons'] if c['layer'] == layer]
        sig = all(c['holdout'] and c['p_adjusted'] < BOOT['alpha'] for c in comps)
        sharpe_ok = (v['base+' + layer]['holdout'].get('sharpe') or -9) >= (v['base']['holdout'].get('sharpe') or -9)
        cost_ok = (v['base+' + layer + '@25bps']['holdout'].get('total') or -9) > (v['base@25bps']['holdout'].get('total') or -9)
        hurts = any(c['holdout'] and c['holdout']['upper95'] < 0 for c in comps)
        res[layer] = 'helps' if sig and sharpe_ok and cost_ok else 'hurts' if hurts else 'no_clear_effect'
    for layer, why in UNSUPPORTED.items():
        res[layer] = 'not_tested: ' + why
    return res


def markdown(out: dict) -> str:
    rows = ['| Variant | Holdout CAGR | Holdout Sharpe | Max drawdown | Exposure | Turnover/yr |', '|---|---|---|---|---|---|']
    for name, x in out['variants'].items():
        h = x['holdout']
        rows.append(f"| {name} | {h.get('cagr', 0) * 100:.1f}% | {h.get('sharpe') or 0:.2f} | {h.get('max_drawdown', 0) * 100:.1f}% | "
                    f"{x['avg_exposure'] * 100:.0f}% | {x['turnover_per_year'] or 0:.1f}x |")
    for name, b in out['benchmarks'].items():
        h = b['holdout']
        rows.append(f"| {name} (benchmark) | {h.get('cagr', 0) * 100:.1f}% | {h.get('sharpe') or 0:.2f} | {h.get('max_drawdown', 0) * 100:.1f}% | {b['weight'] * 100:.0f}% | - |")
    verdicts_md = '\n'.join(f'- {k}: {v}' for k, v in out['verdicts'].items())
    return f"# {EXPERIMENT} (research only)\n\n" + '\n'.join(rows) + '\n\n## Verdicts\n' + verdicts_md + '\n'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--universe', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True, help='bars.json.gz from stock_weekly_backtest_v1 fetch')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--markdown', type=Path, required=True)
    a = p.parse_args()
    universe = json.loads(a.universe.read_text(encoding='utf-8'))
    with gzip.open(a.data, 'rt', encoding='utf-8') as fh:
        data = json.load(fh)
    out = evaluate(data, universe)
    a.output.write_text(json.dumps(out, indent=1), encoding='utf-8')
    a.markdown.write_text(markdown(out), encoding='utf-8')
    print(markdown(out))


if __name__ == '__main__':
    main()


# ---------------------------------------------------------------- forward research ledger (frozen before the open)
FORWARD_FIRST_DECISION = '2026-11-16'
FORWARD_MIN_WEEKS = 26
WEIGHT = 0.10


def decide(sessions: list[str], series: dict, universe: dict, k: int, layers: tuple[str, ...], held: set[str]) -> list[str]:
    """The picks a variant would make for decision session k from completed bars before k only (no k-session data)."""
    sectors = {u['symbol']: u['sector'] for u in universe['securities']}
    cap = float(universe['max_last_close']) if 'max_last_close' in universe else None
    scores = {}
    for sym in sorted(sectors):
        if sym in series:
            x = wb.score(series[sym], k, BASE_SPEC['lookback'])
            if x is not None:
                scores[sym] = x
    adj = make_adjust(layers)
    if adj is not None:
        scores = adj(scores, series, k)
    return wb.select(scores, sectors, held & set(scores), BASE_SPEC, cap)


def next_decision(sessions: list[str], last_bar: str) -> int | None:
    """Index of the first session after the last completed bar, if it opens a new ISO week (a weekly decision)."""
    k = next((i for i, d in enumerate(sessions) if d > last_bar), None)
    if k is None or k == 0 or not wb.is_decision(sessions, k, 'weekly') or sessions[k] < FORWARD_FIRST_DECISION:
        return None
    return k


def freeze(sessions: list[str], series: dict, universe: dict, ledger: list[dict], last_bar: str, frozen_at: str,
           fingerprint: str) -> list[dict]:
    """New ledger rows for the next decision session, one per variant, or [] when nothing is due or it is already frozen.
    Rows are only ever appended: an existing (session, variant) is never recomputed, revised or backfilled late."""
    k = next_decision(sessions, last_bar)
    if k is None:
        return []
    done = {(r['decision_session'], r['variant']) for r in ledger}
    rows = []
    for name, layers in variants().items():
        if (sessions[k], name) in done:
            continue
        prev = [r for r in ledger if r['variant'] == name and r['decision_session'] < sessions[k]]
        held = set(max(prev, key=lambda r: r['decision_session'])['picks']) if prev else set()
        rows.append({'experiment': EXPERIMENT, 'variant': name, 'layers': list(layers), 'decision_session': sessions[k],
                     'data_through': last_bar, 'frozen_at': frozen_at, 'picks': decide(sessions, series, universe, k, layers, held),
                     'held_before': sorted(held), 'dataset_fingerprint': fingerprint, 'rules': RULES})
    return rows


def grade(ledger: list[dict], sessions: list[str], series: dict, cost_bps: float = 10.0) -> dict:
    """Weekly returns of each variant's frozen picks, open-to-next-decision-open, 10% per pick, costs on changed names.
    Weeks without a later open are pending. SPY at the same invested weight is the exposure-matched benchmark."""
    pos = {d: i for i, d in enumerate(sessions)}
    by_var: dict[str, list[dict]] = {}
    for r in sorted(ledger, key=lambda r: r['decision_session']):
        by_var.setdefault(r['variant'], []).append(r)
    out = {}
    for name, rows in by_var.items():
        weeks = []
        for i, r in enumerate(rows):
            k = pos.get(r['decision_session'])
            k2 = pos.get(rows[i + 1]['decision_session']) if i + 1 < len(rows) else None
            if k is None or k2 is None:
                weeks.append({'session': r['decision_session'], 'status': 'pending', 'picks': r['picks']})
                continue
            def ret(sym):
                a, b = series.get(sym, {}).get('ao', [None] * len(sessions))[k], series.get(sym, {}).get('ao', [None] * len(sessions))[k2]
                return None if a is None or b is None or a <= 0 else b / a - 1
            rs = [ret(s) for s in r['picks']]
            if any(x is None for x in rs):
                weeks.append({'session': r['decision_session'], 'status': 'missing_bars', 'picks': r['picks']})
                continue
            changed = len(set(r['picks']) ^ set(r['held_before']))
            gross = WEIGHT * sum(rs)
            spy = ret('SPY')
            weeks.append({'session': r['decision_session'], 'status': 'graded', 'picks': r['picks'],
                          'return': gross - WEIGHT * changed * cost_bps / 1e4,
                          'spy_exposure_matched': None if spy is None else WEIGHT * len(r['picks']) * spy})
        graded = [w for w in weeks if w['status'] == 'graded']
        total = 1.0
        for w in graded:
            total *= 1 + w['return']
        out[name] = {'weeks': len(graded), 'pending': len(weeks) - len(graded), 'total_return': total - 1 if graded else None,
                     'latest_picks': rows[-1]['picks'], 'latest_session': rows[-1]['decision_session'],
                     'status': 'collecting' if len(graded) < FORWARD_MIN_WEEKS else 'ready_for_review'}
    return {'first_decision': FORWARD_FIRST_DECISION, 'min_weeks': FORWARD_MIN_WEEKS, 'variants': out,
            'note': 'Frozen research picks only: never orders, never the live strategy.'}


def lab_summary(hist: dict | None, ledger: list[dict], graded: dict | None) -> dict:
    """Compact, validated-vs-unvalidated summary for the site and chat."""
    out = {'experiment': EXPERIMENT, 'historicalAt': hist.get('at') if hist else None,
           'layers': list(LAYERS), 'unsupported': list(UNSUPPORTED), 'verdicts': (hist or {}).get('verdicts') or {},
           'holdout': {}, 'forward': {'frozenRows': len(ledger), 'firstDecision': FORWARD_FIRST_DECISION, 'minWeeks': FORWARD_MIN_WEEKS,
                                      'variants': {k: {kk: v.get(kk) for kk in ('weeks', 'pending', 'total_return', 'status', 'latest_session')}
                                                   for k, v in ((graded or {}).get('variants') or {}).items()}},
           'validated': [], 'unvalidated': []}
    if hist:
        for name, x in hist['variants'].items():
            if '@' in name:
                continue
            h = x.get('holdout') or {}
            out['holdout'][name] = {k: h.get(k) for k in ('cagr', 'sharpe', 'max_drawdown', 'total')} | {'exposure': x.get('avg_exposure')}
        bm = hist.get('benchmarks', {})
        out['benchmarks'] = {k: {kk: (v.get('holdout') or {}).get(kk) for kk in ('cagr', 'sharpe', 'max_drawdown')} for k, v in bm.items()}
    # Nothing is validated until the forward ledger reaches its minimum AND the historical verdict says it helps.
    for layer in LAYERS:
        v = out['verdicts'].get(layer, 'not_run')
        fwd_ready = all(x.get('status') == 'ready_for_review' for x in out['forward']['variants'].values()) and out['forward']['variants']
        (out['validated'] if v == 'helps' and fwd_ready else out['unvalidated']).append({'layer': layer, 'historical': v})
    return out
