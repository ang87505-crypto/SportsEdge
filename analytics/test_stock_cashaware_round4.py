"""Round 4: cash-aware whole-share sizing (docs/STOCK_CHALLENGER_CASHAWARE_PREREG_2026_11_20.md). Fictional prices."""
from datetime import date
import unittest
from analytics import stock_weekly_backtest_v1 as bt
from analytics.test_stock_weekly_v2 import calendar_rows, universe
from analytics.test_stock_weekly_backtest_v1 import fixture_data


def one_stock(raw, adj=None, end=date(2026, 11, 30)):
    days = [r['date'] for r in calendar_rows(end)]
    o = [raw(i) for i in range(len(days))]
    a = [adj(i) for i in range(len(days))] if adj else o
    b = {'d': days, 'o': o, 'c': o, 'v': [5e6] * len(days), 'ao': a, 'ac': a}
    uni = {'max_last_close': '95', 'securities': [{'symbol': 'AAA', 'sector': 'X', 'first_traded_on': '2015-01-02'}]}
    sessions, series = bt.align({'sessions': days, 'bars': {'AAA': b}})
    ks = [i for i in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, i, 'weekly')]
    return sessions, series, uni, ks, o


class TargetShares(unittest.TestCase):
    def test_floor_is_the_live_planner_and_nearest_fills_the_budget(self):
        raw, picks = {'A': 52.0, 'B': 70.0, 'C': 40.0, 'D': 34.0}, {'A', 'B', 'C', 'D'}
        floor = bt._target_shares('floor', raw, {}, picks, 100.0, 1000.0)
        near = bt._target_shares('nearest', raw, {}, picks, 100.0, 1000.0)
        self.assertEqual(floor, {'A': 1, 'B': 1, 'C': 2, 'D': 2})
        self.assertEqual(near, {'A': 2, 'B': 1, 'C': 3, 'D': 3}, 'round half up: 1.92->2, 1.43->1, 2.5->3, 2.94->3')
        self.assertGreater(sum(near[s] * raw[s] for s in raw), sum(floor[s] * raw[s] for s in raw))

    def test_the_fifteen_percent_name_cap_binds(self):
        # $14: round(100/14)=7 -> $98; at $11: round(9.09)=9 -> $99; at $60 nearest is 2 ($120 <= $150).
        self.assertEqual(bt._target_shares('nearest', {'A': 60.0}, {}, {'A'}, 100.0, 1000.0), {'A': 2})
        # A $76 stock: round(1.32)=1. A $49 stock with a $140 budget (equity 1400): round(2.86)=3 -> $147 <= $210.
        self.assertEqual(bt._target_shares('nearest', {'A': 49.0}, {}, {'A'}, 140.0, 1400.0), {'A': 3})
        # Budget larger than the cap (never in live sizing, but the cap must hold): 0.15*1000/51 -> 2 shares.
        self.assertEqual(bt._target_shares('nearest', {'A': 51.0}, {}, {'A'}, 200.0, 1000.0), {'A': 2})

    def test_band_keeps_a_continuing_pick_inside_five_to_fifteen_percent(self):
        raw = {'A': 52.0, 'B': 60.0, 'C': 20.0}
        held = {'A': 2, 'B': 3, 'C': 2}  # 10.4% kept; 18% out of band; 4% out of band
        w = bt._target_shares('cashaware', raw, held, {'A', 'B', 'C'}, 100.0, 1000.0)
        self.assertEqual(w, {'A': 2, 'B': 2, 'C': 5})
        self.assertEqual(bt._target_shares('band', raw, held, {'A', 'B', 'C'}, 100.0, 1000.0), {'A': 2, 'B': 1, 'C': 5})
        self.assertEqual(bt._target_shares('cashaware', raw, held, {'B'}, 100.0, 1000.0)['A'], 0, 'a dropped pick is sold')

    def test_the_gross_cap_trims_the_largest_position_first(self):
        raw = {s: 66.0 for s in 'ABCDE'}
        w = bt._target_shares('nearest', raw, {}, set(raw), 100.0, 1000.0)
        self.assertLessEqual(sum(n * 66.0 for n in w.values()), 500.0)
        self.assertEqual(w, {'A': 2, 'B': 2, 'C': 1, 'D': 1, 'E': 1}, 'ties broken by symbol, last first')


