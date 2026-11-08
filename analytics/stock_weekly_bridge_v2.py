"""Weekly current-data bridge for the separately registered paper experiment stock-v2-weekly.

Differences from stock_forward_bridge_v1 (which stays unchanged for the frozen monthly model):
- Decisions are taken at 08:00 New York on the first exchange session of each ISO week,
  or once on the experiment's first session (`initial`), with no calendar-year limit.
- The universe is a fixed, reviewed list of large, liquid US common stocks
  (config/paper-auto/universe-large-cap-v1.json) instead of every listed common stock,
  so no full security master or action-coverage attestation is needed.
- A member with missing, changed or unobserved bars, a listing mismatch, or an
  unsupported or ambiguous corporate action is SKIPPED and named in the diagnostics,
  instead of rejecting the whole decision. A skipped member that is currently held
  still rejects the decision, because the planner cannot price an unscored holding.
- Optional `max_last_close` in the universe file: a stock not currently held whose last
  completed close is above it is skipped as unaffordable, so a small paper account
  (10% of equity per target, whole shares) can buy every target it selects.

Everything else is reused from v1 unchanged: the two observations (a reference capture
before 08:00 and a decision capture sealed within 60 seconds of 08:00), raw SIP daily
bars, the provider guards, and the decision-record format the controller and database
accept. Scores come from stock_weekly_scoring_v2, the frozen mathematics with the
weekly calendar rule. Read-only GETs only; no orders and no database writes.
"""
from __future__ import annotations
import argparse
from datetime import date, datetime, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import time
from typing import Callable
from .stock_accounting_v2 import require, stamp as strict_stamp
from .stock_forward_bridge_v1 import (Rejected, Source, EXCHANGES, SYMBOL, PAPER, DATA, SUPPORTED_ACTIONS,
                                      SYMBOL_FIELDS, DATE_FIELDS, canonical, sha256, stamp, iso, ny_at,
                                      decimal_text, parse_calendar, bars_by_symbol, part, timing_problem)
from .stock_momentum_v1 import VERSION as BASELINE, digest
from .stock_rank_buffer_candidate import VERSION as CANDIDATE, choose
from .stock_weekly_scoring_v2 import score_universe_weekly, rebalance_rule, _week
from .stock_lowvol_weekly_v1 import VERSION as LOWVOL, choose as choose_lowvol, volatility_by_symbol

VERSION = 'stock-weekly-bridge-v2'
UNIVERSE_VERSION = 'sportsedge-weekly-universe-v1'
MIN_SCORED_MEMBERS = 20

# ---------------------------------------------------------------- calendar


def decision_point(sessions: list[dict], session: str, initial: bool = False):
    """(08:00 New York, index) on the first session of an ISO week, or any session when initial."""
    dates = [s['date'] for s in sessions]
    if session not in dates or dates.index(session) == 0:
        return None
    k = dates.index(session)
    if not initial and _week(date.fromisoformat(dates[k - 1])) == _week(date.fromisoformat(session)):
        return None
    return ny_at(date.fromisoformat(session), '08:00'), k


# ---------------------------------------------------------------- registered universe


def max_last_close(universe):
    """The optional affordability cap as a Decimal, or None."""
    if 'max_last_close' not in universe:
        return None
    try:
        return Decimal(decimal_text(universe['max_last_close'], 'max_last_close'))
    except Rejected:
        raise Rejected(['UNIVERSE_MAX_LAST_CLOSE_INVALID']) from None


