"""In-cloud QC observations -> IdentityDevelopmentStream rows, or a fixed block.

Assembly only: no acquisition, orders, export or source certification. The
output is exactly the row schema accepted by
analytics.stock_identity_stream_v1.IdentityDevelopmentStream.accept:
    {session, evidence?, identity_records?}
Every downstream gate (bridge, scorer, accounting) still runs unchanged.

Inputs and what this module does NOT do:
- Calendar: the REVIEWED exchange calendar passed in (accounting-v2 shape).
  Sessions are never inferred from weekdays or from returned bar rows; bars
  must match the reviewed calendar exactly.
- Bars: raw observations as returned by lean_reviewed_lookback_v1 (bar rows
  {session_date, lean_history_index_time, open, high, low, close, volume}).
  completed_at is the reviewed session close; the historical ticker of each
  bar is resolved from the reviewed identity records (so the bridge's ticker
  check is a consistency check on those records, not independent evidence).
- Availability: EVERY available_at is an explicit input (per-session bar
  publication, quote/volume/close/event/action availability, provenance).
  Nothing here derives an availability time from a close or a LEAN timestamp.
- Events: accounting-v2 events from qc_lifecycle_mapper_v1.map_session.
  Actions: qc_lifecycle_mapper_v1.scoring_action rows plus 'security_id'.
- Identity: qc_identity_registry_v1.build_records output per permanent ID.
Failures carry FIXED codes only (str(exc) is the code): no IDs, tickers,
dates or vendor values, so a cloud caller may surface the code.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import re
from analytics.stock_accounting_v2 import NY, stamp, validate_calendar
from analytics.stock_identity_bridge_v1 import IdentityRegistry

VERSION = 'sportsedge-qc-stream-rows-v1'
KINDS = ('synthetic_fixture', 'historical_price_proxy')
LOOKBACK_BAR = {'session_date', 'lean_history_index_time', 'open', 'high', 'low', 'close', 'volume'}
SOURCE = {'provider', 'source_revision', 'retrieved_at'}
PROVENANCE = {'calendar_revision', 'calendar_available_at', 'universe_revision',
              'universe_available_at', 'actions_revision', 'actions_available_at',
              'actions_complete', 'actions_coverage_start', 'actions_coverage_end'}
ACTION = {'security_id', 'symbol', 'session_date', 'source_id', 'available_at',
          'split_ratio', 'cash_dividend_per_old_share'}
EXECUTION = {'observed_at', 'available_at', 'bid_size', 'ask_size'}
EVENT_TYPES = ('split', 'ordinary_cash_dividend', 'rename')
REQUIRED_SESSIONS = 253
ADV_SESSIONS = 20
PRICE = re.compile(r'(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?\Z')
# The frozen stream spreads a raw open by x0.9995/x1.0005 and accounting v2
# admits at most 6 decimals, so a raw open needs <= 2 decimals. Fractional-era
# prices (e.g. sixteenths before 2001 decimalization) cannot pass unchanged.
OPEN_PLACES = 2


class StreamRowBlocked(ValueError):
    """Fixed, data-free reason code. str(exc) is the code alone."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _need(ok, code):
    if not ok:
        raise StreamRowBlocked(code)


def _time(value, code):
    try:
        return stamp(value)
    except (ValueError, TypeError, AttributeError):
        raise StreamRowBlocked(code) from None


def _label(value, code):
    _need(isinstance(value, str) and bool(value) and value == value.strip() and len(value) <= 160, code)
    return value


def _ids(members):
    _need(isinstance(members, (list, tuple)) and bool(members), 'MEMBERS_REQUIRED')
    for sid in members:
        _label(sid, 'MEMBER_ID_INVALID')
    _need(len(set(members)) == len(members), 'DUPLICATE_MEMBER')
    return list(members)


def _price(value, code, places=6):
    _need(isinstance(value, str) and bool(PRICE.fullmatch(value)), code)
    number = Decimal(value)
    _need(number > 0 and -number.as_tuple().exponent <= places, code)
    return number


def reviewed_sessions(calendar):
    """{date: session} from the reviewed calendar alone (accounting-v2 shape)."""
    try:
        sessions = validate_calendar(calendar)
    except (ValueError, KeyError, TypeError, AttributeError):
        raise StreamRowBlocked('REVIEWED_CALENDAR_INVALID') from None
    _time(calendar.get('available_at'), 'REVIEWED_CALENDAR_AVAILABILITY_REQUIRED')
    return sessions


