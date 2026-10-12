"""Synthetic fixtures only. Invariance tests address actual leakage failure modes."""
import copy
from datetime import date,timedelta
from decimal import Decimal,ROUND_HALF_UP
import unittest
from analytics.nba_research_audit_20261012 import (replay,fit_calibration,candidate_predictions,
    choose_validation,pick,profit_cents,paired,bet_summary,read_games,run,MODELS)


def game(i, day, season='2008-09', home='A', away='B', y=1):
    return dict(id=str(i),date=date.fromisoformat(day),season=season,home=home,away=away,y=y,ho=-110,ao=-110)


def dataset():
    rows=[]
    for year in range(2007,2018):
        for j in range(30):
            rows.append(game(len(rows),(date(year,11,1)+timedelta(days=j)).isoformat(),
                             f'{year}-{(year+1)%100:02}',y=int((j+year)%3!=0)))
    return rows


class IndependentNbaAuditTests(unittest.TestCase):
    def test_same_day_and_future_outcomes_cannot_change_predictions(self):
        rs=[game(1,'2008-11-01'),game(2,'2008-11-01',home='A',away='C'),game(3,'2008-11-02')]
        first=replay(rs);changed=copy.deepcopy(rs);changed[0]['y']=0
        second=replay(changed)
        self.assertEqual([r['p'] for r in first[:2]],[r['p'] for r in second[:2]])
        self.assertNotEqual(first[2]['p'],second[2]['p'])
        changed=copy.deepcopy(rs);changed[-1]['y']=0
        self.assertEqual([r['p'] for r in first],[r['p'] for r in replay(changed)])
        self.assertEqual(first,replay(rs[::-1]))

    def test_full_pipeline_future_mutation_preserves_fit_selection_and_past(self):
        rows=dataset();a,fa=candidate_predictions(rows)
        for r in rows:
            if r['season']>='2016-17':r['y']=1-r['y']
        b,fb=candidate_predictions(rows)
        self.assertEqual(fa,fb);self.assertEqual(choose_validation(a),choose_validation(b))
        for model in MODELS:
            self.assertEqual([r['p'] for r in a[model] if r['season']<'2016-17'],
                             [r['p'] for r in b[model] if r['season']<'2016-17'])

    def test_calibration_rejects_test_rows(self):
        rs=replay(dataset())
        with self.assertRaisesRegex(ValueError,'training-only'):fit_calibration(rs)

    def test_identity_continuity_and_season_regression(self):
        rs=[game(1,'2007-11-01','2007-08',home='SEA'),game(2,'2008-11-01',home='OKC')]
        legacy=replay(rs);canonical=replay(rs,identity=True)
        self.assertGreater(canonical[-1]['p'],legacy[-1]['p'])
        reset=replay(rs,identity=True,carry=0)
        self.assertAlmostEqual(reset[-1]['p'],reset[0]['p'])
        self.assertEqual(replay(rs,identity=True,carry=.75)[0]['p'],canonical[0]['p'])
        for bad in (True,-1,1.1,float('nan')):
            with self.assertRaises(ValueError):replay(rs,carry=bad)

    def test_payout_all_archive_range_matches_decimal_reference(self):
        for o in list(range(-2000,-99))+list(range(100,2001)):
            ref=int((Decimal(1000)*(Decimal(o)/100 if o>0 else Decimal(100)/abs(o))).quantize(Decimal(1),rounding=ROUND_HALF_UP))
            self.assertEqual(profit_cents(o,True),ref)
            self.assertEqual(profit_cents(o,False),-1000)
        self.assertEqual(profit_cents(-1600,True),63) # half cent rounds UP, not conservative floor

    def test_selection_ignores_outcome_and_rejects_missing_or_invalid_markets(self):
        r=dict(game(1,'2008-11-01'),p=.60)
        a=pick(r);r['y']=0;b=pick(r)
        self.assertEqual(a['side'],b['side']);self.assertNotEqual(a['profit'],b['profit'])
        for ho,ao in [(None,-110),(-900,-900),(150,150)]:
            self.assertIsNone(pick(dict(r,ho=ho,ao=ao)))
        self.assertIsNone(pick(dict(r,p=.5)))

    def test_day_end_drawdown_does_not_invent_within_day_order(self):
        r1=dict(game(1,'2008-11-01',y=0),p=.6)
        r2=dict(game(2,'2008-11-02',y=1),p=.6)
        report=bet_summary([r1,r2],uncertainty=False)
        self.assertEqual(report['profit_cents'],-91)
        self.assertEqual(report['day_end_max_drawdown_cents'],1000)
        self.assertEqual(report,bet_summary([r2,r1],uncertainty=False))
        self.assertEqual(report['cost_sensitivity_roi']['10'],(-91-20)/2000)

    def test_paired_identity_and_mismatch(self):
        rs=replay(dataset())
        result=paired(rs,rs)
        self.assertEqual(result['weekly_bootstrap']['percentile95'],[0,0])
        bad=copy.deepcopy(rs);bad[0]['id']='oops'
        with self.assertRaises(ValueError):paired(rs,bad)

    def test_duplicate_fixture_different_ids_rejected(self):
        a=game(1,'2008-11-01');b=dict(a,id='2')
        with self.assertRaises(ValueError):replay([a,b])
        with self.assertRaises(ValueError):replay([dict(a,y=True)])

    def test_source_pin_fail_closed(self):
        with self.assertRaisesRegex(ValueError,'source blob'):run(b'fictional',b'fictional')

    def test_parser_home_away_identity_and_date_validation(self):
        header='slugSeason,newGameID,idGame,slugTeam,slugOpp,slugMatchup,dateGame,outcomeGame.team1,teamML.team1,oppML.team1\n'
        row='2008-09,one,one,A,B,A @ B,2008-11-01,W,150,-170\n'
        r=read_games((header+row).encode())[0]
        self.assertEqual((r['home'],r['y'],r['ho']),('B',0,-170))
        with self.assertRaises(ValueError):read_games((header+row.replace('2008-11','2018-11')).encode())

if __name__=='__main__':unittest.main()
