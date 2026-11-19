"""Engine and candidate regression tests. All bars, filings and snapshots here are synthetic TEST-ONLY data."""
from __future__ import annotations
from datetime import date, timedelta
import math
import unittest

from analytics.research import candidates as cand
from analytics.research import engine


def sessions(n, start=date(2024, 1, 1)):
    d, out = start, []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def flat(n, price=100.0, volume=1_000_000):
    return {k: [price] * n for k in ('o', 'c', 'ao', 'ac')} | {'v': [volume] * n}


def run(ss, se, decisions, *, actions=(), start=1, end=None, capital=10_000.0, cost=0.0, halt=True):
    return engine.simulate(ss, se, list(actions), decisions, start_index=start, end_index=end if end is not None else len(ss) - 1,
                           capital=capital, cost_bps=cost, halt=halt)


def equity(r):
    return r['curve'][-1][1]


class Execution(unittest.TestCase):
    def setUp(self):
        self.ss = sessions(30)
        self.se = {'AAA': flat(30, 100.0), 'BBB': flat(30, 33.0)}

    def test_decision_executes_at_the_next_open_never_the_signal_session(self):
        r = run(self.ss, self.se, [{'signal_index': 5, 'targets': {'AAA': 0.2}}])
        self.assertEqual(r['trades'][0]['date'], self.ss[6])

    def test_whole_shares_and_residual_cash(self):
        r = run(self.ss, self.se, [{'signal_index': 1, 'targets': {'BBB': 0.2}}], end=2)
        n = math.floor(0.2 * 10_000 / (33.0 * 1.0025))
        self.assertEqual(r['trades'][0]['shares'], n)
        self.assertAlmostEqual(r['cash_end'], 10_000 - n * 33.0)
        self.assertAlmostEqual(equity(r), 10_000)

    def test_costs_charged_per_side_on_traded_notional(self):
        dec = [{'signal_index': 1, 'targets': {'AAA': 0.2}}, {'signal_index': 3, 'targets': {}}]
        r = run(self.ss, self.se, dec, end=5, cost=10)
        n = r['trades'][0]['shares']
        self.assertAlmostEqual(r['costs'], 2 * n * 100 * 0.001)
        self.assertAlmostEqual(equity(r), 10_000 - 2 * n * 100 * 0.001)

    def test_gap_above_the_limit_leaves_cash(self):
        self.se['AAA']['o'][2] = 103.5
        r = run(self.ss, self.se, [{'signal_index': 1, 'targets': {'AAA': 0.2}}], end=3)
        self.assertEqual((r['filled'], r['unfilled_gap']), (0, 1))
        self.assertEqual(equity(r), 10_000)

    def test_buys_are_cut_to_available_cash_never_borrowed(self):
        names = {f'S{i}': flat(30, 40.0) for i in range(5)}
        for s in names.values():
            s['o'][2] = 41.2  # opens 3% above the sizing close: five 20% buys cannot all be paid in full
        r = run(self.ss, names, [{'signal_index': 1, 'targets': {s: 0.2 for s in names}}], end=2, cost=25)
        self.assertGreaterEqual(r['cash_end'], -1e-9)
        self.assertGreaterEqual(r['reduced_for_cash'] + r['unfilled_cash'], 1)

    def test_continuing_holdings_inside_the_band_are_not_traded(self):
        dec = [{'signal_index': 1, 'targets': {'AAA': 0.2}}, {'signal_index': 5, 'targets': {'AAA': 0.2}}]
        self.se['AAA']['c'][5] = 110.0  # drifted 10%: inside the 20% band
        r = run(self.ss, self.se, dec, end=8)
        self.assertEqual(len(r['trades']), 1)

    def test_a_holding_that_drifted_down_inside_the_band_is_not_topped_up(self):
        dec = [{'signal_index': 1, 'targets': {'AAA': 0.2}}, {'signal_index': 5, 'targets': {'AAA': 0.2}}]
        for i in range(5, 30):
            self.se['AAA']['c'][i] = self.se['AAA']['ac'][i] = self.se['AAA']['o'][i] = 90.0
        r = run(self.ss, self.se, dec, end=8)
        self.assertEqual(len(r['trades']), 1)

    def test_unavailable_target_stays_cash(self):
        self.se['BBB']['c'][1] = None
        r = run(self.ss, self.se, [{'signal_index': 1, 'targets': {'BBB': 0.2}}], end=3)
        self.assertEqual((r['unavailable'], len(r['trades'])), (1, 0))


