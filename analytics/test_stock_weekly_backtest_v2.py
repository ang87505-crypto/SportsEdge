"""Independent cash reconciliation, selection, information boundary and replay regressions."""
from copy import deepcopy
from datetime import date
import math
import random
import unittest

from analytics import stock_weekly_backtest_v1 as old
from analytics import stock_weekly_backtest_v2 as bt
from analytics.test_stock_weekly_backtest_v1 import fixture_data
from analytics.test_stock_weekly_v2 import universe


class CashTests(unittest.TestCase):
    def test_fully_invested_purchase_reserves_costs(self):
        targets = {str(i): 200 for i in range(5)}
        r = bt.rebalance({}, 1000, targets, {}, cost_bps=10)
        self.assertAlmostEqual(sum(r['values'].values()), 1000 / 1.001)
        self.assertAlmostEqual(r['cost'], 1000 - 1000 / 1.001)
        self.assertGreaterEqual(r['cash'], 0)
        self.assertAlmostEqual(r['cash'], 0)
        self.assertLess(r['buy_scale'], 1)

    def test_sells_fund_buys_and_buys_have_no_alphabetical_priority(self):
        # Existing $1,000 holding exits; two equal $500 targets share the net proceeds.
        r = bt.rebalance({'ZZZ': 1000}, 0, {'AAA': 500, 'BBB': 500}, {'ZZZ': 50}, cost_bps=50)
        self.assertEqual(r['legs'][0]['side'], 'sell')
        self.assertAlmostEqual(r['values']['AAA'], 995 / 1.005 / 2)
        self.assertEqual(r['values']['AAA'], r['values']['BBB'])
        self.assertAlmostEqual(sum(x['cash_delta'] for x in r['legs']), r['cash'])
        self.assertAlmostEqual(r['cash'] + sum(r['values'].values()), 1000 - r['cost'])

    def test_band_keeps_small_drift_but_never_prevents_exit(self):
        r = bt.rebalance({'A': 110, 'B': 50}, 840, {'A': 100}, {'A': 1, 'B': 1}, cost_bps=10, band=.2)
        self.assertEqual(r['values'], {'A': 110})
        self.assertEqual([(x['symbol'], x['side']) for x in r['legs']], [('B', 'sell')])
        r = bt.rebalance({'A': 121}, 879, {'A': 100}, {'A': 1}, cost_bps=10, band=.2)
        self.assertEqual(r['values']['A'], 100)

    def test_fees_are_charged_on_small_account_control_too(self):
        r = bt.rebalance({}, 1000, {'A': 100}, {}, cost_bps=25)
        self.assertEqual(r['values'], {'A': 100})
        self.assertEqual(r['cash'], 899.75)
        self.assertEqual(r['cost'], .25)

    def test_random_ledgers_reconcile_without_cash_or_position_borrowing(self):
        rng = random.Random(71)
        for _ in range(150):
            positions = {str(i): rng.uniform(0, 2000) for i in range(5)}
            cash = rng.uniform(0, 2000)
            equity = sum(positions.values()) + cash
            weights = [rng.random() for _ in range(5)]
            targets = {str(i): equity * w / sum(weights) for i, w in enumerate(weights)}
            snapshot = deepcopy(positions)
            rate = rng.choice((0, 10, 25, 50))
            r = bt.rebalance(positions, cash, targets, {s: 1 for s in positions}, cost_bps=rate)
            self.assertEqual(positions, snapshot)
            self.assertGreaterEqual(r['cash'], 0)
            self.assertTrue(all(x >= 0 for x in r['values'].values()))
            per_symbol = dict(positions)
            running = cash
            for leg in r['legs']:
                running += leg['cash_delta']
                self.assertGreaterEqual(running, -1e-8)
                self.assertAlmostEqual(leg['cost'], leg['notional'] * rate / 10000)
                sign = 1 if leg['side'] == 'buy' else -1
                per_symbol[leg['symbol']] += sign * leg['notional']
            self.assertAlmostEqual(running, r['cash'])
            for sym in positions:
                self.assertAlmostEqual(per_symbol[sym], r['values'].get(sym, 0))
            self.assertAlmostEqual(sum(r['values'].values()) + r['cash'], equity - r['cost'])

    def test_refuses_invalid_inputs_and_excess_targets(self):
        for kwargs in ({'cost_bps': -1}, {'cost_bps': math.nan}, {'cost_bps': 10000},
                       {'cost_bps': 10, 'band': 1}):
            with self.assertRaises(ValueError):
                bt.rebalance({}, 1000, {'A': 100}, {}, **kwargs)
        with self.assertRaises(ValueError):
            bt.rebalance({}, 1000, {'A': 1001}, {}, cost_bps=10)
        with self.assertRaises(ValueError):
            bt.rebalance({}, -1, {}, {}, cost_bps=10)


class SelectionTests(unittest.TestCase):
    def scores(self):
        return {f'S{i:02}': {'momentum': .30 - i * .01, 'volatility': .02, 'trend': True,
                            'eligible': True, 'last_raw': 200} for i in range(12)}

    def test_control_parity_and_uncapped_selection(self):
        scores = self.scores()
        sectors = {s: s for s in scores}
        self.assertEqual(bt.select(scores, sectors, set(), bt.SPECS['current'], 95), [])
        self.assertEqual(bt.select(scores, sectors, set(), bt.SPECS['uncapped'], None),
                         old.select(scores, sectors, set(), {'model': 'momentum', 'buffer': 0}, None))

    def test_buffer_retains_eligible_top_ten_and_respects_sector_cap(self):
        scores = self.scores()
        sectors = {s: 'X' if s in ('S00', 'S01', 'S08') else s for s in scores}
        picks = bt.select(scores, sectors, {'S08', 'S11'}, bt.SPECS['cost-aware'], None)
        self.assertIn('S08', picks)
        self.assertNotIn('S11', picks)
        self.assertEqual(sum(sectors[s] == 'X' for s in picks), 2)
        self.assertEqual(len(picks), 5)

    def test_risk_adjusted_ranking_changes_only_eligible_positive_momentum_order(self):
        scores = self.scores()
        scores['S09']['volatility'] = .001
        scores['S10']['volatility'] = 0
        scores['S11']['trend'] = False
        snapshot = deepcopy(scores)
        picks = bt.select(scores, {s: s for s in scores}, set(), bt.SPECS['risk-adjusted'], None)
        self.assertEqual(picks[0], 'S09')
        self.assertNotIn('S10', picks)
        self.assertNotIn('S11', picks)
        self.assertEqual(scores, snapshot)