def _prior(sessions, day, code):
    days = list(sessions)
    _need(day in sessions, code)
    index = days.index(day)
    _need(index > 0, 'SESSION_HAS_NO_PRIOR_REVIEWED_SESSION')
    return days, index


def _bar(raw, day):
    _need(isinstance(raw, dict) and set(raw) == LOOKBACK_BAR, 'LOOKBACK_BAR_SCHEMA')
    _need(raw['session_date'] == day, 'BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR')
    _need(isinstance(raw['lean_history_index_time'], str), 'LOOKBACK_BAR_SCHEMA')
    o, h, l, c = (_price(raw[k], 'BAR_PRICE_UNSUPPORTED') for k in ('open', 'high', 'low', 'close'))
    _need(l <= min(o, c) and h >= max(o, c), 'BAR_OHLC_INVALID')
    _need(type(raw['volume']) is int and 0 <= raw['volume'] <= 10**15, 'BAR_VOLUME_INVALID')
    return raw


def _lookback(sid, lookback):
    _need(isinstance(lookback, dict) and isinstance(lookback.get('bars'), list)
          and bool(lookback['bars']), 'LOOKBACK_SCHEMA')
    _need(lookback.get('security_id') == sid, 'LOOKBACK_SECURITY_MISMATCH')
    _need(lookback.get('requested_raw_unadjusted') is True
          and lookback.get('requested_fill_forward') is False
          and lookback.get('historical_source_admitted') is False
          and lookback.get('performance') is None, 'LOOKBACK_NOT_RAW_UNADMITTED')
    return lookback['bars']


def _source(source, at):
    _need(isinstance(source, dict) and set(source) == SOURCE, 'SOURCE_SCHEMA')
    _label(source['provider'], 'SOURCE_SCHEMA'); _label(source['source_revision'], 'SOURCE_SCHEMA')
    retrieved = _time(source['retrieved_at'], 'SOURCE_SCHEMA')
    _need(retrieved >= at, 'RETRIEVED_BEFORE_DECISION')
    return retrieved


def build_shard(security_id, lookback, *, sessions, last_completed, symbol_at,
                bar_available_at, source, decision_at):
    """One {security_id, payload} shard in the frozen parse_daily_bars shape.

    sessions: reviewed_sessions(calendar). Bars must be the contiguous
    reviewed sessions from the first returned bar through last_completed.
    symbol_at(close_at) -> the reviewed historical ticker at that close.
    bar_available_at: {session_date: ISO} explicit publication times.
    """
    at = _time(decision_at, 'DECISION_AT_INVALID')
    retrieved = _source(source, at)
    _need(isinstance(bar_available_at, dict), 'BAR_AVAILABILITY_NOT_SUPPLIED')
    raw = _lookback(security_id, lookback)
    days = list(sessions)
    _need(last_completed in sessions, 'BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR')
    dates = [b.get('session_date') if isinstance(b, dict) else None for b in raw]
    _need(dates[-1] == last_completed, 'LOOKBACK_NOT_THROUGH_PRIOR_CLOSE')
    first = dates[0]
    _need(first in sessions, 'BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR')
    expected = days[days.index(first):days.index(last_completed) + 1]
    _need(len(raw) == len(expected), 'BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR')
    bars = []
    for item, day in zip(raw, expected):
        _bar(item, day)
        close_at = sessions[day]['close_at']
        _need(day in bar_available_at, 'BAR_AVAILABILITY_NOT_SUPPLIED')
        available = bar_available_at[day]
        published = _time(available, 'BAR_AVAILABILITY_NOT_SUPPLIED')
        _need(published >= stamp(close_at), 'BAR_AVAILABLE_BEFORE_CLOSE')
        _need(published < at, 'BAR_AVAILABLE_AT_OR_AFTER_DECISION')
        _need(published <= retrieved, 'BAR_AVAILABLE_AFTER_RETRIEVAL')
        bars.append(dict(symbol=symbol_at(close_at), session_date=day, status='complete',
                         completed_at=close_at, available_at=available,
                         open=item['open'], high=item['high'], low=item['low'],
                         close=item['close'], volume=item['volume'], security_id=security_id))
    return dict(security_id=security_id, payload=dict(
        asset_class='us_equities', timeframe='1d', currency='USD', price_adjustment='raw',
        provider=source['provider'], source_revision=source['source_revision'],
        retrieved_at=source['retrieved_at'], bars=bars))


