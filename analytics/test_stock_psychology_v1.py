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
        self.assertEqual(len(v), 10)
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
        self.assertEqual(len(out['variants']), 20)
        self.assertIn('spy-exposure-matched', out['benchmarks'])
        self.assertEqual(len(out['comparisons']), 9)
        self.assertTrue(all(c['p_adjusted'] >= (c['holdout'] or {'p_improve': 1})['p_improve'] - 1e-12 for c in out['comparisons']))
        for layer in sp.UNSUPPORTED:
            self.assertTrue(out['verdicts'][layer].startswith('not_tested'))
        for layer in sp.LAYERS:
            self.assertIn(out['verdicts'][layer], ('helps', 'hurts', 'no_clear_effect'))
        self.assertTrue(all(math.isfinite(x['full']['total']) for x in out['variants'].values()))

    def test_regime_filter_goes_to_cash_only_when_spy_is_below_its_200_day_mean(self):
        spy = {'ac': [100.0] * 199 + [90.0] + [120.0]}
        self.assertTrue(sp.risk_off(spy, 200))
        self.assertFalse(sp.risk_off({'ac': [100.0] * 199 + [110.0]}, 200))
        self.assertFalse(sp.risk_off(None, 300))
        k = 2300
        scores = {s: wb.score(self.series[s], k, 252) for s in self.series if s != 'SPY'}
        scores = {s: x for s, x in scores.items() if x}
        off = dict(self.series, SPY={**self.series['SPY'], 'ac': [x if i != k - 1 else 1.0 for i, x in enumerate(self.series['SPY']['ac'])]})
        self.assertTrue(all(not x['eligible'] for x in sp.make_adjust(('market_regime',))(scores, off, k).values()))

    def test_forward_ledger_freezes_before_the_open_appends_once_and_grades_later(self):
        sessions = self.sessions + ['2025-07-01']  # a future session from the published calendar: no bars yet
        series = {s: {k: v + [None] for k, v in col.items()} for s, col in self.series.items()}
        uni = self.universe
        # Only weekly decision sessions on/after the first forward date are frozen.
        old = sp.FORWARD_FIRST_DECISION
        try:
            sp.FORWARD_FIRST_DECISION = '2025-06-30'
            last = self.sessions[-1]                     # 2025-06-30 (Monday) completed; next is 2025-07-01 (Tuesday)
            self.assertIsNone(sp.next_decision(sessions, last))
            last = self.sessions[-2]                     # Friday 2025-06-27 completed; Monday 2025-06-30 opens a new week
            rows = sp.freeze(sessions, series, uni, [], last, '2025-06-28T02:17:00Z', 'f' * 64)
            self.assertEqual(len(rows), 10)
            self.assertTrue(all(r['decision_session'] == '2025-06-30' and r['data_through'] == '2025-06-27' for r in rows))
            # Picks depend only on bars before the decision session.
            mutated = {s: {k: v[:-2] + [x * 5 if x else x for x in v[-2:]] for k, v in col.items()} for s, col in series.items()}
            again = sp.freeze(sessions, mutated, uni, [], last, '2025-06-28T03:00:00Z', 'f' * 64)
            self.assertEqual([r['picks'] for r in rows], [r['picks'] for r in again])
            self.assertEqual(sp.freeze(sessions, series, uni, rows, last, 'later', 'f' * 64), [])
            g = sp.grade(rows, sessions, series)
            self.assertEqual(g['variants']['base']['pending'], 1)
            self.assertEqual(g['variants']['base']['status'], 'collecting')
            summary = sp.lab_summary(None, rows, g)
            self.assertEqual(summary['validated'], [])
        finally:
            sp.FORWARD_FIRST_DECISION = old


    def test_holdrank10_forward_rows_freeze_once_and_stay_separate_from_the_psychology_experiment(self):
        sessions = self.sessions + ['2025-07-01']
        series = {s: {k: v + [None] for k, v in col.items()} for s, col in self.series.items()}
        old = sp.FORWARD_FIRST_DECISION
        try:
            sp.FORWARD_FIRST_DECISION = '2025-06-30'
            last = self.sessions[-2]
            psych = sp.freeze(sessions, series, self.universe, [], last, '2025-06-28T02:17:00Z', 'f' * 64)
            hr = sp.freeze_holdrank10(sessions, series, self.universe, psych, last, '2025-06-28T02:17:00Z', 'f' * 64)
            self.assertEqual(len(hr), 1)
            self.assertEqual(hr[0]['experiment'], sp.HOLDRANK10_EXPERIMENT)
            self.assertEqual(hr[0]['decision_session'], '2025-06-30')
            self.assertEqual(hr[0]['rules']['spec']['buffer'], 10)
            # With nothing held, the hold buffer changes nothing: picks equal the base variant's.
            base = next(r for r in psych if r['variant'] == 'base')
            self.assertEqual(hr[0]['picks'], base['picks'])
            # A held name ranked 6-10 is kept by the buffer but not by the base rules.
            k = sessions.index('2025-06-30')
            sectors = {u['symbol']: u['sector'] for u in self.universe['securities']}
            scores = {s: x for s in sectors if s in series and (x := wb.score(series[s], k, sp.BASE_SPEC['lookback'])) is not None}
            ranked = sorted((s for s, x in scores.items() if x['eligible'] and x['trend'] and x['momentum'] > 0), key=lambda s: (-scores[s]['momentum'], s))
            outside = [s for s in ranked[5:10] if s not in base['picks']]
            if outside:
                prior = dict(hr[0], decision_session='2025-06-23', picks=[outside[0]])
                kept = sp.decide(sessions, series, self.universe, k, (), {outside[0]}, sp.HOLDRANK10_SPEC)
                self.assertIn(outside[0], kept)
                self.assertNotIn(outside[0], sp.decide(sessions, series, self.universe, k, (), {outside[0]}))
                self.assertIn(outside[0], sp.freeze_holdrank10(sessions, series, self.universe, [prior], last, 'x', 'f' * 64)[0]['picks'])
            # Append-only: the same week is never frozen twice; psychology rows are unaffected.
            ledger = psych + hr
            self.assertEqual(sp.freeze_holdrank10(sessions, series, self.universe, ledger, last, 'later', 'f' * 64), [])
            self.assertEqual(sp.freeze(sessions, series, self.universe, sp.own_rows(ledger), last, 'later', 'f' * 64), [])
            self.assertEqual(len(sp.own_rows(ledger)), 10)
            self.assertEqual(sp.own_rows(ledger, sp.HOLDRANK10_EXPERIMENT), hr)
            g = sp.grade(hr, sessions, series)
            self.assertEqual(list(g['variants']), ['holdrank10'])
            summary = sp.lab_summary(None, sp.own_rows(ledger), sp.grade(psych, sessions, series))
            self.assertEqual(summary['forward']['frozenRows'], 10)
        finally:
            sp.FORWARD_FIRST_DECISION = old

if __name__ == '__main__':
    unittest.main()