class ReplayTests(unittest.TestCase):
    def inputs(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = deepcopy(data['bars']['S10'])
        return data, universe() | {'max_last_close': '95'}

    def test_initial_cost_is_included_in_performance(self):
        m = bt.metrics([('2017-01-03', 999), ('2017-01-04', 999)], '2017-01-01', '2017-12-31')
        self.assertAlmostEqual(m['total'], -.001)
        self.assertAlmostEqual(m['max_drawdown'], -.001)

    def test_future_data_cannot_change_earlier_decisions_or_equity(self):
        data, uni = self.inputs()
        sessions, series = old.align(data)
        decisions = [k for k in range(old.WINDOW, len(sessions)) if old.is_decision(sessions, k, 'weekly')]
        end = sessions[decisions[1]]
        a = bt.replay(sessions, series, uni, bt.SPECS['cost-aware'], start=sessions[decisions[0]], end=end)
        changed = deepcopy(series)
        for s in changed:
            for key in ('o', 'c', 'ao', 'ac'):
                for k in range(decisions[1] + 1, len(sessions)):
                    changed[s][key][k] *= 10
        b = bt.replay(sessions, changed, uni, bt.SPECS['cost-aware'], start=sessions[decisions[0]], end=end)
        self.assertEqual(a, b)

    def test_selection_does_not_replace_a_pick_using_todays_missing_open(self):
        data, uni = self.inputs()
        sessions, series = old.align(data)
        k = next(i for i in range(old.WINDOW, len(sessions)) if old.is_decision(sessions, i, 'weekly'))
        r = bt.replay(sessions, series, uni, bt.SPECS['uncapped'], start=sessions[k], end=sessions[k])
        picked = r['ledger'][0]['legs'][0]['symbol']
        series[picked]['ao'][k] = None
        r = bt.replay(sessions, series, uni, bt.SPECS['uncapped'], start=sessions[k], end=sessions[k])
        self.assertEqual(r['rejected'], 1)
        self.assertEqual(r['ledger'], [])
        self.assertEqual(r['ending_cash'], 1000)

    def test_missing_held_close_fails_instead_of_hiding_a_loss(self):
        data, uni = self.inputs()
        sessions, series = old.align(data)
        k = next(i for i in range(old.WINDOW, len(sessions)) if old.is_decision(sessions, i, 'weekly'))
        r = bt.replay(sessions, series, uni, bt.SPECS['uncapped'], start=sessions[k], end=sessions[k])
        picked = r['ledger'][0]['legs'][0]['symbol']
        series[picked]['ac'][k] = None
        with self.assertRaisesRegex(ValueError, 'missing held/benchmark ac'):
            bt.replay(sessions, series, uni, bt.SPECS['uncapped'], start=sessions[k], end=sessions[k])

    def test_end_to_end_all_cost_scenarios_and_no_automatic_promotion(self):
        data, uni = self.inputs()
        out = bt.evaluate(data, uni, source_sha='test')
        self.assertFalse(out['clean_holdout'])
        self.assertFalse(out['promotion_authorized'])
        self.assertEqual(set(out['scenarios']), {'10', '25', '50'})
        for rows in out['scenarios'].values():
            self.assertEqual(set(rows), set(bt.SPECS) | {'SPY-50', 'SPY-100'})
            for row in rows.values():
                self.assertEqual(row['cash_invariant'], 'PASS')
                self.assertLessEqual(row['max_exposure'], 1 + 1e-12)
        self.assertIn('EXPLORATORY ONLY', bt.markdown(out))
        self.assertEqual(out, bt.evaluate(data, uni, source_sha='test'))

    def test_invalid_duplicate_or_nonfinite_observations_rejected(self):
        data, uni = self.inputs()
        data['bars']['SPY']['ac'][0] = math.nan
        with self.assertRaises(ValueError):
            bt.evaluate(data, uni)
        data, uni = self.inputs()
        data['sessions'].append(data['sessions'][-1])
        with self.assertRaises(ValueError):
            bt.evaluate(data, uni)

    def test_fetch_bounds_cover_final_day_without_changing_calendar_or_asof(self):
        calls = []

        class Source:
            def fetch(self, base, path, query):
                calls.append((path, query))
                return [{'date': '2026-10-30'}]

            def paged(self, base, path, query):
                calls.append((path, query))
                return [{'bars': {'SPY': [{'t': '2026-10-30T04:00:00Z', 'o': 100, 'c': 101, 'v': 1000}]}}]

        data = bt.fetch(Source(), ['SPY'], '2016-01-01', '2026-10-30')
        self.assertEqual(data['sessions'], ['2026-10-30'])
        self.assertEqual(calls[0][1]['end'], '2026-10-30')
        self.assertTrue(all(q['end'] == '2026-10-31T00:00:00Z' and q['asof'] == '2026-10-30'
                            for path, q in calls if path.endswith('/bars')))


if __name__ == '__main__':
    unittest.main()
