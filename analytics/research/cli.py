"""SportsEdge research runner. Commands: collect, historical, forward, report.

Every command reads and writes an append-only data directory (the `research-data` branch in CI). Market
data comes from Alpaca with the existing paper key pair (environment variables, never arguments);
SEC requests carry the User-Agent from the SEC_EDGAR_USER_AGENT secret. Nothing here trades.
"""
from __future__ import annotations
import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path

from . import candidates as cand
from . import data as rdata
from . import evaluate as ev
from . import figi, qmom, registry, sec13f
from .fetch import Fetcher
from .store import SnapshotStore

ROOT = Path(__file__).resolve().parents[2]
UNIVERSE = ROOT / 'config' / 'paper-auto' / 'universe-large-cap-v1.json'
PUBLIC_UA = 'SportsEdge-research-collector/1.0 (+https://github.com/ang87505-crypto/SportsEdge)'
CANDIDATES = ('momentum-quality-paper-v1', 'qmom-disclosure-follower-v1', 'berkshire-13f-top5-paper-v1')
MAP_DEPTH = 15  # CUSIPs mapped per filing: enough to fill five eligible names


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def stamp(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def write_new(path: Path, obj) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError(str(path))
    path.write_text(json.dumps(obj, indent=1, sort_keys=True, default=str), encoding='utf-8')
    return path


def append_run(data: Path, row: dict):
    with open(data / 'runs.jsonl', 'a', encoding='utf-8') as fh:
        fh.write(json.dumps(row, sort_keys=True, default=str) + '\n')


# ---------------------------------------------------------------- collect

def filings_and_mapping(store, fetcher=None, now=None) -> tuple[list, dict]:
    filings = sec13f.stored_filings(store)
    cusips = []
    for f in filings:
        known = sec13f.known_portfolio(filings, f['accepted_at'])
        if known:
            cusips += [h['cusip'] for h in known['holdings'][:MAP_DEPTH]]
    mapping = figi.map_cusips(fetcher, store, sorted(set(cusips)), now) if fetcher else figi.cached_mappings(store)
    return filings, mapping


def cmd_collect(data: Path, now: datetime) -> dict:
    store = SnapshotStore(data)
    reg = registry.load()
    src = {s['id']: s for s in reg['sources']}
    out = {}
    web = Fetcher(user_agent=PUBLIC_UA, min_interval={'funds.alphaarchitect.com': src['qmom-holdings']['min_interval_seconds'],
                                                       'api.openfigi.com': src['openfigi-cusip']['min_interval_seconds']},
                  cache_dir=data / '.cache')
    out['qmom'] = qmom.collect(web, store, now)['status']
    ua = os.getenv('SEC_EDGAR_USER_AGENT', '').strip() or None
    sec = Fetcher(user_agent=ua or 'unset', min_interval={'data.sec.gov': 0.25, 'www.sec.gov': 0.25})
    line = sec13f.collect(sec, store, now, user_agent=ua)
    out['sec'] = line['status']
    out['sec_new_filings'] = len(line.get('summary', {}).get('new_filings', []))
    if ua:
        _, mapping = filings_and_mapping(store, web, now)
        out['cusips_mapped'] = sum(1 for m in mapping.values() if m.get('ticker'))
        out['cusips_unmapped'] = sum(1 for m in mapping.values() if not m.get('ticker'))
    append_run(data, {'command': 'collect', 'at': stamp(now), 'result': out, 'requests': web.count + sec.count})
    return out


# ---------------------------------------------------------------- market data

def market_data(source, symbols: set, start: str, end: str, late_asof: dict) -> dict:
    """Bars, sessions and actions, with renamed members joined and delisted names refetched as of their date."""
    requested, rejected = rdata.market_symbols(symbols)
    symbols = set(requested)
    sessions = rdata.fetch_calendar(source, start, end)
    bars = rdata.fetch_bars(source, requested, start, end, asof=end)
    pages = rdata.fetch_actions(source, sorted(symbols), start, end)
    actions, dropped = rdata.validate_actions(bars, rdata.normalize_actions(pages))  # entity check (ticker reuse)
    renamed = {a['new_symbol'] for a in actions if a['kind'] == 'name_change' and a['symbol'] in symbols} - set(bars)
    if renamed:
        bars |= rdata.fetch_bars(source, sorted(renamed), start, end, asof=end)
    refetched = {}
    for sym in sorted(symbols - set(bars)):
        if sym in late_asof:
            got = rdata.fetch_bars(source, [sym], start, end, asof=late_asof[sym])
            if sym in got:
                bars[sym] = got[sym]
                refetched[sym] = late_asof[sym]
    bars, actions, joins = rdata.join_renamed(bars, actions, symbols)
    dataset = {'sessions': sessions, 'bars': bars, 'actions': actions}
    return {'sessions': sessions, 'bars': bars, 'actions': actions, 'joins': joins, 'refetched_as_of': refetched,
            'actions_dropped': dropped, 'symbols_rejected': rejected,
            'missing': sorted(symbols - set(bars)), 'fingerprint': rdata.fingerprint(dataset),
            'actions_pages_fingerprint': rdata.fingerprint(pages), 'requests': source.count}


def alpaca():
    from analytics.stock_forward_bridge_v1 import Source
    return Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''), max_requests=3000)


