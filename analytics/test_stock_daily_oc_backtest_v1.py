"""Tests for the daily open-to-close backtest. Synthetic TEST-ONLY bars; no network."""
from __future__ import annotations
import unittest
from datetime import date, timedelta

from analytics import stock_daily_oc_backtest_v1 as bt

SECTORS = {'AAA': 'Tech', 'BBB': 'Tech', 'CCC': 'Tech', 'DDD': 'Energy', 'EEE': 'Energy',
           'FFF': 'Health', 'GGG': 'Health', 'HHH': 'Utilities'}
UNIVERSE = {'securities': [{'symbol': s, 'sector': sec} for s, sec in SECTORS.items()]}


def sessions(n: int) -> list[str]:
    d, out = date(2016, 1, 4), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def flat(n: int, price: float = 50.0, volume: float = 1_000_000) -> dict:
    return {k: [price] * n for k in ('o', 'c', 'ao', 'ac')} | {'v': [volume] * n}


def world(n: int = 260, moves: dict | None = None) -> tuple[list[str], dict]:
    """Flat $50 prices; `moves` = {symbol: {session index: close}} sets raw and adjusted closes."""
    ss = sessions(n)
    series = {s: flat(n) for s in SECTORS}
    series['SPY'] = flat(n, 400.0, 50_000_000)
    # SPY trends up, so its 200-day filter is on unless a test says otherwise.
    series['SPY']['ac'] = [300 + i * 0.5 for i in range(n)]
    for sym, m in (moves or {}).items():
        for i, c in m.items():
            series[sym]['c'][i] = c
            series[sym]['ac'][i] = c
    return ss, series


class Signals(unittest.TestCase):
    def test_losers_are_the_lowest_negative_returns_with_alphabetical_ties(self):
        ss, se = world(moves={'AAA': {248: 45}, 'BBB': {248: 48}, 'CCC': {248: 48},
                              'DDD': {248: 49}, 'EEE': {248: 52}})
        # yesterday = 248 (for T = 249): AAA -10%, BBB/CCC -4%, DDD -2%, EEE +4%
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5'), ['AAA', 'BBB', 'CCC', 'DDD'])
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'gainers5'), ['EEE'])

    def test_no_look_ahead_session_t_and_later_bars_never_change_the_picks(self):
        ss, se = world(moves={'AAA': {248: 45}, 'DDD': {248: 49}})
        before = {r: bt.picks(ss, se, UNIVERSE, 249, r) for r in bt.RULES}
        for sym in se:
            for k in ('o', 'c', 'ao', 'ac', 'v'):
                for i in range(249, len(ss)):
                    se[sym][k][i] = 1.0 if k != 'v' else 1.0
        self.assertEqual({r: bt.picks(ss, se, UNIVERSE, 249, r) for r in bt.RULES}, before)

    def test_spy_filter_turns_the_loser_rule_off_below_the_200_day_average(self):
        ss, se = world(moves={'AAA': {248: 45}})
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5-spy200'), ['AAA'])
        se['SPY']['ac'][248] = 100.0  # yesterday's SPY close far below its 200-day mean
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5-spy200'), [])
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5'), ['AAA'])

    def test_volatility_rule_ranks_by_return_over_usual_volatility(self):
        ss, se = world(moves={'AAA': {248: 45}, 'BBB': {248: 48}})
        # AAA is usually wild (alternating +/-8% before yesterday); BBB is usually calm.
        for i in range(226, 248):
            se['AAA']['ac'][i] = 50 * (1.08 if i % 2 else 1.0)
            se['BBB']['ac'][i] = 50 * (1.001 if i % 2 else 1.0)
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5-volz'), ['BBB', 'AAA'])

    def test_usual_volatility_ends_the_day_before_yesterday(self):
        ss, se = world(moves={'AAA': {248: 25}})  # yesterday's -50% must not count as "usual"
        for i in range(227, 248):
            se['AAA']['ac'][i] = 50 * (1.01 if i % 2 else 1.0)
        p = se['AAA']['ac'][227:248]
        r = [b / a - 1 for a, b in zip(p, p[1:])]
        m = sum(r) / len(r)
        expected = (sum((x - m) ** 2 for x in r) / (len(r) - 1)) ** 0.5
        self.assertAlmostEqual(bt._usual_volatility(se['AAA'], 249), expected)

    def test_sector_cap_takes_at_most_two_per_sector(self):
        ss, se = world(moves={'AAA': {248: 40}, 'BBB': {248: 41}, 'CCC': {248: 42}, 'DDD': {248: 49}})
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5-spy200'), ['AAA', 'BBB', 'CCC', 'DDD'])
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5-spy200-sector2'), ['AAA', 'BBB', 'DDD'])

    def test_price_and_dollar_volume_floors(self):
        ss, se = world(moves={'AAA': {248: 45}, 'BBB': {248: 4.5}})
        se['BBB']['c'][247] = se['BBB']['ac'][247] = 4.9
        self.assertNotIn('BBB', bt.picks(ss, se, UNIVERSE, 249, 'losers5'))  # under $5
        se['AAA']['v'] = [100_000] * len(ss)  # $5M a day
        self.assertNotIn('AAA', bt.picks(ss, se, UNIVERSE, 249, 'losers5'))

    def test_missing_bars_make_a_member_ineligible(self):
        ss, se = world(moves={'AAA': {248: 45}})
        se['AAA']['ac'][247] = None
        self.assertEqual(bt.picks(ss, se, UNIVERSE, 249, 'losers5'), [])


