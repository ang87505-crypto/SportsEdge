"""Steady-stocks (low-volatility) weekly selection. Fictional prices; no market or return evidence."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import statistics
import unittest
from analytics.stock_forward_bridge_v1 import sha256, part
from analytics.stock_momentum_v1 import VERSION as BASELINE
from analytics.stock_lowvol_weekly_v1 import VERSION as LOWVOL, volatility_by_symbol, choose
from analytics.stock_weekly_bridge_v2 import decide, assemble
from analytics.test_stock_weekly_v2 import (NY, SECTORS, SYMBOLS, ASSETS, NO_ACTIONS, calendar_rows, universe)

# Daily swing size per symbol (alternating up/down around a steady uptrend).
# S07 and S13 share S01's sector (index % 6 == 0), so the two-per-sector cap must drop one of them.
AMPLITUDE = {s: 0.30 + 0.02 * i for i, s in enumerate(SYMBOLS)}
AMPLITUDE |= {'S01': 0.02, 'S07': 0.03, 'S13': 0.04, 'S02': 0.05, 'S03': 0.06, 'S04': 0.07}
FALLING = 'S05'  # the calmest of all, but in a downtrend: never eligible
AMPLITUDE[FALLING] = 0.01


def price(sym, k):
    trend = -0.03 if sym == FALLING else 0.03
    swing = AMPLITUDE[sym] * (1 if k % 2 else -1)
    return round(40 + (k * trend if sym != FALLING else 20 + k * trend) + swing, 2)


def pages(end, split=None):
    days = [date.fromisoformat(r['date']) for r in calendar_rows(end)][:-1]
    bars = {}
    for sym in SYMBOLS:
        bars[sym] = []
        for k, x in enumerate(days):
            p = price(sym, k)
            if split and sym == split[0] and k < split[1]:
                p = round(p * 2, 2)  # raw pre-split prices: a 2-for-1 split halves them on the ex-date
            t = datetime.combine(x, datetime.min.time(), NY).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            bars[sym].append({'t': t, 'o': p, 'h': p, 'l': p, 'c': p, 'v': 3_000_000, 'n': 1000, 'vw': p})
    return days, [{'bars': {k: v[:150] for k, v in bars.items()}, 'next_page_token': 'p2'},
                  {'bars': {k: v[150:] for k, v in bars.items()}, 'next_page_token': None}]


def capture(session='2026-11-02', decision='2026-11-02T13:00:00Z', split=None):
    end = date.fromisoformat(session)
    at = datetime.fromisoformat(decision.replace('Z', '+00:00'))
    z = lambda dt: dt.isoformat().replace('+00:00', 'Z')
    rows = calendar_rows(end)
    days, bar_pages = pages(end, split)
    actions = deepcopy(NO_ACTIONS)
    if split:
        actions[0]['corporate_actions']['forward_splits'].append(
            {'id': 'split-1', 'symbol': split[0], 'new_rate': 2, 'old_rate': 1,
             'ex_date': days[split[1]].isoformat(), 'process_date': days[split[1]].isoformat()})
    reference = z(at - timedelta(minutes=2))
    return {'version': 'stock-weekly-bridge-v2-capture', 'session': session, 'initial': False,
            'calendar': {'rows': rows, 'sha256': sha256(rows), 'retrieved_at': reference},
            'assets': {'rows': ASSETS, 'sha256': sha256(ASSETS), 'retrieved_at': reference},
            'actions': part(actions, reference),
            'reference_bars': part(deepcopy(bar_pages), reference),
            'decision_bars': part(bar_pages, z(at + timedelta(seconds=20)), started_at=z(at + timedelta(seconds=1))),
            'observed_at': z(at + timedelta(seconds=21))}


def registration(model):
    return {'experimentId': 'stock-v3-steady-test', 'registeredAt': '2026-10-30T04:00:00Z', 'modelVersion': model}


class SteadyStocksTests(unittest.TestCase):
    def test_picks_the_calmest_uptrending_stocks_with_two_per_sector(self):
        r = decide(capture(), universe(), registration(LOWVOL), [], False)
        self.assertEqual(r['outcome'], 'TARGETS', r.get('diagnostics'))
        sig = r['signal']
        self.assertEqual(sig['modelVersion'], LOWVOL)
        self.assertEqual(sig['variant']['selection'], 'lowest-252-session-volatility-trend200')
        # S05 is calmest but falling; S13 is third calmest but a third S01-sector stock.
        self.assertEqual([t['symbol'] for t in sig['targets']], ['S01', 'S07', 'S02', 'S03', 'S04'])
        self.assertLessEqual(max(sum(t['sector'] == s for t in sig['targets']) for s in SECTORS), 2)
        self.assertFalse(sig['executionPermitted'])
        self.assertEqual(r['decisionId'], sig['decisionId'])

    def test_the_momentum_model_on_the_same_data_still_ranks_by_momentum(self):
        steady = decide(capture(), universe(), registration(LOWVOL), [], False)['signal']['targets']
        momentum = decide(capture(), universe(), registration(BASELINE), [], False)
        self.assertEqual(momentum['outcome'], 'TARGETS')
        self.assertNotIn('selection', momentum['signal']['variant'])
        self.assertNotEqual([t['symbol'] for t in momentum['signal']['targets']], [t['symbol'] for t in steady])

    def test_volatility_is_the_sample_deviation_of_daily_total_returns(self):
        bundle, _ = assemble(capture(), universe(), experiment_id='x', registered_at='2026-10-30T04:00:00Z',
                             model_version=LOWVOL, held_security_ids=[], initial=False)
        vol = volatility_by_symbol(bundle['evidence'])
        self.assertEqual(set(vol), set(SYMBOLS))
        for sym in ('S01', 'S20'):
            shard = next(s for s in bundle['evidence']['shards'] if s['payload']['bars'][0]['symbol'] == sym)
            closes = [float(b['close']) for b in shard['payload']['bars']][-253:]
            expected = statistics.stdev([b / a - 1 for a, b in zip(closes, closes[1:])])
            self.assertAlmostEqual(float(vol[sym]), expected, places=12)
        self.assertLess(vol['S01'], vol['S07'])
        self.assertLess(vol['S07'], vol['S20'])

    def test_a_split_does_not_look_like_a_crash(self):
        days, _ = pages(date(2026, 11, 2))
        cap = capture(split=('S01', len(days) - 60))
        bundle, skipped = assemble(cap, universe(), experiment_id='x', registered_at='2026-10-30T04:00:00Z',
                                   model_version=LOWVOL, held_security_ids=[], initial=False)
        self.assertEqual(skipped, {})
        self.assertEqual(len(bundle['evidence']['context']['actions']), 1)
        with_split = volatility_by_symbol(bundle['evidence'])['S01']
        plain, _ = assemble(capture(), universe(), experiment_id='x', registered_at='2026-10-30T04:00:00Z',
                            model_version=LOWVOL, held_security_ids=[], initial=False)
        self.assertLess(abs(with_split - volatility_by_symbol(plain['evidence'])['S01']), Decimal('0.0001'))
        r = decide(cap, universe(), registration(LOWVOL), [], False)
        self.assertEqual(r['signal']['targets'][0]['symbol'], 'S01')

    def test_choose_ignores_ineligible_and_unscored_members(self):
        row = lambda s, sector='A', **k: {'symbol': s, 'sector': sector, 'eligible': True, 'trend_positive': True} | k
        scores = [row('AAA'), row('BBB', eligible=False), row('CCC', trend_positive=False), row('DDD'), row('EEE')]
        vol = {'AAA': Decimal('0.02'), 'BBB': Decimal('0.001'), 'CCC': Decimal('0.001'), 'DDD': Decimal('0.01')}
        self.assertEqual([s['symbol'] for s in choose(scores, vol)], ['DDD', 'AAA'])


if __name__ == '__main__':
    unittest.main()