def universe_members() -> tuple[dict, list[dict]]:
    u = json.loads(UNIVERSE.read_text(encoding='utf-8'))
    return u, [{'symbol': s['symbol'], 'sector': s['sector']} for s in u['securities']]


def brk_symbols(filings, mapping) -> dict:
    """Mapped tickers that could be picked, with the first date each could be needed (for delisted refetches)."""
    out = {}
    for f in filings:
        known = sec13f.known_portfolio(filings, f['accepted_at'])
        for h in (known or {}).get('holdings', [])[:MAP_DEPTH]:
            t = (mapping.get(h['cusip']) or {}).get('ticker')
            if t and t not in out:
                out[t] = sec13f.acceptance_ny_date(f['accepted_at'])
    return out


# ---------------------------------------------------------------- historical

def cmd_historical(data: Path, out_dir: Path, end: str, now: datetime) -> dict:
    store = SnapshotStore(data)
    reg = registry.load()
    universe, members = universe_members()
    filings, mapping = filings_and_mapping(store)
    brk = brk_symbols(filings, mapping)
    symbols = {m['symbol'] for m in members} | {'SPY', 'QMOM', 'BRK.B'} | set(brk)
    md = market_data(alpaca(), symbols, ev.DATA_START, end, brk)
    sessions, series = rdata.assemble(md['sessions'], md['bars'])
    start_k, end_k = ev.window(sessions, ev.FIRST_EXEC, end)
    has = lambda sym, k: sym in series and series[sym]['c'][k] is not None
    results, verdicts = {}, {}
    bench = ev.benchmarks(sessions, series, universe, start_k, end_k)
    decs = {'momentum-quality-paper-v1': cand.momentum_quality_decisions(
                sessions, series, members, first_signal=sessions[start_k - 1], last_exec=end)}
    if filings:
        decs['berkshire-13f-top5-paper-v1'] = cand.berkshire_decisions(sessions, filings, mapping, has,
                                                                       first_exec=sessions[start_k], last_exec=end)
    matched = {}
    for sid, d in decs.items():
        res = ev.run_candidate(sessions, series, md['actions'], d, start_k, end_k)
        exp = res['bps10']['continuous']['exposure_series']
        matched[sid] = ev.summarize(ev.exposure_matched(sessions, series['SPY'], exp, start_k, end_k), sessions[start_k], sessions[end_k])
        verdicts[sid] = ev.verdict(res, bench, matched[sid])
        res['decision_log'] = [{'date': sessions[x['signal_index']], 'label': x['label'], 'targets': x['targets'],
                                'meta': {k: v for k, v in x['meta'].items() if k != 'dropped'}} for x in d]
        results[sid] = ev.strip_series(res)
    passing = [s for s, v in verdicts.items() if v['verdict'] == 'QUALIFIES FOR REVIEW']
    out = {'kind': 'historical', 'at': stamp(now), 'window': [sessions[start_k], sessions[end_k]], 'capital': ev.CAPITAL,
           'overall': 'QUALIFIES FOR REVIEW: ' + ', '.join(passing) if passing else 'NONE QUALIFIES',
           'not_evaluated_historically': {'qmom-disclosure-follower-v1': 'no reliable historical holdings snapshots; forward only'}
           | ({} if filings else {'berkshire-13f-top5-paper-v1': 'no SEC filings collected (SEC_EDGAR_USER_AGENT not configured)'}),
           'verdicts': verdicts, 'results': results, 'benchmarks': bench, 'exposure_matched_spy': matched,
           'data': {k: md[k] for k in ('fingerprint', 'actions_pages_fingerprint', 'joins', 'refetched_as_of', 'missing', 'requests',
                                       'actions_dropped')}
           | {'sessions': [md['sessions'][0], md['sessions'][-1]], 'symbols_with_bars': len(md['bars']), 'actions': len(md['actions'])},
           'sources': {'sec_filings': [{'accession': f['accession'], 'accepted_at': f['accepted_at'], 'form': f['form'],
                                        'period': f['primary']['period']} for f in filings],
                       'cusip_mapping': mapping},
           'fingerprints': registry.fingerprints(reg) | {'code_commit': os.getenv('GITHUB_SHA', 'local')}}
    path = write_new(out_dir / f"historical-{stamp(now).replace(':', '')}.json", out)
    append_run(data, {'command': 'historical', 'at': stamp(now), 'overall': out['overall'], 'file': str(path),
                      'dataset_fingerprint': md['fingerprint']})
    return out


