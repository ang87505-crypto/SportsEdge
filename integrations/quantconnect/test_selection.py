"""All observations and identifiers are SYNTHETIC; no trading results."""
import unittest
from datetime import date, datetime, timedelta
from decimal import Decimal as D
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from .selection import BASELINE, CANDIDATE, SourceNotReady, choose, evaluate_month, total_return
except ImportError:
    from selection import BASELINE, CANDIDATE, SourceNotReady, choose, evaluate_month, total_return


def fixture(names=tuple("ABCDEFGHIJK")):
    days = []
    day = date(2026, 9, 30)
    while len(days) < 253:
        if day.weekday() < 5:
            days.append(day)
        day -= timedelta(days=1)
    days.reverse()  # Synthetic weekdays; NOT an independently audited calendar.
    zone = ZoneInfo("America/New_York")
    sessions = []
    for d in days:
        sessions.append({"date":d.isoformat(), "close_at":datetime(d.year,d.month,d.day,16,tzinfo=zone).isoformat()})
    members = []
    for j, sym in enumerate(names):
        # Declining slope generates strictly ordered momentum ranks A..K.
        step = D(11-j) / D(100)
        bars=[]
        for i, d in enumerate(days):
            price = str(D(50) + step*i)
            bars.append({"date":d.isoformat(), "close":price,"volume":2_000_000,
                         "split_ratio":"1", "cash_dividend_per_old_share":"0",
                         "completed_at":sessions[i]["close_at"],
                         "available_at":datetime(d.year,d.month,d.day,16,1,tzinfo=zone).isoformat()})
        members.append(dict(security_id="id-"+sym,symbol=sym,sector="sector"+str(j//2),
                            exchange="NYSE",type="common_stock",first_traded_on="1990-01-01",
                            first_trade_available_at="2026-09-30T17:00:00-04:00",bars=bars))
    return dict(universe=members,sessions=sessions,
                next_session={"date":"2026-10-01","open_at":"2026-10-01T09:30:00-04:00"},
                decision_at="2026-10-01T08:00:00-04:00", equity_cents=100000,
                incumbent_ids=(),strategy_version=BASELINE,source_complete=True)


class FrozenSelectionTests(unittest.TestCase):
    def test_exact_total_return_arithmetic(self):
        self.assertEqual(total_return([D(100),D(50)],[D(2)],[D(0)]),[D(1),D(1)])
        self.assertEqual(total_return([D(100),D(99)],[D(1)],[D(1)]),[D(1),D(1)])
        self.assertEqual(total_return([D(100),D(49)],[D(2)],[D(2)]),[D(1),D(1)])

    def test_registered_baseline_five_names_cash_and_sector(self):
        output=evaluate_month(**fixture())
        self.assertEqual({r['security_id'] for r in output['targets'] if r['action']=='TARGET'},
                         {'id-A','id-B','id-C','id-D','id-E'})
        self.assertEqual(output['cash_target_cents'],50000)
        self.assertIsNone(output['performance'])
        self.assertEqual(output['status'],'RESEARCH_TARGETS_ONLY_NOT_EXECUTABLE')
        self.assertEqual(output['declared_members'],11)

    def test_candidate_retains_rank_6_and_drops_rank_11(self):
        data=fixture();data['strategy_version']=CANDIDATE
        data['incumbent_ids']=('id-F',)
        selected=evaluate_month(**data)
        self.assertEqual({r['security_id'] for r in selected['targets'] if r['action']=='TARGET'},
                         {'id-A','id-B','id-C','id-D','id-F'})
        data['incumbent_ids']=('id-K',)
        result=evaluate_month(**data)
        self.assertEqual(next(x['action'] for x in result['targets'] if x['security_id']=='id-K'),'EXIT')

    def test_baseline_exits_unselected_old_holding(self):
        data=fixture();data['incumbent_ids']=('id-F',)
        result=evaluate_month(**data)
        self.assertEqual(next(x['action'] for x in result['targets'] if x['security_id']=='id-F'),'EXIT')

    def test_sector_limit(self):
        data=fixture()
        for member in data['universe']:member['sector']='ONE'
        result=evaluate_month(**data)
        self.assertEqual(sum(x['action']=='TARGET' for x in result['targets']),2)
        self.assertEqual(result['cash_target_cents'],80000)

    def test_no_eligible_positive_momentum(self):
        data=fixture()
        for member in data['universe']:
            for bar in member['bars']:bar['close']='50'
        self.assertEqual(evaluate_month(**data)['targets'],[])

    def test_reject_missing_row_future_availability_duplicate_identity(self):
        for kind in ('missing','future','identity'):
            data=fixture()
            if kind=='missing':data['universe'][0]['bars'].pop(4)
            elif kind=='future':data['universe'][0]['bars'][-1]['available_at']=data['decision_at']
            else:data['universe'][1]['security_id']='id-A'
            with self.subTest(kind=kind),self.assertRaises(SourceNotReady):evaluate_month(**data)

    def test_reject_not_declared_complete_or_wrong_decision(self):
        for change in ({'source_complete':False}, {'decision_at':'2026-10-01T09:00:00-04:00'},
                       {'next_session':{'date':'2026-10-02','open_at':'2026-10-02T09:30:00-04:00'}},
                       {'strategy_version':'something-else'}):
            data=fixture();data.update(change)
            with self.subTest(change=change),self.assertRaises(SourceNotReady):evaluate_month(**data)

    def test_reject_unknown_or_duplicate_incumbents(self):
        for ids in [('id-UNKNOWN',),('id-A','id-A')]:
            data=fixture();data['incumbent_ids']=ids
            with self.assertRaises(SourceNotReady):evaluate_month(**data)

    def test_ipo_explicit_short_history_no_silent_deletion(self):
        data=fixture();member=data['universe'][0]
        member['first_traded_on']=data['sessions'][200]['date']
        member['bars']=member['bars'][200:]
        result=evaluate_month(**data)
        self.assertIn('id-A',result['known_short_history'])
        self.assertEqual(result['declared_members'],11)
        self.assertNotIn('id-A',{x['security_id'] for x in result['targets']})
        data['universe'][0]['bars'].pop()
        with self.assertRaises(SourceNotReady):evaluate_month(**data)

    def test_split_relabel_leaves_momentum_and_liquidity_unchanged(self):
        data=fixture(names=('AAA',));original=evaluate_month(**data)
        member=data['universe'][0]
        for i,bar in enumerate(member['bars']):
            if i>=100:
                bar['close']=str(D(bar['close'])/2)
                bar['volume']*=2
                if i==100:bar['split_ratio']='2'
        changed=evaluate_month(**data)
        self.assertEqual(D(original['scores'][0]['momentum']),D(changed['scores'][0]['momentum']))
        self.assertEqual(D(original['scores'][0]['mean_dollar_volume_20']),D(changed['scores'][0]['mean_dollar_volume_20']))

    def test_symbol_tie_break(self):
        data=fixture(names=('B','A'))
        data['universe'][1]['bars'] = [dict(row) for row in data['universe'][0]['bars']]
        score=evaluate_month(**data)['scores']
        self.assertEqual([v['symbol'] for v in sorted(score,key=lambda s:(-D(s['momentum']),s['symbol']))],['A','B'])

    def test_source_script_is_research_only(self):
        text=Path(__file__).with_name('main.py').read_text()
        for forbidden in ('.market_order(','.set_holdings(','.liquidate(','.stop_market_order('):
            self.assertNotIn(forbidden,text)
        self.assertIn('return []',text)


if __name__=='__main__':unittest.main()
