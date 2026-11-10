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

def forward_end_time(now: datetime) -> str:
    """Forward runs read bars up to 20 minutes ago: a date-only end means the whole New York day, which is still in
    the future during the nightly run, and the free plan refuses SIP requests reaching the last 15 minutes."""
    return (now.astimezone(timezone.utc) - timedelta(minutes=20)).strftime('%Y-%m-%dT%H:%M:%SZ')


def market_data(source, symbols: set, start: str, end: str, late_asof: dict, end_time: str | None = None) -> dict:
    """Bars, sessions and actions, with renamed members joined and delisted names refetched as of their date."""
    requested, rejected = rdata.market_symbols(symbols)
    symbols = set(requested)
    sessions = rdata.fetch_calendar(source, start, end)
    bars = rdata.fetch_bars(source, requested, start, end, asof=end, end_time=end_time)
    pages = rdata.fetch_actions(source, sorted(symbols), start, end)
    actions, dropped = rdata.validate_actions(bars, rdata.normalize_actions(pages))  # entity check (ticker reuse)
    renamed = {a['new_symbol'] for a in actions if a['kind'] == 'name_change' and a['symbol'] in symbols} - set(bars)
    if renamed:
        bars |= rdata.fetch_bars(source, sorted(renamed), start, end, asof=end, end_time=end_time)
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


# ---------------------------------------------------------------- daily strategies (docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md)

DAILY_PREREG = 'docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md'
DAILY_FIRST_SIGNAL = '2026-11-09'   # first forward signal close; first simulated trades at the 2026-11-10 open
DAILY_FORWARD_MIN_SESSIONS = 252


def _daily_market(members, start: str, end: str, end_time: str | None = None):
    symbols = {m['symbol'] for m in members} | {'SPY'}
    md = market_data(alpaca(), symbols, start, end, {}, end_time=end_time)
    sessions, series = rdata.assemble(md['sessions'], md['bars'])
    return md, sessions, series


def cmd_daily_historical(data: Path, out_dir: Path, end: str, now: datetime) -> dict:
    universe, members = universe_members()
    md, sessions, series = _daily_market(members, ev.DATA_START, end)
    start_k, end_k = ev.window(sessions, ev.FIRST_EXEC, end)
    bench = ev.benchmarks(sessions, series, universe, start_k, end_k, extra_holds=())
    results, verdicts, matched = {}, {}, {}
    for sid in cand.DAILY_IDS:
        d = cand.daily_decisions(sid, sessions, series, members, first_signal=sessions[start_k - 1], last_exec=end)
        res = ev.run_candidate(sessions, series, md['actions'], d, start_k, end_k)
        exp = res['bps10']['continuous']['exposure_series']
        matched[sid] = ev.summarize(ev.exposure_matched(sessions, series['SPY'], exp, start_k, end_k), sessions[start_k], sessions[end_k])
        verdicts[sid] = ev.verdict(res, bench, matched[sid])
        res['decisions'] = len(d)
        res['last_decisions'] = [{'date': sessions[x['signal_index']], 'targets': x['targets']} for x in d[-5:]]
        results[sid] = ev.strip_series(res)
    passing = [s for s, v in verdicts.items() if v['verdict'] == 'QUALIFIES FOR REVIEW']
    out = {'kind': 'daily-historical', 'at': stamp(now), 'prereg': DAILY_PREREG, 'window': [sessions[start_k], sessions[end_k]],
           'capital': ev.CAPITAL, 'overall': 'QUALIFIES FOR REVIEW: ' + ', '.join(passing) if passing else 'NONE QUALIFIES',
           'verdicts': verdicts, 'results': results, 'benchmarks': bench, 'exposure_matched_spy': matched,
           'data': {k: md[k] for k in ('fingerprint', 'actions_pages_fingerprint', 'joins', 'missing', 'requests', 'actions_dropped')}
           | {'sessions': [md['sessions'][0], md['sessions'][-1]], 'symbols_with_bars': len(md['bars'])},
           'fingerprints': {'code_commit': os.getenv('GITHUB_SHA', 'local'), 'universe_revision': universe.get('revision')}}
    path = write_new(out_dir / f"daily-historical-{stamp(now).replace(':', '')}.json", out)
    append_run(data, {'command': 'daily-historical', 'at': stamp(now), 'overall': out['overall'], 'file': str(path),
                      'dataset_fingerprint': md['fingerprint']})
    return out


