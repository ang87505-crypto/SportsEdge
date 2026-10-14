"""Synthetic stream parity and poisoned-stream guarantees."""
from copy import deepcopy
import unittest
from unittest.mock import patch
from analytics.stock_readiness_pipeline_v1 import synthetic_input
from analytics.stock_development_runner_v1 import run_bundle
from analytics.stock_identity_stream_v1 import IdentityDevelopmentStream


def source_rows(data):
    for raw in data['rows']:
        row = deepcopy(raw)
        if 'evidence' in row:
            e = row['evidence']; records = []
            for shard in e['shards']:
                shard['payload']['bars'] = [b for b in shard['payload']['bars']
                                            if b['session_date'] < row['session']['date']]
                for b in shard['payload']['bars']: b['security_id'] = shard['security_id']
            for u in e['context']['universe']:
                listing = e['listings'][u['security_id']]
                records.append(dict(**u, effective_from=listing['first_traded_on']+'T00:00:00Z',
                    effective_until=None, available_at=e['context']['universe_available_at'],
                    source_id='SYNTHETIC-'+u['security_id'], first_traded_on=listing['first_traded_on'],
                    first_trade_available_at=listing['available_at'], first_trade_source_id=listing['source_id']))
            row['identity_records'] = records
        yield row


def fixture():
    data = synthetic_input(); data.pop('costs'); data.update(benchmarks={}, risk_free=None)
    data['calendar']['sessions'] = [s for s in data['calendar']['sessions'] if s['date'] <= data['rows'][-1]['session']['date']]
    for row in data['rows']:
        if 'evidence' in row:
            row['evidence']['context']['sessions'] = [s for s in row['evidence']['context']['sessions']
                if s['date'] <= data['rows'][-1]['session']['date']]
    return data


def stream(data, synthetic=True):
    return IdentityDevelopmentStream(data['initial_account'], data['calendar'], data['settlement'], synthetic=synthetic)


class StreamTests(unittest.TestCase):
    def test_six_paths_match_pr50_statistics_and_repeat_deterministically(self):
        data = fixture(); reference = run_bundle(data, synthetic=True); runs = []
        for _ in range(2):
            s = stream(data)
            for row in source_rows(data): s.accept(row)
            result = s.finish({}, None); runs.append(result)
            self.assertIsNone(result['performance'])
            for expected, actual in zip(reference['engineering_scenarios'], result['engineering_scenarios']):
                for name in ('baseline', 'candidate'):
                    self.assertEqual(actual[name]['statistics'], expected[name]['statistics'])
                    self.assertTrue(actual[name]['all_receipts_reconciled'])
        self.assertEqual(runs[0], runs[1])

    def test_new_identity_from_empty_registry_executes_all_six_cases(self):
        data = fixture(); data['initial_account']['symbols'] = {}; data['initial_account']['marks'] = {}
        s = stream(data)
        for row in source_rows(data): s.accept(row)
        result = s.finish({}, None)
        self.assertEqual(len(result['engineering_scenarios']), 3)
        self.assertTrue(all(c['baseline']['statistics']['trades'] for c in result['engineering_scenarios']))

    def test_failed_session_is_atomic_and_cannot_be_skipped(self):
        data = fixture(); s = stream(data); row = next(source_rows(data))
        before = deepcopy(s.cases); row['session']['events'] = [dict(type='delisting', security_id='id-FFF',
            event_id='SYNTHETIC-delist', effective_at=row['session']['open_at'], available_at='2026-09-30T22:00:00Z')]
        with self.assertRaises(ValueError): s.accept(row)
        self.assertEqual(s.cases, before)
        with self.assertRaisesRegex(ValueError, 'failed'): s.accept(next(source_rows(data)))
        with self.assertRaisesRegex(ValueError, 'failed'): s.finish({}, None)

    def test_incomplete_stream_returns_no_partial_report(self):
        s = stream(fixture())
        with self.assertRaisesRegex(ValueError, 'Incomplete'): s.finish({}, None)
        self.assertTrue(s.failed)

    def test_sixth_cost_case_failure_rolls_back_all_six_accounts(self):
        from analytics.stock_identity_stream_v1 import plan_universe
        data = fixture(); s = stream(data); before = deepcopy(s.cases); calls = []
        def fail_last(*args, **kwargs):
            calls.append(1)
            if len(calls) == 6: raise ValueError('SYNTHETIC last-case rejection')
            return plan_universe(*args, **kwargs)
        with patch('analytics.stock_identity_stream_v1.plan_universe', side_effect=fail_last):
            with self.assertRaisesRegex(ValueError, 'last-case'): s.accept(next(source_rows(data)))
        self.assertEqual(len(calls), 6); self.assertEqual(s.cases, before)
        self.assertEqual(s.index, 0); self.assertEqual(s.input_receipts, [])

    def test_historical_mode_rejects_outside_development_before_rows(self):
        with self.assertRaises(ValueError): stream(fixture(), synthetic=False)

    def test_missing_duplicate_and_extra_sessions_fail(self):
        for mode in ('skip', 'duplicate', 'extra'):
            data = fixture(); s = stream(data); rows = list(source_rows(data))
            if mode == 'skip': rows.pop(0)
            if mode == 'duplicate': rows.insert(1, deepcopy(rows[0]))
            if mode == 'extra': rows.append(deepcopy(rows[-1]))
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'exchange session'):
                for row in rows: s.accept(row)


if __name__ == '__main__': unittest.main()
