"""Synthetic chronology fixtures; not basketball evidence."""
import unittest
from copy import deepcopy
from analytics.nba_quant_audit import replay, paired_week_bootstrap


def game(i,when,season,won=True):
    return dict(game_id=str(i),starts_at=when,season=season,home_team_id='A',away_team_id='B',home_score=110 if won else 90,away_score=100,status='final',season_type='regular')

class QuantAuditTests(unittest.TestCase):
    def rows(self):
        return [game(1,'2023-01-01T12:00:00+00:00',2023),game(2,'2023-01-01T20:00:00+00:00',2023),game(3,'2023-01-02T12:00:00+00:00',2023),game(4,'2023-10-01T12:00:00+00:00',2024)]
    def test_same_day_no_hindsight(self):
        a=replay(self.rows()); self.assertEqual(a[0]['p'],a[1]['p'])
        r=self.rows();r[0]['home_score']=80;b=replay(r)
        self.assertEqual(a[1]['p'],b[1]['p']);self.assertNotEqual(a[2]['p'],b[2]['p'])
    def test_future_mutation_preserves_past(self):
        r=self.rows(); a=replay(r);r[-1]['home_score']=80
        self.assertEqual([v['p'] for v in a],[v['p'] for v in replay(r)])
    def test_carry_applied_once_at_boundary(self):
        r=self.rows(); a=replay(r);b=replay(r,.75);z=replay(r,0)
        self.assertEqual(a[:3],b[:3]);self.assertLess(b[-1]['p'],a[-1]['p'])
        self.assertAlmostEqual(z[-1]['p'],1/(1+10**(-65/400)))
    def test_order_invariance(self):
        r=self.rows();self.assertEqual(replay(r),replay(r[::-1]))
    def test_invalid_input(self):
        for carry in [True,float('nan'),-1,1.1]:
            with self.assertRaises(ValueError):replay(self.rows(),carry)
        for field,value in [('home_score',True),('season',2025),('status','pending'),('away_team_id','A')]:
            r=self.rows();r[0][field]=value
            with self.assertRaises(ValueError):replay(r)
        with self.assertRaises(ValueError):replay(self.rows()*2)
    def test_paired_bootstrap_reproducible_and_identity(self):
        r=replay([game(i,f'2023-01-{i:02}T12:00:00+00:00',2023) for i in range(1,22)])
        self.assertEqual(paired_week_bootstrap(r,r,reps=100)['percentile_95'],[0,0])
        c=deepcopy(r);c[0]['p']=.5
        self.assertEqual(paired_week_bootstrap(r,c,reps=100),paired_week_bootstrap(r,c,reps=100))
        c[0]['game_id']='bad'
        with self.assertRaises(ValueError):paired_week_bootstrap(r,c,reps=100)

if __name__=='__main__':unittest.main()
