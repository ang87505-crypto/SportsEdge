"""Tests for the v2 corrections of the daily open-to-close backtest. Synthetic TEST-ONLY bars."""
from __future__ import annotations
import unittest

from analytics import stock_daily_oc_backtest_v2 as v2
from analytics.test_stock_daily_oc_backtest_v1 import UNIVERSE, world

FIVE = 'AAA BBB CCC DDD EEE'.split()


def five_losers_crash_on(ss, se, day: int, intraday: float):
    """Five members fall the day before `day`, then lose `intraday` between open and close on `day`."""
    for i, s in enumerate(FIVE):
        prev = 40.0 + i
        se[s]['c'][day - 1] = se[s]['ac'][day - 1] = prev
        se[s]['o'][day] = prev
        se[s]['c'][day] = se[s]['ac'][day] = prev * (1 - intraday)


class SafetyPause(unittest.TestCase):
    def test_first_session_drop_triggers_the_pause_and_blocks_the_next_session(self):
        # Reviewer's scenario: equity falls from $30,000 to about $13,800 on the very first session.
        ss, se = world(260)
        five_losers_crash_on(ss, se, 249, 0.54)
        for i, s in enumerate(FIVE):  # and they are losers again for the next session
            se[s]['o'][250] = se[s]['c'][249]
            se[s]['c'][250] = se[s]['ac'][250] = se[s]['c'][249]
        r = v2.simulate(ss, se, UNIVERSE, 'losers5', start=ss[249], end=ss[250], cost_bps=10)
        self.assertLess(r['curve'][1][1], 0.9 * 30_000)
        self.assertEqual(r['pauses'], 1)
        self.assertEqual(r['halted_on'], ss[249])
        self.assertEqual([t['date'] for t in r['trades']], [ss[249]] * 5)  # nothing on the next session

    def test_no_automatic_restart(self):
        n = 300
        ss, se = world(n)
        five_losers_crash_on(ss, se, 249, 0.54)
        for i in range(249, n):  # FFF falls 1% every close: a loser every session afterwards
            se['FFF']['c'][i] = se['FFF']['ac'][i] = 50 * 0.99 ** (i - 248)
            se['FFF']['o'][i] = se['FFF']['c'][i - 1]
        cont = v2.simulate(ss, se, UNIVERSE, 'losers5', start=ss[249], end=ss[n - 1], cost_bps=10, pause=False)
        self.assertGreater(len(cont['trades']), 40)  # without the pause it would keep buying
        r = v2.simulate(ss, se, UNIVERSE, 'losers5', start=ss[249], end=ss[n - 1], cost_bps=10)
        self.assertEqual(r['pauses'], 1)
        self.assertTrue(all(t['date'] == ss[249] for t in r['trades']))
        self.assertEqual(r['curve'][-1][1], r['curve'][1][1])

    def test_resume_needs_an_explicit_owner_authorization(self):
        p = v2.SafetyPause(30_000)
        p.close(26_000)
        self.assertTrue(p.halted)
        with self.assertRaises(ValueError):
            p.authorize_resume('')
        for _ in range(100):
            p.close(26_000)
        self.assertTrue(p.halted)
        p.authorize_resume('owner:test-only')
        self.assertFalse(p.halted)

    def test_peak_is_seeded_with_starting_equity(self):
        p = v2.SafetyPause(30_000)
        p.close(27_100)
        self.assertFalse(p.halted)
        p.close(27_000)  # exactly 10% below the $30,000 start
        self.assertTrue(p.halted)


class Unresolved(unittest.TestCase):
    def setUp(self):
        self.ss, self.se = world(260, moves={'AAA': {248: 45}})
        self.se['AAA']['o'][249] = 46.0
        self.se['AAA']['c'][249] = None  # no close on the entry day
        # A new loser on the next session that would normally be bought.
        self.se['DDD']['c'][249] = self.se['DDD']['ac'][249] = 48.0

    def test_an_unresolved_position_blocks_new_entries_until_it_resolves(self):
        r = v2.simulate(self.ss, self.se, UNIVERSE, 'losers5', start=self.ss[249], end=self.ss[250], cost_bps=10)
        self.assertEqual(r['unresolved'][0]['resolved'], self.ss[250])
        self.assertEqual([t['symbol'] for t in r['trades']], ['AAA'])
        self.assertEqual(r['blocked_by_unresolved'], 1)

    def test_any_unresolved_exit_blocks_qualification(self):
        m = lambda cagr, sharpe=1.2, mdd=-0.2: {'cagr': cagr, 'sharpe': sharpe, 'max_drawdown': mdd}
        out = {'rules': {'losers5': {
            'bps10': {'full': m(0.15), 'early': m(0.1), 'late': m(0.1), 'years': {str(y): 0.05 for y in range(2017, 2027)},
                      'unresolved_exits': [{'symbol': 'AAA'}], 'open_unresolved_at_end': 1},
            'bps25': {'full': m(0.05), 'unresolved_exits': [{'symbol': 'AAA'}]}}},
            'benchmarks': {'spy-hold': {'full': m(0.13, 0.8)}, 'spy-open-close': {'bps10': {'full': m(-0.02, -0.1)}},
                           'weekly': {'bps10': {'full': m(0.06, 0.5)}}}}
        v = v2.verdicts(out)
        self.assertFalse(v['losers5']['checks']['no_unresolved_exits'])
        self.assertEqual(v['overall'], 'NONE QUALIFIES')
        out['rules']['losers5']['bps10']['unresolved_exits'] = []
        out['rules']['losers5']['bps25']['unresolved_exits'] = []
        out['rules']['losers5']['bps10']['open_unresolved_at_end'] = 0
        self.assertEqual(v2.verdicts(out)['overall'], 'QUALIFIES FOR REVIEW: losers5')


