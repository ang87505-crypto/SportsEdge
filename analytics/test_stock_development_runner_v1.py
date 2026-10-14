"""Entirely synthetic engineering tests. No historical performance evidence."""
from copy import deepcopy
from decimal import Decimal, localcontext, ROUND_DOWN
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from analytics.stock_development_runner_v1 import (
    VERSION, REVIEWS, START, END, PROTOCOL, _json, _manifest, _read,
    _structure, load_development, validate_development, run_bundle, replay_case,
    BASELINE)
from analytics.stock_development_metrics_v1 import wealth_statistics
from analytics.stock_readiness_pipeline_v1 import synthetic_input, run_synthetic, verify_freezes
from analytics.stock_accounting_v2 import new_account


def fixture():
    data = synthetic_input(); data.pop('costs')
    data.update(benchmarks={}, risk_free=None)
    return data


def manifest():
    entry = {'path': 'absent.json', 'sha256': '0' * 64}
    return dict(version=VERSION, kind='historical_price_proxy', phase='development',
        start=START, end=END, protocol_sha256=hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(),
        rights_scope='local_research', dataset_revision='SYNTHETIC-NOT-A-SOURCE',
        bundle=entry, reviews={name: dict(reviewer='SYNTHETIC-reviewer', status='reviewed',
                                         evidence=entry) for name in REVIEWS})


class ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = fixture()
        cls.result = run_bundle(cls.data, synthetic=True)

    def test_frozen_sources_verified(self):
        self.assertGreater(len(verify_freezes()), 4)

    def test_three_cost_cases_match_existing_reconciled_runner(self):
        previous = run_synthetic()
        self.assertIsNone(self.result['performance'])
        self.assertFalse(self.result['historical_study_approved'])
        self.assertEqual(self.result['kind'], 'SYNTHETIC_ENGINEERING_ONLY')
        for actual, expected in zip(self.result['engineering_scenarios'], previous['scenarios']):
            for name in ('baseline', 'candidate'):
                self.assertEqual(actual[name]['reconciliation'], expected['reconciliation'][name])
                stats = actual[name]['statistics']
                self.assertIsNone(stats['sharpe']); self.assertIsNone(stats['sortino'])
                self.assertGreater(stats['trades'], 0)
                self.assertEqual(Decimal(stats['costs']['total_dollars']),
                                 Decimal(expected['reconciliation'][name]['costs_dollars']))

    def test_deterministic_and_no_mutation(self):
        before = deepcopy(self.data)
        self.assertEqual(run_bundle(self.data, synthetic=True), self.result)
        self.assertEqual(self.data, before)

    def test_decimal_context_cannot_change_execution(self):
        expected = replay_case(self.data, BASELINE, 15, 0)
        with localcontext() as ctx:
            ctx.prec = 6; ctx.rounding = ROUND_DOWN
            self.assertEqual(replay_case(self.data, BASELINE, 15, 0), expected)

    def test_missing_duplicate_and_unordered_sessions_abort(self):
        for mode in ('missing', 'duplicate', 'unordered'):
            data = deepcopy(self.data)
            if mode == 'missing': data['rows'].pop(1)
            if mode == 'duplicate': data['rows'].insert(1, deepcopy(data['rows'][0]))
            if mode == 'unordered': data['rows'][0], data['rows'][1] = data['rows'][1], data['rows'][0]
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'session'):
                run_bundle(data, synthetic=True)

    def test_monthly_decision_cannot_be_omitted_or_added_intramonth(self):
        for extra in (False, True):
            data = deepcopy(self.data)
            if extra: data['rows'][1]['evidence'] = deepcopy(data['rows'][0]['evidence'])
            else: data['rows'][0].pop('evidence')
            with self.assertRaisesRegex(ValueError, 'Exactly one decision'):
                run_bundle(data, synthetic=True)

    def test_close_mutation_does_not_change_first_open(self):
        # Existing planner hides close marks; changed close only affects later NAV.
        data = deepcopy(self.data); data['rows'] = data['rows'][:1]
        base = replay_case(data, BASELINE, 15, 0)
        for mark in data['rows'][0]['session']['close_marks']: mark['price'] = '300'
        changed = replay_case(data, BASELINE, 15, 0)
        self.assertEqual(base['statistics']['costs'], changed['statistics']['costs'])
        self.assertEqual(base['statistics']['turnover'], changed['statistics']['turnover'])
        self.assertNotEqual(base['statistics']['cumulative_return'], changed['statistics']['cumulative_return'])

    def test_pre_spread_input_is_not_charged_twice(self):
        data = deepcopy(self.data); data['rows'][0]['session']['quotes'][0]['ask'] = '999'
        with self.assertRaisesRegex(ValueError, 'double spread'): run_bundle(data, synthetic=True)

    def test_unsupported_delisting_aborts_without_mutation(self):
        data = deepcopy(self.data); s = data['rows'][0]['session']
        s['events'] = [dict(event_id='SYNTHETIC-delisting', security_id='id-S00',
            type='delisting', effective_at=s['open_at'], available_at=s['actions_available_at'])]
        # Use a real fixture ID, never an unknown-security failure shortcut.
        s['events'][0]['security_id'] = next(iter(data['initial_account']['symbols']))
        before = deepcopy(data)
        with self.assertRaisesRegex(ValueError, 'Unsupported corporate event: delisting'):
            run_bundle(data, synthetic=True)
        self.assertEqual(data, before)

    def test_mixed_history_and_synthetic_cannot_be_reported(self):
        data = deepcopy(self.data); data['rows'][0]['session']['kind'] = 'historical_price_proxy'
        with self.assertRaisesRegex(ValueError, 'Mixed'): run_bundle(data, synthetic=True)
        with self.assertRaisesRegex(ValueError, 'Mixed'): run_bundle(self.data)

    def test_fake_historical_label_cannot_admit_wrong_period(self):
        data = deepcopy(self.data)
        for row in data['rows']: row['session']['kind'] = 'historical_price_proxy'
        with self.assertRaisesRegex(ValueError, 'development'): validate_development(data)

    def test_non_cash_origin_blocked(self):
        data = deepcopy(self.data); data['initial_account']['settled_cash_cents'] -= 1
        with self.assertRaisesRegex(ValueError, 'cash-only'): run_bundle(data, synthetic=True)