class CorporateActions(unittest.TestCase):
    def setUp(self):
        self.ss = sessions(20)
        self.se = {'AAA': flat(20, 100.0), 'NEW': flat(20, 50.0)}
        self.dec = [{'signal_index': 1, 'targets': {'AAA': 0.2}}]

    def shares(self, r):
        return r['trades'][0]['shares']

    def test_cash_dividend_is_credited_on_the_ex_date(self):
        r = run(self.ss, self.se, self.dec, actions=[{'date': self.ss[5], 'kind': 'cash_dividend', 'symbol': 'AAA', 'rate': 1.5}], end=6)
        self.assertAlmostEqual(r['dividends'], self.shares(r) * 1.5)
        self.assertAlmostEqual(equity(r), 10_000 + self.shares(r) * 1.5)

    def test_split_with_a_fraction_paid_in_cash(self):
        for f in ('o', 'c'):
            for i in range(5, 20):
                self.se['AAA'][f][i] = 100.0 / 3
        r = run(self.ss, self.se, self.dec, actions=[{'date': self.ss[5], 'kind': 'split', 'symbol': 'AAA', 'ratio': 3.0}], end=6)
        n = self.shares(r)
        self.assertAlmostEqual(equity(r), 10_000, places=6)  # value unchanged by the split
        self.assertEqual(r['unresolved'], [])
        self.assertEqual(len(r['integrity_mismatches']), 0)
        self.assertGreater(n, 0)

    def test_reverse_split_fraction_goes_to_cash(self):
        for f in ('o', 'c'):
            for i in range(5, 20):
                self.se['AAA'][f][i] = 100.0 * 7
        r = run(self.ss, self.se, self.dec, actions=[{'date': self.ss[5], 'kind': 'split', 'symbol': 'AAA', 'ratio': 1 / 7}], end=6)
        self.assertAlmostEqual(equity(r), 10_000, places=4)

    def test_cash_merger_converts_to_cash(self):
        for f in ('o', 'c'):
            for i in range(5, 20):
                self.se['AAA'][f][i] = None
        r = run(self.ss, self.se, self.dec, actions=[{'date': self.ss[5], 'kind': 'cash_merger', 'symbol': 'AAA', 'rate': 120.0}], end=10)
        self.assertAlmostEqual(equity(r), 10_000 + self.shares(r) * 20)
        self.assertEqual(r['open_unresolved_at_end'], 0)

    def test_stock_merger_carries_into_the_acquirer(self):
        r = run(self.ss, self.se, self.dec, actions=[{'date': self.ss[5], 'kind': 'stock_merger', 'symbol': 'AAA',
                                                       'new_symbol': 'NEW', 'ratio': 2.0}], end=6)
        self.assertAlmostEqual(equity(r), 10_000)

    def test_unpriced_spin_off_is_unresolved_and_blocks_buys(self):
        dec = self.dec + [{'signal_index': 7, 'targets': {'AAA': 0.2, 'NEW': 0.2}}]
        r = run(self.ss, self.se, dec, actions=[{'date': self.ss[5], 'kind': 'spin_off', 'symbol': 'AAA',
                                                  'new_symbol': 'GHOST', 'ratio': 0.5}], end=10)
        self.assertEqual(r['unresolved'][0]['reason'], 'SPIN_OFF_TARGET_UNPRICED')
        self.assertEqual(r['blocked_by_unresolved'], 1)
        self.assertNotIn('NEW', [t['symbol'] for t in r['trades']])

    def test_unknown_action_is_unresolved(self):
        r = run(self.ss, self.se, self.dec, actions=[{'date': self.ss[5], 'kind': 'rights_distribution', 'symbol': 'AAA'}], end=6)
        self.assertEqual(r['unresolved'][0]['reason'], 'UNSUPPORTED_ACTION:rights_distribution')
        self.assertEqual(r['open_unresolved_at_end'], 1)

    def test_unexplained_price_jump_is_flagged(self):
        for i in range(5, 20):
            self.se['AAA']['c'][i] = 50.0  # raw halves, adjusted does not, and no action explains it
        r = run(self.ss, self.se, self.dec, end=6)
        self.assertEqual(r['unresolved'][0]['reason'], 'UNEXPLAINED_PRICE_ADJUSTMENT')

    def test_missing_exit_bar_stays_unresolved_until_sold(self):
        dec = self.dec + [{'signal_index': 4, 'targets': {}}]
        self.se['AAA']['o'][5] = None
        r = run(self.ss, self.se, dec, end=7)
        self.assertEqual(r['unresolved'][0]['reason'], 'NO_BAR_FOR_EXIT')
        self.assertEqual(r['unresolved'][0]['resolved'], self.ss[6])
        self.assertEqual(r['trades'][-1]['date'], self.ss[6])


