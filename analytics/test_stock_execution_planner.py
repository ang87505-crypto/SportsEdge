"""Synthetic integration fixtures only; no actual prices or account returns."""
from copy import deepcopy
from decimal import localcontext
import unittest
from analytics.test_stock_momentum_v1 import fixture
from analytics.stock_momentum_v1 import generate,digest
from analytics.stock_execution_planner import plan_run,mark_account


def case():
    signal=generate(**fixture())
    account=dict(account_id='synthetic-account',revision=0,cash_cents=100000,positions={},completed_signal_ids=[])
    now='2026-10-01T13:30:30Z'
    auth=dict(mode='paper',action='run_once',actor_id='synthetic-owner',run_id='synthetic-run',signal_id=signal['signal_id'],signal_digest=digest(signal),account_id=account['account_id'],account_revision=0,signal_published_at='2026-10-01T12:00:01Z',authorized_at='2026-10-01T13:29:00Z',expires_at='2026-10-01T14:00:00Z',max_buy_debit_cents=20000)
    quotes={s:dict(symbol=s,quote_id='synthetic-'+s,provider='synthetic',observed_at='2026-10-01T13:30:10Z',received_at='2026-10-01T13:30:11Z',bid='29',ask='30',tradable=True,bid_size=100,ask_size=100) for s in ('AAA','BBB')}
    costs={s:dict(slippage_bps='100',fee_cents=25,assumption_id='synthetic-100bps') for s in quotes}
    return dict(signal=signal,account=account,quotes=quotes,costs=costs,authorization=auth,now=now,session_open='2026-10-01T13:30:00Z',session_close='2026-10-01T20:00:00Z')

class ExecutionTests(unittest.TestCase):
    def test_generated_signal_to_exact_plan_and_marks(self):
        r=plan_run(**case())
        self.assertEqual(r['buy_debit_cents'],18230)
        self.assertEqual(r['projected_after']['cash_cents'],81770)
        self.assertEqual(r['projected_after']['equity_cents'],99470)
        self.assertEqual(r['projected_positions'],{'AAA':3,'BBB':3})
        self.assertEqual(r['status'],'planned_not_executed')
    def test_determinism_and_no_input_mutation(self):
        c=case();before=deepcopy(c);a=plan_run(**c);b=plan_run(**c)
        self.assertEqual(a,b);self.assertEqual(c,before)
        with localcontext() as ctx:
            ctx.prec=6;self.assertEqual(a,plan_run(**c))
    def test_stale_future_and_crossed_quotes(self):
        for key,val in [('observed_at','2026-10-01T13:29:00Z'),('received_at','2026-10-01T13:31:00Z'),('bid','31'),('tradable',False)]:
            c=case();c['quotes']['AAA'][key]=val
            with self.assertRaises(ValueError):plan_run(**c)
    def test_wrong_quote_identity(self):
        c=case();c['quotes']['AAA']['symbol']='ZZZ'
        with self.assertRaises(ValueError):plan_run(**c)
    def test_unavailable_or_insufficient_quote(self):
        c=case();del c['quotes']['AAA']
        with self.assertRaises(KeyError):plan_run(**c)
        c=case();c['quotes']['AAA']['ask_size']=2
        with self.assertRaises(ValueError):plan_run(**c)
    def test_duplicate_completion_blocks_another_run(self):
        c=case();c['account']['completed_signal_ids']=[c['signal']['signal_id']]
        with self.assertRaises(ValueError):plan_run(**c)
    def test_authorization_scope_and_no_live_mode(self):
        for key,val in [('mode','live'),('signal_id','wrong'),('account_id','wrong'),('account_revision',1),('action','repeat'),('expires_at','2026-10-01T13:30:30Z')]:
            c=case();c['authorization'][key]=val
            with self.assertRaises(ValueError):plan_run(**c)
    def test_no_backdated_publication(self):
        c=case();c['authorization']['signal_published_at']='2026-10-01T13:31:00Z'
        with self.assertRaises(ValueError):plan_run(**c)
    def test_budget_cannot_overspend(self):
        c=case();c['authorization']['max_buy_debit_cents']=18000
        with self.assertRaises(ValueError):plan_run(**c)
        c=case();c['account']['cash_cents']=90000
        with self.assertRaises(ValueError):plan_run(**c)
    def test_rebalance_sells_before_buys(self):
        c=case();c['account'].update(cash_cents=90000,positions={'AAA':4})
        r=plan_run(**c)
        self.assertEqual(r['simulated_intents'][0]['side'],'sell')
        self.assertEqual(r['simulated_intents'][0]['cash_delta_cents'],2846)
        self.assertEqual(r['projected_positions']['AAA'],3)
    def test_exit_liquidates_without_shorting(self):
        c=case();c['account'].update(cash_cents=90000,positions={'AAA':4})
        c['signal']['targets'][0].update(action='EXIT',target_budget_cents=0)
        c['authorization']['signal_digest']=digest(c['signal'])
        r=plan_run(**c);self.assertNotIn('AAA',r['projected_positions'])
        self.assertEqual(r['simulated_intents'][0]['shares'],4)
    def test_session_and_signal_expiry(self):
        for key,val in [('now','2026-10-01T13:29:59Z'),('now','2026-10-01T20:00:00Z'),('session_open','2026-10-01T13:00:00Z')]:
            c=case();c[key]=val
            with self.assertRaises(ValueError):plan_run(**c)
    def test_risk_limits_and_no_missing_holdings(self):
        c=case();c['signal']['targets'][0]['target_budget_cents']=10001
        with self.assertRaises(ValueError):plan_run(**c)
        c=case();c['account']['positions']={'ZZZ':1}
        with self.assertRaises(ValueError):plan_run(**c)
    def test_holdings_marks_require_fresh_prices(self):
        c=case();c['account']['positions']={'AAA':2}
        r=mark_account(c['account'],c['quotes'],as_of=c['now'])
        self.assertEqual(r['equity_cents'],105900)
        self.assertEqual(r['bid_equity_before_costs_cents'],105800)
        c['quotes']['AAA']['observed_at']='2026-10-01T12:00:00Z'
        with self.assertRaises(ValueError):mark_account(c['account'],c['quotes'],as_of=c['now'])
    def test_tampered_authorized_signal_rejected(self):
        c=case();c['signal']['targets'][0]['target_budget_cents']=9000
        with self.assertRaises(ValueError):plan_run(**c)
    def test_invalid_costs_and_cash(self):
        for key,val in [('slippage_bps','NaN'),('fee_cents',True),('slippage_bps','10000')]:
            c=case();c['costs']['AAA'][key]=val
            with self.assertRaises(ValueError):plan_run(**c)
        c=case();c['account']['cash_cents']=-1
        with self.assertRaises(ValueError):plan_run(**c)

if __name__=='__main__':unittest.main()
