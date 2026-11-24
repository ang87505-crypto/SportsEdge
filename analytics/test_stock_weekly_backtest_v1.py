"""Backtest replay on fictional prices: same picks as the live bridge, exact accounting, metrics."""
from datetime import date, datetime, timezone
import math
import unittest
from copy import deepcopy
from datetime import timedelta
from analytics.stock_forward_bridge_v1 import sha256, part
from analytics.stock_momentum_v1 import VERSION as BASELINE
from analytics.stock_lowvol_weekly_v1 import choose as choose_steady, volatility_by_symbol
from analytics.stock_weekly_bridge_v2 import decide, assemble
from analytics.test_stock_weekly_v2 import NY, ASSETS, NO_ACTIONS, SYMBOLS, calendar_rows, universe
from analytics.stock_weekly_scoring_v2 import score_universe_weekly
from analytics import stock_weekly_backtest_v1 as bt

# Swing size per symbol around a steady uptrend; S05 is calm but falling (never eligible).
AMPLITUDE = {s: 0.30 + 0.02 * i for i, s in enumerate(SYMBOLS)}
AMPLITUDE |= {'S01': 0.02, 'S07': 0.03, 'S13': 0.04, 'S02': 0.05, 'S03': 0.06, 'S04': 0.07, 'S05': 0.01}


def price(sym, k):
    swing = AMPLITUDE[sym] * (1 if k % 2 else -1)
    return round((60 - 0.03 * k if sym == 'S05' else 40 + 0.03 * k) + swing, 2)


def capture(session='2026-11-02', decision='2026-11-02T13:00:00Z'):
    end = date.fromisoformat(session)
    at = datetime.fromisoformat(decision.replace('Z', '+00:00'))
    z = lambda dt: dt.isoformat().replace('+00:00', 'Z')
    rows = calendar_rows(end)
    days = [date.fromisoformat(r['date']) for r in rows][:-1]
    bars = {s: [] for s in SYMBOLS}
    for s in SYMBOLS:
        for k, x in enumerate(days):
            p = price(s, k)
            t = datetime.combine(x, datetime.min.time(), NY).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            bars[s].append({'t': t, 'o': p, 'h': p, 'l': p, 'c': p, 'v': 3_000_000, 'n': 1000, 'vw': p})
    pages = [{'bars': {k: v[:150] for k, v in bars.items()}, 'next_page_token': 'p2'},
             {'bars': {k: v[150:] for k, v in bars.items()}, 'next_page_token': None}]
    reference = z(at - timedelta(minutes=2))
    return {'version': 'stock-weekly-bridge-v2-capture', 'session': session, 'initial': False,
            'calendar': {'rows': rows, 'sha256': sha256(rows), 'retrieved_at': reference},
            'assets': {'rows': ASSETS, 'sha256': sha256(ASSETS), 'retrieved_at': reference},
            'actions': part(deepcopy(NO_ACTIONS), reference),
            'reference_bars': part(deepcopy(pages), reference),
            'decision_bars': part(pages, z(at + timedelta(seconds=20)), started_at=z(at + timedelta(seconds=1))),
            'observed_at': z(at + timedelta(seconds=21))}


def live_picks(model):
    """What the live weekly code picks on the fixture: the bridge for momentum; for steady, the
    steady-stocks chooser on the same validated scores and evidence."""
    reg = {'experimentId': 'backtest-check', 'registeredAt': '2026-10-30T04:00:00Z', 'modelVersion': BASELINE}
    if model == 'momentum':
        return [t['symbol'] for t in decide(capture(), universe(), reg, [], False)['signal']['targets']]
    bundle, _ = assemble(capture(), universe(), experiment_id='x', registered_at=reg['registeredAt'],
                         model_version=BASELINE, held_security_ids=[], initial=False)
    scored = score_universe_weekly(**deepcopy(bundle['evidence']))
    return [s['symbol'] for s in choose_steady(scored['scores'], volatility_by_symbol(bundle['evidence']))]


