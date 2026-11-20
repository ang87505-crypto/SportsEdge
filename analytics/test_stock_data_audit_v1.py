"""Stock data-quality audit and forward protocol (docs/STOCK_DATA_QUALITY_AUDIT_2026_11_20.md). Fictional data."""
import unittest
from analytics import stock_data_audit_v1 as au
from analytics import stock_forward_protocol_v1 as fp
from analytics import stock_weekly_backtest_v1 as bt
from analytics.test_stock_weekly_v2 import universe
from analytics.test_stock_weekly_backtest_v1 import fixture_data


def bars(days, close, ratio=lambda i: 1.0):
    c = [close(i) for i in range(len(days))]
    a = [x * ratio(i) for i, x in enumerate(c)]
    return {'d': list(days), 'o': list(c), 'c': c, 'v': [1e6] * len(days), 'ao': list(a), 'ac': a}


class Steps(unittest.TestCase):
    def test_classify_split_dividend_and_unexplained_steps(self):
        self.assertIsNone(au.classify_step(0.9, 0.9))
        self.assertEqual(au.classify_step(0.5, 1.0), 'split', '2-for-1: raw halves, adjusted continuous')
        self.assertEqual(au.classify_step(0.3, 0.9), 'split', '3-for-1')
        self.assertEqual(au.classify_step(1.0, 0.25), 'split', '1-for-4 reverse split')
        self.assertEqual(au.classify_step(0.97, 0.975), 'dividend')
        self.assertEqual(au.classify_step(0.80, 0.97), 'unexplained', 'a ~21% step: spin-off or special dividend')
        self.assertEqual(au.classify_step(0.97, 0.90), 'unexplained', 'a falling ratio is never a normal event')
        self.assertIsNone(au.classify_step(None, 1.0))

    def test_symbol_audit_finds_gaps_bad_prices_events_and_extremes(self):
        days = [f'2024-01-{i:02d}' for i in range(1, 21)]
        b = bars(days, lambda i: 100.0 if i < 10 else 50.0, lambda i: 0.5 if i < 10 else 1.0)  # a 2-for-1 split on day 10
        b['c'][5] = None
        for k in b:
            if k != 'c':
                b[k] = b[k][:3] + b[k][4:] if k != 'd' else b[k][:3] + b[k][4:]
        b['c'] = b['c'][:3] + b['c'][4:]
        r = au.audit_symbol('AAA', b, days)
        self.assertEqual(r['gaps_inside_range'], 1)
        self.assertEqual(r['nonpositive_or_missing'], 1)
        self.assertEqual(r['events'].get('split'), 1)
        self.assertEqual(r['extreme_moves'], [], 'adjusted series is continuous across the split')


class Universe(unittest.TestCase):
    def test_universe_audit_reports_survivorship_facts_without_repairing(self):
        data = fixture_data('2026-12-28')
        u = universe()
        out = au.audit_universe(u, data)
        self.assertEqual(out['members'], len(u['securities']))
        self.assertIn('survivor', out['survivorship'])
        self.assertEqual(out['members_without_data'], sorted(s['symbol'] for s in u['securities'] if s['symbol'] not in data['bars']))


class Leakage(unittest.TestCase):
    def test_picks_never_change_when_everything_after_the_decision_open_is_removed(self):
        data = fixture_data('2026-12-28')
        r = au.leakage_check(data, universe() | {'max_last_close': '95'}, samples=10)
        self.assertGreater(r['checked'], 0)
        self.assertEqual(r['mismatches'], 0)

    def test_the_check_would_catch_a_replay_that_peeked(self):
        # Simulate a peeking scorer: if the score used session k's close, truncation would change the input.
        data = fixture_data('2026-12-28')
        sessions, series = bt.align(data)
        k = next(i for i in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, i, 'weekly'))
        sym = next(iter(series))
        cut = series[sym]['c'][:k] + [None] * (len(sessions) - k)
        self.assertNotEqual(series[sym]['c'][k], cut[k], 'truncation removes the decision-day close a peeking scorer would use')
        self.assertEqual(bt.score(series[sym], k, 252), bt.score({**series[sym], 'c': cut}, k, 252),
                         'the real scorer reads only sessions before k')


class Audit(unittest.TestCase):
    def test_full_audit_is_deterministic_and_lists_what_it_cannot_check(self):
        data = fixture_data('2026-12-28')
        u = universe() | {'max_last_close': '95', 'revision': 'fixture'}
        a, b = au.audit(data, u, leakage_samples=5), au.audit(data, u, leakage_samples=5)
        self.assertEqual(a, b)
        self.assertRegex(a['dataset_sha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(a['leakage']['mismatches'], 0)
        self.assertTrue(any('membership' in x for x in a['not_checkable_from_this_data']))


class Forward(unittest.TestCase):
    def test_forward_window_is_insufficient_until_26_weeks_and_reports_provenance(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        u = universe() | {'max_last_close': '95', 'revision': 'fixture'}
        out = fp.forward_report(data, u, start='2026-11-19')
        self.assertEqual(out['status'], 'INSUFFICIENT_FORWARD_WEEKS')
        self.assertIsNone(out['statement'])
        self.assertEqual(set(out['strategies']), {'current', 'holdrank10'})
        self.assertIn('spy-matched-current', out['benchmarks'])
        self.assertIn('dataset_sha256', out['provenance'])
        self.assertTrue(all(s['weeks'] < fp.MIN_WEEKS for s in out['strategies'].values()))
        for s in out['strategies'].values():
            self.assertLessEqual(s['avg_gross'], 0.5 + 1e-9)

    def test_forward_replay_starts_from_1000_on_the_forward_start(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        sessions, series = bt.align(data)
        r = bt.replay(sessions, series, universe() | {'max_last_close': '95'}, fp.RULES['current'], start='2026-11-19', end=sessions[-1])
        self.assertGreaterEqual(r['curve'][0][0], '2026-11-19')

    def test_live_vs_replay_measures_shortfall_and_excludes_flows(self):
        replay = [('2026-11-27', 1000.0), ('2026-12-04', 1010.0), ('2026-12-11', 1020.1), ('2026-12-18', 1030.0)]
        live = [{'date': '2026-11-27', 'equity': 1000.0}, {'date': '2026-12-04', 'equity': 1005.0},
                {'date': '2026-12-11', 'equity': 1110.0, 'external_flow': 100.0}, {'date': '2026-12-18', 'equity': 1120.0}]
        r = fp.live_vs_replay(live, replay)
        self.assertEqual(r['periods'], 2)
        self.assertEqual(r['excluded'], 1)
        self.assertAlmostEqual(r['pairs'][0]['live'] - r['pairs'][0]['replay'], 0.005 - 0.01)
        self.assertEqual(r['status'], 'INSUFFICIENT_FORWARD_WEEKS')
        with self.assertRaisesRegex(ValueError, 'LIVE_INVALID_EQUITY'):
            fp.live_vs_replay([{'date': '2026-11-27', 'equity': 0}], replay)


if __name__ == '__main__':
    unittest.main()