class SourceAccessTests(unittest.TestCase):
    @staticmethod
    def calendar_skeleton():
        # Fictional weekdays, not an exchange calendar or market dataset. Only
        # exercises structural full-period gates; never sent to the replay.
        days = []; day = date(1998, 1, 1)
        while day <= date(2011, 12, 31):
            if day.weekday() < 5:
                days.append(dict(date=str(day), open_at=str(day)+'T09:30:00-05:00',
                                 close_at=str(day)+'T16:00:00-05:00'))
            day += timedelta(days=1)
        origin = next(s for s in days if s['date'] == '1999-12-31')
        data = dict(initial_account=new_account(as_of=origin['close_at'], settled_cash_cents=100000,
                    symbols={}, positions={}, marks={}),
                    calendar=dict(coverage_complete=True, revision='SYNTHETIC-weekdays', sessions=days),
                    settlement={}, rows=[], benchmarks={}, risk_free=None)
        prior = '1999-12-31'
        for session in days:
            if session['date'] < START: continue
            row = dict(session=dict(session, kind='historical_price_proxy', quotes=[]))
            if prior[:7] != session['date'][:7]:
                row['evidence'] = dict(shards=[], context=dict(actions=[]),
                    decision_at=session['date']+'T08:00:00-05:00')
            data['rows'].append(row); prior = session['date']
        dates = ['1999-12-31'] + [r['session']['date'] for r in data['rows']]
        for key in ('broad_market_total_return', 'half_market_half_cash'):
            data['benchmarks'][key] = dict(dates=dates, wealth=['100']*len(dates),
                source_revision='SYNTHETIC', convention='SYNTHETIC constant index for gate tests')
        return data

    def test_full_development_calendar_and_benchmark_gates(self):
        data = self.calendar_skeleton()
        validate_development(data)
        for mode in ('missing_end', 'benchmark_date', 'benchmark_missing'):
            bad = deepcopy(data)
            if mode == 'missing_end': bad['rows'].pop()
            elif mode == 'benchmark_date': bad['benchmarks']['broad_market_total_return']['dates'] = ['2000-01-01']
            else: bad['benchmarks'].pop('half_market_half_cash')
            with self.subTest(mode=mode), self.assertRaises(ValueError): validate_development(bad)

    def test_future_signal_bars_or_actions_rejected(self):
        for mode in ('bar', 'action'):
            data = self.calendar_skeleton(); row = data['rows'][0]
            evidence = row['evidence']; day = row['session']['date']
            if mode == 'bar': evidence['shards'] = [dict(payload=dict(bars=[dict(session_date=day)]))]
            else: evidence['context']['actions'] = [dict(session_date=day)]
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'Future'):
                validate_development(data)

    def test_phase_dates_and_rights_checked_before_payload_read(self):
        for field, value in [('phase', 'validation'), ('phase', 'sealed_test'),
                ('end', '2025-12-31'), ('start', '2001-01-01'), ('rights_scope', 'cloud_only')]:
            m = manifest(); m[field] = value
            with patch('analytics.stock_development_runner_v1._read') as read:
                with self.assertRaises(ValueError): load_development('.', m)
                read.assert_not_called()

    def test_unreviewed_or_missing_gate_blocks_source_read(self):
        for mode in ('missing', 'pending', 'hash'):
            m = manifest()
            if mode == 'missing': m['reviews'].pop('corporate_event_economics')
            elif mode == 'pending': m['reviews']['license']['status'] = 'pending'
            else: m['protocol_sha256'] = '0' * 64
            with patch('analytics.stock_development_runner_v1._read') as read:
                with self.assertRaises(ValueError): load_development('.', m)
                read.assert_not_called()

    def test_hash_and_path_confinement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'sample.json').write_text('{}')
            entry = dict(path='sample.json', sha256=hashlib.sha256(b'{}').hexdigest())
            self.assertEqual(_read(root, entry), b'{}')
            (root / 'sample.json').write_text('{"changed":true}')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): _read(root, entry)
            for path in ('../outside.json', str(root / 'sample.json')):
                with self.assertRaises(ValueError): _read(root, dict(entry, path=path))

    def test_duplicate_json_keys_and_nonfinite_values_rejected(self):
        for raw in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}'):
            with self.assertRaises(ValueError): _json(raw)


