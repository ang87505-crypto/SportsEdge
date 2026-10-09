"""ALL prices, dividends, calendars and securities here are synthetic fixtures."""
import unittest
from copy import deepcopy
from datetime import date,datetime,timedelta,timezone
from decimal import Decimal,localcontext
from zoneinfo import ZoneInfo
from analytics.stock_momentum_v1 import generate,total_return_index,sized_shares,VERSION


def fixture(symbols=('AAA','BBB')):
    # Weekdays are deliberately a SYNTHETIC calendar, not an exchange calendar.
    end=date(2026,9,30);days=[];d=end
    while len(days)<253:
        if d.weekday()<5:days.append(d)
        d-=timedelta(days=1)
    days=days[::-1]+[date(2026,10,1)]
    ny=ZoneInfo('America/New_York');sessions=[];bars=[]
    for i,day in enumerate(days):
        op=datetime.combine(day,datetime.min.time(),ny).replace(hour=9,minute=30)
        cl=op.replace(hour=16,minute=0)
        sessions.append({'date':str(day),'open_at':op.isoformat(),'close_at':cl.isoformat()})
        for sym in symbols:
            price=str(Decimal(20)+Decimal(i)/10)
            bars.append(dict(symbol=sym,session_date=str(day),status='complete',completed_at=cl.isoformat(),available_at=(cl+timedelta(minutes=1)).isoformat(),open=price,high=price,low=price,close=price,volume=2000000))
    at='2026-10-01T12:00:00Z';available='2026-09-30T22:00:00Z'
    return dict(payload=dict(asset_class='us_equities',timeframe='1d',currency='USD',price_adjustment='raw',provider='synthetic-only',source_revision='synthetic-v1',retrieved_at='2026-10-02T00:00:00Z',bars=bars),context=dict(calendar_revision='synthetic-calendar',calendar_available_at=available,universe_revision='synthetic-universe',universe_available_at=available,universe_session=str(end),actions_revision='synthetic-actions',actions_available_at=available,actions_complete=True,actions_coverage_start=str(days[0]),actions_coverage_end=str(end),sessions=sessions,actions=[],universe=[dict(symbol=s,security_id='id-'+s,sector='sector'+str(i//2),type='common_stock',exchange='NYSE') for i,s in enumerate(symbols)]),decision_at=at)

class StockMomentumTests(unittest.TestCase):
    def test_known_momentum_and_targets(self):
        r=generate(**fixture());self.assertEqual(r['strategy_version'],VERSION)
        self.assertEqual([x['symbol'] for x in r['targets']],['AAA','BBB'])
        self.assertEqual(r['cash_target_cents'],80000)
        self.assertAlmostEqual(float(r['scores'][0]['momentum']),43.1/20-1)
        self.assertEqual(r['fills'],[])
    def test_future_price_changes_do_not_change_signal(self):
        f=fixture();r=generate(**f)
        for b in f['payload']['bars']:
            if b['session_date']=='2026-10-01':
                for k in ('open','high','low','close'):b[k]='9999'
        self.assertEqual(r,generate(**f))
    def test_input_order_does_not_change_signal(self):
        f=fixture();r=generate(**f);f['payload']['bars'].reverse();f['context']['universe'].reverse()
        self.assertEqual(r,generate(**f))
    def test_same_instant_bar_is_not_visible(self):
        f=fixture();f['payload']['bars'][-3]['available_at']=f['decision_at']
        with self.assertRaises(ValueError):generate(**f)
    def test_missing_data_fails_no_forward_fill(self):
        f=fixture();f['payload']['bars'].pop(20)
        with self.assertRaises(ValueError):generate(**f)
    def test_monthly_next_open_timing(self):
        for at in ['2026-10-01T13:30:00Z','2026-09-30T12:00:00Z']:
            f=fixture();f['decision_at']=at
            with self.assertRaises(ValueError):generate(**f)
    def test_split_and_dividend_formula(self):
        D=Decimal
        self.assertEqual(total_return_index([D(100),D(50)],[D(2)],[D(0)]),[D(1),D(1)])
        self.assertEqual(total_return_index([D(100),D(99)],[D(1)],[D(1)]),[D(1),D(1)])
        self.assertEqual(total_return_index([D(100),D(49)],[D(2)],[D(2)]),[D(1),D(1)])
    def test_split_adjustment_preserves_momentum(self):
        f=fixture();r=generate(**f);day=f['context']['sessions'][100]['date']
        f['context']['actions']=[dict(symbol='AAA',session_date=day,available_at=f['context']['actions_available_at'],split_ratio='2',cash_dividend_per_old_share='0',source_id='synthetic-split')]
        for b in f['payload']['bars']:
            if b['symbol']=='AAA' and b['session_date']>=day:
                for k in ('open','high','low','close'):b[k]=str(Decimal(b[k])/2)
                b['volume']*=2
        adjusted=generate(**f)
        self.assertEqual(Decimal(r['scores'][0]['momentum']),Decimal(adjusted['scores'][0]['momentum']))
    def test_action_coverage_required(self):
        for key,val in [('actions_complete',False),('actions_coverage_start','2026-09-30'),('actions_available_at','2026-10-01T12:00:00Z')]:
            f=fixture();f['context'][key]=val
            with self.assertRaises(ValueError):generate(**f)
    def test_action_future_availability_rejected(self):
        f=fixture();f['context']['actions']=[dict(symbol='AAA',session_date='2026-09-30',available_at=f['decision_at'],split_ratio='1',cash_dividend_per_old_share='1',source_id='synthetic')]
        with self.assertRaises(ValueError):generate(**f)
    def test_universe_visibility_and_stable_ids(self):
        f=fixture();f['context']['universe_available_at']=f['decision_at']
        with self.assertRaises(ValueError):generate(**f)
        f=fixture();f['context']['universe'][1]['security_id']='id-AAA'
        with self.assertRaises(ValueError):generate(**f)
    def test_max_five_sector_limit_and_cash(self):
        f=fixture(tuple('ABCDEFG'));r=generate(**f)
        self.assertEqual(len(r['targets']),5);self.assertEqual(r['cash_target_cents'],50000)
        for u in f['context']['universe']:u['sector']='one'
        self.assertEqual(len(generate(**f)['targets']),2)
    def test_nonqualifying_holding_exits(self):
        f=fixture();f['held_symbols']=['AAA']
        for b in f['payload']['bars']:
            if b['symbol']=='AAA':b['volume']=0
        r=generate(**f);self.assertEqual(r['targets'][0],dict(symbol='AAA',action='EXIT',target_budget_cents=0))
    def test_nonpositive_momentum_no_buy(self):
        f=fixture()
        for b in f['payload']['bars']:
            for k in ('open','high','low','close'):b[k]='20'
        self.assertEqual(generate(**f)['targets'],[])
    def test_explicit_costs_and_whole_share_sizing(self):
        r=sized_shares(10000,'30',slippage_bps='100',fee_cents=25)
        self.assertEqual(r,dict(shares=3,estimated_debit_cents=9115,unspent_cents=885))
        self.assertEqual(sized_shares(100,'30',slippage_bps='100',fee_cents=25)['shares'],0)
        with self.assertRaises(TypeError):sized_shares(10000,'30')
    def test_invalid_inputs_and_deterministic_decimal_context(self):
        for v in ['NaN','-1','Infinity']:
            with self.assertRaises(ValueError):sized_shares(10000,v,slippage_bps='10',fee_cents=0)
        with self.assertRaises(ValueError):generate(**fixture(),equity_cents=True)
        r=generate(**fixture())
        with localcontext() as ctx:
            ctx.prec=7
            self.assertEqual(r,generate(**fixture()))
    def test_early_completion_rejected(self):
        f=fixture();b=f['payload']['bars'][0];b['completed_at']=b['session_date']+'T10:00:00-04:00'
        with self.assertRaises(ValueError):generate(**f)

if __name__=='__main__':unittest.main()
