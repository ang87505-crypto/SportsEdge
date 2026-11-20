"""Idle-cash policy research (docs/STOCK_IDLE_CASH_POLICY_PLAN_2026_11_20.md). Fictional prices only."""
from datetime import date
import unittest
from analytics import stock_weekly_backtest_v1 as bt
from analytics import stock_idle_cash_v1 as ic
from analytics.test_stock_weekly_v2 import calendar_rows, universe
from analytics.test_stock_weekly_backtest_v1 import fixture_data


def with_spy(spy_price=None, session='2026-12-28'):
    data = fixture_data(session)
    if spy_price is None:
        data['bars']['SPY'] = dict(data['bars']['S10'])
    else:
        days = data['sessions']
        p = [spy_price + 0.05 * i for i in range(len(days))]
        data['bars']['SPY'] = {'d': days, 'o': p, 'c': p, 'v': [1e7] * len(days), 'ao': p, 'ac': p}
    sessions, series = bt.align(data)
    return data, sessions, series, universe() | {'max_last_close': '95', 'revision': 'fixture'}


class FillReplay(unittest.TestCase):
    def test_a_zero_cap_reproduces_the_unchanged_replay_exactly(self):
        _, sessions, series, uni = with_spy()
        for spec in (ic.CURRENT_SPEC, ic.HOLDRANK10_SPEC):
            a = ic.replay_fill(sessions, series, uni, spec, start=bt.DEV[0], end=sessions[-1], cap=0.0)
            b = bt.replay(sessions, series, uni, spec, start=bt.DEV[0], end=sessions[-1])
            self.assertEqual(a['curve'], b['curve'])
            self.assertEqual(a['traded'], b['traded'])
            self.assertEqual(a['exposure'], b['exposure'])

    def test_the_fill_replaces_idle_cash_but_never_exceeds_the_gross_cap(self):
        _, sessions, series, uni = with_spy(40.0)
        cur = bt.replay(sessions, series, uni, ic.CURRENT_SPEC, start=bt.DEV[0], end=sessions[-1])
        f = ic.replay_fill(sessions, series, uni, ic.CURRENT_SPEC, start=bt.DEV[0], end=sessions[-1])
        decisions = [i for i, d in enumerate(d for d, _ in f['curve'])
                     if bt.is_decision(sessions, sessions.index(d), 'weekly')]
        self.assertTrue(decisions)
        for i in decisions:
            self.assertLessEqual(f['exposure'][i], ic.CAP + 0.01, 'gross at the decision close stays at the cap')
        self.assertGreater(f['avg_exposure'], cur['avg_exposure'])
        self.assertGreater(max(f['fill_weight']), 0)
        self.assertGreater(f['spy_traded'], 0)

    def test_whole_spy_shares_are_unaffordable_at_1000_dollars_with_an_expensive_spy(self):
        _, sessions, series, uni = with_spy(600.0)
        whole = ic.replay_fill(sessions, series, uni, ic.CURRENT_SPEC, start=bt.DEV[0], end=sessions[-1], whole=True)
        plain = bt.replay(sessions, series, uni, ic.CURRENT_SPEC, start=bt.DEV[0], end=sessions[-1])
        self.assertEqual(max(whole['fill_weight']), 0.0, 'a $600 share never fits in ~$100-200 of headroom')
        self.assertEqual(whole['curve'], plain['curve'])
        cheap = ic.replay_fill(*with_spy(5.0)[1:], ic.CURRENT_SPEC, start=bt.DEV[0], end=sessions[-1], whole=True)
        self.assertGreater(max(cheap['fill_weight']), 0)

    def test_mix_is_the_v3_buy_and_hold_recipe(self):
        a = [('d1', 1000.0), ('d2', 1100.0)]
        b = [('d1', 1000.0), ('d2', 900.0)]
        self.assertEqual(ic.mix(a, b, 0.5), [('d1', 1000.0), ('d2', 1000.0)])
        with self.assertRaises(AssertionError):
            ic.mix(a, [('d1', 1.0), ('dX', 1.0)], 0.5)


class Statistics(unittest.TestCase):
    def test_bootstrap_is_paired_deterministic_and_detects_a_constant_edge(self):
        a = {f'w{i:03d}': ((i * 37) % 11 - 5) / 1000 for i in range(60)}
        z = ic.block_bootstrap(a, dict(a))
        self.assertEqual((z['sharpe_difference'], z['sharpe_difference_95']), (0.0, [0.0, 0.0]))
        b = {k: v - 0.001 for k, v in a.items()}
        self.assertEqual(ic.block_bootstrap(a, b), ic.block_bootstrap(a, b))
        self.assertGreater(ic.block_bootstrap(a, b)['mean_weekly_difference_95'][0], 0)
        self.assertIsNone(ic.block_bootstrap(dict(list(a.items())[:10]), b))

    def test_sortino_and_gross_metrics(self):
        curve = [(f'2024-01-0{i}', v) for i, v in enumerate([100, 101, 99, 102, 100, 103], start=1)]
        m = ic.metrics_ext(curve, [0.3, 0.4, 0.5, 0.5, 0.4, 0.3], '2024-01-02', '2024-01-06')
        self.assertAlmostEqual(m['avg_invested'], 0.42)
        self.assertAlmostEqual(m['min_invested'], 0.3)
        self.assertGreater(m['sortino'], m['sharpe'])