class Replay(unittest.TestCase):
    def test_nearest_buys_two_shares_of_a_55_dollar_stock_where_floor_buys_one(self):
        sessions, series, uni, ks, o = one_stock(lambda i: 55.0 + 0.001 * i)
        k = ks[0]
        cur = bt.replay(sessions, series, uni, bt.ROUND4[bt.CURRENT], start=sessions[k], end=sessions[k])
        ch = bt.replay(sessions, series, uni, bt.ROUND4[bt.CASHAWARE], start=sessions[k], end=sessions[k])
        self.assertAlmostEqual(cur['traded'], 1 * o[k], places=9)
        self.assertAlmostEqual(ch['traded'], 2 * o[k], places=9)
        self.assertGreater(ch['avg_exposure'], cur['avg_exposure'])

    def test_the_band_stops_one_share_weekly_churn(self):
        # Price drifts across the 2-share/3-share floor boundary ($50 -> $33) while the account barely moves.
        sessions, series, uni, ks, o = one_stock(lambda i: 50.0 - 0.06 * max(0, i - 250))
        start, end = sessions[ks[0]], sessions[ks[min(12, len(ks) - 1)]]
        floor = bt.replay(sessions, series, uni, bt.ROUND4[bt.CURRENT], start=start, end=end)
        band = bt.replay(sessions, series, uni, bt.ROUND4['cashaware-band-only'], start=start, end=end)
        self.assertLessEqual(band['traded'], floor['traded'])

    def test_a_split_is_not_a_trade_under_cashaware(self):
        s0, *_ = one_stock(lambda i: 80.0)
        d0 = [i for i in range(bt.WINDOW, len(s0)) if bt.is_decision(s0, i, 'weekly')]
        split = d0[0] + 2
        sessions, series, uni, ks, o = one_stock(lambda i: (70.0 + 0.01 * i) / (2 if i >= split else 1),
                                                 lambda i: (70.0 + 0.01 * i) / 2)
        r = bt.replay(sessions, series, uni, bt.ROUND4[bt.CASHAWARE], start=sessions[ks[0]], end=sessions[ks[1]])
        self.assertAlmostEqual(r['traded'], 1 * o[ks[0]], places=9, msg='1 share at ~$72 -> 2 at ~$36: inside the band, no trade')

    def test_floor_rows_reproduce_round_three_exactly(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        sessions, series = bt.align(data)
        uni = universe() | {'max_last_close': '95'}
        for r4, r3 in ((bt.CURRENT, bt.CURRENT), ('holdrank10', bt.CHALLENGER), ('current-fractional', 'current-fractional')):
            a = bt.replay(sessions, series, uni, bt.ROUND4[r4], start=bt.DEV[0], end=sessions[-1])
            b = bt.replay(sessions, series, uni, bt.ROUND3[r3], start=bt.DEV[0], end=sessions[-1])
            self.assertEqual(a['curve'], b['curve'], r4)
            self.assertEqual(a['traded'], b['traded'], r4)


class Statistics(unittest.TestCase):
    def test_block_bootstrap_is_paired_deterministic_and_zero_for_identical_series(self):
        a = {f'2024-{i:03d}': ((i * 37) % 11 - 5) / 1000 for i in range(60)}
        z = bt.block_bootstrap(a, dict(a))
        self.assertEqual(z['sharpe_difference'], 0.0)
        self.assertEqual(z['sharpe_difference_95'], [0.0, 0.0])
        b = {k: v - 0.001 for k, v in a.items()}
        x, y = bt.block_bootstrap(a, b), bt.block_bootstrap(a, b)
        self.assertEqual(x, y)
        self.assertGreater(x['mean_weekly_difference_95'][0], 0, 'a constant +0.1%/week edge is detected')
        self.assertIsNone(bt.block_bootstrap(dict(list(a.items())[:10]), b), 'too few weeks for 8-week blocks')

    def test_sortino_and_utilization_metrics(self):
        curve = [('2024-01-0%d' % i, v) for i, v in enumerate([100, 101, 99, 102, 100, 103], start=1)]
        exp = [0.3, 0.4, 0.5, 0.5, 0.4, 0.3]
        m = bt.metrics4(curve, exp, '2024-01-02', '2024-01-06')
        self.assertAlmostEqual(m['avg_invested'], 0.42)
        self.assertAlmostEqual(m['min_invested'], 0.3)
        self.assertGreater(m['sortino'], m['sharpe'], 'downside-only risk is smaller than total risk here')


class Verdict(unittest.TestCase):
    @staticmethod
    def out(ch, cur=None, spy=None):
        def row(exp, dev, hold, dd, turn, s25):
            return {'exposure_by_period': {'holdout': exp}, 'dev': {'sharpe': dev},
                    'holdout': {'sharpe': hold, 'max_drawdown': dd}, 'turnover_per_avg_equity': turn,
                    'full_at_25bps': {'sharpe': s25}}
        cur = cur or row(0.39, 0.45, 0.47, -0.09, 9.0, 0.40)
        spy = {'dev': {'sharpe': 0.63}, 'holdout': {'sharpe': 1.27}} if spy is None else spy
        return {'variants': {bt.CURRENT: cur, bt.CASHAWARE: row(*ch)}, 'matched_spy': {bt.CASHAWARE: spy}, 'bootstrap': {}}

    def test_rules(self):
        v = bt.verdicts_round4(self.out((0.47, 0.50, 0.55, -0.10, 8.0, 0.45)))
        self.assertEqual((v['verdict'], v['registry_status']), ('BEATS_CURRENT_BELOW_MATCHED_SPY', 'RUNNING'))
        v = bt.verdicts_round4(self.out((0.47, 0.70, 1.30, -0.10, 8.0, 0.45)))
        self.assertEqual(v['verdict'], 'QUALIFIES_FOR_FORWARD_TEST')
        self.assertEqual(v['forward']['status'], 'INSUFFICIENT_FORWARD_WEEKS')
        fails = {'mechanism': (0.43, 0.70, 1.30, -0.10, 8.0, 0.45), 'tie': (0.47, 0.45, 1.30, -0.10, 8.0, 0.45),
                 'drawdown': (0.47, 0.70, 1.30, -0.15, 8.0, 0.45), 'turnover': (0.47, 0.70, 1.30, -0.10, 9.1, 0.45),
                 'costs': (0.47, 0.70, 1.30, -0.10, 8.0, 0.40)}
        for why, ch in fails.items():
            self.assertEqual(bt.verdicts_round4(self.out(ch))['verdict'], 'FAILS', why)
        self.assertEqual(bt.verdicts_round4(self.out((0.47, 0.70, 1.30, -0.10, 8.0, 0.45), spy={}))['verdict'],
                         'INSUFFICIENT_EVIDENCE', 'a missing benchmark is never a pass')


class EndToEnd(unittest.TestCase):
    def test_round4_runs_with_matched_spy_bootstrap_forward_window_and_markdown(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        out = bt.evaluate(data, universe() | {'max_last_close': '95', 'revision': 'fixture'}, end=data['sessions'][-1], round_=4)
        self.assertEqual(out['round'], 4)
        self.assertEqual(set(out['variants']), set(bt.ROUND4))
        self.assertIn('forward', out['periods'], 'sessions after 2026-11-18 form the frozen forward window')
        self.assertEqual(out['periods']['holdout'][1], bt.ROUND4_END)
        for name, ms in out['matched_spy'].items():
            for p, m in ms.items():
                self.assertAlmostEqual(m['weight'], out['variants'][name]['exposure_by_period'][p])
        self.assertIn(out['verdicts']['verdict'], {'QUALIFIES_FOR_FORWARD_TEST', 'BEATS_CURRENT_BELOW_MATCHED_SPY',
                                                   'FAILS', 'INSUFFICIENT_EVIDENCE'})
        self.assertEqual(out['verdicts']['forward']['status'], 'INSUFFICIENT_FORWARD_WEEKS')
        md = bt.markdown(out)
        self.assertIn('Pre-registered verdict', md)
        self.assertIn('EXPLORATORY', md)
        self.assertEqual(bt.evaluate(data, universe() | {'max_last_close': '95', 'revision': 'fixture'},
                                     end=data['sessions'][-1], round_=4)['verdicts'], out['verdicts'], 'deterministic')


if __name__ == '__main__':
    unittest.main()


class RecordedResult(unittest.TestCase):
    """The committed run output (run 44822315095) must keep re-deriving its pre-registered verdict."""

    def test_recorded_round4_result_reproduces_its_verdict(self):
        import json
        from pathlib import Path
        path = Path(__file__).resolve().parents[1] / 'research' / 'stock_challenger_cashaware_20261120' / 'results.json'
        out = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(out['round'], 4)
        self.assertEqual(out['end'], '2026-11-18')
        self.assertEqual(bt.verdicts_round4(out), out['verdicts'])
        self.assertEqual(out['verdicts']['verdict'], 'FAILS')
        v = out['variants']
        self.assertAlmostEqual(v[bt.CURRENT]['dev']['sharpe'], 0.449, places=3, msg='round 3 integrity')
        self.assertAlmostEqual(v['holdrank10']['full_at_25bps']['sharpe'], 0.574, places=3, msg='round 3 integrity')
        self.assertIn('Pre-registered verdict', bt.markdown(out))
