"""Fictional calendar, assets, prices and classifications; no market or return evidence."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
import unittest
from zoneinfo import ZoneInfo
from analytics.stock_forward_bridge_v1 import (decide, capture_reference, capture_decision, provider_get, Rejected,
                                               Source, Limiter, sha256, decision_point, parse_calendar, part)
from analytics.stock_forward_signal_v1 import BASELINE, CANDIDATE

NY = ZoneInfo('America/New_York')
SESSION = '2026-11-02'
IDS = {s: f'{i:08x}-1111-2222-3333-444444444444' for i, s in enumerate(('AAA', 'BBB', 'CCC', 'EEE', 'FFF', 'GGG'), 1)}


def utc(text):
    return datetime.fromisoformat(text.replace('Z', '+00:00'))


def calendar_rows():
    end = date(2026, 11, 2); days = []; d = end
    while len(days) < 270:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return [{'date': x.isoformat(), 'open': '09:30', 'close': '16:00'} for x in reversed(days)]


def bar_pages(prices=None):
    days = [date.fromisoformat(r['date']) for r in calendar_rows()][:-1]
    prices = prices or {'AAA': (20, 0.10), 'BBB': (30, 0.08), 'CCC': (25, 0.05)}
    bars = {}
    for sym, (start, step) in prices.items():
        bars[sym] = []
        for i, x in enumerate(days):
            p = round(start + i * step, 2)
            t = datetime.combine(x, datetime.min.time(), NY).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            bars[sym].append({'t': t, 'o': p, 'h': p, 'l': p, 'c': p, 'v': 2_000_000, 'n': 1000, 'vw': p})
    return [{'bars': {k: v[:150] for k, v in bars.items()}, 'next_page_token': 'p2'},
            {'bars': {k: v[150:] for k, v in bars.items()}, 'next_page_token': None}]


ASSETS = [{'id': IDS[s], 'class': 'us_equity', 'exchange': ex, 'symbol': s, 'status': st, 'tradable': True}
          for s, ex, st in (('AAA', 'NYSE', 'active'), ('BBB', 'NASDAQ', 'active'), ('CCC', 'NYSE', 'active'),
                            ('EEE', 'NYSE', 'active'), ('FFF', 'ARCA', 'active'), ('GGG', 'NYSE', 'inactive'))]
ACTIONS = [{'corporate_actions': {'cash_dividends': [], 'forward_splits': []}, 'next_page_token': None}]


def synthetic_capture(prices=None, reference='2026-11-02T12:58:00Z', started='2026-11-02T13:00:01Z',
                      finished='2026-11-02T13:00:20Z', observed='2026-11-02T13:00:21Z'):
    rows = calendar_rows()
    pages = bar_pages(prices)
    return {'version': 'stock-forward-bridge-v1-capture', 'session': SESSION,
            'calendar': {'rows': rows, 'sha256': sha256(rows), 'retrieved_at': reference},
            'assets': {'rows': ASSETS, 'sha256': sha256(ASSETS), 'retrieved_at': reference},
            'actions': part(deepcopy(ACTIONS), reference),
            'reference_bars': part(deepcopy(pages), reference),
            'decision_bars': part(pages, finished, started_at=started), 'observed_at': observed}


def master(skip=(), overrides=None):
    types = {'AAA': 'common_stock', 'BBB': 'common_stock', 'CCC': 'common_stock', 'EEE': 'etf'}
    sectors = {'AAA': 'Technology', 'BBB': 'Technology', 'CCC': 'Health Care'}
    rows = []
    for s, t in types.items():
        if s in skip:
            continue
        row = {'alpaca_asset_id': IDS[s], 'symbol': s, 'type': t,
               'exchange': 'NASDAQ' if s == 'BBB' else 'NYSE', 'source_id': 'synthetic-master-' + s}
        if t == 'common_stock':
            row |= {'sector': sectors[s], 'first_traded_on': '2000-01-03'}
        row |= (overrides or {}).get(s, {})
        rows.append(row)
    return {'version': 'sportsedge-security-master-v1', 'source': 'synthetic test fixture',
            'revision': 'synthetic-1', 'classification': 'synthetic-sectors', 'retrieved_at': '2026-10-30T22:00:00Z',
            'available_at': '2026-10-30T22:00:00Z', 'securities': rows}


ATTESTATION = {'version': 'sportsedge-action-coverage-attestation-v1', 'provider': 'alpaca-corporate-actions-v1',
               'coverage_start': '2025-01-01', 'coverage_end': '2026-11-02', 'attested_by': 'synthetic-reviewer',
               'attested_at': '2026-10-31T00:00:00Z', 'statement': 'synthetic test attestation'}
REG = {'experimentId': 'fwd-bridge-test', 'registeredAt': '2026-10-20T00:00:00Z', 'modelVersion': BASELINE}


def run(cap=None, mst=None, att=ATTESTATION, reg=REG, held=()):
    return decide(cap or synthetic_capture(), mst or master(), att, reg, list(held))


def both(cap, fn):
    """Applies the same edit to the reference and the decision observations."""
    for key in ('reference_bars', 'decision_bars'):
        for page in cap[key]['pages']:
            fn(page)
    return cap


class BridgeTests(unittest.TestCase):
    def test_targets_from_unchanged_frozen_signal(self):
        r = run()
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['decisionAt'], '2026-11-02T13:00:00Z')
        self.assertEqual(sorted(t['symbol'] for t in r['signal']['targets']), ['AAA', 'BBB', 'CCC'])
        self.assertEqual(r['signal']['modelVersion'], BASELINE)
        self.assertEqual(r['signal']['observedAt'], '2026-11-02T13:00:21Z')
        self.assertFalse(r['signal']['executionPermitted'])
        self.assertEqual(r['decisionId'], r['signal']['decisionId'])
        self.assertEqual(r['diagnostics']['excludedByType'], {'etf': 1})
        self.assertEqual(r['diagnostics']['universeMembers'], 3)
        self.assertTrue(all(t['securityId'].startswith('alpaca:') for t in r['signal']['targets']))

    def test_deterministic_and_order_independent(self):
        first = run()
        cap = synthetic_capture()
        cap['assets']['rows'] = list(reversed(cap['assets']['rows']))
        mst = master(); mst['securities'].reverse()
        self.assertEqual(first['decisionId'], decide(cap, mst, ATTESTATION, REG, [])['decisionId'])
        self.assertEqual(first, run())

    def test_registered_security_type_and_exchange_rules(self):
        r = run(mst=master(skip=('CCC',)))
        self.assertEqual(r['outcome'], 'INPUT_REJECTED')
        self.assertTrue(r['diagnostics']['reasons'][0].startswith('SECURITY_MASTER_INCOMPLETE:1:CCC'))
        r = run(mst=master(overrides={'AAA': {'exchange': 'NASDAQ'}}))
        self.assertIn('SECURITY_MASTER_CONTRADICTS_BROKER:AAA', r['diagnostics']['reasons'])
        r = run(mst={'version': 'other'})
        self.assertEqual(r['diagnostics']['reasons'], ['SECURITY_MASTER_MISSING_OR_UNREGISTERED_VERSION'])
        late = master(); late['available_at'] = '2026-11-02T13:00:00Z'
        self.assertIn('SECURITY_MASTER_NOT_AVAILABLE_BEFORE_DECISION', run(mst=late)['diagnostics']['reasons'])

    def test_missing_bar_rejects_the_whole_decision(self):
        cap = both(synthetic_capture(), lambda page: page['bars']['AAA'].pop(40) if 'next_page_token' in page
                   and page['next_page_token'] else None)
        r = run(cap)
        self.assertEqual(r['outcome'], 'INPUT_REJECTED')
        self.assertTrue(r['diagnostics']['reasons'][0].startswith('MISSING_OR_CONTRADICTED_BARS:1:AAA:1 missing'))

    def test_bars_must_agree_across_both_observations(self):
        cap = synthetic_capture()
        cap['decision_bars']['pages'][1]['bars']['BBB'][5]['c'] = 99.99
        r = run(cap)
        self.assertEqual(r['diagnostics']['reasons'], ['BARS_CHANGED_BETWEEN_OBSERVATIONS:1:BBB'])
        cap = synthetic_capture()
        cap['reference_bars']['pages'][1]['bars']['CCC'].pop(3)
        r = run(cap)
        self.assertEqual(r['diagnostics']['reasons'], ['BARS_NOT_OBSERVED_BEFORE_DECISION:1:CCC'])

    def test_unsupported_and_ambiguous_corporate_actions_reject(self):
        cap = synthetic_capture()
        cap['actions']['pages'][0]['corporate_actions']['spin_offs'] = [
            {'id': 's1', 'source_symbol': 'AAA', 'new_symbol': 'AAAS', 'ex_date': '2026-06-01'}]
        self.assertEqual(run(cap)['diagnostics']['reasons'], ['UNSUPPORTED_CORPORATE_ACTION:spin_offs:AAA:2026-06-01'])
        cap = synthetic_capture()
        groups = cap['actions']['pages'][0]['corporate_actions']
        groups['forward_splits'] = [{'id': 'f1', 'symbol': 'BBB', 'new_rate': 2, 'old_rate': 1, 'ex_date': '2026-06-01'}]
        groups['cash_dividends'] = [{'id': 'd1', 'symbol': 'BBB', 'rate': 0.25, 'ex_date': '2026-06-01'}]
        self.assertEqual(run(cap)['diagnostics']['reasons'], ['AMBIGUOUS_SAME_DAY_ACTIONS:BBB:2026-06-01'])
        cap = synthetic_capture()  # outside the 253-session window: not part of this decision
        cap['actions']['pages'][0]['corporate_actions']['spin_offs'] = [
            {'id': 's0', 'source_symbol': 'AAA', 'ex_date': '2024-06-03'}]
        self.assertEqual(run(cap)['outcome'], 'TARGETS')

    def test_supported_split_leaves_selection_unchanged(self):
        base = run()
        split_day = '2026-06-01'

        def halve(page):
            for b in page['bars'].get('AAA', []):
                if utc(b['t']).astimezone(NY).date().isoformat() >= split_day:
                    for k in ('o', 'h', 'l', 'c'):
                        b[k] = b[k] / 2
                    b['v'] *= 2
        cap = both(synthetic_capture(), halve)
        cap['actions']['pages'][0]['corporate_actions']['forward_splits'] = [
            {'id': 'f2', 'symbol': 'AAA', 'new_rate': 2, 'old_rate': 1, 'ex_date': split_day}]
        r = run(cap)
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['diagnostics']['corporateActions'], 1)
        momentum = lambda rec, sym: next(m for sid, m in rec['signal']['members'].items() if m['symbol'] == sym)
        self.assertEqual(momentum(r, 'AAA')['status'], momentum(base, 'AAA')['status'])
        self.assertEqual(sorted(t['symbol'] for t in r['signal']['targets']),
                         sorted(t['symbol'] for t in base['signal']['targets']))

    def test_action_coverage_must_be_attested(self):
        self.assertEqual(run(att=None)['diagnostics']['reasons'], ['ACTION_COVERAGE_NOT_ATTESTED'])
        narrow = ATTESTATION | {'coverage_start': '2026-01-02'}
        self.assertEqual(run(att=narrow)['diagnostics']['reasons'], ['ACTION_COVERAGE_DOES_NOT_ENCLOSE_WINDOW'])

    def test_observations_outside_their_windows_are_missed_never_backdated(self):
        for kwargs, reason in [
                ({'observed': '2026-11-02T13:01:01Z'}, 'DECISION_CAPTURE_NOT_SEALED_IN_WINDOW'),
                ({'started': '2026-11-02T12:59:59Z'}, 'DECISION_CAPTURE_NOT_SEALED_IN_WINDOW'),
                ({'reference': '2026-11-02T13:00:00Z'}, 'REFERENCE_CAPTURE_NOT_BEFORE_DECISION')]:
            r = run(synthetic_capture(**kwargs))
            self.assertEqual((r['outcome'], r['diagnostics']['reason']), ('MISSED', reason), kwargs)
            self.assertNotIn('signal', r)
        cap = synthetic_capture(); cap['decision_bars'] = None; cap['observed_at'] = None
        self.assertEqual(run(cap)['diagnostics']['reason'], 'CAPTURE_INCOMPLETE')

    def test_only_2026_first_sessions_of_a_month_are_decisions(self):
        cap = synthetic_capture(); cap['session'] = '2026-10-30'
        self.assertIsNone(run(cap))
        self.assertIsNone(decision_point(parse_calendar(cap['calendar']['rows']), '2026-10-29'))

    def test_hold_when_no_name_qualifies(self):
        r = run(synthetic_capture(prices={'AAA': (60, -0.1), 'BBB': (70, -0.12), 'CCC': (65, -0.1)}))
        self.assertEqual(r['outcome'], 'HOLD_NO_TARGETS', r.get('diagnostics'))
        self.assertEqual(r['signal']['targets'], [])

    def test_held_identity_must_be_in_universe_and_candidate_binds_holdings(self):
        self.assertEqual(run(held=['alpaca:' + IDS['GGG']])['diagnostics']['reasons'], ['HELD_SECURITY_NOT_IN_UNIVERSE'])
        r = run(reg=REG | {'modelVersion': CANDIDATE}, held=['alpaca:' + IDS['CCC']])
        self.assertEqual(r['signal']['heldSecurityIds'], ['alpaca:' + IDS['CCC']])
        self.assertNotEqual(r['decisionId'], run()['decisionId'])

    def test_two_phase_capture_uses_fixed_hosts_sip_raw_bars_and_pagination(self):
        seen = []

        def fake(url, headers):
            seen.append(url)
            self.assertEqual(headers['APCA-API-KEY-ID'], 'PKTEST')
            if '/v2/calendar' in url:
                return calendar_rows()
            if '/v2/assets' in url:
                return ASSETS
            if '/v2/stocks/bars' in url:
                return bar_pages()[1 if 'page_token=p2' in url else 0]
            return deepcopy(ACTIONS[0])
        clock = [utc('2026-11-02T12:57:00Z')]
        source = Source('PKTEST', 'secret', get=fake, limiter=Limiter(clock=lambda: 0.0, sleep=lambda s: None))
        ref = capture_reference(session=SESSION, master=master(), source=source, now=lambda: clock[0])
        self.assertEqual(ref['members_requested'], ['AAA', 'BBB', 'CCC'])
        with self.assertRaises(Rejected):
            capture_decision(ref, source=source, now=lambda: clock[0])
        clock[0] = utc('2026-11-02T13:00:02Z')
        sealed = capture_decision(ref, source=source, now=lambda: clock[0])
        hosts = {u.split('/v')[0] for u in seen}
        self.assertEqual(hosts, {'https://paper-api.alpaca.markets', 'https://data.alpaca.markets'})
        bar_urls = [u for u in seen if '/v2/stocks/bars' in u]
        self.assertEqual(len(bar_urls), 4)
        self.assertTrue(all('feed=sip' in u and 'adjustment=raw' in u for u in bar_urls))
        r = decide(sealed, master(), ATTESTATION, REG, [])
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        # A late reference capture still yields a record: MISSED, never a skipped session.
        clock[0] = utc('2026-11-02T13:00:30Z')
        late = capture_reference(session=SESSION, master=master(), source=source, now=lambda: clock[0])
        self.assertEqual(late['capture_failure'], ['REFERENCE_CAPTURE_TOO_LATE'])
        r = decide(late, master(), ATTESTATION, REG, [])
        self.assertEqual((r['outcome'], r['diagnostics']['reason']), ('MISSED', 'CAPTURE_INCOMPLETE'))
        self.assertEqual(r['diagnostics']['captureFailure'], ['REFERENCE_CAPTURE_TOO_LATE'])
        with self.assertRaises(Rejected):
            provider_get('https://api.alpaca.markets/v2/account', {})
        with self.assertRaises(Rejected):
            Source('', '')

    def test_rolling_limiter_waits_instead_of_exceeding_the_plan(self):
        t, waits = [0.0], []
        limiter = Limiter(limit=2, clock=lambda: t[0], sleep=lambda s: (waits.append(s), t.__setitem__(0, t[0] + s)))
        limiter.acquire(); limiter.acquire(); limiter.acquire()
        self.assertEqual(waits, [60.0])

    def test_record_matches_the_controller_contract(self):
        r = run()
        self.assertEqual(set(r) - {'bridgeVersion'}, {'experimentId', 'session', 'decisionAt', 'outcome', 'decisionId',
                                                       'signal', 'inputDigest', 'scoringReportId', 'diagnostics'})
        for k in ('decisionId', 'inputDigest', 'scoringReportId'):
            self.assertRegex(r[k], r'^[a-f0-9]{64}$')
        json.dumps(r, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
