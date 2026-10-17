"""SYNTHETIC ONLY. Literal expected cents/shares are hand-calculated examples.

Fictional securities/prices/calendar; no observed returns or profitability evidence.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal as D, localcontext, ROUND_DOWN, Inexact
import unittest
from zoneinfo import ZoneInfo
from analytics.test_stock_momentum_v1 import fixture as model_fixture
from analytics.stock_momentum_v1 import VERSION as BASELINE, generate
from analytics.stock_rank_buffer_candidate import VERSION as CANDIDATE
from analytics.stock_accounting_v2 import new_account, plan_open, close_session, settlement_date
from analytics.stock_baseline_replay_v2 import signal_from_account, plan_baseline, replay


def fixture(*, positions=None, cash=100000, fee=25, slip='10', bid='29.99', ask='30.01'):
    f = model_fixture(); model = dict(strategy_version=BASELINE, **f)
    prior = f['context']['sessions'][-2]; sessions = deepcopy(f['context']['sessions'])
    ny = ZoneInfo('America/New_York'); d = date(2026, 10, 2)
    while d <= date(2026, 11, 5):
        if d.weekday() < 5:
            op = datetime.combine(d, datetime.min.time(), ny).replace(hour=9, minute=30)
            sessions.append(dict(date=str(d), open_at=op.isoformat(), close_at=op.replace(hour=16, minute=0).isoformat()))
        d += timedelta(days=1)
    calendar = dict(revision='SYNTHETIC-weekdays-NOT-exchange-history', coverage_complete=True,
                    available_at='2026-09-30T22:00:00Z', sessions=sessions)
    settlement = dict(version='us-regular-way-settled-only-v1', revision='SYNTHETIC-settlement',
                      coverage_complete=True, available_at='2026-09-30T22:00:00Z',
                      coverage_start='2026-09-30', coverage_end='2026-11-05',
                      business_dates=[s['date'] for s in sessions if s['date'] >= '2026-09-30'])
    costs = dict(version='explicit-usd-costs-v2', assumption_id='SYNTHETIC-costs', slippage_bps=slip, fee_cents_per_order=fee)
    symbols = {'id-AAA': 'AAA', 'id-BBB': 'BBB'}
    marks = {sid: dict(symbol=symbol, price='45.2', completed_at=prior['close_at'], available_at='2026-09-30T20:01:00Z') for sid, symbol in symbols.items()}
    state = new_account(as_of=prior['close_at'], settled_cash_cents=cash, positions=positions or {}, symbols=symbols, marks=marks)
    return dict(account=state, model=model, session=session_row(calendar, state, '2026-10-01', bid=bid, ask=ask), calendar=calendar, settlement=settlement, costs=costs)


def session_row(calendar, account, day, *, bid='30', ask='30', close='30'):
    row = deepcopy(next(s for s in calendar['sessions'] if s['date'] == day))
    row.update(kind='synthetic_fixture', price_adjustment='raw', currency='USD', actions_complete=True, actions_available_at=row['open_at'].replace('09:30', '08:00'), events=[], quotes=[], close_marks=[])
    for sid, sym in account['symbols'].items():
        row['quotes'].append(dict(security_id=sid, symbol=sym, bid=bid, ask=ask, observed_at=row['open_at'], available_at=row['open_at'], tradable=True, bid_size=100000, ask_size=100000, prior_adv20_shares=2000000, volume_available_at=row['actions_available_at'], volume_last_session=account['as_of'][:10]))
        row['close_marks'].append(dict(security_id=sid, symbol=sym, price=close, completed_at=row['close_at'], available_at=row['close_at']))
    return row


def opening(row): return {k: deepcopy(v) for k, v in row.items() if k != 'close_marks'}
def options(f): return {k: f[k] for k in ('calendar', 'settlement', 'costs')}
def planned(f): return plan_baseline(f['account'], f['model'], opening(f['session']), **options(f))
def run(f, rows=None):
    mode = 'accounting_fixture' if rows and rows[0].get('model') is None else 'baseline'
    return replay(f['account'], rows or [dict(session=f['session'], model=f['model'])], **options(f), mode=mode)
def event(f, kind, **kwargs): return dict(event_id='SYNTHETIC-event-1', security_id='id-AAA', type=kind, effective_at=f['session']['open_at'], available_at='2026-09-30T22:00:00Z', **kwargs)
def dividend(f, amount='1', pay='2026-10-05T10:00:00-04:00'): return event(f, 'ordinary_cash_dividend', currency='USD', due_bill=False, per_old_share=amount, pay_at=pay)


class AccountingV2Tests(unittest.TestCase):
    def test_actual_planner_replay_spread_fee_slippage_parity(self):
        f=fixture(); p=planned(f); r=run(f)['sessions'][0]
        self.assertEqual(p['trades'],r['trades'])
        # Each buy: 3*30.01*1.001=90.12003 ->ceil 9013 cents +25.
        self.assertEqual([t['amount_cents'] for t in p['trades']],[9038,9038])
        self.assertEqual(r['state']['settled_cash_cents'],81924)
        self.assertEqual(r['state']['positions'],{'id-AAA':3,'id-BBB':3})
        self.assertEqual(D(r['open_nav_after']),D('999.24'))
        self.assertEqual(r['state']['unsettled'],[])
        components=sum((D(t['spread_cost_dollars'])+D(t['slippage_cost_dollars'])+D(t['rounding_cost_dollars'])+D(t['fee_cents'])/100 for t in p['trades']),D(0))
        self.assertEqual(components,D('0.76'))

    def test_existing_holdings_sells_buys_cash_reconciliation(self):
        f=fixture(positions={'id-AAA':10},cash=54800);p=planned(f);r=run(f)['sessions'][0]
        self.assertEqual(p['trades'],r['trades'])
        # Sell 8: floor(8*29.99*.999*100)-25=23943; buy2: ceil(2*30.01*1.001*100)+25=6034.
        self.assertEqual([(t['side'],t['shares'],t['amount_cents']) for t in p['trades']],[('sell',8,23943),('buy',2,6034)])
        self.assertEqual(r['state']['settled_cash_cents'],48766)
        self.assertEqual(r['state']['unsettled'][0]['amount_cents'],23943)
        self.assertEqual(r['state']['unsettled'][0]['due_date'],'2026-10-02')
        self.assertEqual(D(r['open_nav_after']),D('847.09'))
        a=p['baseline_adapter'];self.assertEqual(a['equity_cents'],100000);self.assertEqual(a['holdings'],{'id-AAA':10})
        self.assertEqual(a['signal'],generate(f['model']['payload'],f['model']['context'],decision_at=f['model']['decision_at'],equity_cents=100000,held_symbols=['AAA']))

    def test_subcent_prices_round_cash_once_per_order(self):
        f=fixture(bid='10.000001',ask='10.000001',slip='0',fee=0);p=planned(f);r=run(f)['sessions'][0]
        # Nine shares =90.000009 ->9001 cents; never round the unit first.
        self.assertEqual([t['shares'] for t in p['trades']],[9,9]);self.assertEqual([t['amount_cents'] for t in p['trades']],[9001,9001])
        self.assertEqual(r['state']['settled_cash_cents'],81998);self.assertEqual(D(p['open_nav_after']),D('999.980018'))

    def test_subcent_sale_rounds_down(self):
        f=fixture(positions={'id-AAA':3},cash=86440,bid='10.000001',ask='10.000001',fee=1,slip='0')
        for b in f['model']['payload']['bars']:
            if b['symbol']=='AAA':b['volume']=100000
        f['session']['quotes'][0]['prior_adv20_shares']=100000
        t=planned(f)['trades'][0];self.assertEqual((t['side'],t['shares'],t['amount_cents']),('sell',3,2999))

    def test_positive_and_negative_gaps_share_rules(self):
        for price,qty in [('60',1),('10',9)]:
            with self.subTest(price=price):
                f=fixture(positions={'id-AAA':2},cash=90960,bid=price,ask=price,fee=0,slip='0');p=planned(f);r=run(f)['sessions'][0]
                self.assertEqual(p['trades'],r['trades']);self.assertEqual(r['state']['positions'],{'id-AAA':qty,'id-BBB':qty})
                self.assertTrue(all(n*D(price)<=D(p['open_nav_after'])/10 for n in r['state']['positions'].values()))

    def test_post_cost_boundary_cannot_use_precost_cap(self):
        f=fixture(bid='10',ask='10',fee=1,slip='0');p=planned(f)
        self.assertEqual([t['shares'] for t in p['trades']],[9,9]);self.assertEqual(D(p['open_nav_after']),D('999.98'))

    def test_insufficient_settled_cash_and_no_sale_reuse(self):
        f=fixture(cash=100,positions={'id-AAA':20},bid='30',ask='30',fee=0,slip='0');p=planned(f);r=run(f)['sessions'][0]
        self.assertEqual([(t['side'],t['shares']) for t in p['trades']],[('sell',18)])
        self.assertEqual(r['state']['settled_cash_cents'],100);self.assertEqual(r['state']['unsettled'][0]['amount_cents'],54000)
        self.assertEqual(p['cash_constraints'],[dict(security_id='id-BBB',reason='settled_cash_limit',requested=2,shares=0)])
        row2=session_row(f['calendar'],r['state'],'2026-10-02');r2=run(f,[dict(session=f['session'],model=f['model']),dict(session=row2)])
        self.assertEqual(r2['state']['settled_cash_cents'],54100);self.assertEqual(r2['state']['unsettled'],[])

    def test_partial_buy_uses_only_affordable_whole_shares(self):
        f=fixture(cash=3100,positions={'id-AAA':20},bid='30',ask='30',fee=0,slip='0');p=planned(f)
        self.assertEqual(p['cash_constraints'][0]['shares'],1);self.assertEqual(p['projected_open_state']['settled_cash_cents'],100)
        self.assertEqual(p['trades'][-1]['shares'],1)

    def test_dividend_receivable_survives_sale_and_pays_later(self):
        f=fixture(cash=54800,positions={'id-AAA':10},bid='30',ask='30',fee=0,slip='0')
        for b in f['model']['payload']['bars']:
            if b['symbol']=='AAA':b['volume']=100000
        f['session']['quotes'][0]['prior_adv20_shares']=100000
        f['session']['events']=[dividend(f)]
        for q in f['session']['quotes']:
            if q['security_id']=='id-AAA':q['bid']=q['ask']='44.2'
        r=run(f);s=r['state'];self.assertNotIn('id-AAA',s['positions'])
        self.assertEqual(s['receivables'][0]['entitled_shares'],10);self.assertEqual(D(s['receivables'][0]['amount']),10)
        self.assertEqual(s['settled_cash_cents'],45800);self.assertEqual(s['unsettled'][0]['amount_cents'],44200)
        rows=[dict(session=f['session'],model=f['model']),dict(session=session_row(f['calendar'],s,'2026-10-02'))]
        s2=run(f,rows)['state'];self.assertEqual(s2['settled_cash_cents'],90000);self.assertEqual(len(s2['receivables']),1)
        rows.append(dict(session=session_row(f['calendar'],s2,'2026-10-05')));r3=run(f,rows)
        self.assertEqual(r3['state']['settled_cash_cents'],91000);self.assertEqual(r3['state']['receivables'],[])
        self.assertEqual(D(r3['sessions'][-1]['close_nav']),1000)
        self.assertEqual(r3['sessions'][-1]['events'][0]['kind'],'dividend_payment')

    def test_ex_date_buyer_does_not_receive_others_dividend(self):
        f=fixture(fee=0,slip='0');f['session']['events']=[dividend(f)];r=run(f)
        self.assertIn('id-AAA',r['state']['positions']);self.assertEqual(r['state']['receivables'],[])
        self.assertEqual(r['sessions'][0]['events'][0]['shares'],0)

    def test_dividend_rounding_only_at_payment(self):
        f=fixture(positions={'id-AAA':3},cash=86440,fee=0,slip='0');f['session']['events']=[dividend(f,'0.005','2026-10-02T09:00:00-04:00')]
        r=run(f,[dict(session=f['session'])]);s=r['state'];self.assertEqual(s['receivables'][0]['amount'],'0.015');self.assertEqual(s['settled_cash_cents'],86440)
        row2=session_row(f['calendar'],s,'2026-10-02');r2=run(f,[dict(session=f['session']),dict(session=row2)])
        self.assertEqual(r2['state']['settled_cash_cents'],86442);self.assertEqual(r2['sessions'][-1]['events'][0]['rounding_dollars'],'0.005')

    def test_split_and_rename_preserve_economic_identity(self):
        f=fixture(positions={'id-AAA':2},cash=90960,fee=0,slip='0',bid='22.6',ask='22.6');f['session']['events']=[event(f,'split',numerator=2,denominator=1)]
        for m in f['session']['close_marks']:m['price']='22.6'
        r=run(f,[dict(session=f['session'])]);s=r['state'];self.assertEqual(s['positions'],{'id-AAA':4});self.assertEqual(D(r['sessions'][0]['close_nav']),1000)
        row2=session_row(f['calendar'],s,'2026-10-02',bid='22.6',ask='22.6',close='22.6')
        row2['events']=[dict(event_id='SYNTHETIC-rename',security_id='id-AAA',type='rename',old_symbol='AAA',new_symbol='XYZ',effective_at=row2['open_at'],available_at=row2['actions_available_at'])]
        for q in row2['quotes']+row2['close_marks']:
            if q['security_id']=='id-AAA':q['symbol']='XYZ'
        r2=run(f,[dict(session=f['session']),dict(session=row2)])
        self.assertEqual(r2['state']['positions'],{'id-AAA':4});self.assertEqual(r2['state']['symbols']['id-AAA'],'XYZ');self.assertEqual(D(r2['sessions'][-1]['close_nav']),1000)

    def test_reverse_split_whole_entitlement(self):
        f=fixture(positions={'id-AAA':4},cash=81920,fee=0,slip='0',bid='90.4',ask='90.4');f['session']['events']=[event(f,'split',numerator=1,denominator=2)]
        for m in f['session']['close_marks']:m['price']='90.4'
        r=run(f,[dict(session=f['session'])]);self.assertEqual(r['state']['positions']['id-AAA'],2);self.assertEqual(D(r['sessions'][0]['close_nav']),1000)

    def test_unsupported_events_and_fractional_entitlements_invalidate(self):
        for kind,fields in [('delisting',{}),('merger',{}),('spin_off',{}),('split',dict(numerator=1,denominator=2))]:
            f=fixture(positions={'id-AAA':3},cash=86440);f['session']['events']=[event(f,kind,**fields)];before=deepcopy(f)
            with self.subTest(kind=kind),self.assertRaises(ValueError):run(f)
            self.assertEqual(f,before)
        f=fixture();f['session']['events']=[dividend(f)];f['session']['events'][0]['due_bill']=True
        with self.assertRaises(ValueError):run(f)

    def test_duplicate_events_same_day_and_across_days_rejected(self):
        f=fixture(positions={'id-AAA':2},cash=90960);e=event(f,'split',numerator=2,denominator=1);f['session']['events']=[e,deepcopy(e)]
        with self.assertRaisesRegex(ValueError,'Duplicate corporate event'):run(f)
        f['session']['events']=[e];s=run(f,[dict(session=f['session'])])['state'];row2=session_row(f['calendar'],s,'2026-10-02');row2['events']=[{**e,'effective_at':row2['open_at']}]
        with self.assertRaisesRegex(ValueError,'Duplicate corporate event'):run(f,[dict(session=f['session']),dict(session=row2)])

    def test_stale_future_missing_quotes_fail_atomic(self):
        for key,value in [('observed_at','2026-10-01T13:28:00Z'),('available_at','2026-10-01T13:30:01Z'),('tradable',False),('bid_size',0),('prior_adv20_shares',1)]:
            f=fixture(positions={'id-AAA':10},cash=54800);f['session']['quotes'][0][key]=value;before=deepcopy(f)
            with self.subTest(key=key),self.assertRaises(ValueError):run(f)
            self.assertEqual(f,before)
        f=fixture();f['session']['quotes'].pop()
        with self.assertRaises(ValueError):run(f)

    def test_missing_close_or_date_never_skipped(self):
        f=fixture();f['session']['close_marks'].pop()
        with self.assertRaisesRegex(ValueError,'Missing held-security close'):run(f)
        f=fixture();s=run(f)['state'];skipped=session_row(f['calendar'],s,'2026-10-05')
        with self.assertRaisesRegex(ValueError,'Missing/repeated exchange session'):run(f,[dict(session=f['session'],model=f['model']),dict(session=skipped)])

    def test_information_and_identity_attacks_rejected(self):
        for attack in ('price','mark_availability','identity','holdings_override','equity_override','missing_bar','future_bar','calendar','clock'):
            f=fixture()
            if attack=='price':f['account']['marks']['id-AAA']['price']='999'
            elif attack=='mark_availability':f['account']['marks']['id-AAA']['available_at']=f['model']['decision_at']
            elif attack=='identity':f['model']['context']['universe'][0]['security_id']='different-company'
            elif attack=='holdings_override':f['model']['held_symbols']=['AAA']
            elif attack=='equity_override':f['model']['equity_cents']=90000
            elif attack=='missing_bar':f['model']['payload']['bars'].pop(20)
            elif attack=='future_bar':f['model']['payload']['bars'][-3]['available_at']=f['model']['decision_at']
            elif attack=='calendar':f['model']['context']['sessions'][-1]['open_at']='2026-10-01T14:30:00Z'
            else:f['model']['decision_at']='2026-10-01T12:01:00Z'
            with self.subTest(attack=attack),self.assertRaises(ValueError):run(f)

    def test_candidate_and_supplied_signal_remain_blocked(self):
        f=fixture();f['model']['strategy_version']=CANDIDATE
        with self.assertRaisesRegex(ValueError,'blocked'):planned(f)
        f=fixture();f['model']['signal']={'strategy_version':BASELINE}
        with self.assertRaises(ValueError):planned(f)

    def test_future_close_cannot_change_open_plan(self):
        f=fixture();r=run(f)
        for m in f['session']['close_marks']:m['price']='999'
        r2=run(f);self.assertEqual(r['sessions'][0]['trades'],r2['sessions'][0]['trades']);self.assertEqual(r['sessions'][0]['baseline_adapter'],r2['sessions'][0]['baseline_adapter'])
        with self.assertRaisesRegex(ValueError,'future close'):plan_baseline(f['account'],f['model'],f['session'],**options(f))

    def test_future_model_prices_do_not_change_plan(self):
        f=fixture();p=planned(f)
        for b in f['model']['payload']['bars']:
            if b['session_date']=='2026-10-01':
                for k in ('open','high','low','close'):b[k]='999'
        self.assertEqual(p,planned(f))

    def test_deterministic_no_mutation_and_decimal_context(self):
        f=fixture();before=deepcopy(f);a=run(f)
        with localcontext() as ctx:
            ctx.prec=6;ctx.rounding=ROUND_DOWN;ctx.traps[Inexact]=True;b=run(f)
        self.assertEqual(a,b);self.assertEqual(f,before);self.assertEqual(a,run(f))

    def test_malformed_money_and_quantities_rejected(self):
        for bad in (float('nan'),'NaN','Infinity','-1','1.0000001'):
            f=fixture();f['session']['quotes'][0]['bid']=bad
            with self.assertRaises(ValueError):planned(f)
        for bad in (True,-1,1.5):
            f=fixture();f['account']['positions']['id-AAA']=bad
            with self.assertRaises(ValueError):planned(f)

    def test_coverage_late_events_and_date_labels_rejected(self):
        for kind in ('coverage','late_event','wrong_day','large_dividend','future_volume'):
            f=fixture()
            if kind=='coverage':f['session']['actions_complete']=False
            elif kind=='late_event':f['session']['events']=[event(f,'split',numerator=2,denominator=1)];f['session']['events'][0]['available_at']=f['session']['open_at']
            elif kind=='wrong_day':f['session']['date']='2026-10-02'
            elif kind=='future_volume':f['session']['quotes'][0]['volume_available_at']=f['session']['open_at']
            else:f['session']['events']=[dividend(f,'12')]
            with self.subTest(kind=kind),self.assertRaises(ValueError):run(f)

    def test_close_cannot_replace_open_evidence(self):
        f=fixture();p=planned(f);f['session']['close_at']='2026-10-02T20:00:00Z'
        with self.assertRaisesRegex(ValueError,'evidence changed'):close_session(p,f['session'])


    def test_monthly_decision_cannot_be_omitted(self):
        f=fixture()
        with self.assertRaisesRegex(ValueError,'Monthly baseline decision'):
            replay(f['account'],[dict(session=f['session'])],**options(f))
        f['session']['kind']='historical_price_proxy'
        with self.assertRaisesRegex(ValueError,'synthetic'):
            replay(f['account'],[dict(session=f['session'])],**options(f),mode='accounting_fixture')

    def test_payment_at_open_is_available_but_intraday_payment_is_not(self):
        f=fixture(cash=100,positions={'id-AAA':20},fee=0,slip='0',bid='30',ask='30')
        f['session']['events']=[dividend(f,'2','2026-10-01T09:30:00-04:00')]
        p=planned(f)
        self.assertEqual(p['trades'][-1]['side'],'buy');self.assertEqual(p['trades'][-1]['shares'],1)
        self.assertEqual(p['projected_open_state']['settled_cash_cents'],1100)
        f['session']['events'][0]['pay_at']='2026-10-01T10:00:00-04:00'
        r=run(f)['sessions'][0]
        self.assertTrue(all(t['side']=='sell' for t in r['trades']))
        self.assertEqual(r['state']['settled_cash_cents'],4100)

    def test_past_sale_loses_entitlement_future_sale_retains_it(self):
        f=fixture(cash=90960,positions={'id-AAA':2},fee=0,slip='0')
        # Accounting-only explicit liquidation tests the same execution kernel.
        p=plan_open(f['account'],opening(f['session']),{'id-AAA':0},decision_id='SYNTHETIC-exit',**options(f))
        s=close_session(p,f['session'])['state']
        row2=session_row(f['calendar'],s,'2026-10-02')
        row2['events']=[{**dividend(f),'effective_at':row2['open_at']}]
        r=replay(s,[dict(session=row2)],**options(f),mode='accounting_fixture')
        self.assertEqual(r['state']['receivables'],[])
        self.assertEqual([e['shares'] for e in r['sessions'][0]['events'] if e['kind']=='dividend_entitlement'],[0])

    def test_split_at_rebalance_uses_post_split_quantities(self):
        f=fixture(positions={'id-AAA':2},cash=90960,fee=0,slip='0',bid='22.6',ask='22.6')
        f['session']['events']=[event(f,'split',numerator=2,denominator=1)]
        p=planned(f)
        self.assertEqual(p['projected_open_state']['positions']['id-AAA'],4)
        self.assertFalse(any(t['security_id']=='id-AAA' for t in p['trades']))
        self.assertEqual(p['trades'],run(f)['sessions'][0]['trades'])

    def test_model_action_history_reconciles_at_next_month(self):
        f=fixture(cash=90960,positions={'id-AAA':2},fee=0,slip='0',bid='30',ask='30')
        f['session']['events']=[dividend(f)]
        r=run(f);s=r['state']
        # Advance every session with the actual replay, never skipping dates.
        for session in f['calendar']['sessions']:
            if '2026-10-01'<session['date']<='2026-10-30':
                row=session_row(f['calendar'],s,session['date'])
                s=replay(s,[dict(session=row)],**options(f))['state']
        model=deepcopy(f['model']);model['decision_at']='2026-11-02T13:00:00Z'
        model['payload']['retrieved_at']='2026-11-02T14:00:00Z'
        context=model['context'];context['sessions']=deepcopy(f['calendar']['sessions'])
        context['universe_session']='2026-10-30';context['actions_coverage_end']='2026-10-30'
        context['actions']=[dict(symbol='AAA',session_date='2026-10-01',available_at='2026-09-30T22:00:00Z',split_ratio='1',cash_dividend_per_old_share='1',source_id='SYNTHETIC-event-1')]
        # Synthetic raw closes match every recorded October closing mark.
        model['payload']['bars']=[b for b in model['payload']['bars'] if b['session_date']<'2026-10-01']
        for session in f['calendar']['sessions']:
            if '2026-10-01'<=session['date']<='2026-10-30':
                for sym in ('AAA','BBB'):
                    model['payload']['bars'].append(dict(symbol=sym,session_date=session['date'],status='complete',completed_at=session['close_at'],available_at=session['close_at'],open='30',high='30',low='30',close='30',volume=2000000))
        nextrow=session_row(f['calendar'],s,'2026-11-02')
        a=signal_from_account(s,model,f['calendar'])
        # Original $909.60 cash + two shares marked $30 + $2 entitlement = $971.60;
        # zero-cost reallocations and flat subsequent marks conserve that value.
        self.assertEqual(a['equity_cents'],97160)
        expected=generate(model['payload'],context,decision_at=model['decision_at'],equity_cents=97160,held_symbols=['AAA','BBB'])
        self.assertEqual(a['signal'],expected)
        p=plan_baseline(s,model,opening(nextrow),**options(f))
        rr=replay(s,[dict(session=nextrow,model=model)],**options(f))
        self.assertEqual(p['trades'],rr['sessions'][0]['trades'])
        for corrupted in ([],[{**context['actions'][0],'cash_dividend_per_old_share':'1.01'}]):
            bad=deepcopy(model);bad['context']['actions']=corrupted
            with self.assertRaisesRegex(ValueError,'corporate-action histories disagree'):
                signal_from_account(s,bad,f['calendar'])

    def test_identity_change_without_rename_and_rename_collision(self):
        f=fixture();f['session']['quotes'][0]['symbol']='XYZ'
        with self.assertRaisesRegex(ValueError,'identity'):run(f)
        f=fixture();f['session']['events']=[event(f,'rename',old_symbol='AAA',new_symbol='BBB')]
        with self.assertRaisesRegex(ValueError,'collision'):run(f)

    def test_negative_proceeds_and_insufficient_ask_size_fail_whole_plan(self):
        f=fixture(positions={'id-AAA':2},cash=90960,fee=10000,bid='30',ask='30',slip='0')
        with self.assertRaisesRegex(ValueError,'Fee exceeds sale'):run(f)
        f=fixture();f['session']['quotes'][1]['ask_size']=0;before=deepcopy(f)
        with self.assertRaisesRegex(ValueError,'liquidity'):run(f)
        self.assertEqual(f,before)


    def test_adjusted_prices_wrong_currency_and_double_spread_rejected(self):
        for key,value in [('price_adjustment','split_adjusted'),('currency','EUR')]:
            f=fixture();f['session'][key]=value
            with self.assertRaisesRegex(ValueError,'Raw USD'):run(f)
        f=fixture();f['costs']['half_spread_bps']='5'
        with self.assertRaisesRegex(ValueError,'already includes spread'):run(f)


    def test_cli_replays_and_refuses_overwrite_or_partial_results(self):
        import json,subprocess,sys,tempfile
        from pathlib import Path
        f=fixture();payload=dict(initial_account=f['account'],rows=[dict(session=f['session'],model=f['model'])],**options(f))
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'fixture.json';output=Path(tmp)/'result.json';source.write_text(json.dumps(payload))
            cmd=[sys.executable,'-m','analytics.stock_baseline_replay_v2','--input',str(source),'--output',str(output)]
            first=subprocess.run(cmd,capture_output=True,text=True)
            self.assertEqual(first.returncode,0,first.stderr)
            self.assertEqual(json.loads(output.read_text()),run(f));saved=output.read_bytes()
            self.assertNotEqual(subprocess.run(cmd,capture_output=True).returncode,0)
            self.assertEqual(output.read_bytes(),saved)
            payload['rows'][0]['session']['quotes'][1]['tradable']=False;source.write_text(json.dumps(payload))
            output2=Path(tmp)/'must-not-exist.json';cmd[-1]=str(output2)
            self.assertNotEqual(subprocess.run(cmd,capture_output=True).returncode,0)
            self.assertFalse(output2.exists())


    def test_split_converts_prior_volume_to_execution_share_units(self):
        f=fixture(fee=0,slip='0',bid='30',ask='30')
        f['session']['events']=[event(f,'split',numerator=2,denominator=1)]
        f['session']['quotes'][0]['prior_adv20_shares']=200
        # 1% of 200 old shares = 4 new shares after 2-for-1; three-share order fits.
        p=plan_open(f['account'],opening(f['session']),{'id-AAA':10000},decision_id='SYNTHETIC-volume',**options(f))
        self.assertEqual(p['trades'][0]['shares'],3)
        f['session']['events']=[]
        with self.assertRaisesRegex(ValueError,'liquidity'):
            plan_open(f['account'],opening(f['session']),{'id-AAA':10000},decision_id='SYNTHETIC-volume',**options(f))


    def test_prior_adv_is_normalized_for_historical_splits(self):
        f=fixture();day=f['model']['context']['sessions'][-12]['date']
        f['model']['context']['actions']=[dict(symbol='AAA',session_date=day,available_at='2026-09-30T22:00:00Z',split_ratio='2',cash_dividend_per_old_share='0',source_id='SYNTHETIC-history-split')]
        for b in f['model']['payload']['bars']:
            if b['symbol']=='AAA' and b['session_date']>=day:
                for k in ('open','high','low','close'):b[k]=str(D(b[k])/2)
                b['volume']*=2
        f['account']['marks']['id-AAA']['price']='22.6'
        f['session']['quotes'][0]['prior_adv20_shares']=4000000
        self.assertEqual(planned(f)['baseline_adapter']['prior_adv20_shares']['id-AAA'],4000000)
        f['session']['quotes'][0]['prior_adv20_shares']=2000000
        with self.assertRaisesRegex(ValueError,'liquidity disagrees'):planned(f)


class SettlementV2Tests(unittest.TestCase):
    def policy(self,start,end,days):return dict(version='us-regular-way-settled-only-v1',coverage_complete=True,revision='SYNTHETIC',coverage_start=start,coverage_end=end,business_dates=days)
    def test_t3_t2_transition_and_holiday(self):
        p=self.policy('2017-09-01','2017-09-08',['2017-09-01','2017-09-05','2017-09-06','2017-09-07','2017-09-08'])
        self.assertEqual(settlement_date('2017-09-01',p),'2017-09-07');self.assertEqual(settlement_date('2017-09-05',p),'2017-09-07')
    def test_t2_t1_transition_and_holiday(self):
        p=self.policy('2024-05-24','2024-05-31',['2024-05-24','2024-05-28','2024-05-29','2024-05-30','2024-05-31'])
        self.assertEqual(settlement_date('2024-05-24',p),'2024-05-29');self.assertEqual(settlement_date('2024-05-28',p),'2024-05-29')
    def test_trading_day_need_not_be_settlement_day(self):
        p=self.policy('2026-10-09','2026-10-14',['2026-10-09','2026-10-13','2026-10-14'])
        self.assertEqual(settlement_date('2026-10-09',p),'2026-10-13');self.assertEqual(settlement_date('2026-10-12',p),'2026-10-13')
    def test_incomplete_future_calendar_rejected(self):
        p=self.policy('2026-10-09','2026-10-09',['2026-10-09'])
        with self.assertRaises(ValueError):settlement_date('2026-10-09',p)


if __name__=='__main__':unittest.main()