def _registry(identity_records, members, decision_at):
    _need(isinstance(identity_records, dict), 'IDENTITY_RECORDS_SCHEMA')
    _need(set(members) <= set(identity_records), 'MEMBER_IDENTITY_RECORDS_MISSING')
    order = list(members) + sorted(set(identity_records) - set(members))
    flat = []
    for sid in order:
        rows = identity_records[sid]
        _need(isinstance(rows, list) and bool(rows), 'MEMBER_IDENTITY_RECORDS_MISSING')
        _need(all(isinstance(r, dict) and r.get('security_id') == sid for r in rows),
              'IDENTITY_RECORD_KEY_MISMATCH')
        flat.extend(deepcopy(rows))
    try:
        return IdentityRegistry(flat, decision_at=decision_at), flat
    except (ValueError, KeyError, TypeError):
        raise StreamRowBlocked('IDENTITY_RECORDS_REJECTED') from None


def _resolver(registry, sid, code):
    def symbol_at(at):
        try:
            return registry.resolve(sid, at)['symbol']
        except ValueError:
            raise StreamRowBlocked(code) from None
    return symbol_at


def decision_window(sessions, decision_at):
    """(decision session, last completed session, 253-session window) or block."""
    at = _time(decision_at, 'DECISION_AT_INVALID')
    local = at.astimezone(NY)
    _need((local.hour, local.minute, local.second, local.microsecond) == (8, 0, 0, 0),
          'DECISION_NOT_0800_NEW_YORK')
    day = local.date().isoformat()
    days, index = _prior(sessions, day, 'DECISION_SESSION_NOT_IN_REVIEWED_CALENDAR')
    last = days[index - 1]
    _need(last[:7] != day[:7], 'DECISION_NOT_FIRST_MONTHLY_SESSION')
    _need(stamp(sessions[last]['close_at']) < at < stamp(sessions[day]['open_at']),
          'DECISION_NOT_BETWEEN_PRIOR_CLOSE_AND_OPEN')
    _need(index >= REQUIRED_SESSIONS, 'REVIEWED_CALENDAR_LACKS_253_SESSION_WARMUP')
    return day, last, days[index - REQUIRED_SESSIONS:index]


def _actions(actions, members, registry, sessions, window, at):
    _need(isinstance(actions, list), 'ACTION_SCHEMA')
    rows = []
    for action in actions:
        _need(isinstance(action, dict) and set(action) == ACTION, 'ACTION_SCHEMA')
        _need(action['security_id'] in members, 'ACTION_FOR_NON_MEMBER')
        day = action['session_date']
        _need(day in sessions and window[0] <= day <= window[-1], 'ACTION_OUTSIDE_LOOKBACK_WINDOW')
        _need(_time(action['available_at'], 'ACTION_SCHEMA') < at, 'ACTION_AVAILABLE_AT_OR_AFTER_DECISION')
        symbol = _resolver(registry, action['security_id'], 'ACTION_OUTSIDE_IDENTITY_INTERVAL')(
            sessions[day]['close_at'])
        _need(action['symbol'] == symbol, 'ACTION_TICKER_MISMATCH')
        try:
            ratio = Decimal(action['split_ratio']); Decimal(action['cash_dividend_per_old_share'])
        except (InvalidOperation, TypeError, ValueError):
            raise StreamRowBlocked('ACTION_SCHEMA') from None
        _need(ratio.is_finite() and ratio > 0, 'ACTION_SCHEMA')
        rows.append(deepcopy(action))
    return rows


def _provenance(provenance, at, window, last):
    _need(isinstance(provenance, dict) and set(provenance) == PROVENANCE, 'PROVENANCE_SCHEMA')
    for key in ('calendar_revision', 'universe_revision', 'actions_revision'):
        _label(provenance[key], 'PROVENANCE_SCHEMA')
    for key in ('calendar_available_at', 'universe_available_at', 'actions_available_at'):
        _need(_time(provenance[key], 'PROVENANCE_SCHEMA') < at, 'PROVENANCE_AVAILABLE_AT_OR_AFTER_DECISION')
    _need(provenance['actions_complete'] is True, 'ACTIONS_COVERAGE_NOT_DECLARED_COMPLETE')
    start, end = provenance['actions_coverage_start'], provenance['actions_coverage_end']
    _need(isinstance(start, str) and isinstance(end, str), 'PROVENANCE_SCHEMA')
    _need(start <= window[0] and end >= last, 'ACTIONS_COVERAGE_INCOMPLETE')


