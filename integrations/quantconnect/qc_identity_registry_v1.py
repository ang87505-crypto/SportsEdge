"""In-cloud QuantConnect observations -> stock_identity_bridge_v1 interval records.

Construction only: no acquisition, export, orders or source certification.
Every output record is re-validated by the unchanged frozen IdentityRegistry.

What QuantConnect can and cannot supply here (see the gap report):
- Permanent identity: LEAN Symbol.ID survives ticker changes. Its Date is "the
  first date mentioned in the map_files" (SecurityIdentifier.cs), so for
  securities already trading when vendor coverage starts it is LEFT-CENSORED,
  not a listing date. Censoring is marked and must be proven harmless.
- Ticker history: map-file rows (date, ticker, primary exchange).
- Exchange, security type, depositary-receipt flag, Morningstar sector and
  IPODate: Fundamental objects read at monthly selection. QuantConnect does
  NOT document whether historical classifications are point-in-time; their
  backtest-time as-of is used and labelled vendor_asof_unverified.
Vendor-code -> frozen-label mappings are a reviewed INPUT. None are assumed.
"""
from analytics.stock_accounting_v2 import NY, iso_day, stamp
from analytics.stock_identity_bridge_v1 import FIELDS, IdentityRegistry

VERSION = 'sportsedge-qc-identity-registry-v1'
POLICIES = ('block', 'carry_back_first_observation')
OBSERVATION = {'symbol', 'exchange_code', 'security_type_code', 'is_depositary_receipt',
               'sector_code', 'ipo_date'}
MAPPING = {'reference', 'exchange', 'security_type', 'sector'}


