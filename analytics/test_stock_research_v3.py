"""Stock research v3 on fictional prices: bounded family, no look-ahead, ranking-only overlays, honest dispositions."""
import math
import unittest

from analytics import stock_research_v3 as v3
from analytics import stock_weekly_backtest_v1 as wb
from analytics.test_stock_psychology_v1 import fixture


class StockResearchV3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.universe = fixture()
        cls.sessions, cls.series = wb.align(cls.data)
        cls.out = v3.evaluate(cls.data, cls.universe, end='2025-06-30')

    def test_family_is_bounded_and_registered(self):
        self.assertEqual(v3.CANDIDATES, ('riskadj-mom', 'mom-lowvol', 'core-satellite', 'core-satellite-riskadj'))
        self.assertEqual(set(self.out['dispositions']), set(v3.CANDIDATES))
        self.assertEqual(len(self.out['comparisons']), 4)

    def test_overlays_only_rerank_and_never_make_an_ineligible_name_selectable(self):
        k = 2300
        scores = {s: wb.score(self.series[s], k, 252) for s in self.series if s != 'SPY'}
        scores = {s: x for s, x in scores.items() if x}
        for adjust in (v3.riskadj_adjust, v3.lowvol_adjust):
            out = adjust(scores, self.series, k)
            self.assertEqual(set(out), set(scores))
            for s, x in out.items():
                self.assertEqual(x['eligible'], scores[s]['eligible'])
                self.assertEqual(x['trend'], scores[s]['trend'])
                if not (scores[s]['eligible'] and scores[s]['trend'] and scores[s]['momentum'] > 0):
                    self.assertLessEqual(x['momentum'], 0, 'a name the live rules exclude stays excluded')

    def test_overlays_use_only_bars_before_the_decision(self):
        k = 2300
        scores = {s: wb.score(self.series[s], k, 252) for s in self.series if s != 'SPY'}
        scores = {s: x for s, x in scores.items() if x}
        future = {s: {key: (col[:k] + [999.0] * (len(col) - k)) for key, col in ser.items()} for s, ser in self.series.items()}
        self.assertEqual(v3.lowvol_adjust(scores, self.series, k), v3.lowvol_adjust(scores, future, k))
        self.assertEqual(v3.riskadj_adjust(scores, self.series, k), v3.riskadj_adjust(scores, future, k))

    def test_base_is_exactly_the_live_replay(self):
        r = wb.replay(self.sessions, self.series, self.universe, v3.BASE_SPEC, start=wb.DEV[0], end='2025-06-30')
        self.assertAlmostEqual(self.out['variants']['base']['full']['total'], wb.metrics(r['curve'], wb.DEV[0], '2025-06-30')['total'], places=12)

    def test_core_satellite_mix_is_a_buy_and_hold_split(self):
        a, b = [('d1', 1000.0), ('d2', 1100.0)], [('d1', 1000.0), ('d2', 900.0)]
        self.assertEqual(v3.mix(a, b, 0.5), [('d1', 1000.0), ('d2', 1000.0)])
        self.assertGreaterEqual(self.out['variants']['core-satellite']['avg_exposure'], 0.5)

    def test_failure_audit_splits_exposure_drag_from_selection(self):
        fa = self.out['failure_audit']
        # Five 10% picks target 50% invested at each rebalance; winners drift above it between rebalances.
        self.assertTrue(0 < fa['avg_exposure'] < 0.75, fa['avg_exposure'])
        spy, matched, base = fa['holdout_spy_cagr'], fa['holdout_exposure_matched_spy_cagr'], fa['holdout_cagr']
        self.assertAlmostEqual(fa['exposure_drag'] + fa['selection_gap'], base - spy, places=12)
        self.assertTrue(math.isfinite(matched))

    def test_costs_benchmarks_and_conservative_dispositions(self):
        for name, v in self.out['variants'].items():
            self.assertIn('@25bps', v)
            self.assertIn('spy-matched-' + name, self.out['benchmarks'])
        for c in self.out['comparisons']:
            self.assertGreaterEqual(c['p_adjusted'], (c['vs_base_holdout'] or {'p_improve': 1})['p_improve'] - 1e-12)
        for d in self.out['dispositions'].values():
            self.assertIn(d['status'], ('PROMISING', 'NO_CLEAR_EFFECT', 'REJECTED'))
        self.assertIn('survivorship', ' '.join(self.out['caveats']))

    def test_decision_rule_requires_every_condition(self):
        m = lambda cagr, sharpe=1.0, total=0.1: {'cagr': cagr, 'sharpe': sharpe, 'total': total}
        base = {'holdout': m(0.06, 0.5), 'dev': m(0.05), '@25bps': {'holdout': m(0.05, total=0.2)}}
        good = {'holdout': m(0.15, 0.9), 'dev': m(0.08), '@25bps': {'holdout': m(0.14, total=0.6)}}
        spy = {'holdout': m(0.10), 'dev': m(0.06)}
        self.assertEqual(v3.decide(good, base, spy, {'upper95': 0.002}, 0.01)[0], 'PROMISING')
        self.assertEqual(v3.decide(good, base, spy, {'upper95': 0.002}, 0.2)[0], 'NO_CLEAR_EFFECT')
        self.assertEqual(v3.decide(good, base, spy, {'upper95': -0.001}, 0.01)[0], 'REJECTED')
        weak = {**good, 'holdout': m(0.09, 0.9), 'dev': m(0.05)}
        self.assertEqual(v3.decide(weak, base, spy, {'upper95': 0.002}, 0.01)[0], 'REJECTED')


if __name__ == '__main__':
    unittest.main()
