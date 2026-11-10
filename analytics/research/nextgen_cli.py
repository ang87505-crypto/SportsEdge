"""Runner for the next-generation slate (docs/STOCK_STRATEGY_NEXTGEN_PREREG_2026_11_10.md).

  python -m analytics.research.nextgen_cli collect --data research-data      # SEC filings, read-only
  python -m analytics.research.nextgen_cli historical --data research-data --end 2026-11-06

Writes append-only snapshots and results into the data directory (the research-data branch in CI).
Market data: Alpaca, read-only, the existing paper key pair. SEC: the SEC_EDGAR_USER_AGENT secret.
Nothing here trades, plans an order, or changes any automation.
"""
from __future__ import annotations
import argparse
from bisect import bisect_right
import json
import os
from pathlib import Path

from . import candidates as cand
from . import cli
from . import data as rdata
from . import engine
from . import evaluate as ev
from . import filings
from . import nextgen as ng
from .fetch import Fetcher, FetchError
from .store import SnapshotStore, canonical

FIRST_QUARTER = '2016q1'
SMALL_CAPITAL = 1_000.0


# ---------------------------------------------------------------- collect

def collect(data: Path, now) -> dict:
    store = SnapshotStore(data)
    at = cli.stamp(now)
    ua = os.getenv('SEC_EDGAR_USER_AGENT', '').strip()
    if not ua:
        store.put(source_id='sec-nextgen', url=filings.TICKERS_URL, retrieved_at=at, body=None, status='NOT_CONFIGURED')
        return {'status': 'NOT_CONFIGURED'}
    f = Fetcher(user_agent=ua, min_interval={'www.sec.gov': 0.25, 'data.sec.gov': 0.25}, timeout=180.0, max_requests=600)
    _, members = cli.universe_members()
    symbols = [m['symbol'] for m in members]
    raw = f.get(filings.TICKERS_URL).body
    store.put(source_id='sec-company-tickers', key='company_tickers', url=filings.TICKERS_URL, retrieved_at=at, body=raw,
              status='OK', content_type='application/json')
    cmap, unmapped = filings.cik_map(json.loads(raw), symbols)
    out = {'mapped': len(cmap), 'unmapped': unmapped, 'facts_ok': 0, 'facts_failed': [], 'quarters_ok': [], 'quarters_failed': {}}
    for sym, cik in sorted(cmap.items()):
        url = filings.FACTS_URL.format(cik=cik)
        try:
            body = f.get(url).body
            ex = {'symbol': sym, 'cik': cik, 'url': url, 'raw_sha256': filings.sha256(body), 'retrieved_at': at,
                  'facts': filings.extract_facts(json.loads(body))}
            store.put(source_id='sec-xbrl-companyfacts', key=f'{sym}:{cik}', url=url, retrieved_at=at, body=canonical(ex),
                      status='OK', content_type='application/json')
            out['facts_ok'] += 1
        except (FetchError, ValueError) as e:
            store.put(source_id='sec-xbrl-companyfacts', key=f'{sym}:{cik}', url=url, retrieved_at=at, body=None,
                      status='FETCH_FAILED', error=str(e)[:200])
            out['facts_failed'].append(sym)
    by_cik = {v: k for k, v in cmap.items()}
    for q in filings.quarters(FIRST_QUARTER, filings.last_complete_quarter(now.date().isoformat())):
        url = filings.FORM345_URL.format(q=q)
        try:
            body = f.get(url).body
            parsed = filings.parse_form345(body, set(cmap.values()))
            events = filings.filing_events(parsed, quarter=q, raw_sha256=filings.sha256(body), observed_at=at, ticker_by_cik=by_cik)
            ex = {'quarter': q, 'url': url, 'raw_sha256': filings.sha256(body), 'raw_bytes': len(body), 'retrieved_at': at,
                  'submissions': len(parsed['submissions']), 'events': events}
            store.put(source_id='sec-form345-dataset', key=q, url=url, retrieved_at=at, body=canonical(ex), status='OK',
                      content_type='application/json')
            out['quarters_ok'].append(q)
        except FetchError as e:
            store.put(source_id='sec-form345-dataset', key=q, url=url, retrieved_at=at, body=None, status='FETCH_FAILED', error=str(e)[:200])
            out['quarters_failed'][q] = e.code
        except filings.ContractError as e:
            store.put(source_id='sec-form345-dataset', key=q, url=url, retrieved_at=at, body=None, status='PARSE_FAILED', error=str(e)[:200])
            out['quarters_failed'][q] = str(e)
    out['requests'] = f.count
    cli.append_run(data, {'command': 'nextgen-collect', 'at': at, 'result': out})
    return out


