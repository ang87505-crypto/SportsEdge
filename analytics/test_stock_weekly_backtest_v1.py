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
