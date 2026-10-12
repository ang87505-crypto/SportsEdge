"""Synthetic mathematical fixtures ONLY; no prices, trades or returns from markets."""
from copy import deepcopy
from decimal import Decimal, localcontext
import unittest
from analytics.test_stock_momentum_v1 import fixture
from analytics.test_stock_verified_signal_replay import integrated_case
from analytics.stock_momentum_v1 import generate
from analytics.stock_verified_signal_replay import checked_replay
from analytics.stock_replay_integrity_audit import guarded_replay, audit_archive_structure
from analytics.stock_rank_buffer_candidate import generate_buffer, VERSION
from analytics.stock_execution_planner import plan_run
from analytics.stock_historical_ledger import replay
from analytics.alpaca_history_archive import archive

SYMBOLS=('AAA','BBB','CCC','DDD','EEE','FFF','GGG','HHH','III','JJJ','KKK')


def ranked_fixture():
    args=fixture(SYMBOLS)
    days={s['date']:i for i,s in enumerate(args['context']['sessions'])}
    for b in args['payload']['bars']:
        rate=Decimal(len(SYMBOLS)-SYMBOLS.index(b['symbol']))/100
        value=str(Decimal(20)+days[b['session_date']]*rate)
        for k in ('open','high','low','close'):b[k]=value
    for u in args['context']['universe']:u['sector']='sector-'+u['symbol']
    return args


def replace_signal(bundle,args):
    s=generate(**args)
    bundle['signal_evidence'][0]={'signal_id':s['signal_id'],'generate_args':args}
    bundle['replay_input']['sessions'][-1]['decision']['signal']=s