def cmd_daily_forward(data: Path, out_dir: Path, today: str, now: datetime) -> dict:
    universe, members = universe_members()
    start = (date.fromisoformat(DAILY_FIRST_SIGNAL) - timedelta(days=150)).isoformat()
    md, sessions, series = _daily_market(members, start, today, end_time=forward_end_time(now))
    ledgers = {}
    end_k = len(sessions) - 1
    for sid in cand.DAILY_IDS:
        d = cand.daily_decisions(sid, sessions, series, members, first_signal=DAILY_FIRST_SIGNAL, last_exec=today)
        if not d:
            ledgers[sid] = {'status': 'NOT STARTED', 'reason': 'first simulated trades are at the open after the first signal close',
                            'first_signal': DAILY_FIRST_SIGNAL}
            continue
        first = d[0]['signal_index'] + 1
        res = ev.run_candidate(sessions, series, md['actions'], d, first, end_k)
        bench = {'spy-hold': ev.summarize(ev.hold_curve(sessions, series['SPY'], first, end_k), sessions[first], sessions[end_k])}
        n = end_k - first + 1
        ledgers[sid] = {'status': 'INSUFFICIENT FORWARD SAMPLE' if n < DAILY_FORWARD_MIN_SESSIONS else 'READY FOR PRE-REGISTERED FORWARD REVIEW',
                        'first_execution': sessions[first], 'sessions': n,
                        'decisions': [{'date': sessions[x['signal_index']], 'targets': x['targets']} for x in d],
                        'result': ev.strip_series(res), 'benchmarks': bench}
    out = {'kind': 'daily-forward', 'at': stamp(now), 'prereg': DAILY_PREREG, 'latest_session': sessions[end_k] if sessions else None,
           'ledgers': ledgers, 'data': {k: md[k] for k in ('fingerprint', 'joins', 'missing', 'requests', 'actions_dropped', 'symbols_rejected')}}
    path = write_new(out_dir / f"daily-forward-{stamp(now).replace(':', '')}.json", out)
    append_run(data, {'command': 'daily-forward', 'at': stamp(now), 'file': str(path),
                      'status': {s: v['status'] for s, v in ledgers.items()}})
    return out


# ---------------------------------------------------------------- spy-tom-v1 (docs/STOCK_TOM_PREREG_2026_11_10.md)

TOM_PREREG = 'docs/STOCK_TOM_PREREG_2026_11_10.md'
TOM_FIRST_SIGNAL = '2026-11-10'
TOM_FORWARD_MIN_WINDOWS = 24


def break_even(res: dict, target_cagr: float) -> float | None:
    """Per-side cost (bps) at which the continuous CAGR falls to `target_cagr`, by linear interpolation on the
    evaluated grid (0/5/10/25). None when it stays above the target through 25 bps; 0.0 when already below gross."""
    pts = [(c, res[f'bps{c}']['continuous']['full']['cagr']) for c in ev.COSTS]
    if pts[0][1] is None or pts[0][1] <= target_cagr:
        return 0.0
    for (c0, y0), (c1, y1) in zip(pts, pts[1:]):
        if y1 is not None and y1 <= target_cagr < y0:
            return round(c0 + (y0 - target_cagr) * (c1 - c0) / (y0 - y1), 2)
    return None


def _tom_calendar(start: str, end: str) -> list[str]:
    # The exchange calendar is published years ahead; reading it past `end` is not look-ahead.
    return rdata.fetch_calendar(alpaca(), start, (date.fromisoformat(end) + timedelta(days=15)).isoformat())


def cmd_tom_historical(data: Path, out_dir: Path, end: str, now: datetime) -> dict:
    universe, members = universe_members()
    md, sessions, series = _daily_market(members, ev.DATA_START, end)
    calendar = _tom_calendar(ev.DATA_START, end)
    start_k, end_k = ev.window(sessions, ev.FIRST_EXEC, end)
    bench = ev.benchmarks(sessions, series, universe, start_k, end_k, extra_holds=())
    d = cand.tom_decisions(sessions, calendar, first_signal=sessions[start_k - 1], last_exec=end)
    res = ev.run_candidate(sessions, series, md['actions'], d, start_k, end_k)
    exp = res['bps10']['continuous']['exposure_series']
    matched = ev.summarize(ev.exposure_matched(sessions, series['SPY'], exp, start_k, end_k), sessions[start_k], sessions[end_k])
    verdict = ev.verdict(res, bench, matched)
    windows = sum(1 for a, b in zip(d, d[1:]) if not a['targets'] and b['targets'])
    out = {'kind': 'tom-historical', 'at': stamp(now), 'prereg': TOM_PREREG, 'id': cand.TOM_ID,
           'window': [sessions[start_k], sessions[end_k]], 'capital': ev.CAPITAL,
           'overall': 'QUALIFIES FOR REVIEW: ' + cand.TOM_ID if verdict['verdict'] == 'QUALIFIES FOR REVIEW' else 'NONE QUALIFIES',
           'verdict': verdict, 'result': ev.strip_series(res), 'benchmarks': bench, 'exposure_matched_spy': matched,
           'break_even_bps': {'to_zero_cagr': break_even(res, 0.0), 'to_exposure_matched_spy': break_even(res, matched['full']['cagr'])},
           'windows_entered': windows, 'decisions': len(d),
           'data': {k: md[k] for k in ('fingerprint', 'actions_pages_fingerprint', 'joins', 'missing', 'requests', 'actions_dropped')}
           | {'sessions': [md['sessions'][0], md['sessions'][-1]], 'symbols_with_bars': len(md['bars']),
              'calendar_fingerprint': rdata.fingerprint(calendar)},
           'fingerprints': {'code_commit': os.getenv('GITHUB_SHA', 'local'), 'universe_revision': universe.get('revision')}}
    path = write_new(out_dir / f"tom-historical-{stamp(now).replace(':', '')}.json", out)
    append_run(data, {'command': 'tom-historical', 'at': stamp(now), 'overall': out['overall'], 'file': str(path),
                      'dataset_fingerprint': md['fingerprint']})
    return out


