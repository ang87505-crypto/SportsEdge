import unittest
from nba_recent_source import reconcile

def fixture():
    e=dict(season_type='2',status_type_completed='true',status_type_name='STATUS_FINAL',date='2024-11-13T00:00Z',time_valid='true',home_abbreviation='BOS',away_abbreviation='ATL',id='espn1',home_score='116',away_score='117',home_id='2',away_id='1',notes_headline='',neutral_site='false')
    n=dict(season_type='regular-season',season='2025',game_id='0022400001',game_date='2024-11-12',home_team_abbreviation='BOS',away_team_abbreviation='ATL',home_pts='116',away_pts='117',home_wl='L',home_team_id='1610612738',away_team_id='1610612737',home_team_name='Boston Celtics',away_team_name='Atlanta Hawks')
    return e,n

class RecentTests(unittest.TestCase):
    def run_fixture(self,e,n):return reconcile(e,n,2025,expected_games=1)
    def test_correct_date_and_ids(self):
        e,n=fixture();g=self.run_fixture([e],[n])[0]
        self.assertEqual(g['home_score'],116);self.assertEqual(g['game_id'],'0022400001')
    def test_mismatch_score(self):
        e,n=fixture();e['home_score']='117'
        with self.assertRaises(ValueError):self.run_fixture([e],[n])
    def test_missing_fixture(self):
        _,n=fixture()
        with self.assertRaises(ValueError):self.run_fixture([],[n])
    def test_duplicate_espn(self):
        e,n=fixture()
        with self.assertRaises(ValueError):self.run_fixture([e,e],[n])
    def test_duplicate_nba(self):
        e,n=fixture()
        with self.assertRaises(ValueError):self.run_fixture([e],[n,n])
    def test_invalid_timezone(self):
        e,n=fixture();e['date']='2024-11-13T00:00'
        with self.assertRaises(ValueError):self.run_fixture([e],[n])
    def test_unfinalized_excluded(self):
        e,n=fixture();e['status_type_completed']='false'
        with self.assertRaises(ValueError):self.run_fixture([e],[n])
    def test_allstar_excluded(self):
        e,n=fixture();extra=dict(e,id='star',home_abbreviation='EAST',notes_headline='NBA All-Star Game')
        self.assertEqual(len(self.run_fixture([e,extra],[n])),1)
    def test_coverage_guard(self):
        e,n=fixture()
        with self.assertRaises(ValueError):reconcile([e],[n],2025)

if __name__=='__main__':unittest.main()