class StockIndependentAuditTests(unittest.TestCase):
    def test_good_existing_path_identical_and_nonmutating(self):
        bundle,_=integrated_case();before=deepcopy(bundle)
        new=guarded_replay(bundle);old=checked_replay(bundle)
        self.assertEqual(new['portfolio_scenario'],old['portfolio_scenario'])
        self.assertEqual(new['account_price_calendar_decisions_checked'],1)
        self.assertFalse(new['real_world_return_verified'])
        self.assertEqual(bundle,before);self.assertEqual(new,guarded_replay(bundle))

    def test_existing_wrong_equity_acceptance_is_now_rejected(self):
        b,_=integrated_case();args=b['signal_evidence'][0]['generate_args'];args['equity_cents']=90000
        replace_signal(b,args)
        self.assertEqual(checked_replay(b)['recomputed_signals'],1)
        with self.assertRaisesRegex(ValueError,'Model equity differs'):guarded_replay(b)

    def test_existing_fictitious_held_state_acceptance_is_now_rejected(self):
        b,_=integrated_case();args=b['signal_evidence'][0]['generate_args'];args['held_symbols']=['AAA']
        replace_signal(b,args)
        self.assertEqual(checked_replay(b)['recomputed_signals'],1)
        with self.assertRaisesRegex(ValueError,'held_symbols differs'):guarded_replay(b)

    def test_existing_conflicting_price_acceptance_is_now_rejected(self):
        b,_=integrated_case();b['replay_input']['sessions'][0]['market'][0]['close']='999.00'
        self.assertEqual(checked_replay(b)['recomputed_signals'],1)
        with self.assertRaisesRegex(ValueError,'prior close disagree'):guarded_replay(b)

    def test_existing_calendar_label_acceptance_is_now_rejected(self):
        b,_=integrated_case();b['replay_input']['sessions'][-1]['date']='2026-10-02'
        self.assertEqual(checked_replay(b)['recomputed_signals'],1)
        with self.assertRaisesRegex(ValueError,'Session date disagrees'):guarded_replay(b)

    def test_cross_module_security_identity_must_match(self):
        b,_=integrated_case()
        for r in b['replay_input']['sessions']:r['market'][0]['security_id']='different-company'
        self.assertEqual(checked_replay(b)['recomputed_signals'],1)
        with self.assertRaisesRegex(ValueError,'security ID'):guarded_replay(b)

    def test_unknown_calendar_gaps_fail(self):
        b,_=integrated_case();s=deepcopy(b['replay_input']['sessions'][-1]);s.pop('decision')
        s.update(date='2026-10-05',open_at='2026-10-05T13:30:00Z',close_at='2026-10-05T20:00:00Z')
        b['replay_input']['sessions'].append(s)
        with self.assertRaisesRegex(ValueError,'supplied exchange calendar'):guarded_replay(b)

    def test_cash_dividends_fail_instead_of_becoming_immediately_spendable(self):
        b,_=integrated_case();b['replay_input']['sessions'][-1]['actions']=[dict(symbol='AAA',source_id='synthetic-div',split_numerator=1,split_denominator=1,dividend_cents_per_old_share=100)]
        checked_replay(b) # legacy accepts even though it has no payable-date contract
        with self.assertRaisesRegex(ValueError,'receivable/pay-date'):guarded_replay(b)

    def test_split_requires_timing_and_unique_source_event(self):
        b,_=integrated_case();r=b['replay_input']['sessions'][-1]
        action=dict(symbol='AAA',source_id='synthetic-split',split_numerator=2,split_denominator=1,dividend_cents_per_old_share=0)
        r['actions']=[action]
        with self.assertRaises(ValueError):guarded_replay(b)
        action.update(effective_at=r['open_at'],available_at='2026-10-01T12:00:00Z')
        guarded_replay(b)
        b['replay_input']['sessions'][0]['actions']=[{**action,'effective_at':b['replay_input']['sessions'][0]['open_at'],'available_at':'2026-09-29T12:00:00Z'}]
        with self.assertRaisesRegex(ValueError,'source ID replayed'):guarded_replay(b)

    def test_no_holdings_candidate_equals_baseline_targets(self):
        f=ranked_fixture();a=generate(**f);b=generate_buffer(**f)
        self.assertEqual(a['targets'],b['targets']);self.assertEqual(a['scores'],b['scores'])
        self.assertNotEqual(a['strategy_version'],b['strategy_version'])
        self.assertNotEqual(a['signal_id'],b['signal_id']);self.assertEqual(b['fills'],[])

    def test_rank_six_holding_retained_with_same_filters_caps(self):
        f=ranked_fixture();f['held_symbols']=['AAA','BBB','CCC','DDD','FFF']
        a=generate(**f);b=generate_buffer(**f)
        selected=lambda x:{t['symbol'] for t in x['targets'] if t['action']=='TARGET'}
        self.assertEqual(selected(a),set(SYMBOLS[:5]))
        self.assertEqual(selected(b),{'AAA','BBB','CCC','DDD','FFF'})
        self.assertEqual(b['cash_target_cents'],50000)
        self.assertTrue(all(t['target_budget_cents']<=10000 for t in b['targets']))
        self.assertEqual(a['scores'],b['scores'])

    def test_rank_ten_retained_rank_eleven_exits(self):
        for symbol,expected in [('JJJ','TARGET'),('KKK','EXIT')]:
            f=ranked_fixture();f['held_symbols']=[symbol]
            out=generate_buffer(**f)
            self.assertEqual(next(t['action'] for t in out['targets'] if t['symbol']==symbol),expected)

    def test_buffer_never_overrides_liquidity_or_trend_filters(self):
        f=ranked_fixture();f['held_symbols']=['FFF']
        for b in f['payload']['bars']:
            if b['symbol']=='FFF':b['volume']=0
        out=generate_buffer(**f)
        self.assertEqual(next(t['action'] for t in out['targets'] if t['symbol']=='FFF'),'EXIT')
        f=ranked_fixture();f['held_symbols']=['FFF']
        for b in f['payload']['bars']:
            if b['symbol']=='FFF' and b['session_date']=='2026-09-30':
                for k in ('open','high','low','close'):b[k]='5'
        out=generate_buffer(**f)
        self.assertEqual(next(t['action'] for t in out['targets'] if t['symbol']=='FFF'),'EXIT')

    def test_sector_and_position_caps_with_many_holdings(self):
        f=ranked_fixture();f['held_symbols']=list(SYMBOLS)
        for u in f['context']['universe']:u['sector']='one-sector'
        out=generate_buffer(**f)
        self.assertEqual(sum(t['action']=='TARGET' for t in out['targets']),2)
        self.assertEqual(out['cash_target_cents'],80000)

    def test_future_data_order_and_decimal_context_do_not_change_candidate(self):
        f=ranked_fixture();f['held_symbols']=['FFF'];before=deepcopy(f);a=generate_buffer(**f)
        self.assertEqual(f,before)
        for b in f['payload']['bars']:
            if b['session_date']=='2026-10-01':
                for k in ('open','high','low','close'):b[k]='9999'
        f['payload']['bars'].reverse();f['context']['universe'].reverse()
        with localcontext() as ctx:
            ctx.prec=7
            self.assertEqual(a,generate_buffer(**f))

    def test_missing_or_late_data_remains_rejected(self):
        f=ranked_fixture();f['payload']['bars'].pop(0)
        with self.assertRaises(ValueError):generate_buffer(**f)
        f=ranked_fixture()
        for b in f['payload']['bars']:
            if b['session_date']=='2026-09-30':b['available_at']=f['decision_at']
        with self.assertRaises(ValueError):generate_buffer(**f)

    def test_candidate_cannot_be_submitted_as_approved_baseline(self):
        b,p=integrated_case();candidate=generate_buffer(**b['signal_evidence'][0]['generate_args'])
        self.assertEqual(candidate['strategy_version'],VERSION);p['signal']=candidate
        with self.assertRaisesRegex(ValueError,'unapproved strategy'):plan_run(**p)
        b['replay_input']['sessions'][-1]['decision']['signal']=candidate
        with self.assertRaisesRegex(ValueError,'Unapproved stock strategy'):checked_replay(b)

    def test_missing_corporate_action_payload_is_accepted_by_archiver_not_proof_of_coverage(self):
        calls=[]
        def get(url,headers):
            calls.append(url)
            if '/bars?' in url:return {'bars':[{'t':'2026-09-30T04:00:00Z','o':20,'h':20,'l':20,'c':20,'v':2000000}],'next_page_token':None}
            return {'next_page_token':None} # malformed: missing corporate_actions
        out=archive(symbols=['AAA'],start='2026-09-30',end='2026-09-30',asof='2026-09-30',feed='iex',max_requests=2,key_id='synthetic-key',secret_key='synthetic-secret',get=get,captured_at='2026-10-02T00:00:00Z')
        self.assertEqual(len(calls),2)
        self.assertFalse(out['stock_universe_point_in_time_verified'])
        with self.assertRaisesRegex(ValueError,'Missing corporate_actions'):audit_archive_structure(out)
        from analytics.alpaca_history_archive import _hash_page
        page=out['corporate_action_source_pages'][0]
        page['payload']['corporate_actions']={}
        page['page_sha256']=_hash_page(page['payload'])
        self.assertFalse(audit_archive_structure(out)['corporate_actions_complete'])
        out['stock_bar_source_pages'][0]['payload']['bars'][0]['c']=21
        with self.assertRaisesRegex(ValueError,'hash mismatch'):audit_archive_structure(out)

if __name__=='__main__':unittest.main()