# ---------------------------------------------------------------- forward ledgers

def qmom_snapshots(store) -> list[dict]:
    out = []
    for m in store.manifest():
        if m['source_id'] == qmom.SOURCE_ID and m.get('path') and m['status'] in ('OK', 'STALE', 'INCOMPLETE'):
            p = store.load(m['path'])['parsed'] or {}
            out.append({'retrieved_at': m['retrieved_at'], 'effective_date': p.get('effective_date'), 'rows': p.get('rows', []),
                        'status': m['status']})
    return out


def cmd_forward(data: Path, out_dir: Path, today: str, now: datetime) -> dict:
    store = SnapshotStore(data)
    universe, members = universe_members()
    filings, mapping = filings_and_mapping(store)
    snaps = qmom_snapshots(store)
    follower_syms = {r['ticker'].replace('/', '.') for s in snaps if s['status'] == 'OK' for r in s['rows']
                     if r.get('equity_symbol', True)}
    brk = brk_symbols(filings, mapping)
    symbols = {m['symbol'] for m in members} | {'SPY', 'QMOM', 'BRK.B'} | follower_syms | set(brk)
    start = (date.fromisoformat(ev.FORWARD_START) - timedelta(days=400)).isoformat()
    md = market_data(alpaca(), symbols, start, today, {})
    sessions, series = rdata.assemble(md['sessions'], md['bars'])
    if not sessions or sessions[-1] < ev.FORWARD_START:
        out = {'kind': 'forward', 'at': stamp(now), 'status': 'NO_FORWARD_SESSIONS_YET', 'latest_session': sessions[-1] if sessions else None}
        append_run(data, {'command': 'forward', 'at': stamp(now), 'status': out['status']})
        return out
    start_k, end_k = ev.window(sessions, ev.FORWARD_START, today)
    has = lambda sym, k: sym in series and series[sym]['c'][k] is not None
    decs = {'momentum-quality-paper-v1': cand.momentum_quality_decisions(sessions, series, members,
                                                                         first_signal=ev.FORWARD_START, last_exec=today),
            'qmom-disclosure-follower-v1': cand.qmom_follower_decisions(sessions, snaps, has, last_exec=today),
            'berkshire-13f-top5-paper-v1': cand.berkshire_decisions(sessions, filings, mapping, has, first_exec=sessions[start_k],
                                                                    last_exec=today) if filings else []}
    ledgers = {}
    for sid, d in decs.items():
        if not d:
            ledgers[sid] = {'status': 'NOT STARTED', 'reason': 'no decision yet'}
            continue
        first = d[0]['signal_index'] + 1
        if first > end_k:
            ledgers[sid] = {'status': 'NOT STARTED', 'reason': 'first execution after the latest session',
                            'first_execution': sessions[first] if first < len(sessions) else None}
            continue
        res = ev.run_candidate(sessions, series, md['actions'], d, first, end_k)
        bench = ev.benchmarks(sessions, series, None, first, end_k)
        n = end_k - first + 1
        ledgers[sid] = {'status': ev.forward_status(sid, res, n), 'first_execution': sessions[first], 'sessions': n,
                        'decisions': [{'date': sessions[x['signal_index']], 'label': x['label'], 'targets': x['targets'],
                                       'meta': x['meta']} for x in d],
                        'result': ev.strip_series(res), 'benchmarks': bench}
    out = {'kind': 'forward', 'at': stamp(now), 'latest_session': sessions[end_k], 'ledgers': ledgers,
           'data': {k: md[k] for k in ('fingerprint', 'joins', 'missing', 'requests', 'actions_dropped', 'symbols_rejected')}}
    path = write_new(out_dir / f"forward-{stamp(now).replace(':', '')}.json", out)
    append_run(data, {'command': 'forward', 'at': stamp(now), 'file': str(path),
                      'status': {s: v['status'] for s, v in ledgers.items()}})
    return out


