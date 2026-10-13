"""Cross-check the QC selector directly against frozen SportsEdge source code.

This test MUST run at repository root with the original analytics/ modules.
All cases use existing SYNTHETIC upstream fixtures; no market outcomes.
"""
import unittest
from decimal import Decimal as D

from analytics.stock_momentum_v1 import generate as baseline_generate
from analytics.stock_rank_buffer_candidate import generate_buffer
from analytics.test_stock_momentum_v1 import fixture as stock_fixture

try:
    from .selection import BASELINE, CANDIDATE, evaluate_month
except ImportError:
    from selection import BASELINE, CANDIDATE, evaluate_month


def port_fixture(original, *, strategy=BASELINE, held=()):
    context = original['context']
    dates = context['sessions'][:-1]
    last = dates[-1]['date']
    by_sym = {}
    for bar in original['payload']['bars']:
        if bar['session_date'] <= last:
            by_sym.setdefault(bar['symbol'], []).append(bar)
    members=[]
    for u in context['universe']:
        bars=[]
        for row in sorted(by_sym[u['symbol']],key=lambda x:x['session_date']):
            bars.append({'date':row['session_date'],'close':row['close'],
                         'volume':row['volume'], 'completed_at':row['completed_at'],
                         'available_at':row['available_at'], 'split_ratio':'1',
                         'cash_dividend_per_old_share':'0'})
        members.append(dict(**u,first_traded_on='1990-01-01',
                            first_trade_available_at=context['universe_available_at'],bars=bars))
    return dict(universe=members, sessions=[{'date':s['date'],'close_at':s['close_at']} for s in dates],
                next_session={'date':context['sessions'][-1]['date'],
                              'open_at':context['sessions'][-1]['open_at']},
                decision_at=original['decision_at'],incumbent_ids=tuple('id-'+s for s in held),
                equity_cents=100000, strategy_version=strategy,source_complete=True)


class AuthoritativeParityTests(unittest.TestCase):
    def test_baseline_momentum_trend_volume_and_target_parity(self):
        original=stock_fixture(tuple('ABCDEFGHIJK'))
        reference=baseline_generate(**original)
        candidate=evaluate_month(**port_fixture(original))
        self.assertEqual({x['symbol']:x['security_id'] for x in reference['scores']},
                         {x['symbol']:x['security_id'] for x in candidate['scores']})
        for a,b in zip(reference['scores'],candidate['scores']):
            self.assertEqual(a['symbol'],b['symbol'])
            self.assertEqual(D(a['momentum']),D(b['momentum']))
            self.assertEqual(D(a['mean_dollar_volume_20']),D(b['mean_dollar_volume_20']))
            self.assertEqual(a['trend_positive'],b['trend_positive'])
            self.assertEqual(a['eligible'],b['eligible'])
        expected={r['symbol'] for r in reference['targets'] if r['action']=='TARGET'}
        actual={r['security_id'].removeprefix('id-') for r in candidate['targets'] if r['action']=='TARGET'}
        self.assertEqual(expected,actual)
        self.assertEqual(reference['cash_target_cents'],candidate['cash_target_cents'])

    def test_hold_rank_ten_parity(self):
        original=stock_fixture(tuple('ABCDEFGHIJK'))
        held=('J',)
        original['held_symbols']=list(held)
        reference=generate_buffer(**original)
        candidate=evaluate_month(**port_fixture(original,strategy=CANDIDATE,held=held))
        expected={r['symbol'] for r in reference['targets'] if r['action']=='TARGET'}
        actual={r['security_id'].removeprefix('id-') for r in candidate['targets'] if r['action']=='TARGET'}
        self.assertEqual(expected,actual)
        self.assertEqual(reference['cash_target_cents'],candidate['cash_target_cents'])

    def test_both_functions_reject_unknown_strategy(self):
        f=stock_fixture(('AAA','BBB'))
        args=port_fixture(f,strategy='not-a-real-strategy')
        with self.assertRaises(ValueError):evaluate_month(**args)


if __name__=='__main__':unittest.main()