def cmd_tom_forward(data: Path, out_dir: Path, today: str, now: datetime) -> dict:
    universe, members = universe_members()
    start = (date.fromisoformat(TOM_FIRST_SIGNAL) - timedelta(days=60)).isoformat()
    md, sessions, series = _daily_market([], start, today, end_time=forward_end_time(now))
    calendar = _tom_calendar(start, today)
    d = cand.tom_decisions(sessions, calendar, first_signal=TOM_FIRST_SIGNAL, last_exec=today)
    entered = sum(1 for a, b in zip(d, d[1:]) if not a['targets'] and b['targets'])
    if not d:
        led = {'status': 'NOT STARTED', 'first_signal': TOM_FIRST_SIGNAL}
    else:
        first, end_k = d[0]['signal_index'] + 1, len(sessions) - 1
        res = ev.run_candidate(sessions, series, md['actions'], d, first, end_k)
        led = {'status': 'INSUFFICIENT FORWARD SAMPLE' if entered < TOM_FORWARD_MIN_WINDOWS else 'READY FOR PRE-REGISTERED FORWARD REVIEW',
               'first_execution': sessions[first], 'sessions': end_k - first + 1, 'windows_entered': entered,
               'last_target': d[-1]['targets'], 'result': ev.strip_series(res),
               'spy_hold': ev.summarize(ev.hold_curve(sessions, series['SPY'], first, end_k), sessions[first], sessions[end_k])}
    out = {'kind': 'tom-forward', 'at': stamp(now), 'prereg': TOM_PREREG, 'id': cand.TOM_ID,
           'latest_session': sessions[-1] if sessions else None, 'ledger': led,
           'data': {k: md[k] for k in ('fingerprint', 'missing', 'requests', 'symbols_rejected')}}
    path = write_new(out_dir / f"tom-forward-{stamp(now).replace(':', '')}.json", out)
    append_run(data, {'command': 'tom-forward', 'at': stamp(now), 'file': str(path), 'status': led['status']})
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
    md = market_data(alpaca(), symbols, start, today, {}, end_time=forward_end_time(now))
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
    from .summary import build_summary
    hist, fwd = latest(data / 'results', 'historical'), latest(data / 'results', 'forward')
    text = render(hist, fwd, store)
    runs = [json.loads(line) for line in (data / 'runs.jsonl').read_text().splitlines() if line.strip()] if (data / 'runs.jsonl').exists() else []
    summary = build_summary(hist, fwd, store.manifest(), runs, stamp(now))
    from .summary import build_daily
    summary['daily'] = build_daily(latest(data / 'results', 'daily-historical'), latest(data / 'results', 'daily-forward'))
    (data / 'summary.json').write_text(json.dumps(summary, indent=1, sort_keys=True), encoding='utf-8')
    path = data / 'reports' / f"{stamp(now)[:10]}-{stamp(now)[11:19].replace(':', '')}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    (data / 'reports' / 'LATEST.md').write_text(text, encoding='utf-8')
    return path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=('collect', 'historical', 'forward', 'daily-historical', 'daily-forward', 'tom-historical', 'tom-forward', 'report'))
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
    elif a.command == 'daily-historical':
        out = cmd_daily_historical(a.data, a.data / 'results', a.end, now)
        print(json.dumps({'overall': out['overall'], 'verdicts': {k: v['verdict'] for k, v in out['verdicts'].items()},
                          'dataset_fingerprint': out['data']['fingerprint']}))
    elif a.command == 'daily-forward':
        out = cmd_daily_forward(a.data, a.data / 'results', (now - timedelta(days=1)).date().isoformat(), now)
        print(json.dumps({'latest_session': out['latest_session'], 'ledgers': {s: {k: l.get(k) for k in ('status', 'sessions', 'first_execution')}
                                                                                for s, l in out['ledgers'].items()}}))
    elif a.command == 'tom-historical':
        out = cmd_tom_historical(a.data, a.data / 'results', a.end, now)
        print(json.dumps({'overall': out['overall'], 'verdict': out['verdict']['verdict'], 'break_even_bps': out['break_even_bps'],
                          'dataset_fingerprint': out['data']['fingerprint']}))
    elif a.command == 'tom-forward':
        out = cmd_tom_forward(a.data, a.data / 'results', (now - timedelta(days=1)).date().isoformat(), now)
        print(json.dumps({'latest_session': out['latest_session'], 'status': out['ledger']['status']}))
    else:
        path = cmd_report(a.data, now)
        print(path.read_text())


if __name__ == '__main__':
    main()