def build_evidence(*, calendar, decision_at, members, lookbacks, identity_records, actions,
                   bar_available_at, source, provenance):
    """{evidence, identity_records} for the first session of one month.

    members: the complete PIT universe (permanent IDs) at the prior close, in
    output order. lookbacks: {member: lookback}. identity_records:
    {permanent ID: build_records rows}; non-members may be present (retired).
    """
    sessions = reviewed_sessions(calendar)
    at = _time(decision_at, 'DECISION_AT_INVALID')
    day, last, window = decision_window(sessions, decision_at)
    members = _ids(members)
    _provenance(provenance, at, window, last)
    registry, flat = _registry(identity_records, members, decision_at)
    _need(isinstance(lookbacks, dict), 'LOOKBACK_SCHEMA')
    _need(set(members) <= set(lookbacks), 'MEMBER_LOOKBACK_MISSING')
    _need(set(lookbacks) <= set(members), 'LOOKBACK_FOR_NON_MEMBER')
    prior_close = sessions[last]['close_at']
    universe, listings, shards = [], {}, []
    for sid in members:
        try:
            row = registry.resolve(sid, prior_close)
        except ValueError:
            raise StreamRowBlocked('MEMBER_IDENTITY_UNRESOLVED_AT_PRIOR_CLOSE') from None
        universe.append({k: row[k] for k in ('symbol', 'security_id', 'sector', 'type', 'exchange')})
        listings[sid] = dict(first_traded_on=row['first_traded_on'],
                             available_at=row['first_trade_available_at'],
                             source_id=row['first_trade_source_id'])
        shards.append(build_shard(sid, lookbacks[sid], sessions=sessions, last_completed=last,
            symbol_at=_resolver(registry, sid, 'BAR_OUTSIDE_IDENTITY_INTERVAL'),
            bar_available_at=bar_available_at, source=source, decision_at=decision_at))
    context = dict(
        calendar_revision=provenance['calendar_revision'],
        calendar_available_at=provenance['calendar_available_at'],
        universe_revision=provenance['universe_revision'],
        universe_available_at=provenance['universe_available_at'],
        universe_session=last,
        actions_revision=provenance['actions_revision'],
        actions_available_at=provenance['actions_available_at'],
        actions_complete=True,
        actions_coverage_start=provenance['actions_coverage_start'],
        actions_coverage_end=provenance['actions_coverage_end'],
        sessions=[deepcopy(s) for s in calendar['sessions'] if s['date'] <= day],
        actions=_actions(actions, members, registry, sessions, window, at),
        universe=universe)
    return dict(evidence=dict(shards=shards, context=context, listings=listings, decision_at=decision_at),
                identity_records=flat)


def member_symbols(built):
    """{permanent ID: ticker at the prior close} from a build_evidence result."""
    return {u['security_id']: u['symbol'] for u in built['evidence']['context']['universe']}


def apply_renames(symbols, events):
    """Ticker labels after one session's accounting-v2 rename events."""
    out = dict(symbols)
    for event in events:
        if event.get('type') == 'rename':
            _need(out.get(event.get('security_id')) == event.get('old_symbol'), 'RENAME_OLD_SYMBOL_MISMATCH')
            out[event['security_id']] = _label(event.get('new_symbol'), 'RENAME_SCHEMA')
    _need(len(set(out.values())) == len(out), 'RENAME_COLLISION')
    return out