class Shadow(unittest.TestCase):
    snap = staticmethod(lambda d, eq, sleeve, spy, flow=0: {'date': d, 'equity': eq, 'sleeve_value': sleeve,
                                                             'spy_close': spy, 'external_flow': flow})

    def test_one_week_arithmetic(self):
        w = ic.shadow_week(self.snap('2026-11-30', 1000.0, 300.0, 500.0), self.snap('2026-12-07', 1010.0, 305.0, 510.0))
        self.assertAlmostEqual(w['actual'], 0.01)
        self.assertAlmostEqual(w['gross_used'], 0.30)
        self.assertAlmostEqual(w['idle_within_cap'], 0.20)
        self.assertAlmostEqual(w['idle_beyond_cap'], 0.50)
        self.assertAlmostEqual(w['spy'], 0.02)
        self.assertAlmostEqual(w['shadow_fill'], 0.01 + 0.20 * 0.02 - 0.20 * 10 / 1e4)
        self.assertAlmostEqual(w['shadow_fill_25bps'], 0.01 + 0.20 * 0.02 - 0.20 * 25 / 1e4)
        self.assertAlmostEqual(w['spy_at_actual_gross'], 0.30 * 0.02)
        self.assertAlmostEqual(w['spy_50'], 0.01)
        same = ic.shadow_week(self.snap('2026-11-30', 1000.0, 300.0, 500.0), self.snap('2026-12-07', 1010.0, 305.0, 510.0),
                              prev_fill_weight=0.20)
        self.assertAlmostEqual(same['shadow_fill'], 0.01 + 0.20 * 0.02, msg='no fill change, no cost')

    def test_a_sleeve_at_or_above_the_cap_has_no_idle_cash_within_it(self):
        w = ic.shadow_week(self.snap('2026-11-30', 1000.0, 520.0, 500.0), self.snap('2026-12-07', 1000.0, 520.0, 500.0))
        self.assertEqual(w['idle_within_cap'], 0.0)

    def test_invalid_or_unmeasurable_weeks_are_refused(self):
        ok = self.snap('2026-11-30', 1000.0, 300.0, 500.0)
        with self.assertRaisesRegex(ValueError, 'EXTERNAL_FLOW'):
            ic.shadow_week(ok, self.snap('2026-12-07', 1100.0, 300.0, 500.0, flow=100.0))
        with self.assertRaisesRegex(ValueError, 'DATES'):
            ic.shadow_week(ok, self.snap('2026-11-30', 1000.0, 300.0, 500.0))
        with self.assertRaisesRegex(ValueError, 'SNAPSHOT'):
            ic.shadow_week(ok, self.snap('2026-12-07', 1000.0, 1200.0, 500.0))
        with self.assertRaisesRegex(ValueError, 'FILL'):
            ic.shadow_week(ok, self.snap('2026-12-07', 1000.0, 300.0, 500.0), prev_fill_weight=0.6)

    def test_summary_needs_26_weeks_before_intervals(self):
        rows, prev, fill = [], self.snap('2026-11-30', 1000.0, 300.0, 500.0), 0.0
        for i in range(30):
            cur = self.snap(f'2027-{1 + i // 4:02d}-{1 + (i % 4) * 7:02d}', prev['equity'] * (1 + ((i * 7) % 5 - 2) / 1000),
                            300.0, prev['spy_close'] * (1 + ((i * 3) % 7 - 3) / 1000))
            rows.append(ic.shadow_week(prev, cur, fill))
            prev, fill = cur, rows[-1]['fill_weight']
        short = ic.summarize_shadow(rows[:10])
        self.assertEqual(short['status'], 'INSUFFICIENT_WEEKS')
        self.assertNotIn('intervals', short)
        full = ic.summarize_shadow(rows)
        self.assertEqual(full['status'], 'MEASURED')
        self.assertEqual(set(full['intervals']), {'actual - spy_at_actual_gross', 'shadow_fill - actual', 'shadow_fill - spy_50'})
        with self.assertRaisesRegex(ValueError, 'DATES'):
            ic.summarize_shadow([rows[1], rows[0]])


class EndToEnd(unittest.TestCase):
    def test_round5_runs_and_reports_every_row_benchmark_and_check(self):
        data, *_ = with_spy(40.0)
        uni = universe() | {'max_last_close': '95', 'revision': 'fixture'}
        out = ic.evaluate(data, uni, end=data['sessions'][-1])
        self.assertEqual(set(out['rows']), set(ic.CATEGORY))
        self.assertEqual(out['end'], data['sessions'][-1])
        self.assertIn('B: gross exposure raised', out['rows']['core-satellite-v3']['category'])
        self.assertIn('whole_share_check', out)
        self.assertIn('DESCRIPTIVE', ic.markdown(out))
        self.assertEqual(ic.evaluate(data, uni, end=data['sessions'][-1])['rows'], out['rows'], 'deterministic')


if __name__ == '__main__':
    unittest.main()