def parse_universe(universe, decision_at: datetime) -> list[dict]:
    if not isinstance(universe, dict) or universe.get('version') != UNIVERSE_VERSION:
        raise Rejected(['UNIVERSE_MISSING_OR_UNREGISTERED_VERSION'])
    for k in ('source', 'revision', 'classification', 'first_traded_on_basis'):
        if not isinstance(universe.get(k), str) or not universe[k].strip():
            raise Rejected(['UNIVERSE_FIELD_MISSING:' + k])
    if stamp(universe.get('available_at'), 'universe.available_at') >= decision_at:
        raise Rejected(['UNIVERSE_NOT_AVAILABLE_BEFORE_DECISION'])
    if 'max_last_close' in universe and not isinstance(universe['max_last_close'], str):
        raise Rejected(['UNIVERSE_MAX_LAST_CLOSE_INVALID'])
    max_last_close(universe)
    rows = universe.get('securities')
    if not isinstance(rows, list) or not rows:
        raise Rejected(['UNIVERSE_EMPTY'])
    seen = set()
    for r in rows:
        if not isinstance(r, dict) or set(r) != {'symbol', 'sector', 'first_traded_on'} \
                or not SYMBOL.fullmatch(str(r.get('symbol'))) or not isinstance(r.get('sector'), str) \
                or not r['sector'].strip() or r['sector'] != r['sector'].strip():
            raise Rejected(['UNIVERSE_ROW_INVALID'])
        date.fromisoformat(r['first_traded_on'])
        if r['symbol'] in seen:
            raise Rejected(['UNIVERSE_DUPLICATE_SYMBOL:' + r['symbol']])
        seen.add(r['symbol'])
    return sorted(rows, key=lambda r: r['symbol'])


def listed_by_symbol(assets) -> dict:
    """Active Alpaca US equities on the registered exchanges, keyed by symbol."""
    if not isinstance(assets, list):
        raise Rejected(['ASSETS_INVALID'])
    out = {}
    for a in assets:
        if not isinstance(a, dict) or a.get('class') != 'us_equity' or a.get('status') != 'active' \
                or a.get('exchange') not in EXCHANGES or not SYMBOL.fullmatch(str(a.get('symbol'))):
            continue
        if a['symbol'] in out:
            raise Rejected(['ASSET_IDENTITY_DUPLICATE:' + a['symbol']])
        out[a['symbol']] = {'id': str(a.get('id')), 'exchange': a['exchange']}
    return out


def member_actions(pages, members: set, window: tuple[str, str]):
    """Supported splits and cash dividends per member; members with anything else are skipped."""
    supported, skipped = [], {}
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
                if kind not in SUPPORTED_ACTIONS or not isinstance(r.get('symbol'), str) \
                        or r['symbol'] not in members or not isinstance(r.get('ex_date'), str):
                    for s in touched:
                        skipped[s] = 'UNSUPPORTED_CORPORATE_ACTION:' + kind + ':' + when
                    continue
                try:
                    if kind == 'cash_dividends':
                        split, dividend = '1', decimal_text(r.get('rate'), 'dividend.rate:' + r['symbol'])
                    else:
                        new = Decimal(decimal_text(r.get('new_rate'), 'split.new_rate'))
                        old = Decimal(decimal_text(r.get('old_rate'), 'split.old_rate'))
                        split, dividend = format((new / old).normalize(), 'f'), '0'
                except Rejected:
                    skipped[r['symbol']] = 'CORPORATE_ACTION_INVALID:' + kind + ':' + when
                    continue
                supported.append({'symbol': r['symbol'], 'session_date': r['ex_date'],
                                  'split_ratio': split, 'cash_dividend_per_old_share': dividend,
                                  'source_id': 'alpaca-ca:' + kind + ':' + str(r.get('id', ''))})
    merged: dict = {}
    for a in supported:
        key = (a['symbol'], a['session_date'])
        if key in merged:
            # Alpaca does not state the dividend unit for same-day split and dividend events.
            skipped[a['symbol']] = 'AMBIGUOUS_SAME_DAY_ACTIONS:' + a['session_date']
        merged[key] = a
    kept = [a for a in merged.values() if a['symbol'] not in skipped]
    return sorted(kept, key=lambda a: (a['symbol'], a['session_date'])), skipped


# ---------------------------------------------------------------- assembly


