import unittest
from datetime import datetime, timedelta, timezone
from historical_validation import CompletedGame, OddsObservation, validate_dataset

START = datetime(2026, 10, 8, 20, tzinfo=timezone.utc)
GAME = CompletedGame("provider", "event1", START, "Home", "Away", 2, 1)
ODDS = OddsObservation("provider", "event1", START - timedelta(hours=1), "Book", "Home", -110)

class HistoricalValidationTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate_dataset([GAME], [ODDS])["games_with_pregame_odds"], 1)
    def test_missing_odds_reported(self):
        self.assertEqual(validate_dataset([GAME], [])["games_missing_pregame_odds"], 1)
    def test_duplicate_game(self):
        with self.assertRaises(ValueError): validate_dataset([GAME, GAME], [])
    def test_post_start_odds(self):
        with self.assertRaises(ValueError): validate_dataset([GAME], [OddsObservation("provider", "event1", START, "Book", "Home", -110)])
    def test_wrong_event(self):
        with self.assertRaises(ValueError): validate_dataset([GAME], [OddsObservation("provider", "other", START - timedelta(hours=1), "Book", "Home", -110)])
    def test_duplicate_odds(self):
        with self.assertRaises(ValueError): validate_dataset([GAME], [ODDS, ODDS])
    def test_invalid_score(self):
        with self.assertRaises(ValueError): validate_dataset([CompletedGame("provider", "event1", START, "Home", "Away", -1, 1)], [])
    def test_invalid_selection(self):
        with self.assertRaises(ValueError): validate_dataset([GAME], [OddsObservation("provider", "event1", START - timedelta(hours=1), "Book", "Unknown", -110)])
    def test_naive_timestamp(self):
        with self.assertRaises(ValueError): validate_dataset([CompletedGame("provider", "event1", START.replace(tzinfo=None), "Home", "Away", 2, 1)], [])
    def test_invalid_odds(self):
        with self.assertRaises(ValueError): validate_dataset([GAME], [OddsObservation("provider", "event1", START - timedelta(hours=1), "Book", "Home", 99)])

if __name__ == "__main__": unittest.main()
