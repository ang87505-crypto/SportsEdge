"""Stock psychology ablation on fictional prices: no look-ahead, base == registered replay, bounded family, Holm."""
from datetime import date, timedelta
import math
import random
import unittest

from analytics import stock_psychology_v1 as sp
from analytics import stock_weekly_backtest_v1 as wb


def fixture(n_symbols=12, seed=7):
    rng = random.Random(seed)
    d, sessions = date(2016, 1, 4), []
    while d <= date(2025, 6, 30):
        if d.weekday() < 5:
            sessions.append(d.isoformat())
        d += timedelta(days=1)
    bars, securities = {}, []
    for i in range(n_symbols + 1):
        sym = 'SPY' if i == n_symbols else f'T{i:02d}'
        p, rows = 40.0 + i, {'d': [], 'o': [], 'c': [], 'v': [], 'ao': [], 'ac': []}
        drift = 0.0004 + 0.00005 * i
        for k, s in enumerate(sessions):
            shock = 0.06 if (k + i * 37) % 400 < 15 else 0.012
            p = max(5.5, p * (1 + drift + rng.gauss(0, shock)))
            vol = 3_000_000 * (3.0 if (k + i * 37) % 400 < 15 else 1.0)
            for key, val in (('o', p), ('c', p), ('v', vol), ('ao', p), ('ac', p)):
                rows[key].append(val)
            rows['d'].append(s)
        bars[sym] = rows
        if sym != 'SPY':
            securities.append({'symbol': sym, 'sector': 'S%d' % (i % 4)})
    return {'sessions': sessions, 'bars': bars}, {'securities': securities, 'max_last_close': 1e9}


class PsychologyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.universe = fixture()
        cls.sessions, cls.series = wb.align(cls.data)

    def test_bounded_family_and_unsupported_layers_never_run(self):
        v = sp.variants()
        self.assertEqual(len(v), 8)
        self.assertEqual(v['combined'], sp.LAYERS)
        self.assertTrue(all(set(x) <= set(sp.LAYERS) for x in v.values()))
        self.assertTrue(set(sp.UNSUPPORTED).isdisjoint(sp.LAYERS))

    def test_features_use_only_bars_before_the_decision(self):
        k = 2000
        before = sp.features(self.series['T03'], k)
        mutated = {key: list(col) for key, col in self.series['T03'].items()}
        for key in mutated:
            for j in range(k, len(mutated[key])):
                mutated[key][j] = mutated[key][j] * 9 if mutated[key][j] else mutated[key][j]
        self.assertEqual(before, sp.features(mutated, k))

    def test_base_is_exactly_the_registered_replay(self):
        a = wb.replay(self.sessions, self.series, self.universe, sp.BASE_SPEC, start=wb.DEV[0], end='2025-06-30')
        b = wb.replay(self.sessions, self.series, self.universe, sp.BASE_SPEC, start=wb.DEV[0], end='2025-06-30', adjust=sp.make_adjust(()))
        self.assertEqual(a['curve'], b['curve'])

    def test_overlay_only_removes_candidates(self):
        k = 2300
        scores = {s: wb.score(self.series[s], k, 252) for s in self.series if s != 'SPY'}
        scores = {s: x for s, x in scores.items() if x}
        adj = sp.make_adjust(sp.LAYERS)(scores, self.series, k)
        self.assertEqual(set(adj), set(scores))
        self.assertTrue(all(not adj[s]['eligible'] or scores[s]['eligible'] for s in scores))

    def test_holm(self):
        self.assertEqual([round(x, 4) for x in sp.holm([0.01, 0.04, 0.03, 0.005])], [0.03, 0.06, 0.06, 0.02])

    def test_full_evaluation_reports_costs_benchmarks_and_conservative_verdicts(self):
        out = sp.evaluate(self.data, self.universe, end='2025-06-30')
        self.assertEqual(len(out['variants']), 16)
        self.assertIn('spy-exposure-matched', out['benchmarks'])
        self.assertEqual(len(out['comparisons']), 7)
        self.assertTrue(all(c['p_adjusted'] >= (c['holdout'] or {'p_improve': 1})['p_improve'] - 1e-12 for c in out['comparisons']))
        for layer in sp.UNSUPPORTED:
            self.assertTrue(out['verdicts'][layer].startswith('not_tested'))
        for layer in sp.LAYERS:
            self.assertIn(out['verdicts'][layer], ('helps', 'hurts', 'no_clear_effect'))
        self.assertTrue(all(math.isfinite(x['full']['total']) for x in out['variants'].values()))


if __name__ == '__main__':
    unittest.main()