class Execution(unittest.TestCase):
    def run_one(self, se, ss, rule='losers5', cost=10, **kw):
        return bt.simulate(ss, se, UNIVERSE, rule, start=ss[249], end=ss[249], cost_bps=cost, **kw)

    def test_fill_at_open_exit_at_close_with_slippage_and_whole_shares(self):
        ss, se = world(moves={'AAA': {248: 45}})
        se['AAA']['o'][249], se['AAA']['c'][249] = 46.0, 47.0
        r = self.run_one(se, ss)
        limit = round(45 * 1.03, 2)
        shares = int(0.20 * 30_000 // (limit * 1.0025))
        pnl = shares * (47.0 * (1 - 0.001) - 46.0 * (1 + 0.001))
        self.assertAlmostEqual(r['curve'][-1][1], 30_000 + pnl, places=6)
        self.assertEqual((r['orders'], r['filled'], r['unfilled']), (1, 1, 0))
        self.assertEqual(r['trades'][0]['shares'], shares)

    def test_gap_above_the_limit_leaves_the_order_unfilled(self):
        ss, se = world(moves={'AAA': {248: 45}})
        se['AAA']['o'][249] = 45 * 1.031  # 3.1% gap up
        r = self.run_one(se, ss)
        self.assertEqual((r['orders'], r['filled'], r['unfilled']), (1, 0, 1))
        self.assertEqual(r['curve'][-1][1], 30_000)

    def test_no_bar_on_the_day_leaves_the_order_unfilled(self):
        ss, se = world(moves={'AAA': {248: 45}})
        for k in ('o', 'c', 'ao', 'ac', 'v'):
            se['AAA'][k][249] = None
        r = self.run_one(se, ss)
        self.assertEqual(r['unfilled'], 1)

    def test_a_position_smaller_than_one_share_is_not_an_order(self):
        ss, se = world(moves={'AAA': {248: 45}})
        r = bt.simulate(ss, se, UNIVERSE, 'losers5', start=ss[249], end=ss[249], cost_bps=10, capital=100)
        self.assertEqual((r['orders'], r['unfilled'], r['skipped_under_one_share']), (0, 0, 1))

    def test_never_leveraged_even_when_every_order_fills_at_its_limit(self):
        moves = {s: {248: 40 + i} for i, s in enumerate('AAA BBB CCC DDD EEE'.split())}
        ss, se = world(moves=moves)
        for s, m in moves.items():
            se[s]['o'][249] = round(m[248] * 1.03, 2)
        r = self.run_one(se, ss, cost=25)
        spent = sum(t['shares'] * t['entry'] * 1.0025 for t in r['trades'])
        self.assertLessEqual(spent, 30_000)
        self.assertEqual(r['filled'], 5)

    def test_a_missing_close_stays_unresolved_and_exits_at_the_next_close(self):
        ss, se = world(moves={'AAA': {248: 45}})
        se['AAA']['o'][249] = 46.0
        se['AAA']['c'][249] = None
        r = bt.simulate(ss, se, UNIVERSE, 'losers5', start=ss[249], end=ss[250], cost_bps=10)
        self.assertEqual(r['unresolved'][0]['symbol'], 'AAA')
        self.assertEqual(r['unresolved'][0]['entered'], ss[249])
        self.assertEqual(r['unresolved'][0]['resolved'], ss[250])
        self.assertIsNone(r['trades'][0]['exit_on_entry_day'])

    def test_drawdown_pause_skips_five_sessions_then_resumes(self):
        n = 300
        ss, se = world(n)
        # From session 247 AAA falls 3% every close, opens flat to the prior close: a loser every day
        # that also loses 3% intraday, so a 20% position costs the account about 0.6% a day.
        se['AAA']['v'] = [10_000_000] * n  # stays above the $20M dollar-volume floor as it falls
        for i in range(247, n):
            se['AAA']['c'][i] = se['AAA']['ac'][i] = 50 * 0.97 ** (i - 246)
            se['AAA']['o'][i] = se['AAA']['c'][i - 1]
        live = bt.simulate(ss, se, UNIVERSE, 'losers5', start=ss[249], end=ss[n - 1], cost_bps=10, pause=True)
        cont = bt.simulate(ss, se, UNIVERSE, 'losers5', start=ss[249], end=ss[n - 1], cost_bps=10, pause=False)
        self.assertGreaterEqual(live['pauses'], 1)
        self.assertEqual(cont['pauses'], 0)
        self.assertEqual(cont['orders'] - live['orders'], 5 * live['pauses'])
        self.assertGreater(live['curve'][-1][1], cont['curve'][-1][1])

    def test_pause_rule_mechanics(self):
        state = bt.Pause()
        for eq in (100, 95, 91):
            self.assertFalse(state.paused_today())
            state.close(eq)
        state.close(90)  # 10% below the 100 peak
        self.assertEqual(state.events, 1)
        for _ in range(5):
            self.assertTrue(state.paused_today())
            state.tick()
        self.assertFalse(state.paused_today())
        state.close(85)  # peak was reset to 90 at resume; 85 is only 5.6% below
        self.assertEqual(state.events, 1)

    def test_higher_costs_lower_the_result_with_identical_shares(self):
        ss, se = world(moves={'AAA': {248: 45}})
        se['AAA']['o'][249], se['AAA']['c'][249] = 46.0, 47.0
        a, b = self.run_one(se, ss, cost=5), self.run_one(se, ss, cost=25)
        self.assertGreater(a['curve'][-1][1], b['curve'][-1][1])
        self.assertEqual(a['trades'][0]['shares'], b['trades'][0]['shares'])


class Benchmarks(unittest.TestCase):
    def test_spy_open_to_close_and_buy_and_hold(self):
        ss, se = world()
        se['SPY']['o'][249], se['SPY']['c'][249] = 400.0, 404.0
        oc = bt.spy_open_close(ss, se['SPY'], start=ss[249], end=ss[249], cost_bps=0)
        self.assertAlmostEqual(oc['curve'][-1][1], 30_000 * 1.01)
        se['SPY']['ao'][249] = 400.0
        se['SPY']['ac'][249] = 410.0
        hold = bt.spy_hold(ss, se['SPY'], start=ss[249], end=ss[249])
        self.assertAlmostEqual(hold['curve'][-1][1], 30_000 * 410 / 400)


class Verdicts(unittest.TestCase):
    def good(self):
        m = lambda cagr, sharpe=1.2, mdd=-0.2: {'cagr': cagr, 'sharpe': sharpe, 'max_drawdown': mdd}
        return {
            'rules': {'losers5': {
                'bps10': {'full': m(0.15), 'early': m(0.1), 'late': m(0.1),
                          'years': {str(y): 0.05 for y in range(2017, 2027)}},
                'bps25': {'full': m(0.05)}}},
            'benchmarks': {'spy-hold': {'full': m(0.13, 0.8)}, 'spy-open-close': {'bps10': {'full': m(-0.02, -0.1)}},
                           'weekly': {'bps10': {'full': m(0.06, 0.5)}}},
        }

    def test_all_seven_conditions_pass(self):
        v = bt.verdicts(self.good())
        self.assertEqual(v['losers5']['verdict'], 'QUALIFIES FOR REVIEW')
        self.assertEqual(v['overall'], 'QUALIFIES FOR REVIEW: losers5')

    def test_any_failed_condition_means_none_qualifies(self):
        for path, value in ((('bps25', 'full', 'cagr'), -0.01), (('bps10', 'full', 'sharpe'), 0.7),
                            (('bps10', 'full', 'max_drawdown'), -0.36), (('bps10', 'late', 'cagr'), -0.01)):
            out = self.good()
            node = out['rules']['losers5']
            for k in path[:-1]:
                node = node[k]
            node[path[-1]] = value
            v = bt.verdicts(out)
            self.assertEqual(v['losers5']['verdict'], 'FAILS', path)
            self.assertEqual(v['overall'], 'NONE QUALIFIES', path)

    def test_six_of_ten_positive_years_needed(self):
        out = self.good()
        years = out['rules']['losers5']['bps10']['years']
        for y in ('2017', '2018', '2019', '2020', '2021'):
            years[y] = -0.01
        self.assertEqual(bt.verdicts(out)['losers5']['checks']['positive_years'], False)


class Metrics(unittest.TestCase):
    def test_calendar_year_returns(self):
        curve = [('2016-12-30', 100.0), ('2017-06-30', 110.0), ('2017-12-29', 120.0), ('2018-12-31', 108.0)]
        self.assertEqual({k: round(v, 6) for k, v in bt.yearly(curve).items()}, {'2017': 0.2, '2018': -0.1})


if __name__ == '__main__':
    unittest.main()