def assemble(capture: dict, universe, *, experiment_id: str, registered_at: str, model_version: str,
             held_security_ids: list[str], initial: bool):
    """The scoring inputs plus the skipped members, or Rejected with every reason found."""
    if model_version not in (BASELINE, CANDIDATE, LOWVOL):
        raise Rejected(['UNREGISTERED_MODEL'])
    sessions = parse_calendar(capture['calendar']['rows'])
    point = decision_point(sessions, capture['session'], initial)
    if point is None:
        raise Rejected(['NOT_A_DECISION_SESSION'])
    decision_at, k = point
    completed = sessions[:k]
    if len(completed) < 253:
        raise Rejected(['CALENDAR_HISTORY_TOO_SHORT'])
    window = [s['date'] for s in completed[-253:]]
    rows = parse_universe(universe, decision_at)
    price_cap = max_last_close(universe)
    held_ids = set(held_security_ids)
    listed = listed_by_symbol(capture['assets']['rows'])
    dates = {s['date'] for s in completed}
    before = bars_by_symbol(capture['reference_bars']['pages'], dates)
    at = bars_by_symbol(capture['decision_bars']['pages'], dates)
    in_window = set(window)
    reference_at, decision_retrieved = capture['reference_bars']['retrieved_at'], capture['decision_bars']['retrieved_at']
    revision = 'alpaca-sip-pages-' + sha256([capture['reference_bars']['page_sha256'],
                                             capture['decision_bars']['page_sha256']])
    close_at = {s['date']: s['close_at'] for s in completed}
    skipped: dict = {}
    candidates = {}
    for r in rows:
        sym = r['symbol']
        if sym not in listed:
            skipped[sym] = 'NOT_AN_ACTIVE_LISTED_ASSET'
            continue
        expected = [d for d in window if d >= r['first_traded_on']]
        now_bars = {d: b for d, b in at.get(sym, {}).items() if d in in_window}
        old_bars = {d: b for d, b in before.get(sym, {}).items() if d in in_window}
        if not expected or any(d not in now_bars for d in expected):
            skipped[sym] = f'MISSING_BARS:{sum(d not in now_bars for d in expected)}'
        elif any(d < r['first_traded_on'] for d in now_bars):
            skipped[sym] = 'BARS_BEFORE_DECLARED_LISTING'
        elif any(d not in old_bars for d in expected):
            skipped[sym] = 'BARS_NOT_OBSERVED_BEFORE_DECISION'
        elif any(old_bars[d] != now_bars[d] for d in expected):
            skipped[sym] = 'BARS_CHANGED_BETWEEN_OBSERVATIONS'
        elif price_cap is not None and 'alpaca:' + listed[sym]['id'] not in held_ids \
                and Decimal(now_bars[window[-1]]['c']) > price_cap:
            # Unaffordable at 10% of a small account in whole shares; holdings are never skipped for price.
            skipped[sym] = 'LAST_CLOSE_ABOVE_CAP:' + now_bars[window[-1]]['c']
        else:
            candidates[sym] = (r, listed[sym], expected, now_bars)
    actions, action_skips = member_actions(capture['actions']['pages'], set(candidates), (window[0], window[-1]))
    for sym, why in action_skips.items():
        if sym in candidates:
            skipped[sym] = why
            del candidates[sym]
    for a in actions:
        a['available_at'] = capture['actions']['retrieved_at']
    universe_rows, shards, listings = [], [], {}
    for sym, (r, asset, expected, now_bars) in sorted(candidates.items()):
        sid = 'alpaca:' + asset['id']
        universe_rows.append({'security_id': sid, 'symbol': sym, 'type': 'common_stock',
                              'exchange': asset['exchange'], 'sector': r['sector']})
        bars = [{'symbol': sym, 'session_date': d, 'status': 'complete', 'completed_at': close_at[d],
                 'available_at': reference_at, 'open': now_bars[d]['o'], 'high': now_bars[d]['h'],
                 'low': now_bars[d]['l'], 'close': now_bars[d]['c'], 'volume': now_bars[d]['v']} for d in expected]
        shards.append({'security_id': sid, 'payload': {
            'asset_class': 'us_equities', 'timeframe': '1d', 'currency': 'USD', 'price_adjustment': 'raw',
            'provider': 'Alpaca Market Data API (SIP consolidated, raw)', 'source_revision': revision,
            'retrieved_at': decision_retrieved, 'bars': bars}})
        listings[sid] = {'first_traded_on': r['first_traded_on'], 'available_at': universe['available_at'],
                         'source_id': universe['revision'] + ':' + sym}
    held = sorted(held_security_ids)
    reasons = []
    lost = [h for h in held if h not in listings]
    if lost:
        reasons.append('HELD_SECURITY_SKIPPED:' + ','.join(lost[:10]))
    if len(listings) < MIN_SCORED_MEMBERS:
        reasons.append(f'TOO_FEW_MEMBERS:{len(listings)}<{MIN_SCORED_MEMBERS}')
    if reasons:
        raise Rejected(reasons + [f'SKIPPED:{len(skipped)}'])
    context = {
        'calendar_revision': 'alpaca-calendar-' + capture['calendar']['sha256'],
        'calendar_available_at': capture['calendar']['retrieved_at'],
        'universe_revision': UNIVERSE_VERSION + ':' + universe['revision'] + '+alpaca-assets-'
        + sha256(sorted((s, listed[s]) for s in candidates)),
        'universe_available_at': iso(max(stamp(universe['available_at'], 'universe'),
                                         stamp(capture['assets']['retrieved_at'], 'assets'))),
        'universe_session': window[-1],
        # Coverage is Alpaca's corporate-action feed for the kept members, as returned; it is
        # not independently attested (the frozen v1 bridge requires an owner attestation).
        'actions_revision': 'alpaca-actions-unattested-' + sha256(capture['actions']['page_sha256']),
        'actions_available_at': capture['actions']['retrieved_at'],
        'actions_complete': True,
        'actions_coverage_start': window[0], 'actions_coverage_end': window[-1],
        'sessions': sessions[:k + 1], 'universe': universe_rows, 'actions': actions}
    bundle = {'experiment_id': experiment_id, 'registered_at': registered_at,
              'observed_at': capture['observed_at'], 'model_version': model_version,
              'held_security_ids': held,
              'evidence': {'shards': shards, 'context': context, 'listings': listings,
                           'decision_at': iso(decision_at)}}
    return bundle, dict(sorted(skipped.items()))


