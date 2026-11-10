"""Proposed one-session commissioning decision for stock-v2-weekly-1. Fictional data only."""
import json
from pathlib import Path
import tempfile
import unittest
from analytics.stock_weekly_bridge_v2 import commissioning_mode, decision_point
from analytics.stock_forward_bridge_v1 import parse_calendar
from analytics.test_stock_weekly_v2 import capture, run, calendar_rows, asset_id
from datetime import date

DOC = {'experimentId': 'stock-v2-weekly-test', 'session': '2026-11-04', 'approved': True,
       'protocol': 'docs/STOCK_PAPER_COMMISSIONING_2026_11_10.md'}


def mode(doc, experiment='stock-v2-weekly-test', session='2026-11-04'):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / 'c.json'
        if doc is not None:
            p.write_text(json.dumps(doc))
        return commissioning_mode(p, experiment, session)


class CommissioningTests(unittest.TestCase):
    def test_only_the_approved_named_session_of_that_experiment(self):
        self.assertEqual(mode(DOC), 'commissioning')
        self.assertFalse(mode(None))
        self.assertFalse(mode(DOC | {'approved': False}))
        self.assertFalse(mode(DOC, session='2026-11-05'))
        self.assertFalse(mode(DOC, experiment='stock-v2-weekly-2'))
        self.assertFalse(mode(DOC | {'session': ['2026-11-04']}))

    def test_midweek_decision_is_labelled_commissioning_with_frozen_math(self):
        r = run(capture('2026-11-04', '2026-11-04T13:00:00Z', initial='commissioning'))
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        self.assertEqual(r['diagnostics']['rebalance'], 'weekly-commissioning-session')
        self.assertEqual(r['signal']['variant']['rebalance'], 'weekly-commissioning-session')
        self.assertEqual(r['decisionAt'], '2026-11-04T13:00:00Z')
        # Same scores and targets as the frozen scorer gives the experiment's own first session that day.
        initial = run(capture('2026-11-04', '2026-11-04T13:00:00Z', initial=True))
        self.assertEqual(r['signal']['targets'], initial['signal']['targets'])

    def test_refused_unless_the_account_is_flat(self):
        r = run(capture('2026-11-04', '2026-11-04T13:00:00Z', initial='commissioning'), held=[asset_id(1)])
        self.assertEqual(r['outcome'], 'INPUT_REJECTED')
        self.assertIn('COMMISSIONING_REQUIRES_FLAT_ACCOUNT', r['diagnostics']['reasons'])

    def test_a_regular_week_start_keeps_the_registered_rule(self):
        r = run(capture('2026-11-02', '2026-11-02T13:00:00Z', initial='commissioning'))
        self.assertEqual(r['diagnostics']['rebalance'], 'weekly-first-session-of-iso-week')
        sessions = parse_calendar(calendar_rows(date(2026, 11, 6)))
        self.assertIsNotNone(decision_point(sessions, '2026-11-05', 'commissioning'))

    def test_committed_file_names_one_session_of_the_registered_experiment(self):
        p = Path(__file__).resolve().parents[1] / 'config' / 'paper-auto' / 'stock-v2-weekly-1-commissioning.json'
        doc = json.loads(p.read_text())
        self.assertEqual(doc['experimentId'], 'stock-v2-weekly-1')
        self.assertRegex(doc['session'], r'^2026-11-1[1-3]$')
        self.assertTrue((p.parents[2] / doc['protocol']).exists())


if __name__ == '__main__':
    unittest.main()
