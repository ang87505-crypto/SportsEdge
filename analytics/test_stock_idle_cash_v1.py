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

    def test_no_money_is_created_flat_prices_and_zero_costs_keep_equity_constant(self):
        days = [r['date'] for r in calendar_rows(date(2026, 11, 30))]
        flat = lambda p: {'d': days, 'o': [p] * len(days), 'c': [p] * len(days), 'v': [5e6] * len(days),
                          'ao': [p] * len(days), 'ac': [p] * len(days)}
        uni = {'max_last_close': '95', 'securities': [{'symbol': 'AAA', 'sector': 'X', 'first_traded_on': '2015-01-02'}]}
        sessions, series = bt.align({'sessions': days, 'bars': {'AAA': flat(30.0), 'SPY': flat(25.0)}})
        # A flat stock has zero momentum (never picked), so the fill holds SPY in the whole 50% headroom every week.
        r = ic.replay_fill(sessions, series, uni, ic.CURRENT_SPEC, start=bt.DEV[0], end=sessions[-1], cost_bps=0.0)
        self.assertGreater(max(r['fill_weight']), 0.49)
        for _, v in r['curve']:
            self.assertAlmostEqual(v, bt.STARTING, places=9)
        costly = ic.replay_fill(sessions, series, uni, ic.CURRENT_SPEC, start=bt.DEV[0], end=sessions[-1], cost_bps=10.0)
        end_value = costly['curve'][-1][1]
        self.assertLessEqual(end_value, bt.STARTING - 500.0 * 10 / 1e4 + 1e-9, 'costs never create money')
        self.assertGreater(end_value, bt.STARTING - 500.0 * 10 / 1e4 - 0.01,
                           'after the first purchase only cent-sized re-targeting trades pay fees')

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


class RecordedResult(unittest.TestCase):
    """The committed round-5 output (run 44828158320) must keep its recorded findings."""

    def test_recorded_round5_findings(self):
        import json
        from pathlib import Path
        path = Path(__file__).resolve().parents[1] / 'research' / 'stock_idle_cash_20261120' / 'results.json'
        out = json.loads(path.read_text(encoding='utf-8'))
        rows, spy50 = out['rows'], out['benchmarks']['spy-50']
        self.assertEqual(out['end'], '2026-11-18')
        self.assertAlmostEqual(rows['current']['dev']['sharpe'], 0.449, places=3, msg='round 3 integrity')
        for name in ('current+spy-fill', 'holdrank10+spy-fill'):
            self.assertLessEqual(rows[name]['full']['avg_invested'], ic.CAP + 0.005, 'the fill respects the gross cap')
            for p in ('holdout', 'full'):
                self.assertLess(rows[name][p]['sharpe'], spy50[p]['sharpe'], f'{name} is below SPY 50% in {p}')
        self.assertLess(rows['current+spy-fill']['dev']['sharpe'], spy50['dev']['sharpe'])
        # Recorded as found: holdrank10 + fill is marginally ABOVE SPY 50% in development (0.640 vs 0.628).
        self.assertGreater(rows['holdrank10+spy-fill']['dev']['sharpe'], spy50['dev']['sharpe'])
        self.assertEqual(out['whole_share_check']['weeks_whole_fill_held_any_spy'], 0)
        self.assertEqual(rows['current+spy-fill-whole']['full'], rows['current']['full'])
        self.assertGreater(rows['core-satellite-v3']['full']['avg_invested'], 0.99, 'policy B raises gross to ~100%')
        self.assertIn('DESCRIPTIVE', ic.markdown(out))
