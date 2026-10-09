"""Experimental EPL forward-only 1X2 Elo forecasts and guarded paper-quote selection.

The bookmaker is NOT a model. Never turn archived/backfilled odds into a live paper bet.
This module makes no real-money transactions and changes no NBA state.
"""
from __future__ import annotations
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from elo_walkforward import load_source, parse_completed, ELO_K, HOME_ADVANTAGE, UPSTREAM_COMMIT

VERSION = 'epl-elo-k20-h65-draw-pre20260408-v1'
DRAW_CUTOFF = '2026-04-08'
SOURCE_FREEZE = '2026-10-08'
SOURCE_LAST_COMPLETE = '2026-09-20'
SEASONS = ('2024-25', '2025-26', '2026-27')
MAPPING = {
 'Arsenal':'Arsenal FC','Leeds United':'Leeds United FC',
 'Aston Villa':'Aston Villa FC','Brentford':'Brentford FC',
 'Chelsea':'Chelsea FC','Bournemouth':'AFC Bournemouth',
 'Ipswich Town':'Ipswich Town FC','Fulham':'Fulham FC',
 'Sunderland':'Sunderland AFC','Brighton and Hove Albion':'Brighton & Hove Albion FC',
 'Manchester United':'Manchester United FC','Tottenham Hotspur':'Tottenham Hotspur FC',
 'Crystal Palace':'Crystal Palace FC','Nottingham Forest':'Nottingham Forest FC',
 'Hull City':'Hull City AFC','Everton':'Everton FC',
 'Liverpool':'Liverpool FC','Manchester City':'Manchester City FC',
 'Coventry City':'Coventry City FC','Newcastle United':'Newcastle United FC',
}

def fit(matches):
    """Frozen baseline from pre-April matches; Elo history uses past completed games only."""
    matches = sorted((m for m in matches if m['date'] < SOURCE_FREEZE),
                     key=lambda m:(m['date'],m['home']))
    if not matches or matches[-1]['date'] > SOURCE_LAST_COMPLETE:
        raise ValueError('Source chronology changed; publish a NEW model version')
    pre = [m for m in matches if m['date'] < DRAW_CUTOFF]
    if len(pre) < 100: raise ValueError('Insufficient earlier completed EPL games')
    draws = sum(m['homeGoals']==m['awayGoals'] for m in pre)
    if not 0 < draws < len(pre): raise ValueError('Invalid pre-period draw frequency')
    ratings = {}
    for m in matches:
        h = ratings.get(m['home'],1500.0)
        a = ratings.get(m['away'],1500.0)
        expected = 1/(1+10**(-(h+HOME_ADVANTAGE-a)/400))
        actual = 1 if m['homeGoals']>m['awayGoals'] else .5 if m['homeGoals']==m['awayGoals'] else 0
        change = ELO_K*(actual-expected)
        ratings[m['home']] = h+change
        ratings[m['away']] = a-change
    return ratings,draws/len(pre),{'rated_games':len(matches),'baseline_games':len(pre),'baseline_draws':draws}

def probability(home,away,ratings,p_draw):
    if home not in MAPPING or away not in MAPPING or home==away: raise ValueError('Unmapped fixture')
    if MAPPING[home] not in ratings or MAPPING[away] not in ratings: raise ValueError('Untrained team')
    d = ratings[MAPPING[home]]+HOME_ADVANTAGE-ratings[MAPPING[away]]
    q = 1/(1+10**(-d/400))
    return {'home':(1-p_draw)*q,'draw':p_draw,'away':(1-p_draw)*(1-q)}

def decimal(odds):
    if type(odds) is not int or abs(odds)<100: raise ValueError('Invalid American odds')
    return 1+(odds/100 if odds>0 else 100/abs(odds))

def when(value):
    timestamp = datetime.fromisoformat(value.replace('Z','+00:00'))
    if timestamp.tzinfo is None: raise ValueError('Timezone required')
    return timestamp.astimezone(timezone.utc)

