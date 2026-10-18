"""Keeps the QC capability matrix tied to the frozen review gates in code.

A gate added to the runner or source bridge without a matrix entry fails here,
and the matrix can never mark a gate reviewed or the source admitted.
"""
import json
from pathlib import Path
import unittest
from analytics.stock_development_runner_v1 import REVIEWS
from integrations.quantconnect.source_bridge import REQUIRED_REVIEWS

ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / 'research/qc_historical_gaps_20261017/capability_matrix.json'


def strict(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            assert key not in out, key
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs)


class CapabilityMatrixTests(unittest.TestCase):
    def setUp(self):
        self.matrix = strict(MATRIX.read_text(encoding='utf-8'))

    def test_every_frozen_gate_has_an_entry(self):
        covered = {g for e in self.matrix['entries'] for g in e['gates']}
        self.assertEqual(set(REVIEWS) | set(REQUIRED_REVIEWS), covered)

    def test_entries_are_well_formed_and_never_admit(self):
        self.assertIs(self.matrix['historical_source_admitted'], False)
        self.assertIsNone(self.matrix['performance'])
        statuses = set(self.matrix['status_meanings'])
        ways = set(self.matrix['verification_meanings'])
        ids = [e['id'] for e in self.matrix['entries']]
        self.assertEqual(len(ids), len(set(ids)))
        for e in self.matrix['entries']:
            self.assertEqual(set(e), {'id', 'gates', 'status', 'qc_supplies', 'gap', 'verified_by',
                                      'evidence', 'implemented_here', 'remaining'})
            self.assertIn(e['status'], statuses)
            self.assertLessEqual(set(e['verified_by']), ways)
            if e['status'] in ('SUPPLIED_UNREVIEWED', 'PARTIAL', 'NOT_SUPPLIED'):
                self.assertTrue(e['evidence'] and e['verified_by'], e['id'])
            for path in e['implemented_here']:
                self.assertTrue((ROOT / path).is_file(), path)
        # This matrix inventories gaps; it can never satisfy a review gate itself.
        self.assertNotIn('reviews', self.matrix)
        self.assertFalse(statuses & {'REVIEWED', 'ADMITTED', 'reviewed'})

    def test_paid_subscription_is_not_assumed(self):
        self.assertEqual(self.matrix['paid_subscription']['required'], 'NOT_ESTABLISHED')


if __name__ == '__main__':
    unittest.main()