def weekly_signal(bundle, initial: bool):
    """The v1 signal artifact format, scored with the weekly calendar rule. No year limit."""
    experiment = bundle['experiment_id']
    model = bundle['model_version']
    require(model in (BASELINE, CANDIDATE, LOWVOL), 'Unregistered model')
    evidence = bundle['evidence']
    decision = strict_stamp(evidence['decision_at'])
    require(strict_stamp(bundle['registered_at']) < decision <= strict_stamp(bundle['observed_at'])
            and (strict_stamp(bundle['observed_at']) - decision).total_seconds() <= 60,
            'Pre-register experiment; capture decision within sixty seconds')
    for shard in evidence['shards']:
        require(strict_stamp(shard['payload']['retrieved_at']) <= strict_stamp(bundle['observed_at']),
                'Payload retrieved after declared capture')
    scored = score_universe_weekly(**evidence, initial=initial)
    held = bundle['held_security_ids']
    require(set(held) <= set(scored['members']), 'Held security missing; reconcile event first')
    held_symbols = {scored['members'][sid]['symbol'] for sid in held}
    if model == LOWVOL:
        # Steady stocks: same validated scores, ranked by window volatility instead of momentum.
        selected = choose_lowvol(scored['scores'], volatility_by_symbol(evidence))
    else:
        selected = choose(scored['scores'], held_symbols if model == CANDIDATE else set())
    result = {
        # Artifact format consumed unchanged by the planner and the database.
        'version': 'stock-forward-signal-v1', 'experimentId': experiment,
        'modelVersion': model, 'decisionAt': decision.isoformat(),
        'scoringReportId': scored['report_id'],
        'targets': [{'securityId': r['security_id'], 'symbol': r['symbol'],
                     'sector': r['sector']} for r in selected],
        'heldSecurityIds': sorted(held), 'members': scored['members'],
        'priorInputs': scored['prior_inputs'],
        'observedAt': bundle['observed_at'], 'registeredAt': bundle['registered_at'],
        'sourceIndependentlyVerified': False, 'executionPermitted': False,
        'performance': None,
        # Disclosure: this is the weekly paper variant, not the frozen monthly research model.
        'variant': {'bridge': VERSION, 'scoring': scored['adapter_version'], 'rebalance': rebalance_rule(initial),
                    'universe': UNIVERSE_VERSION},
    }
    if model == LOWVOL:
        result['variant']['selection'] = 'lowest-252-session-volatility-trend200'
    result['decisionId'] = digest(result)
    return result