def _latest_body(store, source_id, key):
    m = store.latest(source_id, key=key, require_body=True)
    return (json.loads(store.load(m['path'])['body']), m) if m else (None, None)


def load_filings(store, symbols, last_quarter):
    facts, provenance = {}, {}
    for key in sorted(store.keys('sec-xbrl-companyfacts')):
        doc, m = _latest_body(store, 'sec-xbrl-companyfacts', key)
        if doc and doc['symbol'] in symbols:
            facts[doc['symbol']] = doc['facts']
            provenance[doc['symbol']] = {'cik': doc['cik'], 'raw_sha256': doc['raw_sha256'], 'retrieved_at': doc['retrieved_at']}
    events, qprov, missing = [], {}, []
    for q in filings.quarters(FIRST_QUARTER, last_quarter):
        doc, m = _latest_body(store, 'sec-form345-dataset', q)
        if not doc:
            missing.append(q)
            continue
        events += doc['events']
        qprov[q] = {'raw_sha256': doc['raw_sha256'], 'raw_bytes': doc['raw_bytes'], 'events': len(doc['events'])}
    return facts, provenance, events, qprov, missing


# ---------------------------------------------------------------- historical

def _sim(sessions, series, actions, decisions, start_k, end_k, *, cost, halt, capital=ev.CAPITAL, recovery=None):
    return engine.simulate(sessions, series, actions, decisions, start_index=start_k, end_index=end_k, capital=capital,
                           cost_bps=cost, halt=halt, recovery=recovery)


def _row(r, sessions, start_k, end_k, spy_curve):
    lo, hi = sessions[start_k], sessions[end_k]
    return {**ev.summarize(r['curve'], lo, hi), **{f: r[f] for f in ev.RUN_FIELDS},
            **ng.extra_metrics(r['curve'], spy_curve, r['exposure']), 'unresolved': r['unresolved'],
            'halts': r['halts'], 'reentries': r['reentries'], 'cash_sessions': r['cash_sessions'],
            'executions': len(r['executions'])}


def evaluate_candidate(sid, decisions, ctx, *, recovery=None):
    sessions, series, actions, start_k, end_k = ctx['sessions'], ctx['series'], ctx['actions'], ctx['start_k'], ctx['end_k']
    res, raw10 = {'decisions': len(decisions)}, {}
    for c in ng.COSTS:
        cont = _sim(sessions, series, actions, decisions, start_k, end_k, cost=c, halt=False)
        live = _sim(sessions, series, actions, decisions, start_k, end_k, cost=c, halt=True)
        res[f'bps{c}'] = {'continuous': _row(cont, sessions, start_k, end_k, ctx['spy_curve']),
                          'as_live': _row(live, sessions, start_k, end_k, ctx['spy_curve'])}
        if recovery is not None:
            rec = _sim(sessions, series, actions, decisions, start_k, end_k, cost=c, halt=True, recovery=recovery)
            res[f'bps{c}']['recovery'] = _row(rec, sessions, start_k, end_k, ctx['spy_curve'])
            if c == 10:
                raw10['recovery'] = rec
        if c == 10:
            raw10['continuous'] = cont
    judged = 'recovery' if recovery is not None else 'continuous'
    r10 = raw10[judged]
    lo, hi = sessions[start_k], sessions[end_k]
    matched_v1 = ev.summarize(ev.exposure_matched(sessions, series['SPY'], r10['exposure'], start_k, end_k), lo, hi)
    matched_v2 = ev.summarize(ng.exposure_matched_v2(sessions, series['SPY'], r10['exposure'], r10['open_exposure'],
                                                     start_k, end_k, ev.CAPITAL), lo, hi)
    unresolved_any = any(res[f'bps{c}'][k]['unresolved'] or res[f'bps{c}'][k]['open_unresolved_at_end']
                         for c in ng.COSTS for k in res[f'bps{c}'] if k in ('continuous', 'as_live', 'recovery'))
    out = {'judged_path': judged, 'result': res,
           'original_nine': ev.verdict(res, ctx['bench'], matched_v1),
           'gates': ng.gates(res['bps10'][judged], res['bps25'][judged], ctx['bench']['spy-hold']['full'], matched_v2['full'],
                             unresolved_any, halts=res['bps10'][judged]['halts'] if recovery is not None else None),
           'matched_spy_v1': matched_v1, 'matched_spy_v2': matched_v2}
    rets = ng.daily_returns(r10['curve'])
    out['bootstrap_10bps'] = {'cagr': ng.block_bootstrap(rets, ng.cagr), 'sharpe': ng.block_bootstrap(rets, ng.sharpe),
                              'sharpe_minus_spy': ng.block_bootstrap(rets, ng.sharpe_diff, paired=ctx['spy_rets']),
                              'sharpe_minus_b0': ng.block_bootstrap(rets, ng.sharpe_diff, paired=ctx['b0_rets'])
                              if ctx.get('b0_rets') and sid != ng.B0 else None}
    small = _sim(sessions, series, actions, decisions, start_k, end_k, cost=10, halt=recovery is not None,
                 capital=SMALL_CAPITAL, recovery=recovery)
    out['capital_1000_10bps'] = {k: v for k, v in _row(small, sessions, start_k, end_k, ctx['spy_curve']).items()
                                 if k in ('full', 'filled', 'unfilled_cash', 'unfilled_gap', 'reduced_for_cash', 'orders', 'avg_exposure')}
    if recovery is not None:
        out['recovery_detail'] = recovery_detail(r10, sessions, series['SPY'], start_k)
    out['picks'] = [{'date': sessions[d['signal_index']], 'targets': d['targets'], 'meta': d.get('meta', {})} for d in decisions]
    return out