class Halt(unittest.TestCase):
    def test_first_session_loss_halts_sells_next_open_and_never_buys_again(self):
        ss = sessions(30)
        se = {f'S{i}': flat(30, 100.0) for i in range(5)}
        for s in se.values():
            for i in range(2, 30):
                s['c'][i] = s['ac'][i] = 40.0
                s['o'][i] = 40.0 if i > 2 else 100.0
            s['o'][3] = 35.0  # gap down at the liquidation open
        dec = [{'signal_index': 1, 'targets': {s: 0.2 for s in se}}, {'signal_index': 10, 'targets': {s: 0.2 for s in se}}]
        r = run(ss, se, dec, cost=0)
        self.assertEqual(r['halted_on'], ss[2])
        self.assertTrue(all(t['date'] == ss[3] for t in r['trades'] if t['side'] == 'sell'))
        self.assertEqual(sum(1 for t in r['trades'] if t['side'] == 'buy'), 5)  # no buys after the halt
        self.assertLess(r['equity_after_halt_exit'] / r['halt_peak'] - 1, -0.10)  # the gap made it worse than 10%
        self.assertEqual(r['halt_peak'], 10_000)  # peak seeded with starting equity

    def test_continuous_series_has_no_halt(self):
        ss = sessions(20)
        se = {'AAA': flat(20, 100.0)}
        for i in range(3, 20):
            se['AAA']['c'][i] = se['AAA']['ac'][i] = se['AAA']['o'][i] = 10.0
        r = run(ss, se, [{'signal_index': 1, 'targets': {'AAA': 0.9}}], halt=False)
        self.assertIsNone(r['halted_on'])


class MomentumQuality(unittest.TestCase):
    def build(self):
        ss = sessions(300)
        members = [{'symbol': f'M{i}', 'sector': 'Tech' if i >= 4 else f'Sec{i}'} for i in range(8)]  # Tech = strongest
        se = {}
        for i, m in enumerate(members):
            s = flat(300, 50.0, 2_000_000)
            for k in range(300):  # steady uptrends of different strength
                s['ac'][k] = s['c'][k] = 50.0 * (1 + 0.0005 * (i + 1)) ** k
            se[m['symbol']] = s
        return ss, se, members

    def test_formation_window_and_sector_cap(self):
        ss, se, members = self.build()
        t = cand.momentum_quality_targets(se, members, 280)
        self.assertEqual(len(t), 5)
        self.assertEqual(sum(1 for s in t if s in {'M4', 'M5', 'M6', 'M7'}), 2)  # the cap binds
        self.assertTrue(all(w == 0.2 for w in t.values()))

    def test_no_future_data(self):
        ss, se, members = self.build()
        before = cand.momentum_quality_targets(se, members, 280)
        for s in se.values():
            for f in ('o', 'c', 'ac', 'ao', 'v'):
                for k in range(281, 300):
                    s[f][k] = 1e-3
        self.assertEqual(cand.momentum_quality_targets(se, members, 280), before)

    def test_positive_fraction_keeps_zero_days_in_the_denominator(self):
        ss, se, members = self.build()
        s = se['M7']
        for k in range(30, 259, 2):
            s['ac'][k] = s['ac'][k - 1]  # every other day a zero return
        x = next(r for r in cand.momentum_quality_scores(se, members, 280) if r['symbol'] == 'M7')
        self.assertLess(x['positive_fraction'], 0.75)

    def test_floors_and_negative_momentum_exclude(self):
        ss, se, members = self.build()
        se['M0']['v'] = [1000] * 300
        for k in range(300):
            se['M1']['ac'][k] = 100.0 - 0.1 * k
        syms = {r['symbol'] for r in cand.momentum_quality_scores(se, members, 280)}
        self.assertNotIn('M0', syms)
        self.assertNotIn('M1', syms)

    def test_decisions_on_month_ends_only(self):
        ss, se, members = self.build()
        d = cand.momentum_quality_decisions(ss, se, members, first_signal=ss[260], last_exec=ss[-1])
        self.assertTrue(all(ss[x['signal_index']][:7] != ss[x['signal_index'] + 1][:7] for x in d))


