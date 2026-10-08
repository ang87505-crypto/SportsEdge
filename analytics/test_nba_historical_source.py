import unittest
from nba_historical_source import adapt_rows, evaluate_bytes


def pair():
    common = dict(lg_id='NBA', year_id='2014', is_playoffs='0', game_id='sample', date_game='11/1/2013')
    return [dict(common, game_location='H', team_id='BOS', opp_id='NYK', fran_id='Celtics', opp_fran='Knicks', pts='100', opp_pts='90', game_result='W'), dict(common, game_location='A', team_id='NYK', opp_id='BOS', fran_id='Knicks', opp_fran='Celtics', pts='90', opp_pts='100', game_result='L')]


class SourceTests(unittest.TestCase):
    def test_pair_reconciles_once(self):
        games, _ = adapt_rows(pair())
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0].home_score, 100)
        self.assertEqual(str(games[0].utc_day), '2013-11-01')

    def test_order_invariant(self):
        self.assertEqual(adapt_rows(pair()), adapt_rows(pair()[::-1]))

    def test_missing_opponent_rejected(self):
        with self.assertRaises(ValueError): adapt_rows(pair()[:1])

    def test_duplicate_rejected(self):
        with self.assertRaises(ValueError): adapt_rows(pair() + pair())

    def test_score_disagreement_rejected(self):
        rows = pair(); rows[1]['pts'] = '89'
        with self.assertRaises(ValueError): adapt_rows(rows)

    def test_identity_disagreement_rejected(self):
        rows = pair(); rows[1]['team_id'] = 'LAL'
        with self.assertRaises(ValueError): adapt_rows(rows)

    def test_winner_disagreement_rejected(self):
        rows = pair(); rows[0]['game_result'] = 'L'
        with self.assertRaises(ValueError): adapt_rows(rows)

    def test_playoff_excluded(self):
        excluded = pair()
        for r in excluded: r['is_playoffs'] = '1'; r['game_id'] = 'playoff'
        games, counts = adapt_rows(pair() + excluded)
        self.assertEqual(len(games), 1); self.assertEqual(counts['playoffs'], 2)

    def test_neutral_excluded(self):
        excluded = pair()
        for r in excluded: r['game_location'] = 'N'
        self.assertEqual(adapt_rows(pair() + excluded)[1]['neutral_rows'], 2)

    def test_source_fingerprint_rejected(self):
        with self.assertRaises(ValueError): evaluate_bytes(b'changed source')

    def test_publisher_forecast_not_used(self):
        rows = pair()
        for r in rows: r['forecast'] = 'garbage'; r['elo_i'] = 'garbage'
        self.assertEqual(adapt_rows(rows), adapt_rows(pair()))


if __name__ == '__main__': unittest.main()