class IdentityBlocked(ValueError):
    """Fixed, data-free reason code. str(exc) is the code alone."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _need(ok, code):
    if not ok:
        raise IdentityBlocked(code)


def _validate_mapping(mapping):
    _need(isinstance(mapping, dict) and set(mapping) == MAPPING
          and isinstance(mapping['reference'], str) and bool(mapping['reference'].strip()),
          'REVIEWED_MAPPING_REQUIRED')
    for key in ('exchange', 'security_type', 'sector'):
        _need(isinstance(mapping[key], dict) and bool(mapping[key]), 'REVIEWED_MAPPING_REQUIRED')
    _need(set(mapping['exchange'].values()) <= {'NYSE', 'NASDAQ', 'AMEX'}
          and set(mapping['security_type'].values()) == {'common_stock'}, 'MAPPING_TARGET_INVALID')


def classify(row, mapping):
    """(symbol, exchange, type, sector) if in the frozen universe scope, else None.

    Out of scope = unmapped exchange or security type, or a depositary receipt.
    An in-scope common stock with an unmapped sector BLOCKS: dropping it would
    silently delete a member, and the two-per-sector cap needs every sector.
    """
    _need(isinstance(row, dict) and set(row) == OBSERVATION, 'OBSERVATION_SCHEMA')
    _need(isinstance(row['is_depositary_receipt'], bool), 'OBSERVATION_SCHEMA')
    exchange = mapping['exchange'].get(row['exchange_code'])
    kind = mapping['security_type'].get(row['security_type_code'])
    if exchange is None or kind is None or row['is_depositary_receipt']:
        return None
    sector = mapping['sector'].get(row['sector_code'])
    _need(sector is not None, 'SECTOR_UNMAPPED_FOR_IN_SCOPE_MEMBER')
    _need(isinstance(row['symbol'], str) and bool(row['symbol'].strip()), 'OBSERVATION_SCHEMA')
    return row['symbol'], exchange, kind, sector


def _ticker_at(history, at):
    current = [ticker for start, ticker in history if stamp(start) <= at]
    _need(bool(current), 'TICKER_HISTORY_DOES_NOT_COVER_SNAPSHOT')
    return current[-1]


def _ticker_change(history, after, until, symbol):
    changes = [start for start, ticker in history if after < stamp(start) <= until]
    _need(len(changes) == 1 and dict(history)[changes[0]] == symbol,
          'TICKER_CHANGE_NOT_UNIQUELY_DATED')
    return changes[0]


def left_censor_is_harmless(censor_date, session_dates, first_decision_session, required=253):
    """A censored first date cannot change eligibility if the first decision
    already has `required` completed sessions on or after the censor date."""
    censor = iso_day(censor_date).isoformat()
    first = iso_day(first_decision_session).isoformat()
    days = [iso_day(d).isoformat() for d in session_dates]
    _need(days == sorted(set(days)) and first in days, 'CALENDAR_INVALID')
    return sum(1 for d in days if censor <= d < first) >= required


def build_records(security_id, *, sid_first_date, coverage_start, ticker_history, snapshots,
                  mapping, decision_at, dataset_revision, terminal_at=None, policy='block'):
    """Decision-local FIELDS records for one permanent ID.

    snapshots: the GLOBAL monthly schedule, each {asof_at, observed_at, row},
      row None when this ID was absent. asof_at is the Fundamental EndTime and
      becomes an interval boundary; observed_at is when the value was read and
      becomes availability. Snapshots at/after decision_at are never read.
    ticker_history: map-file [(effective_from ISO, ticker), ...] ascending.
    policy 'block' starts the first interval at its first observation, so raw
      lookback bars before it fail the frozen continuity check. The explicit
      'carry_back_first_observation' policy back-dates it to the ticker's
      map-file start and tags the record; it needs a protocol amendment.
    """
    _need(policy in POLICIES, 'UNKNOWN_POLICY')
    _validate_mapping(mapping)
    at = stamp(decision_at)
    first_day = iso_day(sid_first_date).isoformat()
    censored = first_day <= iso_day(coverage_start).isoformat()
    _need(isinstance(ticker_history, list) and bool(ticker_history)
          and [stamp(s) for s, _ in ticker_history] == sorted({stamp(s) for s, _ in ticker_history})
          and stamp(ticker_history[0][0]).astimezone(NY).date().isoformat() == first_day,
          'TICKER_HISTORY_INVALID')
    visible = [s for s in snapshots if stamp(s['observed_at']) < at]
    _need(all(stamp(a['asof_at']) < stamp(b['asof_at']) for a, b in zip(visible, visible[1:]))
          and all(stamp(s['asof_at']) <= stamp(s['observed_at']) for s in visible), 'SNAPSHOT_ORDER')
    states = [None if s['row'] is None else classify(s['row'], mapping) for s in visible]
    for s, state in zip(visible, states):
        if state is not None:
            _need(_ticker_at(ticker_history, stamp(s['asof_at'])) == state[0],
                  'TICKER_HISTORY_DISAGREES_WITH_SNAPSHOT')
            ipo = s['row']['ipo_date']
            if ipo is not None:
                ipo = iso_day(ipo).isoformat()
                _need(ipo <= first_day if censored else ipo == first_day, 'FIRST_TRADE_DATE_CONFLICT')
    present = [i for i, state in enumerate(states) if state is not None]
    _need(bool(present), 'NO_IN_SCOPE_OBSERVATION')
    first_seen = visible[present[0]]['observed_at']
    source = 'qc-morningstar-asof:' + dataset_revision + ':vendor_asof_unverified'
    records = []; i = present[0]
    while i < len(states):
        state = states[i]
        if state is None:
            i += 1
            continue
        j = i
        while j + 1 < len(states) and states[j + 1] == state:
            j += 1
        snap = visible[i]
        prior = records[-1] if records and states[i - 1] is not None else None
        if prior is not None and prior['symbol'] != state[0]:
            start = _ticker_change(ticker_history, stamp(visible[i - 1]['asof_at']),
                                   stamp(snap['asof_at']), state[0])
        else:
            start = snap['asof_at']
        source_id = source
        if not records and policy == 'carry_back_first_observation':
            starts = [s for s, t in ticker_history if t == state[0] and stamp(s) <= stamp(start)]
            _need(bool(starts), 'TICKER_HISTORY_DOES_NOT_COVER_SNAPSHOT')
            start = starts[-1]
            source_id = source + ':carried_back_unverified'
        if prior is not None:
            prior['effective_until'] = start
            prior['available_at'] = snap['observed_at']
        record = dict(security_id=security_id, symbol=state[0], exchange=state[1], type=state[2],
                      sector=state[3], effective_from=start, effective_until=None,
                      available_at=snap['observed_at'], source_id=source_id,
                      first_traded_on=first_day, first_trade_available_at=first_seen,
                      first_trade_source_id='qc-sid-first-mapfile-date'
                      + (':left_censored' if censored else ''))
        _need(first_day <= stamp(start).astimezone(NY).date().isoformat(), 'LISTING_AFTER_MAPPING')
        records.append(record)
        if j + 1 < len(states) and states[j + 1] is None:
            end = visible[j + 1]
            until = end['asof_at']
            if terminal_at is not None:
                _need(stamp(visible[j]['asof_at']) < stamp(terminal_at) <= stamp(end['asof_at']),
                      'TERMINAL_DATE_OUTSIDE_EXIT_WINDOW')
                until = terminal_at
            record['effective_until'] = until
            record['available_at'] = end['observed_at']
        i = j + 1
    _need(all(set(r) == FIELDS for r in records), 'FROZEN_REGISTRY_REJECTED_RECORDS')
    try:
        IdentityRegistry(records, decision_at=decision_at)
    except ValueError:
        raise IdentityBlocked('FROZEN_REGISTRY_REJECTED_RECORDS') from None
    return records
