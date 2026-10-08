"""Date-only historical NBA benchmark; never represents actual tipoff timestamps.

Source: FiveThirtyEight nbaallelo.csv, CC BY 4.0, via Basketball-Reference.
No publisher Elo ratings or forecast columns are used as model inputs.
"""
import argparse
import csv
from datetime import date, datetime, time, timezone
import hashlib
import io
import json
from pathlib import Path

from nba_elo_walkforward import NBAGame, run_nba_walkforward
from calibration_diagnostics import ScoredProbability, diagnose_binary

SOURCE_BLOB = '6d6ccd07151aed322e1a77c57ea83b8ea58c5523'
SOURCE_URL = 'https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-elo/nbaallelo.csv'


def adapt_rows(rows, first_season=2010, last_season=2015):
    """Select non-neutral NBA regular-season games and reconcile both team rows.

    UTC midnight is solely an internal grouping proxy for the declared game
    date. It is removed from public output; no tipoff or as-of claim is made.
    """
    if type(first_season) is not int or type(last_season) is not int or first_season > last_season:
        raise ValueError('Invalid season bounds')
    pairs = {}
    excluded = {'outside_seasons': 0, 'other_leagues': 0, 'playoffs': 0, 'neutral_rows': 0}
    for row in rows:
        if row['lg_id'] != 'NBA':
            excluded['other_leagues'] += 1
            continue
        season = int(row['year_id'])
        if not first_season <= season <= last_season:
            excluded['outside_seasons'] += 1
            continue
        if row['is_playoffs'] not in ('0', '1'):
            raise ValueError('Unknown season type')
        if row['is_playoffs'] == '1':
            excluded['playoffs'] += 1
            continue
        if row['game_location'] == 'N':
            excluded['neutral_rows'] += 1
            continue
        if row['game_location'] not in ('H', 'A') or not row['game_id']:
            raise ValueError('Invalid event location or ID')
        pairs.setdefault(row['game_id'], []).append(row)
    games = []
    for event_id, pair in pairs.items():
        if len(pair) != 2 or {r['game_location'] for r in pair} != {'H', 'A'}:
            raise ValueError('Missing or duplicate opponent row: ' + event_id)
        h = next(r for r in pair if r['game_location'] == 'H')
        a = next(r for r in pair if r['game_location'] == 'A')
        if h['team_id'] != a['opp_id'] or h['opp_id'] != a['team_id'] or h['date_game'] != a['date_game'] or h['year_id'] != a['year_id']:
            raise ValueError('Inconsistent opponent identity/date')
        hs, aws = int(h['pts']), int(h['opp_pts'])
        if hs != int(a['opp_pts']) or aws != int(a['pts']) or min(hs, aws) < 0 or hs == aws:
            raise ValueError('Inconsistent or invalid final score')
        if h['game_result'] != ('W' if hs > aws else 'L') or a['game_result'] != ('L' if hs > aws else 'W'):
            raise ValueError('Winner disagrees with scores')
        if h['fran_id'] == h['opp_fran'] or h['fran_id'] != a['opp_fran'] or h['opp_fran'] != a['fran_id']:
            raise ValueError('Inconsistent franchise identity')
        day = datetime.strptime(h['date_game'], '%m/%d/%Y').date()
        games.append(NBAGame(event_id, datetime.combine(day, time(), timezone.utc), h['fran_id'], h['opp_fran'], hs, aws))
    if not games:
        raise ValueError('No eligible games')
    return sorted(games, key=lambda g: (g.utc_day, g.game_id)), excluded


def evaluate_bytes(raw):
    blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if blob != SOURCE_BLOB:
        raise ValueError('Source differs from pinned Git blob; audit before proceeding')
    games, excluded = adapt_rows(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
    # Fixed before examining evaluation outcomes; no parameter search.
    result = run_nba_walkforward(games, start=date(2013, 10, 1), end=date(2015, 6, 30))
    result['study'] = 'Historical date-grouped NBA Elo benchmark, 2013-14 and 2014-15; not current or forward performance'
    for prediction in result['predictions']:
        prediction['game_date'] = prediction.pop('starts_at')[:10]
    result['date_semantics'] = 'Publisher game dates, timezone unspecified; internal midnight grouping proxy is not an actual tipoff'
    result['source_manifest'] = {'publisher': 'FiveThirtyEight', 'upstream_declared': 'Basketball-Reference', 'license': 'CC BY 4.0', 'url': SOURCE_URL, 'git_blob_sha1': blob, 'sha256': hashlib.sha256(raw).hexdigest(), 'first_season': 2010, 'last_season': 2015, 'excluded_source_rows': excluded, 'opponent_rows_reconciled': True, 'independent_official_score_audit': False}
    result['calibration'] = diagnose_binary(ScoredProbability(p['game_id'], p['home_win_probability'], int(p['home_won'])) for p in result['predictions'])
    result['per_season'] = {}
    for label, lo, hi in [('2013-14', '2013-10-01', '2014-06-30'), ('2014-15', '2014-10-01', '2015-06-30')]:
        picks = [p for p in result['predictions'] if lo <= p['game_date'] <= hi]
        result['per_season'][label] = {'games': len(picks), 'correct': sum(p['correct'] for p in picks), 'accuracy': sum(p['correct'] for p in picks) / len(picks), 'baseline_accuracy': sum(p['baseline_correct'] for p in picks) / len(picks)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = evaluate_bytes(args.input.read_bytes())
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('predictions', 'calibration')}, indent=2))


if __name__ == '__main__':
    main()