def decide(capture: dict, universe, registration: dict, held_security_ids: list[str], initial: bool = False):
    """One controller decision record for the session, or None when it is not a decision session."""
    experiment = registration['experimentId']
    sessions = parse_calendar(capture['calendar']['rows'])
    point = decision_point(sessions, capture['session'], initial)
    if point is None:
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
        bundle, skipped = assemble(capture, universe, experiment_id=experiment,
                                   registered_at=registration['registeredAt'],
                                   model_version=registration['modelVersion'],
                                   held_security_ids=held_security_ids, initial=initial)
        signal = weekly_signal(bundle, initial)
    except Rejected as e:
        reasons = e.reasons
    except ValueError as e:
        reasons = ['WEEKLY_SIGNAL_REFUSED:' + str(e)[:200]]
    else:
        return base | {'outcome': 'TARGETS' if signal['targets'] else 'HOLD_NO_TARGETS',
                       'decisionId': signal['decisionId'], 'signal': signal, 'inputDigest': sha256(bundle),
                       'scoringReportId': signal['scoringReportId'],
                       'diagnostics': {'universeMembers': len(bundle['evidence']['shards']),
                                       'skipped': skipped, 'rebalance': rebalance_rule(initial),
                                       'corporateActions': len(bundle['evidence']['context']['actions'])}}
    return base | {'outcome': 'INPUT_REJECTED', 'diagnostics': {'reasons': reasons},
                   'decisionId': sha256({'rejected': base, 'reasons': reasons})}


# ---------------------------------------------------------------- capture (network, opt-in)