def select_paper_quote(fixture, probabilities, quotes, now, available_cents):
    """No bet unless a fresh *complete three-way* same-book snapshot has >=2% model EV."""
    current,tip = when(now),when(fixture['starts_at'])
    if current>=tip or type(available_cents) is not int or available_cents<10000: return None
    names = {fixture['home'],'Draw',fixture['away']}
    groups = {}
    for q in quotes:
        if q.get('market')!='h2h' or q.get('line') is not None or q.get('selection') not in names: continue
        try:
            obs,receipt = when(q['observed_at']),when(q['ingested_at'])
            decimal(q['american_odds'])
            if type(q['id']) is not int or q['id']<=0 or not q.get('sportsbook') or not q.get('provider'): continue
        except (KeyError,TypeError,ValueError): continue
        if obs>current or receipt>current or obs>=tip or receipt>=tip: continue
        if (current-obs).total_seconds()>3600 or (current-receipt).total_seconds()>3600: continue
        groups.setdefault((q['sportsbook'],q['provider'],q['observed_at']),[]).append(q)
    candidates=[]
    for group in groups.values():
        if len(group)!=3 or {q['selection'] for q in group}!=names: continue
        implied=[1/decimal(q['american_odds']) for q in group]
        total=sum(implied)
        for q,raw in zip(group,implied):
            direction='draw' if q['selection']=='Draw' else 'home' if q['selection']==fixture['home'] else 'away'
            p=probabilities[direction]
            ev=p*decimal(q['american_odds'])-1
            if ev>=.02 and p>raw/total:
                candidates.append({'quote_id':q['id'],'selection':q['selection'],'american_odds':q['american_odds'],
                                   'probability':p,'no_vig_probability':raw/total,
                                   'expected_return':ev,'stake_cents':math.floor(available_cents*.01)})
    candidates.sort(key=lambda c:(-c['expected_return'],c['quote_id']))
    return candidates[0] if candidates else None

def snapshot(fixtures,source):
    rows=[]
    diagnostics={}
    for season in SEASONS:
        source_rows=source[season]['matches']
        rows.extend(parse_completed(source[season],'en',season))
        diagnostics[season]={'source_fixtures':len(source_rows),
                             'completed_in_snapshot':len(parse_completed(source[season],'en',season))}
    ratings,pdraw,fit_info=fit(rows)
    seen=set()
    forecasts=[]
    for f in fixtures:
        if f['game_id'] in seen: raise ValueError('Duplicate fixture')
        seen.add(f['game_id'])
        if when(f['starts_at'])<=when('2026-10-08T00:00:00Z'): raise ValueError('No retrospective forecasts')
        forecasts.append({**f,'probabilities':probability(f['home'],f['away'],ratings,pdraw)})
    return {'model_version':VERSION,'pinned_source_commit':UPSTREAM_COMMIT,
            'source_latest_result_date':SOURCE_LAST_COMPLETE,
            'historical_coverage':diagnostics,'fit_counts':fit_info,
            'experimental':True,'validated_betting_roi':False,
            'fixture_source':'https://www.premierleague.com/en/news/4688862/fixture-amendments-for-premier-league-matches-in-october-and-november',
            'forecasts':forecasts}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fixtures',required=True,type=Path)
    p.add_argument('--cache-dir',type=Path)
    p.add_argument('--output',required=True,type=Path)
    args=p.parse_args()
    if args.output.exists(): raise FileExistsError('Frozen pregame forecasts are append-only')
    data={s:load_source(s,'en',args.cache_dir) for s in SEASONS}
    out=snapshot(json.loads(args.fixtures.read_text(encoding='utf-8')),data)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as fp: json.dump(out,fp,indent=2)
    print(json.dumps({'forecasts':len(out['forecasts']),'bets':0,'model':VERSION}))

if __name__=='__main__': main()