# ---------------------------------------------------------------- report

def latest(dir_: Path, prefix: str):
    files = sorted(dir_.glob(prefix + '-*.json'))
    return json.loads(files[-1].read_text()) if files else None


def health(store) -> list[str]:
    rows = store.manifest()
    L = ['| Source | Attempts | Last status | Last success | Failures |', '|---|---|---|---|---|']
    for sid in sorted({m['source_id'] for m in rows}):
        mine = [m for m in rows if m['source_id'] == sid]
        ok = [m for m in mine if m['status'] in ('OK', 'UNCHANGED')]
        bad = [m for m in mine if m['status'] in ('FETCH_FAILED', 'PARSE_FAILED', 'NOT_CONFIGURED', 'INCOMPLETE', 'STALE')]
        L.append(f"| {sid} | {len(mine)} | {mine[-1]['status']} | {ok[-1]['retrieved_at'] if ok else 'never'} | {len(bad)} |")
    return L


def render(hist: dict | None, fwd: dict | None, store) -> str:
    L = ['# SportsEdge stock research report', '',
         'Research only. No candidate is active and broker writes stay off. Pre-registration: '
         '`docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md`.', '', '## Source collection health', ''] + health(store)
    if hist:
        L += ['', f"## Historical evaluation ({hist['window'][0]} to {hist['window'][1]}, ${hist['capital']:,.0f})", '',
              f"**Overall: {hist['overall']}**", '',
              f"Dataset SHA-256 `{hist['data']['fingerprint']}`; code `{hist['fingerprints']['code_commit']}`; registry "
              f"`{hist['fingerprints']['registry'][:16]}…`. The 2017–2026 history was already inspected and the 136-stock "
              'universe is survivorship-biased: this is exploratory research data, not an untouched validation set.', '']
        for sid, why in hist['not_evaluated_historically'].items():
            L.append(f'- {sid}: not evaluated historically ({why}).')
        b = hist['benchmarks']
        L += ['', '| Comparison (same dates) | Cost/side | End value | CAGR | Sharpe | Max DD |', '|---|---|---|---|---|---|']
        for key, label in (('spy-hold', 'SPY buy-and-hold (dividends)'), ('brk.b-hold', 'Berkshire BRK.B'), ('qmom-hold', 'QMOM (market price, distributions)')):
            if key in b:
                f = b[key]['full']
                L.append(f"| {label} | none | ${f.get('end_value', 0):,.0f} | {_p(f.get('cagr'))} | {_n(f.get('sharpe'))} | {_p(f.get('max_drawdown'))} |")
        for c in ev.COSTS[1:]:
            f = b['weekly'][f'bps{c}']['full']
            L.append(f"| Weekly strategy ($1,000, ~half invested) | {c} bps | ${f.get('end_value', 0):,.0f} | {_p(f.get('cagr'))} | {_n(f.get('sharpe'))} | {_p(f.get('max_drawdown'))} |")
        for sid, res in hist['results'].items():
            v = hist['verdicts'][sid]
            m = hist['exposure_matched_spy'][sid]['full']
            L += ['', f'### {sid}: {v["verdict"]}', '',
                  f"Exposure-matched SPY (continuous, 10 bps exposure): CAGR {_p(m.get('cagr'))}, Sharpe {_n(m.get('sharpe'))}.", '']
            L += ev.candidate_table(sid, res)
            L += ['', '| Check (pre-registered) | Result |', '|---|---|'] + [f'| {k} | {"pass" if ok else "FAIL"} |' for k, ok in v['checks'].items()]
            x = res['bps10']['continuous']
            L += ['', f"Decisions {res['decisions']}; orders {x['orders']}, filled {x['filled']}, unfilled (gap {x['unfilled_gap']}, no bar "
                  f"{x['unfilled_missing']}, cash {x['unfilled_cash']}), reduced for cash {x['reduced_for_cash']}, unavailable targets "
                  f"{x['unavailable']}; dividends ${x['dividends']:,.0f}; unresolved {len(x['unresolved'])}; integrity mismatches "
                  f"{x['integrity_mismatches']}.", '', '| Year (continuous, 10 bps) | ' + ' | '.join(sorted(x['years'])) + ' |',
                  '|---|' + '---|' * len(x['years']), '| | ' + ' | '.join(_p(x['years'][y]) for y in sorted(x['years'])) + ' |']
    if fwd:
        L += ['', f"## Forward paper ledgers (latest session {fwd.get('latest_session')})", '']
        for sid, led in (fwd.get('ledgers') or {}).items():
            if 'result' not in led:
                L.append(f"- **{sid}**: {led['status']} ({led.get('reason')}).")
                continue
            x = led['result']['bps10']['continuous']
            spy = led['benchmarks']['spy-hold']['full']
            L.append(f"- **{sid}**: {led['status']}. Since {led['first_execution']} ({led['sessions']} sessions, "
                     f"{x['executions']} rebalances): total {_p(x['full'].get('total'))} at 10 bps vs SPY {_p(spy.get('total'))}.")
    return '\n'.join(L) + '\n'