class ReportingTests(unittest.TestCase):
    def test_annual_monthly_cumulative_and_drawdown_known_values(self):
        r = wealth_statistics(['1999-12-31', '2000-01-31', '2000-02-29', '2000-12-29',
                              '2001-12-31'], [100, 110, 88, 110, 121])
        self.assertAlmostEqual(r['cumulative_return'], .21)
        self.assertAlmostEqual(r['maximum_drawdown'], .2)
        self.assertEqual(r['drawdown_duration_days'], 333)
        self.assertFalse(r['terminal_drawdown_unrecovered'])
        self.assertAlmostEqual(r['annual'][0]['net_return'], .1)
        self.assertAlmostEqual(r['annual'][1]['net_return'], .1)
        self.assertFalse(r['annual'][0]['complete_calendar_year'])

    def test_sortino_uses_all_months_not_only_negative_months(self):
        r = wealth_statistics(['1999-12-31', '2000-01-31', '2000-02-29'],
                             [100, 110, 104.5], {'2000-01': 0., '2000-02': 0.})
        self.assertAlmostEqual(r['sortino'], .025 / (.05 / 2**.5) * 12**.5)
        self.assertIsNotNone(r['sharpe'])

    def test_undefined_ratios_and_bad_risk_free(self):
        dates = ['1999-12-31', '2000-01-31', '2000-02-29']
        self.assertIsNone(wealth_statistics(dates, [100,100,100])['sortino'])
        self.assertIsNone(wealth_statistics(dates, [100,100,100], {'2000-01':0., '2000-02':0.})['sharpe'])
        for rf in ({'2000-01':0.}, {'2000-01':0., '2000-02':float('nan')}):
            with self.assertRaises(ValueError): wealth_statistics(dates, [100,110,100], rf)

    def test_zero_negative_nonfinite_wealth_and_duplicate_dates(self):
        for wealth in ([100,0], [100,-1], [100,'NaN']):
            with self.assertRaises(ValueError): wealth_statistics(['2000-01-01','2000-01-02'], wealth)
        with self.assertRaises(ValueError): wealth_statistics(['2000-01-01']*2, [100,100])


if __name__ == '__main__': unittest.main()
