"""Synthetic integration and mutation tests; no real returns."""
from copy import deepcopy
import unittest
from analytics.stock_readiness_pipeline_v1 import run_synthetic, synthetic_input, reconcile, readiness
from analytics.stock_universe_account_v1 import compare_synthetic
from analytics.test_stock_accounting_v2 import fixture, run, dividend, session_row

class ReadinessPipelineTests(unittest.TestCase):
    def test_three_frozen_cost_scenarios_reconcile_and_repeat(self):
        r=run_synthetic();self.assertIsNone(r['performance'])
        self.assertEqual([s['nominal_one_way_bps'] for s in r['scenarios']],[15,25,50])
        for s in r['scenarios']:
            self.assertTrue(s['repeated_outputs_identical'])
            for name in ('baseline','candidate'):self.assertTrue(s['reconciliation'][name]['all_receipts_reconciled'])
    def test_tampering_receipts_and_balances_fails_independent_reconciliation(self):
        data=synthetic_input();r=compare_synthetic(**data)['baseline']
        for mode in ('cash','position','nav','fee','amount','spread','duplicate'):
            x=deepcopy(r);s=x['sessions'][0]
            if mode=='cash':s['state']['settled_cash_cents']+=1
            elif mode=='position':s['state']['positions']['id-AAA']+=1
            elif mode=='nav':s['close_nav']='1234'
            elif mode=='fee':s['trades'][0]['fee_cents']+=1
            elif mode=='amount':s['trades'][0]['amount_cents']+=1
            elif mode=='spread':s['trades'][0]['spread_cost_dollars']='99'
            else:s['trades'].append(deepcopy(s['trades'][0]))
            with self.subTest(mode=mode),self.assertRaises(ValueError):reconcile(data['initial_account'],x)
    def test_dividend_and_sale_settlement_reconcile(self):
        f=fixture(positions={'id-AAA':10},cash=54800)
        f['session']['events']=[dividend(f,pay='2026-10-02T10:00:00-04:00')]
        first=run(f)['sessions'][0]
        second=session_row(f['calendar'],first['state'],'2026-10-02')
        r=run(f,[dict(session=f['session'],model=f['model']),dict(session=second)])
        self.assertTrue(reconcile(f['account'],r)['all_receipts_reconciled'])
    def test_missing_session_and_terminal_events_fail_entire_pair(self):
        for mode in ('missing','delisting','merger','spinoff'):
            data=synthetic_input()
            if mode=='missing':data['rows'].pop(1)
            else:
                s=data['rows'][1]['session'];s['events']=[dict(type=mode,event_id='synthetic-terminal',security_id='id-AAA',effective_at=s['open_at'],available_at=s['actions_available_at'])]
            with self.subTest(mode=mode),self.assertRaises(ValueError):compare_synthetic(**data)
    def test_no_historical_or_prefunded_positions(self):
        for mode in ('history','positions'):
            d=synthetic_input()
            if mode=='history':d['rows'][0]['session']['kind']='historical_price_proxy'
            else:d['initial_account']['positions']={'id-AAA':1}
            with self.assertRaises(ValueError):run_synthetic(d)
    def test_readiness_cannot_claim_performance(self):
        r=readiness();self.assertFalse(r['historical_backtest_ready']);self.assertIsNone(r['performance'])

if __name__=='__main__':unittest.main()
