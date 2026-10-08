"""Validate historical games and pregame odds before backtesting."""
from dataclasses import dataclass
from datetime import datetime

@dataclass(frozen=True)
class CompletedGame:
    provider: str
    event_id: str
    starts_at: datetime
    home: str
    away: str
    home_score: int
    away_score: int

@dataclass(frozen=True)
class OddsObservation:
    provider: str
    event_id: str
    observed_at: datetime
    sportsbook: str
    selection: str
    american_odds: int

def _aware(value: datetime) -> bool:
    return isinstance(value, datetime) and value.tzinfo is not None and value.utcoffset() is not None

def validate_dataset(games: list[CompletedGame], odds: list[OddsObservation]) -> dict[str, int]:
    """Reject invalid/duplicate observations and odds recorded after kickoff."""
    by_id: dict[tuple[str, str], CompletedGame] = {}
    for game in games:
        key = (game.provider, game.event_id)
        if not all(isinstance(v, str) and v.strip() for v in (game.provider, game.event_id, game.home, game.away)):
            raise ValueError("Game identity and teams must be nonempty")
        if key in by_id:
            raise ValueError("Duplicate provider event ID")
        if not _aware(game.starts_at):
            raise ValueError("Game start must be timezone-aware")
        if game.home.strip().casefold() == game.away.strip().casefold():
            raise ValueError("Home and away teams cannot match")
        if any(type(score) is not int or score < 0 for score in (game.home_score, game.away_score)):
            raise ValueError("Scores must be nonnegative integers")
        by_id[key] = game
    seen: set[tuple[str, str, str, str, datetime]] = set()
    covered: set[tuple[str, str]] = set()
    for observation in odds:
        key = (observation.provider, observation.event_id)
        if key not in by_id:
            raise ValueError("Odds must reference a known provider event")
        if not all(isinstance(v, str) and v.strip() for v in (observation.sportsbook, observation.selection)):
            raise ValueError("Sportsbook and selection are required")
        if not _aware(observation.observed_at):
            raise ValueError("Odds observation must be timezone-aware")
        if observation.observed_at >= by_id[key].starts_at:
            raise ValueError("Odds observation must precede game start")
        if type(observation.american_odds) is not int or -100 < observation.american_odds < 100:
            raise ValueError("Invalid American odds")
        if observation.selection.strip().casefold() not in {
            by_id[key].home.strip().casefold(), by_id[key].away.strip().casefold(), "draw"
        }:
            raise ValueError("Selection does not match game teams or draw")
        fingerprint = (*key, observation.sportsbook.strip().casefold(), observation.selection.strip().casefold(), observation.observed_at)
        if fingerprint in seen:
            raise ValueError("Duplicate odds observation")
        seen.add(fingerprint)
        covered.add(key)
    return {
        "completed_games": len(games),
        "pregame_odds_observations": len(odds),
        "games_with_pregame_odds": len(covered),
        "games_missing_pregame_odds": len(games) - len(covered),
    }
