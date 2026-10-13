"""Independent replay and fixed offseason-regression experiment; no ledger writes.

Candidate frozen before evaluation: K20/H65, 75% carryover toward 1500.
Validation 2023-24, previously exposed temporal tests 2024-25/2025-26.
No historical season is represented as a fresh untouched holdout.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import random
from statistics import mean
try:
    from .calibration_diagnostics import ScoredProbability, diagnose_binary
except ImportError:
    from calibration_diagnostics import ScoredProbability, diagnose_binary

VERSION = 'nba-elo-k20-h65-carry75-research-v1'
AUDIT_VERSION = 'nba-quant-audit-v1'


def replay(rows, carry=1.0):
    """Independent implementation with explicit season labels and UTC-day batches.

    Scores are historical finals, not timestamped availability observations.
    Returns forecasts for all supplied seasons, including warmup.
    """
    if type(carry) not in (float, int) or not math.isfinite(carry) or not 0 <= carry <= 1:
        raise ValueError('carry must be finite in [0,1]')
    if not rows:
        raise ValueError('empty dataset')
    seen, fixtures, batches = set(), set(), defaultdict(list)
    from datetime import datetime, timezone
    for r in rows:
        for k in ('game_id', 'home_team_id', 'away_team_id'):
            if not isinstance(r[k], str) or not r[k].strip():
                raise ValueError('invalid identity')
        t = datetime.fromisoformat(r['starts_at'].replace('Z', '+00:00'))
        if t.tzinfo is None or t.utcoffset() is None:
            raise ValueError('timezone required')
        day = t.astimezone(timezone.utc).date()
        if type(r['season']) is not int or not date(r['season']-1, 7, 1) <= day < date(r['season'], 7, 1):
            raise ValueError('season/date mismatch')
        key = (t, r['home_team_id'], r['away_team_id'])
        if r['game_id'] in seen or key in fixtures or r['home_team_id'] == r['away_team_id']:
            raise ValueError('duplicate or invalid fixture')
        if r.get('status') != 'final' or r.get('season_type') != 'regular':
            raise ValueError('final regular games required')
        if any(type(r[k]) is not int or r[k] < 0 for k in ('home_score','away_score')) or r['home_score'] == r['away_score']:
            raise ValueError('invalid score')
        seen.add(r['game_id']); fixtures.add(key)
        batches[day].append(r)
    ratings, result, last_season = {}, [], None
    for day, batch in sorted(batches.items()):
        seasons = {r['season'] for r in batch}
        if len(seasons) != 1:
            raise ValueError('mixed seasons on one day')
        season = next(iter(seasons))
        if last_season is not None and season != last_season:
            if season != last_season+1:
                raise ValueError('missing season; do not silently carry stale ratings')
            ratings = {t:1500 + carry*(v-1500) for t,v in ratings.items()}
        last_season = season
        batch = sorted(batch, key=lambda r:(r['starts_at'],r['game_id']))
        forecasts = []
        for r in batch:
            h, a = (ratings.get(r[k],1500.0) for k in ('home_team_id','away_team_id'))
            p = max(1e-6,min(1-1e-6,1/(1+10**(-(h+65-a)/400))))
            forecasts.append(p)
            result.append({'game_id':r['game_id'],'day':day.isoformat(),'season':season,
                           'p':p,'y':int(r['home_score']>r['away_score'])})
        for r,p in zip(batch,forecasts):
            delta = 20*(int(r['home_score']>r['away_score'])-p)
            for key,change in [('home_team_id',delta),('away_team_id',-delta)]:
                t=r[key]; ratings[t]=ratings.get(t,1500.0)+change
    return result


def diagnostics(rows):
    return diagnose_binary(ScoredProbability(r['game_id'],r['p'],r['y']) for r in rows)


def paired_week_bootstrap(base, candidate, reps=2000, seed=20261009):
    """Paired nonoverlapping calendar-week cluster bootstrap, fixed seed.

    Keeps games inside weeks together; does not eliminate team/season dependence.
    Percentile 95% interval for candidate-minus-base mean log loss.
    """
    if type(reps) is not int or reps < 100 or len(base) != len(candidate) or not base:
        raise ValueError('invalid paired bootstrap inputs')
    weeks=defaultdict(list)
    for a,b in zip(base,candidate):
        if (a['game_id'],a['day'],a['y']) != (b['game_id'],b['day'],b['y']):
            raise ValueError('unmatched predictions')
        loss=lambda r:-math.log(r['p'] if r['y'] else 1-r['p'])
        d=date.fromisoformat(a['day']); iso=d.isocalendar()
        weeks[(iso.year,iso.week)].append(loss(b)-loss(a))
    values=[(sum(v),len(v)) for _,v in sorted(weeks.items())]
    if len(values)<2: raise ValueError('need multiple weeks')
    rng=random.Random(seed); draws=[]
    for _ in range(reps):
        sample=rng.choices(values,k=len(values))
        draws.append(sum(s for s,n in sample)/sum(n for s,n in sample))
    draws.sort()
    return {'difference':sum(s for s,n in values)/sum(n for s,n in values),
            'percentile_95':[draws[int(.025*(reps-1))],draws[int(.975*(reps-1))]],
            'weeks':len(values),'replicates':reps,'seed':seed}


def audit(folder, manifest_path, summary_path, predictions_path):
    from nba_recent_source import load_sources
    manifest=json.loads(Path(manifest_path).read_text())
    payload,_=load_sources(Path(folder),manifest)
    rows=payload['games']; base=replay(rows); candidate=replay(rows,.75)
    old=json.loads(Path(predictions_path).read_text())
    if isinstance(old,dict): old=old['predictions']
    stored={r['game_id']:r for r in old}
    evaluated=[r for r in base if r['season'] in (2025,2026)]
    if set(stored)!= {r['game_id'] for r in evaluated}: raise ValueError('stored sample differs')
    for r in evaluated:
        s=stored[r['game_id']]
        if abs(r['p']-s['home_win_probability'])>1e-12 or r['y']!=int(s['home_won']):
            raise ValueError('per-game reproduction mismatch')
    summary=json.loads(Path(summary_path).read_text())
    d=diagnostics(evaluated)
    for old_key,new_key in [('accuracy','classification_accuracy'),('brier','brier_score'),('log_loss','log_loss')]:
        if abs(summary[old_key]-d[new_key])>1e-12: raise ValueError('summary differs')
    training=[r for r in base if r['season']<2025]
    prior=(sum(r['y'] for r in training)+1)/(len(training)+2)
    constant=[dict(r,p=prior) for r in evaluated]
    coin=[dict(r,p=.5) for r in evaluated]
    per_season={}
    for season in (2024,2025,2026):
        b=[r for r in base if r['season']==season]; c=[r for r in candidate if r['season']==season]
        per_season[str(season)]={'role':'validation' if season==2024 else 'previously_exposed_temporal_test',
                                 'base':diagnostics(b),'carry75':diagnostics(c),
                                 'paired_log_loss':paired_week_bootstrap(b,c)}
    c=[r for r in candidate if r['season'] in (2025,2026)]
    # Audit the actual cross-midnight exposure risk for recurring teams.
    from datetime import datetime
    last={}; gaps=[]
    for r in sorted(rows,key=lambda r:r['starts_at']):
        t=datetime.fromisoformat(r['starts_at'])
        for team in (r['home_team_id'],r['away_team_id']):
            if team in last:gaps.append((t-last[team]).total_seconds()/3600)
            last[team]=t
    return {'audit_version':AUDIT_VERSION,'candidate_version':VERSION,'main_sha':'261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72',
            'source_revision':payload['source_revision'],'source_manifest':manifest,
            'source_files_hash_verified':8,'reconciled_games':len(rows),
            'per_game_reproduction_matches':len(evaluated),'baseline':d,
            'home_frequency_baseline':diagnostics(constant),'coin_baseline':diagnostics(coin),
            'always_home_correct':sum(r['y'] for r in evaluated),
            'candidate':diagnostics(c),'per_season':per_season,
            'paired_log_loss':paired_week_bootstrap(evaluated,c),
            'minimum_team_tipoff_gap_hours':min(gaps),
            'neutral_site_regular_games':sum(bool(r.get('neutral_site')) for r in rows),
            'protocol':{'warmup':'2022-23','validation':'2023-24','exposed_tests':['2024-25','2025-26'],
                        'untouched_holdout':'2026-27 future regular season; no observations yet',
                        'candidate_carry':.75,'parameters_tuned':False,'promotion':False},
            'source_independently_verified':False,'historical_odds_available':False,'roi':None}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--folder',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args(); root=Path(__file__).resolve().parents[1]/'src/data/research'
    report=audit(a.folder,root/'nba_recent_sources.json',root/'nba_recent_summary.json',root/'nba_recent_predictions.json')
    with a.output.open('x') as f: json.dump(report,f,indent=2,allow_nan=False); f.write('\n')
    print(json.dumps({k:report[k] for k in ('per_game_reproduction_matches','paired_log_loss','minimum_team_tipoff_gap_hours','neutral_site_regular_games','protocol')},indent=2))

if __name__=='__main__':main()