_p, _n = ev._pct, ev._num


def cmd_report(data: Path, now: datetime) -> Path:
    store = SnapshotStore(data)
    text = render(latest(data / 'results', 'historical'), latest(data / 'results', 'forward'), store)
    path = data / 'reports' / f"{stamp(now)[:10]}-{stamp(now)[11:19].replace(':', '')}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    (data / 'reports' / 'LATEST.md').write_text(text, encoding='utf-8')
    return path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=('collect', 'historical', 'forward', 'report'))
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--end', default=ev.END)
    a = p.parse_args()
    now = now_utc()
    a.data.mkdir(parents=True, exist_ok=True)
    if a.command == 'collect':
        print(json.dumps(cmd_collect(a.data, now)))
    elif a.command == 'historical':
        out = cmd_historical(a.data, a.data / 'results', a.end, now)
        print(json.dumps({'overall': out['overall'], 'verdicts': {k: v['verdict'] for k, v in out['verdicts'].items()},
                          'dataset_fingerprint': out['data']['fingerprint']}))
    elif a.command == 'forward':
        # Through the last completed day only: Alpaca's free plan refuses the most recent SIP data, and a
        # session is only complete after its close. The nightly 02:17 UTC run therefore covers the prior session.
        out = cmd_forward(a.data, a.data / 'results', (now - timedelta(days=1)).date().isoformat(), now)
        print(json.dumps({k: v for k, v in out.items() if k in ('status', 'latest_session')} |
                         {'ledgers': {s: l['status'] for s, l in (out.get('ledgers') or {}).items()}}))
    else:
        path = cmd_report(a.data, now)
        print(path.read_text())


if __name__ == '__main__':
    main()