def recovery_detail(r, sessions, spy, start_k):
    reentries = [x for x in r['reentries'] if x.get('equity') is not None]
    whipsaws = sum(1 for x in reentries for h in r['halts']
                   if 0 < sessions.index(h['date']) - sessions.index(x['date']) <= 60)
    first_halt = r['halts'][0]['date'] if r['halts'] else None
    missed = 1.0
    if first_halt:
        for i, e in enumerate(r['exposure']):
            k = start_k + i
            if sessions[k] > first_halt and e == 0 and spy['ac'][k] and spy['ac'][k - 1]:
                missed *= spy['ac'][k] / spy['ac'][k - 1]
    return {'halts': r['halts'], 'reentries': r['reentries'], 'whipsaws': whipsaws, 'cash_sessions': r['cash_sessions'],
            'spy_return_while_v1_flat_after_first_halt': missed - 1 if first_halt else None}


def picks_changed(a, b):
    by = {x['signal_index']: set(x['targets']) for x in b}
    return sum(1 for x in a if set(x['targets']) != by.get(x['signal_index']))


def historical(data: Path, end: str, now) -> dict:
    store = SnapshotStore(data)
    universe, members = cli.universe_members()
    symbols = {m['symbol'] for m in members}
    md = cli.market_data(cli.alpaca(), symbols | {'SPY'}, ev.DATA_START, end, {})
    sessions, series = rdata.assemble(md['sessions'], md['bars'])
    start_k, end_k = ev.window(sessions, ev.FIRST_EXEC, end)
    lo, hi = sessions[start_k], sessions[end_k]
    bench = ev.benchmarks(sessions, series, universe, start_k, end_k, extra_holds=())
    spy_curve = ev.hold_curve(sessions, series['SPY'], start_k, end_k)
    ctx = {'sessions': sessions, 'series': series, 'actions': md['actions'], 'start_k': start_k, 'end_k': end_k,
           'bench': bench, 'spy_curve': spy_curve, 'spy_rets': ng.daily_returns(spy_curve)}
    kw = {'first_signal': sessions[start_k - 1], 'last_exec': end}
    b0 = cand.momentum_quality_decisions(sessions, series, members, **kw)
    results, status = {}, {}
    results[ng.B0] = evaluate_candidate(ng.B0, b0, ctx)
    b0_cont = _sim(sessions, series, md['actions'], b0, start_k, end_k, cost=10, halt=False)
    ctx['b0_rets'] = ng.daily_returns(b0_cont['curve'])
    regime = ng.spy_regime(series['SPY'], len(sessions))
    results['mq-recovery-v1'] = evaluate_candidate('mq-recovery-v1', b0, ctx, recovery=dict(ng.RECOVERY, regime=regime))
    buffer = ng.buffer_decisions(sessions, series, members, **kw)
    results['mq-buffer-v1'] = evaluate_candidate('mq-buffer-v1', buffer, ctx)
    results['mq-invvol-v1'] = evaluate_candidate('mq-invvol-v1', ng.invvol_decisions(sessions, series, members, **kw), ctx)
    results['mq-wide10-v1'] = evaluate_candidate('mq-wide10-v1', ng.wide_decisions(sessions, series, members, **kw), ctx)
    # V4: point-in-time fundamentals
    last_q = filings.last_complete_quarter(now.date().isoformat())
    facts, fprov, events, qprov, qmissing = load_filings(store, symbols, last_q)
    fund = lambda s, cutoff: filings.fundamentals_at(facts[s], cutoff) if s in facts else None
    fq, coverage = ng.fquality_decisions(sessions, series, members, fund, **kw)
    status['mq-fquality-v1'] = {'top20_score_coverage': coverage, 'symbols_with_facts': len(facts)}
    if coverage >= ng.QUALITY_MIN_COVERAGE:
        results['mq-fquality-v1'] = evaluate_candidate('mq-fquality-v1', fq, ctx)
        results['mq-fquality-v1']['picks_changed_vs_b0'] = picks_changed(fq, b0)
    else:
        status['mq-fquality-v1']['status'] = 'BLOCKED_BY_POINT_IN_TIME_DATA'
    # V5: Form 4 insider purchases
    purchases, attribution = filings.qualifying_purchases(events)
    coverage_end = None
    if not qmissing and qprov:
        y, q = int(last_q[:4]), int(last_q[-1])
        coverage_end = f'{y}-{3 * q:02d}-{[31, 30, 30, 31][q - 1]}'
    status['insider'] = {'quarters': len(qprov), 'missing_quarters': qmissing, 'coverage_end': coverage_end, 'attribution': attribution}
    if qmissing or not qprov:
        for sid in ('insider-only-v1', 'mq-insider-tiebreak-v1', 'mq-insider-filter-v1'):
            status[sid] = {'status': 'BLOCKED_BY_POINT_IN_TIME_DATA', 'missing_quarters': qmissing}
    else:
        for sid, mode in (('insider-only-v1', 'only'), ('mq-insider-tiebreak-v1', 'tiebreak'), ('mq-insider-filter-v1', 'filter')):
            d = ng.insider_decisions(sessions, series, members, purchases, mode, coverage_end=coverage_end, **kw)
            results[sid] = evaluate_candidate(sid, d, ctx)
            results[sid]['picks_changed_vs_b0'] = picks_changed(d, b0)
            results[sid]['decisions_beyond_coverage'] = sum(1 for x in d if x['meta'].get('beyond_coverage'))
    # Integrated challenger only if V2 and V4 each beat B0's 10 bps continuous Sharpe.
    s = lambda sid: results.get(sid, {}).get('result', {}).get('bps10', {}).get('continuous', {}).get('full', {}).get('sharpe')
    cond = all(s(x) is not None and s(x) > s(ng.B0) for x in ('mq-buffer-v1', 'mq-fquality-v1'))
    status[ng.INTEGRATED] = {'evaluated': cond}
    if cond:
        integ, _ = ng.fquality_decisions(sessions, series, members, fund, buffer=True, **kw)
        results[ng.INTEGRATED] = evaluate_candidate(ng.INTEGRATED, integ, ctx)
    qualifying = [k for k, v in results.items() if k != ng.B0 and v['gates']['verdict'] == 'QUALIFIES FOR INDEPENDENT REVIEW']
    out = {'kind': 'nextgen-historical', 'prereg': ng.PREREG, 'at': cli.stamp(now), 'window': [lo, hi], 'capital': ev.CAPITAL,
           'overall': 'QUALIFIES FOR INDEPENDENT REVIEW: ' + ', '.join(qualifying) if qualifying else 'NONE QUALIFIES',
           'results': results, 'status': status, 'benchmarks': bench,
           'spy_hold_extra': ng.extra_metrics(spy_curve, spy_curve, [1.0] * (len(spy_curve) - 1)),
           'data': {k: md[k] for k in ('fingerprint', 'actions_pages_fingerprint', 'joins', 'missing', 'requests', 'actions_dropped')}
           | {'sessions': [md['sessions'][0], md['sessions'][-1]], 'symbols_with_bars': len(md['bars']),
              'fundamentals': fprov, 'form345_quarters': qprov},
           'fingerprints': {'code_commit': os.getenv('GITHUB_SHA', 'local'), 'universe_revision': universe.get('revision'),
                            'prereg_sha256': filings.sha256((cli.ROOT / ng.PREREG).read_bytes())}}
    path = cli.write_new(data / 'results' / f"nextgen-historical-{cli.stamp(now).replace(':', '')}.json", out)
    cli.append_run(data, {'command': 'nextgen-historical', 'at': cli.stamp(now), 'overall': out['overall'], 'file': str(path),
                          'dataset_fingerprint': md['fingerprint']})
    return out


