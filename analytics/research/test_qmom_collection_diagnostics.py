"""Offline CLI regressions: preserve QMOM failure evidence without admitting rejected holdings.

All pages below are SYNTHETIC TEST-ONLY variants of the existing collector fixture builder.
The real Fetcher, collector, snapshot store, CLI JSON and forward snapshot reader are exercised.
"""
from contextlib import redirect_stdout
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from analytics.research import cli, qmom
from analytics.research.fetch import Fetcher, Response
from analytics.research.store import SnapshotStore
from analytics.research.test_collectors import synthetic_page


class QmomCollectionDiagnostics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)

    def collect(self, page, at, *, http_status=200):
        body = page.encode()

        def transport(method, url, headers, request_body, timeout):
            self.assertEqual((method, url, request_body), ('GET', qmom.URL, None))
            return Response(url, http_status, {'content-type': 'text/html'}, body)

        hit = mock.Mock(side_effect=transport)

        def make_fetcher(**kwargs):
            return Fetcher(transport=hit, **kwargs)

        output = io.StringIO()
        now = datetime.fromisoformat(at.replace('Z', '+00:00'))
        with mock.patch.dict(os.environ, {'SEC_EDGAR_USER_AGENT': ''}), \
                mock.patch.object(cli, 'Fetcher', side_effect=make_fetcher), \
                mock.patch.object(cli, 'now_utc', return_value=now), \
                mock.patch('sys.argv', ['research', 'collect', '--data', str(self.data)]), \
                mock.patch('socket.create_connection', side_effect=AssertionError('NETWORK_REFUSED')), \
                redirect_stdout(output):
            cli.main()
        self.assertEqual(hit.call_count, 1)  # diagnostics do not fetch again
        run = json.loads((self.data / 'runs.jsonl').read_text().splitlines()[-1])
        result = json.loads(output.getvalue())
        self.assertEqual(run['result'], result)
        self.assertEqual(run['requests'], 1)
        self.assertNotIn(page, output.getvalue())
        return result, SnapshotStore(self.data)

    def test_future_holdings_log_the_reason_and_remain_unusable(self):
        page = synthetic_page(eff='11/16/2026')
        at = '2026-11-14T04:43:41Z'
        result, store = self.collect(page, at)
        self.assertEqual(result['qmom'], 'PARSE_FAILED')
        detail = result['qmom_detail']
        self.assertEqual(detail['error'], 'EFFECTIVE_DATE_IN_FUTURE')
        self.assertEqual(detail['effective_date'], '2026-11-16')
        self.assertEqual(detail['retrieved_at'], at)
        self.assertEqual(detail['content_sha256'], hashlib.sha256(page.encode()).hexdigest())
        self.assertEqual(store.load(detail['path'])['body'], page.encode())
        self.assertEqual(cli.qmom_snapshots(store), [])

    def test_bad_markup_and_missing_dates_are_distinguishable_from_future_dates(self):
        pages = [
            (synthetic_page(eff='not-a-date'), 'EFFECTIVE_DATE_MISSING', None),
            (synthetic_page().replace('50.00</td>', 'n/a</td>', 1), 'NUMBER_INVALID:n/a', '2026-11-09'),
        ]
        for i, (page, error, effective) in enumerate(pages):
            with self.subTest(error=error):
                result, store = self.collect(page, f'2026-11-09T23:30:0{i}Z')
                self.assertEqual(result['qmom'], 'PARSE_FAILED')
                self.assertEqual(result['qmom_detail']['error'], error)
                self.assertEqual(result['qmom_detail']['effective_date'], effective)
                self.assertEqual(store.load(result['qmom_detail']['path'])['body'], page.encode())
                self.assertEqual(cli.qmom_snapshots(store), [])

    def test_http_failure_logs_no_snapshot_instead_of_guessing_a_parse_failure(self):
        result, store = self.collect('SYNTHETIC HTTP failure body', '2026-11-09T23:30:00Z', http_status=403)
        self.assertEqual(result['qmom'], 'FETCH_FAILED')
        self.assertEqual(result['qmom_detail']['error'], 'HTTP_403')
        for key in ('effective_date', 'path', 'content_sha256'):
            self.assertIsNone(result['qmom_detail'][key])
        self.assertEqual(cli.qmom_snapshots(store), [])

    def test_future_rejection_preserves_earlier_valid_snapshot_and_manifest_prefix(self):
        first, store = self.collect(synthetic_page(eff='11/13/2026'), '2026-11-13T10:00:00Z')
        self.assertEqual(first['qmom'], 'OK')
        self.assertIsNone(first['qmom_detail']['error'])
        original_snapshot = (self.data / first['qmom_detail']['path']).read_bytes()
        original_manifest = (self.data / 'manifest.jsonl').read_bytes()
        second, store = self.collect(synthetic_page(eff='11/16/2026'), '2026-11-14T04:43:41Z')
        self.assertEqual(second['qmom_detail']['error'], 'EFFECTIVE_DATE_IN_FUTURE')
        self.assertEqual((self.data / first['qmom_detail']['path']).read_bytes(), original_snapshot)
        self.assertTrue((self.data / 'manifest.jsonl').read_bytes().startswith(original_manifest))
        self.assertEqual([s['effective_date'] for s in cli.qmom_snapshots(store)], ['2026-11-13'])


if __name__ == '__main__':
    unittest.main()