class Follower(unittest.TestCase):
    def snap(self, at, eff, rows, status='OK'):
        return {'retrieved_at': at, 'effective_date': eff, 'status': status, 'rows': rows}

    def test_initializes_after_receipt_then_monthly_with_already_received_data(self):
        ss = sessions(60, start=date(2026, 11, 2))
        rows = [{'ticker': 'AAA', 'weight_pct': 2.5}, {'ticker': 'BIG', 'weight_pct': 30.0}, {'ticker': 'NOPX', 'weight_pct': 2.0}]
        snaps = [self.snap('2026-11-09T23:30:00Z', '2026-11-09', rows),
                 self.snap('2026-11-30T23:30:00Z', '2026-11-30', rows[:1]),          # after the Nov 30 close
                 self.snap('2026-11-27T12:00:00Z', '2026-11-27', rows, status='INCOMPLETE')]
        d = cand.qmom_follower_decisions(ss, snaps, lambda s, k: s != 'NOPX', last_exec='2026-12-31')
        self.assertEqual(ss[d[0]['signal_index'] + 1], '2026-11-10')  # next session after receipt
        self.assertEqual(d[0]['targets'], {'AAA': 0.025, 'BIG': 0.20})  # capped at 20%, unpriced to cash
        self.assertAlmostEqual(d[0]['meta']['dropped_weight'], 0.02)
        dec = d[1]
        self.assertEqual(ss[dec['signal_index'] + 1], '2026-12-01')
        self.assertEqual(dec['meta']['effective_date'], '2026-11-09')  # Nov 30 snapshot arrived after the close

    def test_no_valid_snapshot_no_decision(self):
        ss = sessions(10, start=date(2026, 11, 2))
        self.assertEqual(cand.qmom_follower_decisions(ss, [self.snap('2026-11-03T00:00:00Z', 'x', [], 'STALE')],
                                                      lambda s, k: True, last_exec='2026-12-31'), [])


class Berkshire(unittest.TestCase):
    def filing(self, acc, accepted, period, holdings, amend=None):
        rows = [{'issuer': c, 'title': 'COM', 'cusip': c, 'value': v, 'shares': 1, 'share_type': 'SH', 'put_call': None,
                 'other_manager': None} for c, v in holdings]
        return {'accession': acc, 'accepted_at': accepted, 'form': '13F-HR',
                'primary': {'period': period, 'is_amendment': bool(amend), 'amendment_type': amend}, 'rows': rows}

    def setUp(self):
        self.ss = sessions(140, start=date(2025, 3, 3))
        self.mapping = {c: {'ticker': 'T' + c} for c in 'ABCDEFGHZ'}
        self.fs = [self.filing('Q4', '2025-02-14T21:05:00Z', '2024-12-31', [('A', 9), ('B', 8), ('C', 7), ('D', 6), ('E', 5), ('F', 4)]),
                   self.filing('Q1', '2025-05-15T20:05:00Z', '2025-03-31', [('B', 9), ('C', 8), ('D', 7), ('E', 6), ('F', 5), ('G', 4)]),
                   self.filing('Q1A', '2025-08-16T14:00:00Z', '2025-06-30', [('Z', 100)], amend='NEW HOLDINGS'),  # a Saturday
                   self.filing('Q2', '2025-08-14T20:05:00Z', '2025-06-30', [('H', 9), ('B', 8), ('C', 7), ('D', 6), ('E', 5)])]

    def decisions(self, has=lambda s, k: True):
        return cand.berkshire_decisions(self.ss, self.fs, self.mapping, has, first_exec='2025-04-01', last_exec='2025-09-30')

    def test_initial_uses_only_what_was_public_and_events_trade_after_acceptance(self):
        d = self.decisions()
        self.assertEqual(d[0]['meta']['period'], '2024-12-31')
        self.assertEqual(set(d[0]['targets']), {'TA', 'TB', 'TC', 'TD', 'TE'})
        q1 = next(x for x in d if x['meta']['period'] == '2025-03-31')
        self.assertEqual(self.ss[q1['signal_index'] + 1], '2025-05-16')  # accepted after the close on the 15th

    def test_weekend_amendment_trades_the_next_monday_and_is_not_known_earlier(self):
        d = self.decisions()
        q2 = [x for x in d if x['meta']['period'] == '2025-06-30']
        self.assertEqual(self.ss[q2[0]['signal_index'] + 1], '2025-08-15')
        self.assertNotIn('TZ', q2[0]['targets'])
        self.assertEqual(self.ss[q2[1]['signal_index'] + 1], '2025-08-18')
        self.assertIn('TZ', q2[1]['targets'])

    def test_unmapped_or_unpriced_holdings_are_skipped_not_replaced_by_guesses(self):
        self.mapping['A'] = {'unmapped': 'No identifier found.'}
        d = self.decisions(has=lambda s, k: s != 'TB')
        self.assertEqual(set(d[0]['targets']), {'TC', 'TD', 'TE', 'TF'})
        self.assertEqual([s['why'] for s in d[0]['meta']['skipped']], ['No identifier found.', 'NO_PRICE'])


if __name__ == '__main__':
    unittest.main()


class NoNegativeIndexLeak(unittest.TestCase):
    def test_a_window_starting_on_the_first_session_is_refused(self):
        ss = sessions(20, start=date(2025, 4, 1))
        with self.assertRaises(ValueError):
            cand.berkshire_decisions(ss, [], {}, lambda s, k: True, first_exec=ss[0], last_exec=ss[-1])