def fixture_data(session='2026-11-02'):
    """The steady-stocks test prices, plus an opening bar on the decision session itself."""
    days = [r['date'] for r in calendar_rows(date.fromisoformat(session))]
    bars = {}
    for sym in SYMBOLS:
        closes = [price(sym, k) for k in range(len(days) - 1)] + [price(sym, len(days) - 2)]
        bars[sym] = {'d': days, 'o': closes, 'c': closes, 'v': [3_000_000.0] * len(days), 'ao': closes, 'ac': closes}
    return {'sessions': days, 'bars': bars}


class BacktestTests(unittest.TestCase):
    def test_picks_match_the_live_bridge_for_both_models(self):
        data = fixture_data()
        sessions, series = bt.align(data)
        k = len(sessions) - 1
        uni = universe()
        sectors = {u['symbol']: u['sector'] for u in uni['securities']}
        scores = {s: bt.score(series[s], k, 252) for s in SYMBOLS}
        for model in ('momentum', 'steady'):
            ours = bt.select(scores, sectors, set(), {'model': model, 'buffer': 0}, None)
            self.assertEqual(ours, live_picks(model), model)
        self.assertEqual(live_picks('steady'), ['S01', 'S07', 'S02', 'S03', 'S04'])

    def test_flat_prices_lose_exactly_the_trading_costs(self):
        days = [r['date'] for r in calendar_rows(date(2026, 11, 30))]
        flat = {'d': days, 'o': [50.0] * len(days), 'c': [50.0] * len(days), 'v': [1e6] * len(days),
                'ao': [50.0] * len(days), 'ac': [50.0] * len(days)}
        uni = {'securities': [{'symbol': 'AAA', 'sector': 'X', 'first_traded_on': '2015-01-02'}]}
        sessions, series = bt.align({'sessions': days, 'bars': {'AAA': flat}})
        r = bt.replay(sessions, series, uni, bt.VARIANTS['steady'], start=sessions[bt.WINDOW], end=days[-1])
        # Flat prices fail the trend filter (W_T is not above its mean), so nothing is ever bought.
        self.assertEqual(r['traded'], 0.0)
        self.assertEqual(r['curve'][-1][1], bt.STARTING)

    def test_one_rising_stock_is_bought_at_ten_percent_and_charged_costs(self):
        days = [r['date'] for r in calendar_rows(date(2026, 11, 30))]
        up = [10.0 + 0.01 * i for i in range(len(days))]
        b = {'d': days, 'o': up, 'c': up, 'v': [5e6] * len(days), 'ao': up, 'ac': up}
        uni = {'securities': [{'symbol': 'AAA', 'sector': 'X', 'first_traded_on': '2015-01-02'}]}
        sessions, series = bt.align({'sessions': days, 'bars': {'AAA': b}})
        k = next(i for i in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, i, 'weekly'))
        r = bt.replay(sessions, series, uni, bt.VARIANTS['momentum'], start=sessions[k], end=sessions[k])
        bought = 0.10 * bt.STARTING
        expected = bt.STARTING - bought * (1 + bt.COST_BPS / 1e4) + bought / up[k] * up[k]
        self.assertAlmostEqual(r['curve'][0][1], expected, places=9)
        self.assertEqual(r['decisions'], 1)

    def test_a_held_stock_that_cannot_be_scored_freezes_the_week(self):
        days = [r['date'] for r in calendar_rows(date(2026, 12, 31))]
        up = [10.0 + 0.01 * i for i in range(len(days))]
        gap = list(up)
        b = {'d': days, 'o': up, 'c': up, 'v': [5e6] * len(days), 'ao': up, 'ac': up}
        sessions, series = bt.align({'sessions': days, 'bars': {'AAA': b}})
        decisions = [i for i in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, i, 'weekly')]
        series['AAA']['ac'][decisions[1] - 3] = None  # a missing bar inside the second decision's window
        uni = {'securities': [{'symbol': 'AAA', 'sector': 'X', 'first_traded_on': '2015-01-02'}]}
        r = bt.replay(sessions, series, uni, bt.VARIANTS['momentum'], start=sessions[decisions[0]],
                      end=sessions[decisions[1]])
        self.assertEqual(r['rejected'], 1)
        del gap

    def test_metrics_and_the_preregistered_verdict_rule(self):
        curve = [('2017-01-03', 1000.0), ('2017-01-04', 1100.0), ('2017-01-05', 990.0)]
        m = bt.metrics(curve, '2017-01-01', '2017-12-31')
        self.assertAlmostEqual(m['total'], -0.01)
        self.assertAlmostEqual(m['max_drawdown'], 990 / 1100 - 1)
        good = {'sharpe': 1.0, 'max_drawdown': -0.20}
        out = {'variants': {k: {'dev': dict(good), 'holdout': dict(good)} for k in bt.VARIANTS}}
        out['variants']['steady-6m'] = {'dev': {'sharpe': 1.2, 'max_drawdown': -0.2},
                                        'holdout': {'sharpe': 1.1, 'max_drawdown': -0.24}}
        out['variants']['momentum-6m'] = {'dev': {'sharpe': 1.5, 'max_drawdown': -0.2},
                                          'holdout': {'sharpe': 0.9, 'max_drawdown': -0.2}}
        out['variants']['steady-monthly'] = {'dev': {'sharpe': 1.2, 'max_drawdown': -0.2},
                                             'holdout': {'sharpe': 1.2, 'max_drawdown': -0.30}}
        v = bt.verdicts(out)
        self.assertEqual(v['steady-6m'], 'PROMISING')
        self.assertEqual(v['momentum-6m'], 'NOT_BETTER', 'must win in the holdout too')
        self.assertEqual(v['steady-monthly'], 'NOT_BETTER', 'holdout drawdown more than 5 points worse')
        self.assertEqual(v['momentum-buffer10'], 'NOT_BETTER', 'a tie is not better')

    def test_evaluate_runs_end_to_end_with_spy_and_markdown(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        sessions = data['sessions']
        out = bt.evaluate(data, universe() | {'max_last_close': '95'}, end=sessions[-1])
        self.assertIn('combined', out['variants'])
        self.assertEqual(set(out['verdicts']), set(bt.VARIANTS) - {'momentum', 'steady'})
        self.assertIn('| momentum |', bt.markdown(out))


if __name__ == '__main__':
    unittest.main()


class Round2Tests(unittest.TestCase):
    def _one(self, level, spec):
        days = [r['date'] for r in calendar_rows(date(2026, 11, 30))]
        up = [level + 0.01 * i for i in range(len(days))]
        b = {'d': days, 'o': up, 'c': up, 'v': [5e6] * len(days), 'ao': up, 'ac': up}
        uni = {'max_last_close': '95', 'securities': [{'symbol': 'AAA', 'sector': 'X', 'first_traded_on': '2015-01-02'}]}
        sessions, series = bt.align({'sessions': days, 'bars': {'AAA': b}})
        k = next(i for i in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, i, 'weekly'))
        return bt.replay(sessions, series, uni, spec, start=sessions[k], end=sessions[k]), up[k]

    def test_the_price_cap_skips_expensive_stocks_unless_it_is_dropped(self):
        capped, _ = self._one(200.0, bt.ROUND2['momentum'])
        self.assertEqual(capped['traded'], 0.0, 'a $200 stock is above the $95 cap')
        uncapped, _ = self._one(200.0, bt.ROUND2['momentum-nocap'])
        self.assertAlmostEqual(uncapped['traded'], 0.10 * bt.STARTING)

    def test_full_investment_buys_twenty_percent_per_pick(self):
        r, _ = self._one(10.0, bt.ROUND2['momentum-full'])
        self.assertAlmostEqual(r['traded'], 0.20 * bt.STARTING)

    def test_round_one_variants_are_unchanged(self):
        for name in ('momentum', 'steady'):
            self.assertEqual({k: v for k, v in bt.ROUND2[name].items()}, bt.VARIANTS[name])
        self.assertNotIn('weight', bt.VARIANTS['momentum-6m'])

    def test_round_two_runs_with_both_verdict_rules(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        out = bt.evaluate(data, universe() | {'max_last_close': '95'}, end=data['sessions'][-1], round_=2)
        self.assertEqual(set(out['verdicts']), {'vs_live', 'vs_spy'})
        self.assertEqual(set(out['verdicts']['vs_live']), set(bt.ROUND2) - {'momentum', 'steady'})
        self.assertIn('combined-nocap-full', out['verdicts']['vs_spy'])
        self.assertIn('vs_spy', bt.markdown(out))


class Round3Tests(unittest.TestCase):
    """Whole-share replay of the frozen hold-buffer challenger (docs/STOCK_CHALLENGER_HOLDRANK10_PREREG_2026_11_19.md)."""

    def _series(self, raw, adj=None, end=date(2026, 11, 30)):
        days = [r['date'] for r in calendar_rows(end)]
        o = [raw(i) for i in range(len(days))]
        a = [adj(i) for i in range(len(days))] if adj else o
        b = {'d': days, 'o': o, 'c': o, 'v': [5e6] * len(days), 'ao': a, 'ac': a}
        uni = {'max_last_close': '95', 'securities': [{'symbol': 'AAA', 'sector': 'X', 'first_traded_on': '2015-01-02'}]}
        sessions, series = bt.align({'sessions': days, 'bars': {'AAA': b}})
        decisions = [i for i in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, i, 'weekly')]
        return sessions, series, uni, decisions, o

    def test_whole_shares_buy_floor_of_ten_percent(self):
        sessions, series, uni, ks, o = self._series(lambda i: 40.0 + 0.01 * i)
        k = ks[0]
        r = bt.replay(sessions, series, uni, bt.ROUND3[bt.CURRENT], start=sessions[k], end=sessions[k])
        self.assertAlmostEqual(r['traded'], 2 * o[k], places=9, msg='floor($100 / ~$42.5) = 2 shares, not $100')
        frac = bt.replay(sessions, series, uni, bt.ROUND3['current-fractional'], start=sessions[k], end=sessions[k])
        self.assertAlmostEqual(frac['traded'], 100.0, places=9)
        self.assertLess(r['avg_exposure'], frac['avg_exposure'])

    def test_a_stock_above_the_budget_or_cap_is_not_bought(self):
        sessions, series, uni, ks, _ = self._series(lambda i: 101.0 + 0.01 * i)
        k = ks[0]
        r = bt.replay(sessions, series, uni, bt.ROUND3[bt.CURRENT], start=sessions[k], end=sessions[-1])
        self.assertEqual(r['traded'], 0.0, 'above the $95 cap: never eligible')

    def test_a_split_is_not_a_trade(self):
        # Raw price halves at index s (2-for-1); the all-adjusted series is continuous.
        split = None
        sessions0, *_ = self._series(lambda i: 80.0)
        decisions = [i for i in range(bt.WINDOW, len(sessions0)) if bt.is_decision(sessions0, i, 'weekly')]
        split = decisions[0] + 2
        raw = lambda i: (70.0 + 0.01 * i) / (2 if i >= split else 1)
        adj = lambda i: (70.0 + 0.01 * i) / 2
        sessions, series, uni, ks, o = self._series(raw, adj)
        r = bt.replay(sessions, series, uni, bt.ROUND3[bt.CURRENT], start=sessions[ks[0]], end=sessions[ks[1]])
        self.assertAlmostEqual(r['traded'], 1 * o[ks[0]], places=9,
                               msg='1 share at ~$72 becomes 2 after the split; the target at ~$36 is floor($100/$36) = 2, so no trade')
        self.assertEqual(r['decisions'], 2)

    def test_the_buffer_keeps_a_held_stock_ranked_six_to_ten_and_the_live_rules_sell_it(self):
        sectors = {f'S{i}': f'X{i}' for i in range(12)}
        scores = {f'S{i}': {'eligible': True, 'trend': True, 'momentum': 1.0 - i / 20, 'last_raw': 50.0} for i in range(12)}
        held = {'S7'}
        live = bt.select(scores, sectors, held, bt.ROUND3[bt.CURRENT], 95.0)
        challenger = bt.select(scores, sectors, held, bt.ROUND3[bt.CHALLENGER], 95.0)
        self.assertNotIn('S7', live)
        self.assertIn('S7', challenger)
        self.assertEqual(challenger, ['S7', 'S0', 'S1', 'S2', 'S3'])
        self.assertNotIn('S11', bt.select(scores, sectors, {'S11'}, bt.ROUND3[bt.CHALLENGER], 95.0), 'rank 12 is outside the buffer')

    def test_the_preregistered_round3_rule(self):
        def row(dev, hold, dd, turn, s25):
            return {'dev': {'sharpe': dev}, 'holdout': {'sharpe': hold, 'max_drawdown': dd}, 'turnover_per_year': turn,
                    'full_at_25bps': {'sharpe': s25}}
        base = row(0.5, 0.6, -0.11, 12.0, 0.45)
        spy = {'dev': {'sharpe': 0.6}, 'holdout': {'sharpe': 1.3}}
        out = lambda ch, m=spy: {'variants': {bt.CURRENT: base, bt.CHALLENGER: ch}, 'matched_spy': {bt.CHALLENGER: m}}
        v = bt.verdicts_round3(out(row(0.6, 0.7, -0.12, 5.0, 0.55)))
        self.assertEqual((v['verdict'], v['registry_status']), ('BEATS_CURRENT_BELOW_MATCHED_SPY', 'RUNNING'))
        v = bt.verdicts_round3(out(row(0.7, 1.4, -0.12, 5.0, 0.55)))
        self.assertEqual((v['verdict'], v['registry_status']), ('PROMISING', 'PROMISING'))
        self.assertEqual(bt.verdicts_round3(out(row(0.6, 0.6, -0.12, 5.0, 0.55)))['verdict'], 'REJECTED', 'a tie is not better')
        self.assertEqual(bt.verdicts_round3(out(row(0.6, 0.7, -0.17, 5.0, 0.55)))['verdict'], 'REJECTED', 'drawdown > 5 points worse')
        self.assertEqual(bt.verdicts_round3(out(row(0.6, 0.7, -0.12, 13.0, 0.55)))['verdict'], 'REJECTED', 'more turnover')
        self.assertEqual(bt.verdicts_round3(out(row(0.6, 0.7, -0.12, 5.0, 0.40)))['verdict'], 'REJECTED', 'fails at 25 bps')
        self.assertEqual(bt.verdicts_round3(out(row(0.7, 1.4, -0.12, 5.0, 0.55), {}))['verdict'], 'BEATS_CURRENT_BELOW_MATCHED_SPY',
                         'a missing benchmark is a failure of R3, never a pass')

    def test_round3_runs_end_to_end_with_matched_spy(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        out = bt.evaluate(data, universe() | {'max_last_close': '95', 'revision': 'fixture'}, end=data['sessions'][-1], round_=3)
        self.assertEqual(out['round'], 3)
        self.assertEqual(set(out['variants']), set(bt.ROUND3))
        self.assertEqual(set(out['matched_spy']), {bt.CURRENT, bt.CHALLENGER})
        for name in out['matched_spy']:
            for p, m in out['matched_spy'][name].items():
                self.assertAlmostEqual(m['weight'], out['variants'][name]['exposure_by_period'][p])
        self.assertIn(out['verdicts']['verdict'], {'PROMISING', 'BEATS_CURRENT_BELOW_MATCHED_SPY', 'REJECTED'})
        md = bt.markdown(out)
        self.assertIn('Pre-registered verdict', md)
        self.assertIn('SPY at challenger-holdrank10 exposure', md)

    def test_rounds_one_and_two_are_unchanged_by_round_three(self):
        self.assertEqual(bt.ROUND3['current-fractional'], bt.VARIANTS['momentum'])
        self.assertEqual(bt.ROUND3['challenger-fractional'], bt.VARIANTS['momentum-buffer10'])


class Round4CashEfficientAllocator(unittest.TestCase):
    """docs/STOCK_CHALLENGER_CASH_EFFICIENT_PREREG_2026_11_24.md: same picks, cash-efficient whole-share sizing."""
    ORDER = ['A', 'B', 'C', 'D', 'E']
    RAW = {'A': 60.0, 'B': 45.0, 'C': 30.0, 'D': 80.0, 'E': 25.0}

    def test_fill_spends_the_unused_gross_budget_best_ranked_first(self):
        base = {s: math.floor(100 / p) for s, p in self.RAW.items()}
        want = bt.fill_band_targets(self.RAW, {}, self.ORDER, 1000.0, 0.10)
        self.assertEqual(base, {'A': 1, 'B': 2, 'C': 3, 'D': 1, 'E': 4}, 'the live floor(10%) sizing invests $420')
        self.assertEqual(want, {'A': 2, 'B': 2, 'C': 3, 'D': 1, 'E': 4}, 'the $80 remainder buys one more A ($60)')
        self.assertLessEqual(sum(want[s] * self.RAW[s] for s in want), 500.0)

    def test_limits_hold_for_any_prices_and_never_go_below_the_live_floor(self):
        import random
        rnd = random.Random(20261124)
        for _ in range(500):
            n = rnd.randint(1, 5)
            order = [f'S{i}' for i in range(n)]
            raw = {s: round(rnd.uniform(5, 95), 2) for s in order}
            equity = rnd.uniform(600, 3000)
            held = {s: rnd.choice([0, 0, 1, 2, 3]) for s in order}
            want = bt.fill_band_targets(raw, held, order, equity, 0.10)
            budget = math.floor(0.10 * equity * 100) / 100
            gross = sum(want[s] * raw[s] for s in order)
            self.assertLessEqual(gross, n * budget + 1e-6, 'never above the live gross cap')
            for s in order:
                base = math.floor(budget / raw[s])
                self.assertGreaterEqual(want[s], min(base, held[s]) if held[s] else base)
                if want[s] > base:
                    self.assertLessEqual(want[s] * raw[s], bt.ALLOC_NAME_CAP * equity + 1e-6, 'name cap')
            self.assertEqual(want, bt.fill_band_targets(raw, held, order, equity, 0.10), 'deterministic')

    def test_band_keeps_a_held_pick_inside_five_to_fifteen_percent_and_resets_outside(self):
        kept = bt.fill_band_targets(self.RAW, {'A': 2}, self.ORDER, 1000.0, 0.10)
        self.assertGreaterEqual(kept['A'], 2, '$120 = 12% of equity: no single-share sell')
        reset = bt.fill_band_targets(self.RAW, {'A': 3}, self.ORDER, 1000.0, 0.10)
        self.assertEqual(reset['A'], 2, '$180 > 15% resets to the floor (1 share), then the fill adds one back')
        small = bt.fill_band_targets({'A': 40.0}, {'A': 1}, ['A'], 1000.0, 0.10)
        self.assertEqual(small['A'], 2, '$40 < 5% is below the band: back to floor($100 / $40) = 2 shares')

    def test_banded_positions_return_to_the_floor_worst_ranked_first_when_gross_is_exceeded(self):
        raw = {s: 35.0 for s in self.ORDER}
        held = {s: 4 for s in self.ORDER}  # $140 each = $700, above the $500 gross budget
        want = bt.fill_band_targets(raw, held, self.ORDER, 1000.0, 0.10)
        self.assertLessEqual(sum(want[s] * 35.0 for s in self.ORDER), 500.0)
        self.assertEqual([want[s] for s in self.ORDER], [4, 4, 2, 2, 2],
                         'E, D, then C return to floor($100/$35) = 2 until $490 fits; the $10 left cannot buy a share')

    def test_one_pick_fill_cannot_exceed_that_picks_budget(self):
        sessions, series, uni, ks, o = Round3Tests._series(self, lambda i: 40.0 + 0.01 * i)
        k = ks[0]
        live = bt.replay(sessions, series, uni, bt.ROUND4[bt.R4_CURRENT], start=sessions[k], end=sessions[k])
        fill = bt.replay(sessions, series, uni, bt.ROUND4[bt.R4_FILL], start=sessions[k], end=sessions[k])
        self.assertAlmostEqual(fill['traded'], live['traded'], places=9, msg='one pick: gross = one 10% budget')

    def test_round4_baselines_are_round3_rules_and_rounds_one_to_three_are_untouched(self):
        self.assertEqual(bt.ROUND4[bt.R4_CURRENT], bt.ROUND3[bt.CURRENT])
        self.assertEqual(bt.ROUND4[bt.R4_HOLD], bt.ROUND3[bt.CHALLENGER])
        for name in bt.R4_CHALLENGERS:
            spec = dict(bt.ROUND4[name]); self.assertEqual(spec.pop('allocator'), 'fill-band-v1')
        self.assertEqual({k: v for k, v in bt.ROUND4[bt.R4_FILL].items() if k != 'allocator'}, bt.ROUND3[bt.CURRENT])
        self.assertEqual({k: v for k, v in bt.ROUND4[bt.R4_HOLD_FILL].items() if k != 'allocator'}, bt.ROUND3[bt.CHALLENGER])
        self.assertNotIn('allocator', str(bt.ROUND3) + str(bt.ROUND2) + str(bt.VARIANTS))
        self.assertEqual((bt.ALLOC_NAME_CAP, bt.ALLOC_BAND_LOW, bt.PICKS * bt.WEIGHT), (0.15, 0.05, 0.5))

    def test_the_preregistered_round4_rule(self):
        def row(dev, hold, dd, s25, exp):
            return {'dev': {'sharpe': dev}, 'holdout': {'sharpe': hold, 'max_drawdown': dd}, 'avg_exposure': exp,
                    'full_at_25bps': {'sharpe': s25}}
        base = row(0.45, 0.47, -0.09, 0.40, 0.39)
        spy = {'dev': {'sharpe': 0.63}, 'holdout': {'sharpe': 1.27}}
        def out(ch, m=spy):
            return {'variants': {bt.R4_CURRENT: base, bt.R4_FILL: ch, bt.R4_HOLD_FILL: row(0, 0, -0.5, 0, 0)},
                    'matched_spy': {bt.R4_FILL: m}}
        v = bt.verdicts_round4(out(row(0.5, 0.5, -0.10, 0.45, 0.46)))[bt.R4_FILL]
        self.assertEqual((v['verdict'], v['registry_status']), ('BEATS_CURRENT_BELOW_MATCHED_SPY', 'RUNNING'))
        v = bt.verdicts_round4(out(row(0.7, 1.3, -0.10, 0.45, 0.46)))[bt.R4_FILL]
        self.assertEqual((v['verdict'], v['registry_status']), ('PROMISING', 'PROMISING'))
        bad = lambda r: bt.verdicts_round4(out(r))[bt.R4_FILL]['verdict']
        self.assertEqual(bad(row(0.5, 0.47, -0.10, 0.45, 0.46)), 'REJECTED', 'a tie is not better')
        self.assertEqual(bad(row(0.5, 0.5, -0.15, 0.45, 0.46)), 'REJECTED', 'drawdown more than 5 points worse')
        self.assertEqual(bad(row(0.5, 0.5, -0.10, 0.40, 0.46)), 'REJECTED', 'fails at 25 bps')
        self.assertEqual(bad(row(0.5, 0.5, -0.10, 0.45, 0.43)), 'REJECTED', 'invests less than 5 points more')
        self.assertEqual(bt.verdicts_round4(out(row(0.7, 1.3, -0.10, 0.45, 0.46), {}))[bt.R4_FILL]['verdict'],
                         'BEATS_CURRENT_BELOW_MATCHED_SPY', 'a missing benchmark fails R4, never passes it')
        self.assertEqual(bt.verdicts_round4(out(row(0.7, 1.3, -0.10, 0.45, 0.46)))[bt.R4_HOLD_FILL]['verdict'], 'REJECTED',
                         'each challenger is judged on its own')

    def test_round4_runs_end_to_end_with_matched_spy_and_markdown(self):
        data = fixture_data('2026-12-28')
        data['bars']['SPY'] = dict(data['bars']['S10'])
        out = bt.evaluate(data, universe() | {'max_last_close': '95', 'revision': 'fixture'}, end=data['sessions'][-1], round_=4)
        self.assertEqual(out['round'], 4)
        self.assertEqual(set(out['variants']), set(bt.ROUND4))
        self.assertEqual(set(out['matched_spy']), {bt.R4_CURRENT, bt.R4_HOLD, *bt.R4_CHALLENGERS})
        self.assertEqual(set(out['verdicts']), set(bt.R4_CHALLENGERS))
        for name in bt.R4_CHALLENGERS:
            self.assertGreaterEqual(out['variants'][name]['avg_exposure'] + 1e-12,
                                    out['variants'][bt.R4_CURRENT if name == bt.R4_FILL else bt.R4_HOLD]['avg_exposure'] - 0.02)
            self.assertIn('vs_matched_spy', out['paired_weekly_holdout'][name])
        md = bt.markdown(out)
        self.assertIn('Pre-registered verdicts', md)
        self.assertIn('SPY at current-fill exposure', md)

    def test_expensive_picks_invest_more_with_the_allocator_and_trade_no_extra_churn(self):
        # Five uptrending stocks at $62-$88 in five sectors: floor($100 / price) = 1 share each, about 37% invested.
        days, d = [], date(2025, 1, 6)
        while len(days) < 420:
            if d.weekday() < 5:
                days.append(d.isoformat())
            d += timedelta(days=1)
        starts = {'P1': 62.0, 'P2': 66.0, 'P3': 71.0, 'P4': 77.0, 'P5': 83.0}
        bars = {}
        for i, (sym, p0) in enumerate(starts.items()):
            o = [round(p0 * (1 + 0.00005 * (6 - i)) ** k * (1 + 0.003 * (-1) ** k), 4) for k in range(len(days))]
            bars[sym] = {'d': days, 'o': o, 'c': o, 'v': [5e6] * len(days), 'ao': o, 'ac': o}
        uni = {'max_last_close': '95', 'securities': [{'symbol': s, 'sector': 'X' + s, 'first_traded_on': '2015-01-02'}
                                                     for s in starts]}
        sessions, series = bt.align({'sessions': days, 'bars': bars})
        first = next(k for k in range(bt.WINDOW, len(sessions)) if bt.is_decision(sessions, k, 'weekly'))
        live = bt.replay(sessions, series, uni, bt.ROUND4[bt.R4_CURRENT], start=sessions[first], end=sessions[-1])
        fill = bt.replay(sessions, series, uni, bt.ROUND4[bt.R4_FILL], start=sessions[first], end=sessions[-1])
        self.assertGreater(live['decisions'], 10)
        self.assertLess(live['avg_exposure'], 0.40)
        self.assertLess(max(max(series[x]['o']) for x in starts), 95.0, 'all five stay eligible under the $95 cap')
        self.assertGreater(fill['avg_exposure'], live['avg_exposure'] + 0.05, 'the unused gross budget is invested')
        self.assertLessEqual(max(fill['exposure']), 0.5 + 0.01, 'never above the live 50% gross cap (price drift aside)')
        self.assertEqual(fill['cash_blocked'], 0)
        initial = sum(math.floor(100 / series[s]['o'][first]) * series[s]['o'][first] for s in starts)
        self.assertLess(fill['traded'] - initial, 3 * (live['traded'] - initial + 200),
                        'the band prevents weekly single-share churn from dominating turnover')

    def test_learning_registry_entries_match_the_code_and_are_only_proposed(self):
        import json
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        reg = json.loads((root / 'research/engine/registry.json').read_text(encoding='utf-8'))
        rows = {e['id']: e for e in reg['experiments']}
        for i in ('lab-stock-cash-efficient-fill', 'lab-stock-holdrank10-cash-efficient-fill'):
            e = rows[i]
            p = e['frozen']['parameters']
            self.assertEqual((p['allocator'], p['nameCap'], p['bandLow'], p['grossCap']),
                             (bt.ALLOCATOR, bt.ALLOC_NAME_CAP, bt.ALLOC_BAND_LOW, bt.PICKS * bt.WEIGHT))
            self.assertEqual(p['holdout'], '2023-01-01..' + bt.ROUND4_END)
            self.assertEqual(e['history'][0]['to'], 'PROPOSED', 'registered before any result')
            self.assertGreaterEqual(e['sampleRequirements']['minWeeks'], 26)
            self.assertIn('STOCK_CHALLENGER_CASH_EFFICIENT_PREREG_2026_11_24.md', e['decisionRule'])
        self.assertEqual(rows['lab-stock-holdrank10-cash-efficient-fill']['frozen']['parameters']['HOLD_RANK_MAX'], 10)
