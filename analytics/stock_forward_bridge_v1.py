"""Current-data bridge into the unchanged frozen forward signal (stock-forward-signal-v1).

Read-only GET requests to Alpaca's PAPER trading API (exchange calendar, active
assets) and market-data API (raw consolidated SIP daily bars, corporate actions)
are combined with two registered owner/Astra inputs that Alpaca cannot supply:
a security-master snapshot (security type, exchange, sector, first trading date)
and a corporate-action coverage attestation. The resulting envelope is passed,
unchanged, to analytics.stock_forward_signal_v1.forward_signal.

The frozen data contract needs two observations of every member's bars:
a REFERENCE capture before 08:00 New York proves each bar was available before
the decision, and a DECISION capture started at or after 08:00 and sealed within
60 seconds proves nothing visible at the decision is missing (stock_data_contract
refuses a dataset retrieved before the decision). A bar is used only when both
observations agree.

Each decision session yields exactly one record for the recurring controller:
TARGETS, HOLD_NO_TARGETS, MISSED (an observation outside its time window) or
INPUT_REJECTED (any missing, changed, contradictory or unsupported input, with
named reasons). Nothing is substituted, forward-filled, dropped or taken from
IEX. No orders, no database writes, and no network without --execute-network.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as clock_time, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from .stock_forward_signal_v1 import forward_signal, BASELINE, CANDIDATE

VERSION = 'stock-forward-bridge-v1'
DATA = 'https://data.alpaca.markets'
PAPER = 'https://paper-api.alpaca.markets'
NY = ZoneInfo('America/New_York')
EXCHANGES = ('NYSE', 'NASDAQ', 'AMEX')
SUPPORTED_ACTIONS = ('forward_splits', 'reverse_splits', 'cash_dividends')
CAPTURE_WINDOW = timedelta(seconds=60)
MAX_PAGE_BYTES = 20_000_000
REQUESTS_PER_MINUTE = 190  # below the free market-data plan's 200 per minute
SYMBOL = re.compile(r'[A-Z][A-Z0-9.-]{0,9}\Z')
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')


class Rejected(ValueError):
    """Inputs cannot faithfully reproduce the registered universe or evidence."""
    def __init__(self, reasons):
        super().__init__('; '.join(reasons))
        self.reasons = list(reasons)


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def sha256(value) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def stamp(value, name) -> datetime:
    if not isinstance(value, str) or 'T' not in value:
        raise Rejected([name + ': timezone-aware ISO timestamp required'])
    try:
        out = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise Rejected([name + ': invalid timestamp']) from None
    if out.tzinfo is None:
        raise Rejected([name + ': timezone required'])
    return out.astimezone(timezone.utc)


def day(value, name) -> date:
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise Rejected([name + ': YYYY-MM-DD required'])
    return date.fromisoformat(value)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def ny_at(d: date, hhmm: str) -> datetime:
    hour, minute = (int(x) for x in hhmm.split(':'))
    return datetime.combine(d, clock_time(hour, minute), NY).astimezone(timezone.utc)


def decimal_text(value, name) -> str:
    """Exact provider number as decimal text (at most six places); never rounded."""
    if type(value) not in (int, float, str):
        raise Rejected([name + ': numeric value required'])
    try:
        d = Decimal(str(value))
    except InvalidOperation:
        raise Rejected([name + ': invalid number']) from None
    if not d.is_finite() or d <= 0:
        raise Rejected([name + ': positive finite value required'])
    text = format(d.normalize(), 'f')
    if '.' in text and len(text.split('.')[1]) > 6:
        raise Rejected([name + ': more than six decimal places'])
    return text


# ---------------------------------------------------------------- calendar
def parse_calendar(rows) -> list[dict]:
    if not isinstance(rows, list) or not rows:
        raise Rejected(['CALENDAR_EMPTY'])
    sessions = []
    for r in rows:
        if not isinstance(r, dict) or not re.fullmatch(r'\d{2}:\d{2}', str(r.get('open'))) \
                or not re.fullmatch(r'\d{2}:\d{2}', str(r.get('close'))):
            raise Rejected(['CALENDAR_ROW_INVALID'])
        d = day(r.get('date'), 'calendar.date')
        op, cl = ny_at(d, r['open']), ny_at(d, r['close'])
        if d.weekday() > 4 or not op < cl:
            raise Rejected(['CALENDAR_ROW_INVALID'])
        sessions.append({'date': d.isoformat(), 'open_at': iso(op), 'close_at': iso(cl)})
    dates = [s['date'] for s in sessions]
    if dates != sorted(set(dates)):
        raise Rejected(['CALENDAR_UNORDERED_OR_DUPLICATE'])
    return sessions


def decision_point(sessions: list[dict], session: str):
    """(08:00 New York, index) on the first exchange session of a month, or None."""
    dates = [s['date'] for s in sessions]
    if session not in dates or dates.index(session) == 0:
        return None
    k = dates.index(session)
    if dates[k - 1][:7] == session[:7]:
        return None
    return ny_at(date.fromisoformat(session), '08:00'), k


# ---------------------------------------------------------------- registered inputs
def parse_master(master, decision_at: datetime):
    reasons = []
    if not isinstance(master, dict) or master.get('version') != 'sportsedge-security-master-v1':
        raise Rejected(['SECURITY_MASTER_MISSING_OR_UNREGISTERED_VERSION'])
    for k in ('source', 'revision', 'classification'):
        if not isinstance(master.get(k), str) or not master[k].strip():
            reasons.append('SECURITY_MASTER_FIELD_MISSING:' + k)
    if stamp(master.get('available_at'), 'security_master.available_at') >= decision_at:
        reasons.append('SECURITY_MASTER_NOT_AVAILABLE_BEFORE_DECISION')
    rows = master.get('securities')
    if not isinstance(rows, list) or not rows:
        raise Rejected(reasons + ['SECURITY_MASTER_EMPTY'])
    by_asset = {}
    for r in rows:
        if not isinstance(r, dict) or not UUID.fullmatch(str(r.get('alpaca_asset_id'))) \
                or not SYMBOL.fullmatch(str(r.get('symbol'))) \
                or not isinstance(r.get('type'), str) or not isinstance(r.get('exchange'), str) \
                or not isinstance(r.get('source_id'), str) or not r['source_id'].strip():
            raise Rejected(reasons + ['SECURITY_MASTER_ROW_INVALID'])
        if r['type'] == 'common_stock':
            if not isinstance(r.get('sector'), str) or not r['sector'].strip() or r['sector'] != r['sector'].strip():
                raise Rejected(reasons + ['SECURITY_MASTER_SECTOR_MISSING:' + r['symbol']])
            day(r.get('first_traded_on'), 'first_traded_on')
        if r['alpaca_asset_id'] in by_asset:
            raise Rejected(reasons + ['SECURITY_MASTER_DUPLICATE_ASSET'])
        by_asset[r['alpaca_asset_id']] = r
    if reasons:
        raise Rejected(reasons)
    # Content digest independent of row order; the registered file keeps its own hash.
    canonical_master = master | {'securities': sorted(rows, key=lambda r: r['alpaca_asset_id'])}
    return by_asset, iso(stamp(master['available_at'], 'available_at')), sha256(canonical_master)


def parse_attestation(att, decision_at: datetime, window_start: str, window_end: str):
    if not isinstance(att, dict) or att.get('version') != 'sportsedge-action-coverage-attestation-v1':
        raise Rejected(['ACTION_COVERAGE_NOT_ATTESTED'])
    if att.get('provider') != 'alpaca-corporate-actions-v1':
        raise Rejected(['ACTION_COVERAGE_PROVIDER_MISMATCH'])
    if not isinstance(att.get('attested_by'), str) or not att['attested_by'].strip():
        raise Rejected(['ACTION_COVERAGE_ATTESTER_MISSING'])
    if stamp(att.get('attested_at'), 'attested_at') >= decision_at:
        raise Rejected(['ACTION_COVERAGE_ATTESTED_AFTER_DECISION'])
    if day(att.get('coverage_start'), 'coverage_start').isoformat() > window_start \
            or day(att.get('coverage_end'), 'coverage_end').isoformat() < window_end:
        raise Rejected(['ACTION_COVERAGE_DOES_NOT_ENCLOSE_WINDOW'])
    return att['coverage_start'], att['coverage_end'], sha256(att)


# ---------------------------------------------------------------- provider pages
def candidates(assets) -> dict:
    """Active Alpaca US equities on the registered exchanges, keyed by asset id."""
    if not isinstance(assets, list):
        raise Rejected(['ASSETS_INVALID'])
    out, symbols = {}, set()
    for a in assets:
        if not isinstance(a, dict):
            raise Rejected(['ASSETS_INVALID'])
        if a.get('class') != 'us_equity' or a.get('status') != 'active' or a.get('exchange') not in EXCHANGES:
            continue
        aid, sym = a.get('id'), a.get('symbol')
        if not UUID.fullmatch(str(aid)):
            raise Rejected(['ASSET_ID_INVALID'])
        if not SYMBOL.fullmatch(str(sym)):
            raise Rejected(['ASSET_SYMBOL_UNSUPPORTED:' + str(sym)[:16]])
        if sym in symbols or aid in out:
            raise Rejected(['ASSET_IDENTITY_DUPLICATE:' + sym])
        symbols.add(sym)
        out[aid] = {'symbol': sym, 'exchange': a['exchange']}
    if not out:
        raise Rejected(['ASSETS_EMPTY'])
    return out


def member_symbols(master, assets) -> list[str]:
    """Symbols whose bars are requested: broker candidates the master marks common stock."""
    try:
        listed = candidates(assets)
        rows = {r.get('alpaca_asset_id'): r for r in master.get('securities', []) if isinstance(r, dict)}
    except (Rejected, AttributeError):
        return []
    return sorted(listed[a]['symbol'] for a in listed if rows.get(a, {}).get('type') == 'common_stock')


def bars_by_symbol(pages, session_dates: set) -> dict:
    out: dict = {}
    for page in pages:
        bars = page.get('bars') if isinstance(page, dict) else None
        if bars is None:
            bars = {}
        if not isinstance(bars, dict):
            raise Rejected(['BARS_PAGE_INVALID'])
        for sym, rows in bars.items():
            if not isinstance(rows, list):
                raise Rejected(['BARS_PAGE_INVALID'])
            for b in rows:
                if not isinstance(b, dict):
                    raise Rejected(['BAR_INVALID:' + sym])
                d = stamp(b.get('t'), 'bar.t').astimezone(NY).date().isoformat()
                if d not in session_dates:
                    raise Rejected(['BAR_ON_NON_SESSION:' + sym + ':' + d])
                if d in out.setdefault(sym, {}):
                    raise Rejected(['BAR_DUPLICATE:' + sym + ':' + d])
                volume = b.get('v')
                if type(volume) is not int or volume < 0:
                    raise Rejected(['BAR_VOLUME_INVALID:' + sym])
                out[sym][d] = {k: decimal_text(b.get(k), 'bar.' + k + ':' + sym) for k in ('o', 'h', 'l', 'c')} \
                    | {'v': volume}
    return out


SYMBOL_FIELDS = ('symbol', 'source_symbol', 'new_symbol', 'old_symbol', 'acquirer_symbol',
                 'acquiree_symbol', 'target_symbol', 'initiating_symbol')
DATE_FIELDS = ('ex_date', 'effective_date', 'process_date')


def corporate_actions(pages, members: set, window: tuple[str, str]):
    """Supported splits and cash dividends; anything else touching a member in the window rejects."""
    supported, unsupported = [], []
    for page in pages:
        groups = page.get('corporate_actions') if isinstance(page, dict) else None
        if not isinstance(groups, dict):
            raise Rejected(['CORPORATE_ACTIONS_PAGE_INVALID'])
        for kind, rows in groups.items():
            if not isinstance(rows, list):
                raise Rejected(['CORPORATE_ACTIONS_PAGE_INVALID'])
            for r in rows:
                if not isinstance(r, dict):
                    raise Rejected(['CORPORATE_ACTION_INVALID'])
                touched = {r[f] for f in SYMBOL_FIELDS if isinstance(r.get(f), str)} & members
                when = next((r[f] for f in DATE_FIELDS if isinstance(r.get(f), str)), None)
                if not touched or when is None or not window[0] < when <= window[1]:
                    continue
                if kind not in SUPPORTED_ACTIONS or not isinstance(r.get('symbol'), str):
                    unsupported.append(kind + ':' + ','.join(sorted(touched)) + ':' + when)
                    continue
                if kind == 'cash_dividends':
                    split, dividend = '1', decimal_text(r.get('rate'), 'dividend.rate:' + r['symbol'])
                else:
                    new = Decimal(decimal_text(r.get('new_rate'), 'split.new_rate'))
                    old = Decimal(decimal_text(r.get('old_rate'), 'split.old_rate'))
                    split, dividend = format((new / old).normalize(), 'f'), '0'
                supported.append({'symbol': r['symbol'], 'session_date': r.get('ex_date'),
                                  'split_ratio': split, 'cash_dividend_per_old_share': dividend,
                                  'source_id': 'alpaca-ca:' + kind + ':' + str(r.get('id', ''))})
    if unsupported:
        raise Rejected(['UNSUPPORTED_CORPORATE_ACTION:' + u for u in sorted(set(unsupported))[:50]])
    merged: dict = {}
    for a in supported:
        key = (a['symbol'], a['session_date'])
        if key in merged:
            # The frozen model needs one record per symbol/session with dividends in
            # old-share units; Alpaca does not state the unit for same-day events.
            raise Rejected(['AMBIGUOUS_SAME_DAY_ACTIONS:' + a['symbol'] + ':' + str(a['session_date'])])
        merged[key] = a
    return sorted(merged.values(), key=lambda a: (a['symbol'], a['session_date']))


# ---------------------------------------------------------------- assembly
def assemble(capture: dict, master, attestation, *, experiment_id: str, registered_at: str,
             model_version: str, held_security_ids: list[str]) -> dict:
    """Builds the exact forward_signal envelope or raises Rejected with every reason found."""
    if model_version not in (BASELINE, CANDIDATE):
        raise Rejected(['UNREGISTERED_MODEL'])
    sessions = parse_calendar(capture['calendar']['rows'])
    point = decision_point(sessions, capture['session'])
    if point is None:
        raise Rejected(['NOT_A_DECISION_SESSION'])
    decision_at, k = point
    completed = sessions[:k]
    if len(completed) < 253:
        raise Rejected(['CALENDAR_HISTORY_TOO_SHORT'])
    window = [s['date'] for s in completed[-253:]]
    by_asset, master_available, master_digest = parse_master(master, decision_at)
    cov_start, cov_end, att_digest = parse_attestation(attestation, decision_at, window[0], window[-1])
    listed = candidates(capture['assets']['rows'])
    reasons = []
    missing = sorted(listed[a]['symbol'] for a in listed if a not in by_asset)
    if missing:
        reasons.append(f'SECURITY_MASTER_INCOMPLETE:{len(missing)}:' + ','.join(missing[:25]))
    for aid, a in listed.items():
        m = by_asset.get(aid)
        if m and (m['symbol'] != a['symbol'] or m['exchange'] != a['exchange']):
            reasons.append('SECURITY_MASTER_CONTRADICTS_BROKER:' + a['symbol'])
    if reasons:
        raise Rejected(reasons)
    members = {aid: by_asset[aid] for aid in listed if by_asset[aid]['type'] == 'common_stock'}
    excluded: dict = {}
    for aid in listed:
        t = by_asset[aid]['type']
        if t != 'common_stock':
            excluded[t] = excluded.get(t, 0) + 1
    universe = [{'security_id': 'alpaca:' + aid, 'symbol': m['symbol'], 'type': 'common_stock',
                 'exchange': m['exchange'], 'sector': m['sector']} for aid, m in sorted(members.items())]
    dates = {s['date'] for s in completed}
    before = bars_by_symbol(capture['reference_bars']['pages'], dates)
    at = bars_by_symbol(capture['decision_bars']['pages'], dates)
    in_window = set(window)
    reference_at, decision_retrieved = capture['reference_bars']['retrieved_at'], capture['decision_bars']['retrieved_at']
    revision = 'alpaca-sip-pages-' + sha256([capture['reference_bars']['page_sha256'],
                                             capture['decision_bars']['page_sha256']])
    close_at = {s['date']: s['close_at'] for s in completed}
    shards, listings, gaps, unseen, changed = [], {}, [], [], []
    for aid, m in sorted(members.items()):
        sid, sym, first = 'alpaca:' + aid, m['symbol'], m['first_traded_on']
        expected = [d for d in window if d >= first]
        now_bars = {d: b for d, b in at.get(sym, {}).items() if d in in_window}
        old_bars = {d: b for d, b in before.get(sym, {}).items() if d in in_window}
        absent = [d for d in expected if d not in now_bars]
        early = [d for d in set(now_bars) | set(old_bars) if d < first]
        if absent or early or not expected:
            gaps.append(f'{sym}:{len(absent)} missing' + (f',{len(early)} before listing' if early else ''))
            continue
        if any(d not in old_bars for d in expected):
            unseen.append(sym)
            continue
        if any(old_bars[d] != now_bars[d] for d in expected):
            changed.append(sym)
            continue
        # Availability is proven by the reference observation; completeness by the decision one.
        rows = [{'symbol': sym, 'session_date': d, 'status': 'complete', 'completed_at': close_at[d],
                 'available_at': reference_at, 'open': now_bars[d]['o'], 'high': now_bars[d]['h'],
                 'low': now_bars[d]['l'], 'close': now_bars[d]['c'], 'volume': now_bars[d]['v']} for d in expected]
        shards.append({'security_id': sid, 'payload': {
            'asset_class': 'us_equities', 'timeframe': '1d', 'currency': 'USD', 'price_adjustment': 'raw',
            'provider': 'Alpaca Market Data API (SIP consolidated, raw)', 'source_revision': revision,
            'retrieved_at': decision_retrieved, 'bars': rows}})
        listings[sid] = {'first_traded_on': first, 'available_at': master_available, 'source_id': m['source_id']}
    if gaps:
        # The frozen protocol forbids forward fills or dropping members with gaps.
        reasons.append(f'MISSING_OR_CONTRADICTED_BARS:{len(gaps)}:' + ';'.join(gaps[:25]))
    if unseen:
        reasons.append(f'BARS_NOT_OBSERVED_BEFORE_DECISION:{len(unseen)}:' + ','.join(unseen[:25]))
    if changed:
        reasons.append(f'BARS_CHANGED_BETWEEN_OBSERVATIONS:{len(changed)}:' + ','.join(changed[:25]))
    if reasons:
        raise Rejected(reasons)
    actions = corporate_actions(capture['actions']['pages'], {u['symbol'] for u in universe},
                                (window[0], window[-1]))
    for a in actions:
        a['available_at'] = capture['actions']['retrieved_at']
    held = sorted(held_security_ids)
    if any(h not in listings for h in held):
        raise Rejected(['HELD_SECURITY_NOT_IN_UNIVERSE'])
    context = {
        'calendar_revision': 'alpaca-calendar-' + capture['calendar']['sha256'],
        'calendar_available_at': capture['calendar']['retrieved_at'],
        'universe_revision': 'master-' + master_digest + '+alpaca-assets-' + sha256(sorted(listed.items())),
        'universe_available_at': iso(max(stamp(master_available, 'master'),
                                         stamp(capture['assets']['retrieved_at'], 'assets'))),
        'universe_session': window[-1],
        'actions_revision': 'alpaca-actions-' + sha256(capture['actions']['page_sha256']) + '+attestation-' + att_digest,
        'actions_available_at': capture['actions']['retrieved_at'],
        'actions_complete': True,
        'actions_coverage_start': cov_start, 'actions_coverage_end': cov_end,
        'sessions': sessions[:k + 1], 'universe': universe, 'actions': actions}
    return {'experiment_id': experiment_id, 'registered_at': registered_at,
            'observed_at': capture['observed_at'], 'model_version': model_version,
            'held_security_ids': held,
            'evidence': {'shards': shards, 'context': context, 'listings': listings,
                         'decision_at': iso(decision_at)},
            '_excluded_by_type': excluded}


def timing_problem(capture: dict, decision_at: datetime) -> dict | None:
    """Every pre-decision source before 08:00; the decision capture started from 08:00 and sealed within 60 s."""
    try:
        observed = stamp(capture.get('observed_at'), 'observed_at')
        early = {k: stamp(capture[k]['retrieved_at'], k) for k in ('calendar', 'assets', 'actions', 'reference_bars')}
        started = stamp(capture['decision_bars']['started_at'], 'decision_bars.started_at')
        finished = stamp(capture['decision_bars']['retrieved_at'], 'decision_bars.retrieved_at')
    except (Rejected, KeyError, TypeError):
        return {'reason': 'CAPTURE_INCOMPLETE'}
    if max(early.values()) >= decision_at:
        return {'reason': 'REFERENCE_CAPTURE_NOT_BEFORE_DECISION', 'latestReferenceAt': iso(max(early.values()))}
    if started < decision_at or finished < started or observed < finished or observed - decision_at > CAPTURE_WINDOW:
        return {'reason': 'DECISION_CAPTURE_NOT_SEALED_IN_WINDOW', 'startedAt': iso(started),
                'observedAt': iso(observed)}
    return None


def decide(capture: dict, master, attestation, registration: dict, held_security_ids: list[str]) -> dict | None:
    """One controller decision record for the session, or None when it is not a 2026 decision session."""
    experiment = registration['experimentId']
    sessions = parse_calendar(capture['calendar']['rows'])
    point = decision_point(sessions, capture['session'])
    if point is None or point[0].year != 2026:
        # The frozen forward signal admits 2026 engineering decisions only; 2027 is reserved.
        return None
    decision_at = point[0]
    base = {'experimentId': experiment, 'session': capture['session'], 'decisionAt': iso(decision_at),
            'bridgeVersion': VERSION}
    late = timing_problem(capture, decision_at)
    if late and capture.get('capture_failure'):
        late |= {'captureFailure': capture['capture_failure'][:10]}
    if late:
        return base | {'outcome': 'MISSED', 'diagnostics': late, 'decisionId': sha256({'missed': base, **late})}
    try:
        bundle = assemble(capture, master, attestation, experiment_id=experiment,
                          registered_at=registration['registeredAt'], model_version=registration['modelVersion'],
                          held_security_ids=held_security_ids)
        excluded = bundle.pop('_excluded_by_type')
        signal = forward_signal(bundle)
    except Rejected as e:
        reasons = e.reasons
    except ValueError as e:
        reasons = ['FROZEN_SIGNAL_REFUSED:' + str(e)[:200]]
    else:
        return base | {'outcome': 'TARGETS' if signal['targets'] else 'HOLD_NO_TARGETS',
                       'decisionId': signal['decisionId'], 'signal': signal, 'inputDigest': sha256(bundle),
                       'scoringReportId': signal['scoringReportId'],
                       'diagnostics': {'universeMembers': len(bundle['evidence']['shards']),
                                       'excludedByType': excluded,
                                       'corporateActions': len(bundle['evidence']['context']['actions'])}}
    return base | {'outcome': 'INPUT_REJECTED', 'diagnostics': {'reasons': reasons},
                   'decisionId': sha256({'rejected': base, 'reasons': reasons})}


# ---------------------------------------------------------------- capture (network, opt-in)
def provider_get(url: str, headers: dict) -> Any:
    """GET only, to the two fixed Alpaca hosts; never forwards credentials elsewhere."""
    if not (url.startswith(DATA + '/') or url.startswith(PAPER + '/')):
        raise Rejected(['UNEXPECTED_HOST'])
    try:
        with urlopen(Request(url, headers=headers, method='GET'), timeout=30) as response:
            raw = response.read(MAX_PAGE_BYTES + 1)
    except HTTPError as e:
        raise Rejected([f'PROVIDER_HTTP_{e.code}']) from None
    except (URLError, TimeoutError):
        raise Rejected(['PROVIDER_UNREACHABLE']) from None
    if len(raw) > MAX_PAGE_BYTES:
        raise Rejected(['PROVIDER_PAGE_TOO_LARGE'])
    try:
        return json.loads(raw)
    except ValueError:
        raise Rejected(['PROVIDER_INVALID_JSON']) from None


class Limiter:
    """At most `limit` requests in any rolling 60 seconds, shared by every thread."""
    def __init__(self, limit=REQUESTS_PER_MINUTE, clock=time.monotonic, sleep=time.sleep):
        self.limit, self.clock, self.sleep, self.sent, self.lock = limit, clock, sleep, [], threading.Lock()

    def acquire(self):
        while True:
            with self.lock:
                t = self.clock()
                self.sent = [x for x in self.sent if t - x < 60]
                if len(self.sent) < self.limit:
                    self.sent.append(t)
                    return
                wait = 60 - (t - self.sent[0])
            self.sleep(max(wait, 0.01))


class Source:
    def __init__(self, key_id, secret_key, get=provider_get, limiter=None, max_requests=1200):
        if not key_id or not secret_key:
            raise Rejected(['ALPACA_CREDENTIALS_MISSING'])
        self.headers = {'APCA-API-KEY-ID': key_id, 'APCA-API-SECRET-KEY': secret_key, 'Accept': 'application/json'}
        self.get, self.limiter, self.max_requests, self.count = get, limiter or Limiter(), max_requests, 0
        self.lock = threading.Lock()

    def fetch(self, base, path, query):
        with self.lock:
            if self.count >= self.max_requests:
                raise Rejected(['REQUEST_BUDGET_EXHAUSTED'])
            self.count += 1
        self.limiter.acquire()
        return self.get(base + path + '?' + urlencode(query), self.headers)

    def paged(self, base, path, query) -> list:
        pages, token, seen = [], None, set()
        while True:
            page = self.fetch(base, path, query | ({'page_token': token} if token else {}))
            if not isinstance(page, dict):
                raise Rejected(['PROVIDER_PAGE_INVALID'])
            pages.append(page)
            token = page.get('next_page_token')
            if not token:
                return pages
            if token in seen:
                raise Rejected(['PAGINATION_REPEATED'])
            seen.add(token)

    def bars(self, symbols, window, session, chunk, workers):
        groups = [','.join(symbols[i:i + chunk]) for i in range(0, len(symbols), chunk)]
        query = {'timeframe': '1Day', 'start': window[0], 'end': window[-1], 'adjustment': 'raw',
                 'feed': 'sip', 'asof': session, 'limit': 10000}
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(lambda g: self.paged(DATA, '/v2/stocks/bars', query | {'symbols': g}), groups))
        return [page for pages in results for page in pages]


def part(pages, retrieved_at, **extra):
    return {'pages': pages, 'page_sha256': [sha256(p) for p in pages], 'retrieved_at': retrieved_at} | extra


def capture_reference(*, session: str, master, source: Source,
                      now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                      chunk: int = 200, workers: int = 4) -> dict:
    """Observation 1, before 08:00 New York: calendar, assets, corporate actions and member bars.

    After the calendar is known, any failure is returned with the parts obtained so the
    session is still recorded (as MISSED) rather than silently skipped.
    """
    target = date.fromisoformat(session)
    rows = source.fetch(PAPER, '/v2/calendar', {'start': (target - timedelta(days=420)).isoformat(), 'end': session})
    out = {'version': VERSION + '-capture', 'session': session, 'decision_bars': None, 'observed_at': None,
           'calendar': {'rows': rows, 'sha256': sha256(rows), 'retrieved_at': iso(now())}}
    sessions = parse_calendar(rows)
    point = decision_point(sessions, session)
    if point is None:
        raise Rejected(['NOT_A_DECISION_SESSION'])
    try:
        if now() >= point[0]:
            raise Rejected(['REFERENCE_CAPTURE_TOO_LATE'])
        out['window'] = window = [s['date'] for s in sessions[:point[1]][-253:]]
        assets = source.fetch(PAPER, '/v2/assets', {'status': 'active', 'asset_class': 'us_equity'})
        out['assets'] = {'rows': assets, 'sha256': sha256(assets), 'retrieved_at': iso(now())}
        out['members_requested'] = symbols = member_symbols(master, assets)
        actions = []
        for i in range(0, len(symbols), chunk):
            actions += source.paged(DATA, '/v1/corporate-actions', {'symbols': ','.join(symbols[i:i + chunk]),
                                                                   'start': window[0], 'end': session, 'limit': 1000})
        out['actions'] = part(actions, iso(now()))
        out['reference_bars'] = part(source.bars(symbols, window, session, chunk, workers), iso(now()))
    except Rejected as e:
        out['capture_failure'] = e.reasons
    return out


def capture_decision(reference: dict, *, source: Source,
                     now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                     chunk: int = 200, workers: int = 4) -> dict:
    """Observation 2, from 08:00:00 New York: re-reads every member's bars, then seals the capture."""
    point = decision_point(parse_calendar(reference['calendar']['rows']), reference['session'])
    started = now()
    if point is None or started < point[0]:
        raise Rejected(['DECISION_CAPTURE_BEFORE_DECISION'])
    pages = source.bars(reference['members_requested'], reference['window'], reference['session'], chunk, workers)
    finished = iso(now())
    return reference | {'decision_bars': part(pages, finished, started_at=iso(started)), 'observed_at': iso(now())}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    c = sub.add_parser('capture', help='reference capture before 08:00, decision capture from 08:00:00')
    c.add_argument('--session', required=True)
    c.add_argument('--security-master', type=Path, required=True)
    c.add_argument('--output', type=Path, required=True)
    c.add_argument('--execute-network', action='store_true')
    d = sub.add_parser('decide', help='pure: capture + registered inputs -> controller decision record')
    for name in ('capture', 'security-master', 'actions-attestation', 'registration', 'output'):
        d.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    load = lambda path: json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    if a.command == 'capture':
        if not a.execute_network:
            print(json.dumps({'mode': 'plan_only_no_network', 'session': a.session,
                              'reference': 'before 08:00 New York: calendar, active assets, corporate actions and '
                                           'raw SIP daily bars for registered common stocks',
                              'decision': 'from 08:00:00: the same bar queries again, sealed within 60 seconds'}))
            return
        if a.output.exists():
            p.error('output exists; refusing to overwrite')
        source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''))
        reference = capture_reference(session=a.session, master=load(a.security_master), source=source)
        sealed = reference
        if 'capture_failure' not in reference:
            point = decision_point(parse_calendar(reference['calendar']['rows']), a.session)
            wait = (point[0] - datetime.now(timezone.utc)).total_seconds()
            if wait > 0:
                time.sleep(wait)
            try:
                sealed = capture_decision(reference, source=source)
            except Rejected as e:
                # Recorded as MISSED by `decide`: the decision capture did not complete in its window.
                sealed = reference | {'capture_failure': e.reasons}
        with a.output.open('x', encoding='utf-8') as f:
            json.dump(sealed, f, allow_nan=False)
        return
    registration = load(a.registration)
    record = decide(load(a.capture), load(a.security_master), load(a.actions_attestation), registration,
                    registration.get('heldSecurityIds', []))
    if record is None:
        print(json.dumps({'status': 'NO_DECISION_THIS_SESSION'}))
        return
    with a.output.open('x', encoding='utf-8') as f:
        json.dump(record, f, allow_nan=False)
    print(json.dumps({'status': 'DECISION_WRITTEN', 'outcome': record['outcome'], 'decisionId': record['decisionId']}))


if __name__ == '__main__':
    main()
