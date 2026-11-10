"""spy-tom-v1 (docs/STOCK_TOM_PREREG_2026_11_10.md). Calendar-only rule; synthetic TEST-ONLY prices."""
from __future__ import annotations
import inspect
import unittest

from analytics.research import candidates as cand
from analytics.research import cli
from analytics.research import evaluate as ev

# Real NYSE sessions around Thanksgiving 2026 (closed 11-26) and the Nov/Dec month change.
CAL = ['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-24', '2026-11-25',
       '2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-07']


class Window(unittest.TestCase):
    def test_last_session_and_first_three_sessions(self):
        self.assertEqual(sorted(cand.tom_window(CAL)),
                         ['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'])

    def test_holidays_and_partial_calendar_edges(self):
        # The day after Thanksgiving is not a month-end; the calendar's opening month has no "first days".
        self.assertNotIn('2026-11-27', cand.tom_window(CAL))
        self.assertNotIn('2026-10-29', cand.tom_window(CAL))
        # A calendar ending on a month's last session cannot know it is the last one.
        self.assertNotIn('2026-11-30', cand.tom_window(CAL[:10]))

    def test_uses_no_prices(self):
        self.assertEqual(list(inspect.signature(cand.tom_decisions).parameters)[:2], ['sessions', 'calendar'])


class Decisions(unittest.TestCase):
    def test_buy_signal_at_day_minus_two_and_sell_signal_at_day_plus_three(self):
        d = cand.tom_decisions(CAL, CAL, first_signal='2026-11-24', last_exec='2026-12-07')
        by = {CAL[x['signal_index']]: x['targets'] for x in d}
        self.assertEqual(by['2026-11-25'], {})                 # 11-27 is outside the window
        self.assertEqual(by['2026-11-27'], {'SPY': 1.0})       # day -2 close -> buy at the 11-30 open (day -1)
        self.assertEqual(by['2026-12-02'], {'SPY': 1.0})       # 12-03 is day +3
        self.assertEqual(by['2026-12-03'], {})                 # sell at the 12-04 open (day +4)
        self.assertNotIn('2026-12-07', by)                     # no execution after last_exec


class BreakEven(unittest.TestCase):
    def res(self, cagrs):
        return {f'bps{c}': {'continuous': {'full': {'cagr': v}}} for c, v in zip(ev.COSTS, cagrs)}

    def test_interpolation_and_edges(self):
        self.assertEqual(cli.break_even(self.res([0.10, 0.06, 0.02, -0.10]), 0.0), 12.5)
        self.assertEqual(cli.break_even(self.res([0.10, 0.09, 0.08, 0.05]), 0.0), None)    # still positive at 25 bps
        self.assertEqual(cli.break_even(self.res([-0.01, -0.02, -0.03, -0.06]), 0.0), 0.0)  # fails before costs
        self.assertEqual(cli.break_even(self.res([0.10, 0.08, 0.06, 0.0]), 0.07), 7.5)


class Engine(unittest.TestCase):
    def test_runs_through_the_engine_with_low_exposure_and_turnover(self):
        sessions = []
        for m in range(1, 13):
            for day in range(1, 22):
                sessions.append(f'2025-{m:02d}-{day:02d}')
        n = len(sessions)
        closes = [400.0 * (1.0003 ** i) for i in range(n)]
        spy = {'o': [closes[0]] + closes[:-1], 'c': closes, 'v': [5e7] * n}
        spy['ao'], spy['ac'] = list(spy['o']), list(spy['c'])
        series = {'SPY': spy}
        d = cand.tom_decisions(sessions, sessions, first_signal=sessions[20], last_exec=sessions[-1])
        res = ev.run_candidate(sessions, series, [], d, 21, n - 1)
        c = res['bps10']['continuous']
        self.assertGreater(c['executions'], 15)
        self.assertLess(c['avg_exposure'], 0.35)               # about 4 of 21 sessions
        self.assertGreater(c['avg_exposure'], 0.1)
        self.assertGreater(c['costs'], 0)
        self.assertEqual(c['unresolved'], [])


if __name__ == '__main__':
    unittest.main()
