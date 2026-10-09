import unittest
from datetime import datetime, timezone, timedelta
from epl_forward_paper import MAPPING, VERSION, probability, decimal, select_paper_quote, fit

NOW=datetime(2026,10,8,22,tzinfo=timezone.utc)
def stamp(t):return t.isoformat().replace('+00:00','Z')
FIX={'home':'Arsenal','away':'Leeds United','starts_at':stamp(NOW+timedelta(days=2))}
def prices(age=20):
    t=stamp(NOW-timedelta(seconds=age))
    return [dict(id=i,sportsbook='fanduel',provider='the_odds_api',market='h2h',line=None,
                 selection=s,american_odds=o,observed_at=t,ingested_at=t)
            for i,(s,o) in enumerate([('Arsenal',-125),('Draw',310),('Leeds United',350)],1)]

class ForwardEplTests(unittest.TestCase):
    def test_probability_sum_and_team_identity(self):
        p=probability('Arsenal','Leeds United',{MAPPING['Arsenal']:1700,MAPPING['Leeds United']:1500},.23)
        self.assertAlmostEqual(sum(p.values()),1)
        self.assertEqual(p['draw'],.23)
        with self.assertRaises(ValueError):probability('Unknown','Leeds United',{},.23)
    def test_prices_and_protection(self):
        self.assertAlmostEqual(decimal(-120),1+100/120)
        self.assertAlmostEqual(decimal(150),2.5)
        for o in [0,99,-99,120.2,True]:
            with self.assertRaises(ValueError):decimal(o)
    def test_paper_requires_three_outcomes_fresh_complete_market(self):
        p={'home':.62,'draw':.25,'away':.13}
        result=select_paper_quote(FIX,p,prices(),stamp(NOW),100000)
        self.assertEqual(result['selection'],'Arsenal')
        self.assertEqual(result['stake_cents'],1000)
        self.assertGreaterEqual(result['expected_return'],.02)
        self.assertIsNone(select_paper_quote(FIX,p,prices()[:2],stamp(NOW),100000))
        self.assertIsNone(select_paper_quote(FIX,p,prices(3601),stamp(NOW),100000))
        wrong=prices();wrong[0]['sportsbook']='other'
        self.assertIsNone(select_paper_quote(FIX,p,wrong,stamp(NOW),100000))
        wrong=prices();wrong[1]['observed_at']=stamp(NOW-timedelta(seconds=10))
        self.assertIsNone(select_paper_quote(FIX,p,wrong,stamp(NOW),100000))
        self.assertIsNone(select_paper_quote(FIX,p,prices(),FIX['starts_at'],100000))
        self.assertIsNone(select_paper_quote(FIX,p,prices(),stamp(NOW),9900))
    def test_draw_can_be_pick(self):
        ps=prices();ps[1]['american_odds']=500
        result=select_paper_quote(FIX,{'home':.37,'draw':.4,'away':.23},ps,stamp(NOW),100000)
        self.assertEqual(result['selection'],'Draw')
    def test_no_weak_model_or_future_result_leakage(self):
        entries=[{'date':'2025-01-%02d'%d,'home':'Arsenal FC','away':'Leeds United FC',
                  'homeGoals':1,'awayGoals':0} for d in range(1,10)]
        entries.append(dict(date='2026-10-10',home='Arsenal FC',away='Leeds United FC',homeGoals=99,awayGoals=0))
        with self.assertRaises(ValueError):fit(entries)

if __name__=='__main__': unittest.main()
