"""Daily strategies (docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md). Synthetic TEST-ONLY prices."""
from __future__ import annotations
import copy
import time
import unittest

from analytics.research import candidates as cand
from analytics.research import engine
from analytics.research import evaluate as ev


def days(n):
    out, d = [], 0
    while len(out) < n:
        d += 1
        out.append(f'2024-{1 + d // 28:02d}-{1 + d % 28:02d}')
    return sorted(set(out))[:n]


def series_for(closes, volume=1e6):
    n = len(closes)
    return {'o': list(closes), 'c': list(closes), 'v': [volume] * n, 'ao': list(closes), 'ac': list(closes)}


N = 80
SESSIONS = days(N)
FLAT = [100.0] * N


def universe(**over):
    base = {f'S{i}': list(FLAT) for i in range(8)}
    base.update(over)
    series = {s: series_for(c) for s, c in base.items()}
    series['SPY'] = series_for([400.0 + i for i in range(N)])
    members = [{'symbol': s, 'sector': 'X'} for s in base]
    return series, members


class Eligibility(unittest.TestCase):
    def test_price_volume_and_history_filters(self):
        series, members = universe(CHEAP=[4.0] * N)
        series['THIN'] = series_for(FLAT, volume=100)  # $10k a day
        members += [{'symbol': 'THIN', 'sector': 'X'}]
        gap = list(FLAT); gap[40] = None
        series['GAP'] = series_for(gap); members += [{'symbol': 'GAP', 'sector': 'X'}]
        ok = cand.daily_eligible(series, members, 70)
        self.assertNotIn('CHEAP', ok); self.assertNotIn('THIN', ok); self.assertNotIn('GAP', ok)
        self.assertIn('S0', ok)
        self.assertEqual(cand.daily_eligible(series, members, 59), [])  # needs k-60..k


class Rules(unittest.TestCase):
    def test_reversal_picks_the_five_biggest_one_day_losers_only_if_negative(self):
        over = {}
        for i, drop in enumerate([-0.10, -0.08, -0.06, -0.04, -0.02, -0.01]):
            c = list(FLAT); c[70] = 100 * (1 + drop); over[f'L{i}'] = c
        up = list(FLAT); up[70] = 120.0; over['UP'] = up
        series, members = universe(**over)
        t = cand.daily_reversal_targets(series, members, 70)
        self.assertEqual(sorted(t), ['L0', 'L1', 'L2', 'L3', 'L4'])
        self.assertTrue(all(w == 0.20 for w in t.values()))
        flat_series, flat_members = universe()
        self.assertEqual(cand.daily_reversal_targets(flat_series, flat_members, 70), {})  # no losers -> cash

    def test_momentum_needs_positive_five_day_return_and_above_50_day_average(self):
        rising = [100.0 + max(0, i - 60) * 2 for i in range(N)]
        crash_then_bounce = [200.0] * 60 + [100.0] * 5 + [100.0 + i for i in range(15)]  # up 5 days but below average
        series, members = universe(R=rising, B=crash_then_bounce)
        t = cand.daily_momentum_targets(series, members, 75)
        self.assertIn('R', t); self.assertNotIn('B', t)
        self.assertNotIn('S0', t)  # flat: zero return is not > 0

    def test_spy_trend(self):
        series, _ = universe()
        self.assertEqual(cand.daily_spy_trend_targets(series, 70), {'SPY': 1.0})
        series['SPY'] = series_for([500.0 - i for i in range(N)])
        self.assertEqual(cand.daily_spy_trend_targets(series, 70), {})

    def test_no_lookahead_future_prices_never_change_a_decision(self):
        series, members = universe(L=[100.0] * 70 + [90.0] + [100.0] * 9)
        before = cand.daily_decisions('daily-reversal5-v1', SESSIONS, series, members,
                                      first_signal=SESSIONS[65], last_exec=SESSIONS[72])
        future = copy.deepcopy(series)
        for s in future.values():
            for key in ('o', 'c', 'ao', 'ac'):
                s[key][72:] = [x * 3 for x in s[key][72:]]
        after = cand.daily_decisions('daily-reversal5-v1', SESSIONS, future, members,
                                     first_signal=SESSIONS[65], last_exec=SESSIONS[72])
        self.assertEqual(before, after)

    def test_decision_window_and_unknown_ids(self):
        series, members = universe()
        d = cand.daily_decisions('daily-spy-trend50-v1', SESSIONS, series, members, first_signal=SESSIONS[70], last_exec=SESSIONS[75])
        self.assertEqual([SESSIONS[x['signal_index']] for x in d], SESSIONS[70:75])  # executes 71..75
        with self.assertRaises(ValueError):
            cand.daily_decisions('daily-anything', SESSIONS, series, members, first_signal=SESSIONS[0], last_exec=SESSIONS[-1])


class EngineDaily(unittest.TestCase):
    def test_daily_decisions_run_through_the_engine_with_costs_and_quickly(self):
        series, members = universe(L=[100.0 + (5 if i % 2 else -5) for i in range(N)])
        for s in series.values():  # open at the previous close, so limit-on-open buys can fill
            s['o'] = [s['c'][0]] + s['c'][:-1]
            s['ao'] = list(s['o'])
        d = cand.daily_decisions('daily-reversal5-v1', SESSIONS, series, members, first_signal=SESSIONS[60], last_exec=SESSIONS[-1])
        t0 = time.time()
        res = ev.run_candidate(SESSIONS, series, [], d, 61, N - 1)
        self.assertLess(time.time() - t0, 10)
        c10 = res['bps10']['continuous']
        self.assertGreater(c10['executions'], 5)
        self.assertGreater(c10['costs'], 0)
        self.assertGreater(c10['costs'], res['bps5']['continuous']['costs'])
        self.assertEqual(res['bps0']['continuous']['costs'], 0)


if __name__ == '__main__':
    unittest.main()
