"""Reconcile ESPN timed results to NBA Stats season/score records, CC BY 4.0.
Both sources are SportsDataverse mirrors; direct source confirmation is separate.
"""
import argparse
import csv
from datetime import date, datetime
import gzip
import hashlib
import io
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from nba_elo_walkforward import parse_completed_nba, run_nba_walkforward, EloSettings, _home_probability
from calibration_diagnostics import diagnose_binary, ScoredProbability

ALIASES = {'GS': 'GSW', 'NO': 'NOP', 'NY': 'NYK', 'SA': 'SAS', 'UTAH': 'UTA', 'WSH': 'WAS'}


def reconcile(espn, official, season, *, expected_games=1230):
    lookup = {}
    for r in official:
        if r['season_type'] != 'regular-season': continue
        if r['season'] != str(season) or not r['game_id'].startswith('002'):
            raise ValueError('Invalid NBA regular-season identity')
        key = (r['game_date'], r['home_team_abbreviation'], r['away_team_abbreviation'])
        if key in lookup: raise ValueError('Duplicate NBA fixture')
        lookup[key] = r
    if len(lookup) != expected_games: raise ValueError('Unexpected regular-season coverage')
    accepted, seen, identities = [], set(), {}
    for r in espn:
        if r['season_type'] != '2' or r['status_type_completed'] != 'true' or r['status_type_name'] != 'STATUS_FINAL': continue
        starts = datetime.fromisoformat(r['date'].replace('Z', '+00:00'))
        if starts.tzinfo is None or r['time_valid'] != 'true': raise ValueError('Missing valid source tipoff')
        key = (starts.astimezone(ZoneInfo('America/New_York')).date().isoformat(), ALIASES.get(r['home_abbreviation'], r['home_abbreviation']), ALIASES.get(r['away_abbreviation'], r['away_abbreviation']))
        n = lookup.get(key)
        if n is None:
            # All-star and cup final are specifically outside NBA regular season.
            if 'All-Star' in r['notes_headline'] or ('Championship' in r['notes_headline'] and 'Cup' in r['notes_headline']) or 'Tournament Championship' in r['notes_headline']: continue
            raise ValueError('Unmatched final ESPN fixture: ' + r['id'])
        if key in seen: raise ValueError('Duplicate matched ESPN fixture')
        if int(r['home_score']) != int(n['home_pts']) or int(r['away_score']) != int(n['away_pts']): raise ValueError('Cross-source score disagreement')
        if n['home_wl'] != ('W' if int(n['home_pts']) > int(n['away_pts']) else 'L'): raise ValueError('NBA winner inconsistent')
        for side in ('home', 'away'):
            identity = (r[side+'_id'], n[side+'_team_id'])
            if identity[0] in identities and identities[identity[0]] != identity[1]: raise ValueError('Team ID mapping changed')
            identities[identity[0]] = identity[1]
        seen.add(key)
        accepted.append({'game_id': n['game_id'], 'espn_event_id': r['id'], 'starts_at': starts.isoformat(), 'home_team_id': n['home_team_id'], 'away_team_id': n['away_team_id'], 'home_name': n['home_team_name'], 'away_name': n['away_team_name'], 'home_score': int(n['home_pts']), 'away_score': int(n['away_pts']), 'season_type': 'regular', 'status': 'final', 'season': season, 'neutral_site': r['neutral_site'] == 'true'})
    if seen != set(lookup): raise ValueError('NBA games missing from timed ESPN finals')
    return accepted


def load_sources(folder, manifest):
    data, provenance = [], []
    for e, n in zip(manifest['espn'], manifest['nba']):
        if e['season'] != n['season']: raise ValueError('Manifest seasons disagree')
        files = []
        for entry, prefix in [(e, ''), (n, 'official_')]:
            raw = (folder / (prefix + entry['name'])).read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry['sha256']: raise ValueError('Source hash mismatch')
            content = gzip.decompress(raw) if entry['name'].endswith('.gz') else raw
            files.append(list(csv.DictReader(io.StringIO(content.decode('utf-8-sig')))))
            provenance.append(entry)
        data.extend(reconcile(files[0], files[1], e['season']))
    payload = {'competition': 'nba', 'source': 'SportsDataverse ESPN + NBA Stats reconciliation', 'source_revision': hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest(), 'games': data}
    games, _ = parse_completed_nba(payload)
    return payload, games


def rating_snapshot(games):
    config, ratings = EloSettings(), {}
    days = {}
    for g in games: days.setdefault(g.utc_day, []).append(g)
    for day in sorted(days):
        batch = days[day]
        forecasts = [_home_probability(ratings.get(g.home_team_id,1500), ratings.get(g.away_team_id,1500), config) for g in batch]
        for g,p in zip(batch,forecasts):
            delta = config.k_factor * (int(g.home_won)-p)
            ratings[g.home_team_id] = ratings.get(g.home_team_id,1500)+delta
            ratings[g.away_team_id] = ratings.get(g.away_team_id,1500)-delta
    return ratings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path,required=True)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    manifest=json.loads(args.manifest.read_text())
    payload,games=load_sources(args.folder,manifest)
    report=run_nba_walkforward(games,start=date(2024,10,1),end=date(2026,6,30))
    report['source_manifest']=manifest
    report['score_cross_source_reconciliation']='All admitted scores/teams/game dates agree between ESPN and NBA Stats mirrors; direct originals not independently audited'
    report['calibration']=diagnose_binary(ScoredProbability(p['game_id'],p['home_win_probability'],int(p['home_won'])) for p in report['predictions'])
    report['per_season']={}
    for label,lo,hi in [('2024-25','2024-10-01','2025-06-30'),('2025-26','2025-10-01','2026-06-30')]:
        ps=[p for p in report['predictions'] if lo<=p['starts_at'][:10]<=hi]
        report['per_season'][label]={'games':len(ps),'correct':sum(p['correct'] for p in ps),'accuracy':sum(p['correct'] for p in ps)/len(ps),'baseline_accuracy':sum(p['baseline_correct'] for p in ps)/len(ps)}
    report['ratings']=rating_snapshot(games)
    report['ratings_as_of']=max(g.starts_at for g in games).isoformat()
    report['team_names']={g[s+'_team_id']:g[s+'_name'] for g in payload['games'] for s in ('home','away')}
    report['source_revision']=payload['source_revision']
    with args.output.open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
    print(json.dumps({k:v for k,v in report.items() if k not in ('predictions','source_manifest','calibration','ratings','team_names')},indent=2))


if __name__=='__main__': main()