def prior_adv20(security_id, history, *, sessions, prior_session, split_actions):
    """Frozen-scorer trailing 20-session mean volume as of prior_session.

    Same rule as stock_universe_scoring_v1: older volumes are multiplied by
    split_ratio of every split with day < split session <= prior_session.
    None when fewer than 20 sessions exist (cannot be held or targeted).
    """
    _need(isinstance(history, list) and bool(history), 'MEMBER_VOLUME_HISTORY_MISSING')
    days = list(sessions)
    _need(prior_session in sessions, 'VOLUME_HISTORY_DISAGREES_WITH_REVIEWED_CALENDAR')
    end = days.index(prior_session) + 1
    dates = [b.get('session_date') if isinstance(b, dict) else None for b in history]
    _need(dates[-1] == prior_session, 'VOLUME_HISTORY_NOT_THROUGH_PRIOR_CLOSE')
    _need(dates[0] in sessions and dates == days[days.index(dates[0]):end],
          'VOLUME_HISTORY_DISAGREES_WITH_REVIEWED_CALENDAR')
    if len(history) < ADV_SESSIONS:
        return None
    splits = [a for a in split_actions if a['security_id'] == security_id]
    total = Decimal(0)
    for bar in history[-ADV_SESSIONS:]:
        _bar(bar, bar['session_date'])
        adjusted = Decimal(bar['volume'])
        for a in splits:
            if bar['session_date'] < a['session_date'] <= prior_session:
                adjusted *= Decimal(a['split_ratio'])
        total += adjusted
    return int(total // ADV_SESSIONS)


def _events(events, members, symbols, session):
    _need(isinstance(events, list), 'EVENT_SCHEMA')
    seen = set()
    open_at = stamp(session['open_at'])
    for e in events:
        _need(isinstance(e, dict) and e.get('type') in EVENT_TYPES, 'UNSUPPORTED_EVENT_TYPE')
        _need(e.get('security_id') in members, 'EVENT_FOR_NON_MEMBER')
        _label(e.get('event_id'), 'EVENT_SCHEMA')
        _need(e['security_id'] not in seen, 'COMBINED_SAME_SESSION_EVENTS')
        seen.add(e['security_id'])
        _need(_time(e.get('effective_at'), 'EVENT_SCHEMA') == open_at, 'EVENT_NOT_EFFECTIVE_AT_SESSION_OPEN')
        _need(_time(e.get('available_at'), 'EVENT_SCHEMA') < open_at, 'EVENT_AVAILABLE_AT_OR_AFTER_OPEN')
    return apply_renames(symbols, events)


def build_session(*, calendar, session_date, kind, members, symbols, session_bars, volume_history,
                  split_actions, events, actions_available_at, execution, volume_available_at,
                  close_available_at):
    """One accounting-v2 session with raw-open bid==ask quotes and close marks.

    members: the current month's PIT universe. Every member needs a session
    bar: a missing bar blocks the whole session (never skipped or filled).
    symbols: {member: ticker at the prior close}; renames in events apply.
    volume_history: {member: lookback bars through the prior session}.
    execution: {observed_at, available_at, bid_size, ask_size}, an explicit,
    reviewed raw-open execution proxy applied to every quote this session.
    """
    sessions = reviewed_sessions(calendar)
    days, index = _prior(sessions, session_date, 'SESSION_NOT_IN_REVIEWED_CALENDAR')
    prior = days[index - 1]
    row = sessions[session_date]
    open_at, close_at = stamp(row['open_at']), stamp(row['close_at'])
    _need(kind in KINDS, 'SESSION_KIND_INVALID')
    members = _ids(members)
    _need(isinstance(symbols, dict) and set(symbols) == set(members), 'SYMBOLS_DO_NOT_COVER_MEMBERS')
    _need(_time(actions_available_at, 'ACTIONS_AVAILABILITY_REQUIRED') < open_at,
          'ACTIONS_AVAILABLE_AT_OR_AFTER_OPEN')
    _need(isinstance(execution, dict) and set(execution) == EXECUTION, 'EXECUTION_PROXY_SCHEMA')
    observed = _time(execution['observed_at'], 'EXECUTION_PROXY_SCHEMA')
    available = _time(execution['available_at'], 'EXECUTION_PROXY_SCHEMA')
    _need(observed <= available <= open_at and (open_at - observed).total_seconds() <= 60,
          'EXECUTION_PROXY_TIMING_INVALID')
    _need(all(type(execution[k]) is int and 0 <= execution[k] <= 10**12 for k in ('bid_size', 'ask_size')),
          'EXECUTION_PROXY_SIZES_INVALID')
    volume_at = _time(volume_available_at, 'VOLUME_AVAILABILITY_REQUIRED')
    _need(volume_at >= stamp(sessions[prior]['close_at']), 'VOLUME_AVAILABLE_BEFORE_PRIOR_CLOSE')
    _need(volume_at < open_at, 'VOLUME_AVAILABLE_AT_OR_AFTER_OPEN')
    _need(_time(close_available_at, 'CLOSE_AVAILABILITY_REQUIRED') >= close_at,
          'CLOSE_MARK_AVAILABLE_BEFORE_COMPLETION')
    _need(isinstance(split_actions, list) and all(isinstance(a, dict) and set(a) == ACTION
                                                  for a in split_actions), 'ACTION_SCHEMA')
    current = _events(events, members, symbols, row)
    _need(isinstance(session_bars, dict), 'SESSION_BAR_SCHEMA')
    _need(set(members) <= set(session_bars), 'MISSING_SESSION_BAR')
    _need(set(session_bars) <= set(members), 'SESSION_BAR_FOR_NON_MEMBER')
    _need(isinstance(volume_history, dict) and set(members) <= set(volume_history),
          'MEMBER_VOLUME_HISTORY_MISSING')
    quotes, marks = [], []
    for sid in members:
        bar = session_bars[sid]
        _need(isinstance(bar, dict) and bar.get('session_date') == session_date, 'SESSION_BAR_DATE_MISMATCH')
        _bar(bar, session_date)
        _price(bar['open'], 'OPEN_PRICE_PRECISION_EXCEEDS_FROZEN_SPREAD_BOUND', OPEN_PLACES)
        adv = prior_adv20(sid, volume_history[sid], sessions=sessions, prior_session=prior,
                          split_actions=split_actions)
        if adv is not None:
            quotes.append(dict(security_id=sid, symbol=current[sid], bid=bar['open'], ask=bar['open'],
                observed_at=execution['observed_at'], available_at=execution['available_at'],
                tradable=True, bid_size=execution['bid_size'], ask_size=execution['ask_size'],
                prior_adv20_shares=adv, volume_available_at=volume_available_at,
                volume_last_session=prior))
        marks.append(dict(security_id=sid, symbol=current[sid], price=bar['close'],
                          completed_at=row['close_at'], available_at=close_available_at))
    session = dict(date=session_date, open_at=row['open_at'], close_at=row['close_at'], kind=kind,
                   price_adjustment='raw', currency='USD', actions_complete=True,
                   actions_available_at=actions_available_at, events=deepcopy(events),
                   quotes=quotes, close_marks=marks)
    validate_session(session)
    return session


def validate_session(session):
    """Independent output check; also usable on a session from elsewhere."""
    _need(isinstance(session, dict) and session.get('price_adjustment') == 'raw'
          and session.get('currency') == 'USD' and session.get('kind') in KINDS
          and session.get('actions_complete') is True, 'SESSION_SCHEMA')
    quotes, marks = session.get('quotes'), session.get('close_marks')
    _need(isinstance(quotes, list) and isinstance(marks, list), 'SESSION_SCHEMA')
    for q in quotes:
        _need(q.get('bid') == q.get('ask'), 'QUOTE_NOT_UNSPREAD_RAW_OPEN')
        _price(q.get('bid'), 'OPEN_PRICE_PRECISION_EXCEEDS_FROZEN_SPREAD_BOUND', OPEN_PLACES)
        _need(q.get('tradable') is True, 'QUOTE_NOT_TRADABLE')
    _need(len({q['security_id'] for q in quotes}) == len(quotes), 'DUPLICATE_QUOTE')
    _need(len({m['security_id'] for m in marks}) == len(marks), 'DUPLICATE_CLOSE_MARK')
    _need({q['security_id'] for q in quotes} <= {m['security_id'] for m in marks}, 'QUOTE_WITHOUT_CLOSE_MARK')
    return session


def build_row(session, built=None):
    """Stream row: evidence and identity records only on a monthly decision."""
    validate_session(session)
    row = dict(session=session)
    if built is not None:
        _need(isinstance(built, dict) and set(built) == {'evidence', 'identity_records'}, 'DECISION_SCHEMA')
        decided = _time(built['evidence']['decision_at'], 'DECISION_AT_INVALID')
        _need(decided.astimezone(NY).date().isoformat() == session['date'], 'DECISION_SESSION_MISMATCH')
        row['evidence'] = built['evidence']; row['identity_records'] = built['identity_records']
    return row
