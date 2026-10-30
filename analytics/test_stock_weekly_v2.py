"""Fictional calendar, assets and prices; no market or return evidence."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import unittest
from zoneinfo import ZoneInfo
from analytics.stock_forward_bridge_v1 import sha256, part
from analytics.stock_momentum_v1 import VERSION as BASELINE
from analytics.stock_universe_scoring_v1 import score_universe
from analytics.stock_weekly_bridge_v2 import (decide, assemble, decision_point, parse_universe, Rejected,
                                              UNIVERSE_VERSION, MIN_SCORED_MEMBERS)
from analytics.stock_forward_bridge_v1 import parse_calendar
from analytics.stock_weekly_scoring_v2 import score_universe_weekly

NY = ZoneInfo('America/New_York')
SECTORS = ('Information Technology', 'Health Care', 'Financials', 'Energy', 'Industrials', 'Utilities')
SYMBOLS = [f'S{i:02d}' for i in range(1, 25)]


def asset_id(i):
    return f'{i:08x}-1111-2222-3333-444444444444'


def calendar_rows(end):
    days, d = [], end
    while len(days) < 280:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return [{'date': x.isoformat(), 'open': '09:30', 'close': '16:00'} for x in reversed(days)]


def bar_pages(end, drop=None):
    days = [date.fromisoformat(r['date']) for r in calendar_rows(end)][:-1]
    bars = {}
    for i, sym in enumerate(SYMBOLS):
        bars[sym] = []
        start, step = 20 + i, 0.02 + 0.004 * i
        for k, x in enumerate(days):
            if drop and drop[0] == sym and k == drop[1]:
                continue
            p = round(start + k * step, 2)
            t = datetime.combine(x, datetime.min.time(), NY).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            bars[sym].append({'t': t, 'o': p, 'h': p, 'l': p, 'c': p, 'v': 3_000_000, 'n': 1000, 'vw': p})
    return [{'bars': {k: v[:150] for k, v in bars.items()}, 'next_page_token': 'p2'},
            {'bars': {k: v[150:] for k, v in bars.items()}, 'next_page_token': None}]


ASSETS = [{'id': asset_id(i), 'class': 'us_equity', 'exchange': 'NYSE' if i % 2 else 'NASDAQ', 'symbol': s,
           'status': 'active', 'tradable': True} for i, s in enumerate(SYMBOLS, 1)]
NO_ACTIONS = [{'corporate_actions': {'cash_dividends': [], 'forward_splits': []}, 'next_page_token': None}]


def universe(symbols=SYMBOLS, available='2026-10-30T03:00:00Z'):
    return {'version': UNIVERSE_VERSION, 'source': 'synthetic', 'revision': 'synthetic-1',
            'classification': 'synthetic sectors', 'first_traded_on_basis': 'synthetic lower bound',
            'available_at': available,
            'securities': [{'symbol': s, 'sector': SECTORS[i % len(SECTORS)], 'first_traded_on': '2015-01-02'}
                           for i, s in enumerate(symbols)]}


def capture(session='2026-11-02', decision='2026-11-02T13:00:00Z', drop=None, actions=None, initial=False,
            late=0):
    end = date.fromisoformat(session)
    at = datetime.fromisoformat(decision.replace('Z', '+00:00'))
    z = lambda dt: dt.isoformat().replace('+00:00', 'Z')
    rows, pages = calendar_rows(end), bar_pages(end, drop)
    reference = z(at - timedelta(minutes=2))
    return {'version': 'stock-weekly-bridge-v2-capture', 'session': session, 'initial': initial,
            'calendar': {'rows': rows, 'sha256': sha256(rows), 'retrieved_at': reference},
            'assets': {'rows': ASSETS, 'sha256': sha256(ASSETS), 'retrieved_at': reference},
            'actions': part(deepcopy(actions or NO_ACTIONS), reference),
            'reference_bars': part(deepcopy(pages), reference),
            'decision_bars': part(pages, z(at + timedelta(seconds=20 + late)), started_at=z(at + timedelta(seconds=1))),
            'observed_at': z(at + timedelta(seconds=21 + late))}


REG = {'experimentId': 'stock-v2-weekly-test', 'registeredAt': '2026-10-30T04:00:00Z', 'modelVersion': BASELINE}


def run(cap=None, uni=None, held=(), initial=None):
    cap = cap or capture()
    return decide(cap, uni or universe(), REG, list(held), cap.get('initial', False) if initial is None else initial)


class WeeklyBridgeTests(unittest.TestCase):
    def test_targets_on_the_first_session_of_a_week(self):
        r = run()
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['decisionAt'], '2026-11-02T13:00:00Z')
        sig = r['signal']
        self.assertEqual(sig['version'], 'stock-forward-signal-v1')
        self.assertEqual(sig['modelVersion'], BASELINE)
        self.assertEqual(sig['variant']['rebalance'], 'weekly-first-session-of-iso-week')
        self.assertEqual(sig['variant']['universe'], UNIVERSE_VERSION)
        self.assertEqual(len(sig['targets']), 5)
        self.assertLessEqual(max(sum(t['sector'] == s for t in sig['targets']) for s in SECTORS), 2)
        self.assertFalse(sig['executionPermitted'])
        self.assertEqual(r['decisionId'], sig['decisionId'])
        self.assertEqual(r['diagnostics']['skipped'], {})
        self.assertEqual(r['diagnostics']['universeMembers'], len(SYMBOLS))

    def test_scores_match_the_frozen_model_exactly(self):
        # 2026-11-02 starts both an ISO week and a month, so the frozen monthly scorer accepts it too.
        bundle, _ = assemble(capture(), universe(), experiment_id='x', registered_at=REG['registeredAt'],
                             model_version=BASELINE, held_security_ids=[], initial=False)
        weekly = score_universe_weekly(**deepcopy(bundle['evidence']))
        frozen = score_universe(**deepcopy(bundle['evidence']))
        self.assertEqual(weekly['scores'], frozen['scores'])
        self.assertEqual(weekly['members'], frozen['members'])
        self.assertEqual(weekly['prior_inputs'], frozen['prior_inputs'])
        self.assertNotEqual(weekly['report_id'], frozen['report_id'])  # the report names its weekly rule

    def test_frozen_monthly_scorer_still_refuses_a_mid_month_week(self):
        cap = capture('2026-11-09', '2026-11-09T13:00:00Z')
        bundle, _ = assemble(cap, universe(), experiment_id='x', registered_at=REG['registeredAt'],
                             model_version=BASELINE, held_security_ids=[], initial=False)
        with self.assertRaises(ValueError):
            score_universe(**deepcopy(bundle['evidence']))
        self.assertEqual(run(cap)['outcome'], 'TARGETS')

    def test_only_week_starts_unless_initial(self):
        cap = capture('2026-11-03', '2026-11-03T13:00:00Z')
        self.assertIsNone(run(cap))
        r = run(capture('2026-11-03', '2026-11-03T13:00:00Z', initial=True))
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['diagnostics']['rebalance'], 'weekly-initial-session')
        # A Friday initial session, as for the first live run.
        r = run(capture('2026-10-30', '2026-10-30T12:00:00Z', initial=True))
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['decisionAt'], '2026-10-30T12:00:00Z')

    def test_no_calendar_year_limit(self):
        cap = capture('2027-01-04', '2027-01-04T13:00:00Z')
        uni = universe(available='2026-12-31T00:00:00Z')
        r = decide(cap, uni, REG, [], False)
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))

    def test_member_with_a_missing_bar_is_skipped_not_fatal(self):
        r = run(capture(drop=('S24', 40)))
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['diagnostics']['skipped'], {'S24': 'MISSING_BARS:1'})
        self.assertNotIn('S24', [t['symbol'] for t in r['signal']['targets']])
        self.assertEqual(r['diagnostics']['universeMembers'], len(SYMBOLS) - 1)

    def test_bars_must_agree_across_both_observations(self):
        cap = capture()
        cap['decision_bars']['pages'][1]['bars']['S20'][5]['c'] = 99.99
        r = run(cap)
        self.assertEqual(r['diagnostics']['skipped'], {'S20': 'BARS_CHANGED_BETWEEN_OBSERVATIONS'})

    def test_unsupported_corporate_action_skips_that_member(self):
        actions = [{'corporate_actions': {'spin_offs': [{'id': 'x1', 'source_symbol': 'S23', 'new_symbol': 'NEWCO',
                                                          'ex_date': '2026-06-01'}],
                                          'cash_dividends': [{'id': 'd1', 'symbol': 'S22', 'rate': 0.25,
                                                              'ex_date': '2026-07-01'}]},
                    'next_page_token': None}]
        r = run(capture(actions=actions))
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['diagnostics']['skipped'], {'S23': 'UNSUPPORTED_CORPORATE_ACTION:spin_offs:2026-06-01'})
        self.assertEqual(r['diagnostics']['corporateActions'], 1)

    def test_symbol_not_listed_is_skipped(self):
        r = run(uni=universe(SYMBOLS + ['ZZZZ']))
        self.assertEqual(r['diagnostics']['skipped'], {'ZZZZ': 'NOT_AN_ACTIVE_LISTED_ASSET'})

    def test_skipped_holding_rejects_the_decision(self):
        r = run(capture(drop=('S24', 40)), held=['alpaca:' + asset_id(24)])
        self.assertEqual(r['outcome'], 'INPUT_REJECTED')
        self.assertTrue(r['diagnostics']['reasons'][0].startswith('HELD_SECURITY_SKIPPED:'))

    def test_too_few_members_rejects(self):
        r = run(uni=universe(SYMBOLS[:MIN_SCORED_MEMBERS - 1]))
        self.assertEqual(r['outcome'], 'INPUT_REJECTED')
        self.assertTrue(r['diagnostics']['reasons'][0].startswith('TOO_FEW_MEMBERS:'))

    def test_late_capture_is_missed(self):
        r = run(capture(late=60))
        self.assertEqual(r['outcome'], 'MISSED')
        self.assertEqual(r['diagnostics']['reason'], 'DECISION_CAPTURE_NOT_SEALED_IN_WINDOW')

    def test_universe_must_be_available_before_the_decision(self):
        r = run(uni=universe(available='2026-11-02T13:00:00Z'))
        self.assertEqual(r['diagnostics']['reasons'], ['UNIVERSE_NOT_AVAILABLE_BEFORE_DECISION'])

    def test_deterministic(self):
        self.assertEqual(run(), run())

    def test_decision_point_rules(self):
        sessions = parse_calendar(calendar_rows(date(2026, 11, 6)))
        self.assertIsNotNone(decision_point(sessions, '2026-11-02'))
        for d in ('2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'):
            self.assertIsNone(decision_point(sessions, d))
            self.assertIsNotNone(decision_point(sessions, d, initial=True))

    def test_committed_universe_file_is_valid(self):
        path = Path(__file__).resolve().parents[1] / 'config' / 'paper-auto' / 'universe-large-cap-v1.json'
        doc = json.loads(path.read_text())
        rows = parse_universe(doc, datetime(2026, 10, 30, 12, tzinfo=timezone.utc))
        self.assertGreaterEqual(len(rows), 100)
        self.assertEqual(len({r['sector'] for r in rows}), 11)


if __name__ == '__main__':
    unittest.main()