class Identity(unittest.TestCase):
    def bars(self, days, start_price, step=1.0, factor=1.0):
        px = [start_price + i * step for i in range(len(days))]
        return {'d': list(days), 'o': px, 'c': px, 'v': [1e6] * len(days),
                'ao': [p * factor for p in px], 'ac': [p * factor for p in px]}

    def test_a_renamed_member_is_joined_at_the_change_date_with_a_continuous_adjusted_series(self):
        days = [f'2026-01-{d:02d}' for d in (8, 9, 12, 13, 14, 15, 16)]
        old = self.bars(days[:4], 100.0, factor=0.9)          # MMC history, different adjustment base
        new = self.bars(days[4:], 104.0, factor=1.0)          # MRSH from 2026-01-14
        data = {'sessions': days, 'bars': {'MMC': old}, 'supplement': {'bars': {'MRSH': new}},
                'identity': {'MMC': {'kind': 'name_change', 'new_symbol': 'MRSH', 'date': '2026-01-14'}}}
        joined = v2.apply_identity(data)['bars']['MMC']
        self.assertEqual(joined['d'], days)
        self.assertEqual(joined['c'], [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0])
        raw = joined['c'][4] / joined['c'][3]
        adj = joined['ac'][4] / joined['ac'][3]
        self.assertAlmostEqual(adj, raw)

    def test_audit_classifies_name_changes_mergers_and_unexplained_gaps(self):
        pages = [{'corporate_actions': {
            'name_changes': [{'old_symbol': 'MMC', 'new_symbol': 'MRSH', 'process_date': '2026-01-14'}],
            'cash_mergers': [{'acquirer_symbol': None, 'acquiree_symbol': 'EA', 'effective_date': '2026-08-04',
                              'rate': '210'}]}}]
        found = v2.classify_gaps(['EA', 'MMC', 'ZZZ'], pages)
        self.assertEqual(found['MMC'], {'kind': 'name_change', 'new_symbol': 'MRSH', 'date': '2026-01-14'})
        self.assertEqual(found['EA']['kind'], 'cash_merger')
        self.assertEqual(found['EA']['date'], '2026-08-04')
        self.assertEqual(found['ZZZ'], {'kind': 'unexplained'})


class BreakEven(unittest.TestCase):
    def test_break_even_cost_brackets_zero_net_cagr(self):
        ss, se = world(400)
        # SPY gains 0.2% from open to close every session.
        for k in range(len(ss)):
            se['SPY']['o'][k], se['SPY']['c'][k] = 400.0, 400.8
        be = v2.break_even(lambda bps: v2.spy_open_close(ss, se['SPY'], start=ss[250], end=ss[399], cost_bps=bps)['curve'],
                           ss[250], ss[399])
        # Net daily return ~ 1.002*(1-c)/(1+c) - 1 = 0 at c ~ 10 bps.
        self.assertAlmostEqual(be, 9.99, delta=0.05)

    def test_no_break_even_when_it_loses_before_costs(self):
        ss, se = world(400)
        for k in range(len(ss)):
            se['SPY']['o'][k], se['SPY']['c'][k] = 400.0, 399.6
        self.assertIsNone(v2.break_even(
            lambda bps: v2.spy_open_close(ss, se['SPY'], start=ss[250], end=ss[399], cost_bps=bps)['curve'], ss[250], ss[399]))


if __name__ == '__main__':
    unittest.main()


class UnresolvedEveryCostLevel(unittest.TestCase):
    """Regression: an unresolved position at any cost level, including 25 bps, blocks qualification."""

    def out(self, where: str, field: str):
        m = lambda cagr, sharpe=1.2, mdd=-0.2: {'cagr': cagr, 'sharpe': sharpe, 'max_drawdown': mdd}
        level = lambda: {'full': m(0.15), 'early': m(0.1), 'late': m(0.1), 'years': {str(y): 0.05 for y in range(2017, 2027)},
                         'unresolved_exits': [], 'open_unresolved_at_end': 0}
        rules = {'losers5': {'bps5': level(), 'bps10': level(), 'bps25': level()}}
        rules['losers5']['bps25']['full'] = m(0.05)
        node = rules['losers5'][where]
        node[field] = [{'symbol': 'AAA'}] if field == 'unresolved_exits' else 1
        return {'rules': rules, 'benchmarks': {'spy-hold': {'full': m(0.13, 0.8)},
                                               'spy-open-close': {'bps10': {'full': m(-0.02, -0.1)}},
                                               'weekly': {'bps10': {'full': m(0.06, 0.5)}}}}

    def test_open_unresolved_at_end_at_25_bps_blocks(self):
        self.assertEqual(v2.verdicts(self.out('bps25', 'open_unresolved_at_end'))['overall'], 'NONE QUALIFIES')

    def test_unresolved_at_5_bps_blocks(self):
        self.assertEqual(v2.verdicts(self.out('bps5', 'unresolved_exits'))['overall'], 'NONE QUALIFIES')
        self.assertEqual(v2.verdicts(self.out('bps5', 'open_unresolved_at_end'))['overall'], 'NONE QUALIFIES')

    def test_clean_at_every_level_can_qualify(self):
        out = self.out('bps10', 'open_unresolved_at_end')
        out['rules']['losers5']['bps10']['open_unresolved_at_end'] = 0
        self.assertEqual(v2.verdicts(out)['overall'], 'QUALIFIES FOR REVIEW: losers5')
