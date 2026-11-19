"""Snapshot store and fetcher tests. Synthetic TEST-ONLY bodies; no network."""
from __future__ import annotations
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from analytics.research.fetch import Fetcher, FetchError, Response
from analytics.research.store import AppendOnlyError, SnapshotStore


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = SnapshotStore(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, body, at='2026-11-09T23:00:00Z', status='OK', **kw):
        return self.s.put(source_id='src', url='https://example.test/x', retrieved_at=at, body=body, status=status,
                          available_at=at, **kw)

    def test_stores_complete_body_with_hash_and_availability(self):
        line = self.put(b'<html>v1</html>', effective_date='2026-11-09')
        rec = self.s.load(line['path'])
        self.assertEqual(rec['body'], b'<html>v1</html>')
        self.assertEqual(rec['available_at'], '2026-11-09T23:00:00Z')
        self.assertEqual(rec['effective_date'], '2026-11-09')
        self.assertEqual(len(rec['content_sha256']), 64)

    def test_identical_content_is_recorded_but_not_stored_twice(self):
        a = self.put(b'same')
        b = self.put(b'same', at='2026-11-10T23:00:00Z')
        self.assertEqual(b['status'], 'UNCHANGED')
        self.assertEqual(b['path'], a['path'])
        self.assertEqual(len(self.s.manifest()), 2)

    def test_never_overwrites_an_existing_snapshot(self):
        self.put(b'x', dedupe=False)
        with self.assertRaises(AppendOnlyError):
            self.put(b'x', dedupe=False)

    def test_tampered_snapshot_is_detected(self):
        line = self.put(b'original')
        p = Path(self.tmp.name) / line['path']
        rec = json.loads(gzip.open(p, 'rt').read())
        rec['body_b64'] = 'dGFtcGVyZWQ='
        with gzip.open(p, 'wt') as fh:
            json.dump(rec, fh)
        with self.assertRaises(AppendOnlyError):
            self.s.load(line['path'])

    def test_failures_are_recorded_without_a_body(self):
        line = self.put(None, status='FETCH_FAILED', error='HTTP_503')
        self.assertIsNone(line['path'])
        self.assertEqual(self.s.manifest()[-1]['error'], 'HTTP_503')
        self.assertIsNone(self.s.latest('src'))

    def test_research_items_never_change_rules(self):
        self.s.research_item(source_id='src', observed_at='t', kind='TABLE_HEADER_CHANGED', detail={'a': 1})
        row = json.loads((Path(self.tmp.name) / 'items.jsonl').read_text())
        self.assertIs(row['executable_rules_changed'], False)


class FakeClock:
    def __init__(self):
        self.t, self.slept = 0.0, []

    def clock(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def fetcher(responses, **kw):
    calls = []
    clk = FakeClock()

    def transport(method, url, headers, body, timeout):
        calls.append((method, url, dict(headers), body))
        r = responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r
    f = Fetcher(user_agent='SportsEdge test', min_interval={'example.test': 10}, transport=transport,
                clock=clk.clock, sleep=clk.sleep, **kw)
    return f, calls, clk


class Fetch(unittest.TestCase):
    def test_rate_limit_spaces_requests_per_host(self):
        f, calls, clk = fetcher([Response('u', 200, {}, b'a'), Response('u', 200, {}, b'b')])
        f.get('https://example.test/a')
        f.get('https://example.test/b')
        self.assertEqual(clk.slept, [10])
        self.assertEqual(calls[0][2]['User-Agent'], 'SportsEdge test')

    def test_retries_server_errors_and_honours_retry_after(self):
        f, calls, clk = fetcher([Response('u', 503, {}, b''), Response('u', 429, {'retry-after': '30'}, b''),
                                 Response('u', 200, {}, b'ok')])
        self.assertEqual(f.get('https://example.test/a').body, b'ok')
        self.assertIn(30.0, clk.slept)
        self.assertEqual(len(calls), 3)

    def test_gives_up_with_a_clear_code(self):
        f, _, _ = fetcher([Response('u', 503, {}, b'')] * 5)
        with self.assertRaises(FetchError) as e:
            f.get('https://example.test/a')
        self.assertEqual(e.exception.code, 'RETRIES_EXHAUSTED')
        f, _, _ = fetcher([Response('u', 403, {}, b'')])
        with self.assertRaises(FetchError) as e:
            f.get('https://example.test/a')
        self.assertEqual(e.exception.code, 'HTTP_403')

    def test_network_errors_are_retried(self):
        f, _, _ = fetcher([TimeoutError(), Response('u', 200, {}, b'ok')])
        self.assertEqual(f.get('https://example.test/a').body, b'ok')

    def test_conditional_request_cache(self):
        with tempfile.TemporaryDirectory() as d:
            f, calls, _ = fetcher([Response('u', 200, {'etag': '"v1"'}, b'body'), Response('u', 304, {}, b'')],
                                  cache_dir=Path(d))
            f.get('https://example.test/a')
            again = f.get('https://example.test/a')
            self.assertTrue(again.from_cache)
            self.assertEqual(again.body, b'body')
            self.assertEqual(calls[1][2]['If-None-Match'], '"v1"')

    def test_refuses_plain_http_and_runaway_request_counts(self):
        f, _, _ = fetcher([])
        with self.assertRaises(FetchError):
            f.get('http://example.test/a')
        f, _, _ = fetcher([Response('u', 200, {}, b'')], max_requests=0)
        with self.assertRaises(FetchError) as e:
            f.get('https://example.test/a')
        self.assertEqual(e.exception.code, 'REQUEST_BUDGET_EXHAUSTED')


if __name__ == '__main__':
    unittest.main()
