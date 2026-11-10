"""Public website/chat read-model contract; synthetic fixtures only."""
import unittest
from analytics.research.summary import build_summary

class Summary(unittest.TestCase):
    def test_no_forward_sessions_means_unknown_return_and_no_active_candidate(self):
        s = build_summary(None, None, [], [{'command': 'forward', 'at': '2026-11-09T23:00:00Z', 'status': 'NO_FORWARD_SESSIONS_YET'}], '2026-11-09T23:01:00Z')
        self.assertEqual(s['schemaVersion'], 'stock-research-summary-v1')
        self.assertEqual(len(s['candidates']), 3)
        self.assertTrue(all(c['historical'] is None and c['forward']['totalReturn'] is None and not c['active'] for c in s['candidates']))
        self.assertEqual(s['forwardAt'], '2026-11-09T23:00:00Z')
    def test_last_source_failure_preserves_last_success_instead_of_claiming_health(self):
        rows = [{'source_id': 'TEST', 'retrieved_at': '2026-11-09T21:00:00Z', 'status': 'OK'},
                {'source_id': 'TEST', 'retrieved_at': '2026-11-09T22:00:00Z', 'status': 'FETCH_FAILED'}]
        s = build_summary(None, None, rows, [], '2026-11-09T23:00:00Z')
        self.assertEqual(s['sources'][0]['status'], 'FETCH_FAILED')
        self.assertEqual(s['sources'][0]['lastSuccessAt'], '2026-11-09T21:00:00Z')