# ---------------------------------------------------------------- report

def _p(x, d=1):
    return '—' if x is None else f'{x * 100:.{d}f}%'


def _n(x, d=2):
    return '—' if x is None else f'{x:.{d}f}'


def render(out: dict) -> str:
    L = [f"# Next-generation slate: historical results ({out['window'][0]} to {out['window'][1]})", '',
         f"Pre-registration: `{out['prereg']}` · overall: **{out['overall']}** · dataset `{out['data']['fingerprint'][:16]}` · "
         f"code `{out['fingerprints']['code_commit'][:8]}`", '',
         'Exploratory: this window was already inspected. Universe is survivorship-biased. Research only.', '']
    spy = out['benchmarks']['spy-hold']['full']
    L += [f"SPY buy-and-hold: CAGR {_p(spy.get('cagr'))}, Sharpe {_n(spy.get('sharpe'))}, max DD {_p(spy.get('max_drawdown'))}", '',
          '| Candidate | Path | Cost | CAGR | Total | Sharpe | Sortino | Max DD | Worst month | Beta | Alpha/yr | Turnover/yr | Exposure | Time in cash | Costs paid | Halts |',
          '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for sid, r in out['results'].items():
        for c in ng.COSTS:
            for path, x in r['result'][f'bps{c}'].items():
                f = x['full']
                L.append(f"| {sid} | {path} | {c} | {_p(f.get('cagr'))} | {_p(f.get('total'), 0)} | {_n(f.get('sharpe'))} | {_n(x.get('sortino'))} | "
                         f"{_p(f.get('max_drawdown'))} | {_p(x.get('worst_month'))} | {_n(x.get('beta'))} | {_p(x.get('alpha_annual'))} | "
                         f"{_n(x['turnover_per_year'], 1)}x | {_p(x['avg_exposure'], 0)} | {_p(x.get('time_in_cash'), 0)} | "
                         f"${x['costs']:,.0f} | {len(x['halts'])} |")
    L += ['', '| Candidate | Judged path | Gates verdict | Failed gates | Original nine | Matched SPY v2 CAGR | CAGR 90% CI | Sharpe 90% CI | Sharpe − SPY 90% CI | Sharpe − B0 90% CI | $1,000 CAGR (unfilled for cash) |',
          '|---|---|---|---|---|---|---|---|---|---|---|']
    ci = lambda b: '—' if not b else f"{_n(b['p05'])} to {_n(b['p95'])}"
    cip = lambda b: '—' if not b else f"{_p(b['p05'])} to {_p(b['p95'])}"
    for sid, r in out['results'].items():
        b = r['bootstrap_10bps']
        failed = [k for k, v in r['gates']['gates'].items() if not v]
        sm = r['capital_1000_10bps']
        L.append(f"| {sid} | {r['judged_path']} | {r['gates']['verdict']} | {', '.join(failed) or 'none'} | {r['original_nine']['verdict']} | "
                 f"{_p(r['matched_spy_v2']['full'].get('cagr'))} | {cip(b['cagr'])} | {ci(b['sharpe'])} | {ci(b['sharpe_minus_spy'])} | "
                 f"{ci(b['sharpe_minus_b0'])} | {_p(sm['full'].get('cagr'))} ({sm['unfilled_cash']}) |")
    L += ['', '## Status of blocked or conditional candidates', '', '```', json.dumps(out['status'], indent=1, default=str)[:6000], '```']
    return '\n'.join(L) + '\n'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=('collect', 'historical', 'report'))
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--end', default=ev.END)
    a = p.parse_args()
    now = cli.now_utc()
    a.data.mkdir(parents=True, exist_ok=True)
    if a.command == 'collect':
        print(json.dumps(collect(a.data, now)))
    elif a.command == 'historical':
        out = historical(a.data, a.end, now)
        text = render(out)
        (a.data / 'reports').mkdir(parents=True, exist_ok=True)
        rp = a.data / 'reports' / f"nextgen-{cli.stamp(now).replace(':', '')}.md"
        if rp.exists():
            raise FileExistsError(str(rp))
        rp.write_text(text, encoding='utf-8')
        print(text)


if __name__ == '__main__':
    main()