def capture_reference(*, session: str, universe, source: Source, initial: bool = False,
                      now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> dict:
    """Observation 1, before 08:00 New York: calendar, assets, corporate actions and member bars."""
    target = date.fromisoformat(session)
    rows = source.fetch(PAPER, '/v2/calendar', {'start': date(target.year - 2, target.month, 1).isoformat(),
                                                'end': session})
    out = {'version': VERSION + '-capture', 'session': session, 'initial': initial, 'decision_bars': None,
           'observed_at': None, 'calendar': {'rows': rows, 'sha256': sha256(rows), 'retrieved_at': iso(now())}}
    sessions = parse_calendar(rows)
    point = decision_point(sessions, session, initial)
    if point is None:
        raise Rejected(['NOT_A_DECISION_SESSION'])
    try:
        if now() >= point[0]:
            raise Rejected(['REFERENCE_CAPTURE_TOO_LATE'])
        out['window'] = window = [s['date'] for s in sessions[:point[1]][-253:]]
        assets = source.fetch(PAPER, '/v2/assets', {'status': 'active', 'asset_class': 'us_equity'})
        out['assets'] = {'rows': assets, 'sha256': sha256(assets), 'retrieved_at': iso(now())}
        listed = listed_by_symbol(assets)
        out['members_requested'] = symbols = sorted(r['symbol'] for r in universe.get('securities', [])
                                                    if isinstance(r, dict) and r.get('symbol') in listed)
        actions = source.paged(DATA, '/v1/corporate-actions', {'symbols': ','.join(symbols), 'start': window[0],
                                                               'end': session, 'limit': 1000}) if symbols else []
        out['actions'] = part(actions, iso(now()))
        out['reference_bars'] = part(source.bars(symbols, window, session, 200, 4), iso(now()))
    except Rejected as e:
        out['capture_failure'] = e.reasons
    return out


def capture_decision(reference: dict, *, source: Source,
                     now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> dict:
    """Observation 2, from 08:00:00 New York: re-reads every member's bars, then seals the capture."""
    point = decision_point(parse_calendar(reference['calendar']['rows']), reference['session'],
                           reference.get('initial', False))
    started = now()
    if point is None or started < point[0]:
        raise Rejected(['DECISION_CAPTURE_BEFORE_DECISION'])
    pages = source.bars(reference['members_requested'], reference['window'], reference['session'], 200, 4)
    finished = iso(now())
    return reference | {'decision_bars': part(pages, finished, started_at=iso(started)), 'observed_at': iso(now())}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    c = sub.add_parser('capture', help='reference capture before 08:00, decision capture from 08:00:00')
    c.add_argument('--session', required=True)
    c.add_argument('--universe', type=Path, required=True)
    c.add_argument('--output', type=Path, required=True)
    c.add_argument('--initial', action='store_true')
    c.add_argument('--execute-network', action='store_true')
    d = sub.add_parser('decide', help='pure: capture + universe + registration -> controller decision record')
    for name in ('capture', 'universe', 'registration', 'output'):
        d.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    load = lambda path: json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    if a.command == 'capture':
        if not a.execute_network:
            print(json.dumps({'mode': 'plan_only_no_network', 'session': a.session, 'initial': a.initial}))
            return
        if a.output.exists():
            p.error('output exists; refusing to overwrite')
        source = Source(os.getenv('ALPACA_PAPER_AUTO_KEY_ID', ''), os.getenv('ALPACA_PAPER_AUTO_SECRET_KEY', ''))
        try:
            reference = capture_reference(session=a.session, universe=load(a.universe), source=source,
                                          initial=a.initial)
        except Rejected as e:
            if e.reasons != ['NOT_A_DECISION_SESSION']:
                raise
            # A scheduled run on any other weekday (or a holiday) is a quiet no-op: no capture file.
            print(json.dumps({'status': 'NO_DECISION_THIS_SESSION', 'session': a.session}))
            return
        sealed = reference
        if 'capture_failure' not in reference:
            point = decision_point(parse_calendar(reference['calendar']['rows']), a.session, a.initial)
            wait = (point[0] - datetime.now(timezone.utc)).total_seconds()
            if wait > 0:
                time.sleep(wait)
            try:
                sealed = capture_decision(reference, source=source)
            except Rejected as e:
                sealed = reference | {'capture_failure': e.reasons}
        with a.output.open('x', encoding='utf-8') as f:
            json.dump(sealed, f, allow_nan=False)
        print(json.dumps({'status': 'CAPTURED', 'session': a.session, 'members': len(sealed.get('members_requested', [])),
                          'failure': sealed.get('capture_failure')}))
        return
    registration = load(a.registration)
    capture = load(a.capture)
    record = decide(capture, load(a.universe), registration, registration.get('heldSecurityIds', []),
                    bool(capture.get('initial')))
    if record is None:
        print(json.dumps({'status': 'NO_DECISION_THIS_SESSION'}))
        return
    with a.output.open('x', encoding='utf-8') as f:
        json.dump(record, f, allow_nan=False)
    print(json.dumps({'status': 'DECISION_WRITTEN', 'outcome': record['outcome'], 'decisionId': record['decisionId'],
                      'diagnostics': record.get('diagnostics')}))


if __name__ == '__main__':
    main()
