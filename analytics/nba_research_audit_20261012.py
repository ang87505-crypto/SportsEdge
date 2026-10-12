"""Offline, additive NBA audit. Exposed historical prices are scenarios, never fills.

Standard library only. No network, database, provider or betting operations.
CLI verifies pinned input bytes and exclusively creates a new output directory.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import io
from itertools import groupby
import json
import math
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/nba_audit_20261012/protocol.json'
ALIASES = {'SEA': 'OKC', 'NJN': 'BKN', 'NOH': 'NOP'}
BLOB = 'ed143d6e608b21f791b7ff9f2e35577c9aa5997a'
CROSS_BLOB = 'b68b299cdaa6aaa39e4b1c6ab2182d8eeeb23bf2'
MODELS = ['legacy', 'identity', 'identity_carry75', 'identity_calibrated', 'identity_carry75_calibrated']
TRAIN = {'2008-09', '2009-10', '2010-11', '2011-12', '2012-13'}
VALID = {'2013-14', '2014-15', '2015-16'}
TEST = {'2016-17', '2017-18', '2018-19', '2019-20'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git_blob(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def odds(value):
    if value == '':
        return None
    d = Decimal(value)
    require(d.is_finite() and d == int(d) and 100 <= abs(d) <= 100000, 'invalid odds')
    return int(d)


def read_games(raw):
    """Independent parser; check actual fixture identity as well as both source IDs."""
    result, ids, fixtures, official_ids = [], set(), set(), set()
    for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
        t, o = r['slugTeam'], r['slugOpp']
        require(t and o and t != o, 'invalid teams')
        is_home = r['slugMatchup'] == f'{t} vs. {o}'
        require(is_home or r['slugMatchup'] == f'{t} @ {o}', 'ambiguous matchup')
        d, s = date.fromisoformat(r['dateGame']), r['slugSeason']
        require(len(s) == 7 and s[4] == '-' and int(s[5:]) == (int(s[:4])+1)%100, 'season')
        require(date(int(s[:4]), 7, 1) <= d < date(int(s[:4])+1, 7, 1), 'date/season')
        require(r['outcomeGame.team1'] in ('W', 'L'), 'outcome')
        h, a = (t, o) if is_home else (o, t)
        fixture = (d, tuple(sorted((h, a))))
        require(r['newGameID'] and r['newGameID'] not in ids and fixture not in fixtures
                and r['idGame'] and r['idGame'] not in official_ids, 'duplicate game/fixture')
        ids.add(r['newGameID']); fixtures.add(fixture); official_ids.add(r['idGame'])
        x, z = odds(r['teamML.team1']), odds(r['oppML.team1'])
        result.append(dict(id=r['newGameID'], date=d, season=s, home=h, away=a,
                           y=int((r['outcomeGame.team1'] == 'W') == is_home),
                           ho=x if is_home else z, ao=z if is_home else x))
    require(result, 'empty source')
    return sorted(result, key=lambda r: (r['date'], r['id']))


def validate_games(games):
    require(games, 'empty games')
    ids, fixtures = set(), set()
    for r in games:
        require(type(r['y']) is int and r['y'] in (0, 1), 'binary outcome')
        key = (r['date'], tuple(sorted((r['home'], r['away']))))
        require(r['id'] not in ids and key not in fixtures and r['home'] != r['away'], 'duplicate fixture')
        ids.add(r['id']); fixtures.add(key)


def replay(games, *, carry=1.0, identity=False):
    require(type(carry) in (int, float) and math.isfinite(carry) and 0 <= carry <= 1, 'carry')
    validate_games(games)
    ratings, out, last = {}, [], None
    for day, it in groupby(sorted(games, key=lambda r:(r['date'], r['id'])), key=lambda r:r['date']):
        batch = list(it); seasons = {r['season'] for r in batch}
        require(len(seasons) == 1, 'mixed seasons')
        season = next(iter(seasons))
        if last is not None and season != last:
            require(int(season[:4]) == int(last[:4])+1, 'missing season')
            ratings = {t:1500+carry*(v-1500) for t,v in ratings.items()}
        last = season
        updates = defaultdict(float)
        for r in batch:
            h, a = [ALIASES.get(r[k], r[k]) if identity else r[k] for k in ('home','away')]
            require(h != a, 'identity collision')
            p = 1/(1+10**(-(ratings.get(h,1500)+65-ratings.get(a,1500))/400))
            out.append(dict(r, p=p))
            delta = 20*(r['y']-p)
            updates[h] += delta; updates[a] -= delta
        for t, delta in updates.items():
            ratings[t] = ratings.get(t,1500)+delta
    return out


def logit(p):
    require(math.isfinite(p) and 0 < p < 1, 'probability')
    return math.log(p/(1-p))


def sigmoid(x):
    p = 1/(1+math.exp(-x)) if x >= 0 else math.exp(x)/(1+math.exp(x))
    return max(1e-12, min(1-1e-12,p))


def fit_calibration(rows):
    """Two-parameter ridge logistic calibration, only on designated earlier seasons.

    Prior centered at identity (a=0,b=1), fixed precision 1. Newton + line search.
    Reject any non-training record, including an accidentally appended test row.
    """
    require(len(rows) >= 20 and all(r['season'] in TRAIN for r in rows), 'training-only calibration')
    require({r['y'] for r in rows} == {0,1}, 'both classes required')
    xy = [(logit(r['p']), r['y']) for r in rows]
    def objective(a,b):
        total = .5*(a*a+(b-1)**2)
        for x,y in xy:
            z=a+b*x
            total += max(z,0)+math.log1p(math.exp(-abs(z)))-y*z
        return total
    a,b = 0.,1.
    for iteration in range(100):
        ga,gb,haa,hab,hbb = a,b-1,1.,0.,1.
        for x,y in xy:
            p=sigmoid(a+b*x); w=p*(1-p)
            ga+=p-y; gb+=(p-y)*x; haa+=w; hab+=w*x; hbb+=w*x*x
        det=haa*hbb-hab*hab
        require(det>0, 'singular calibration')
        da,db = (hbb*ga-hab*gb)/det, (haa*gb-hab*ga)/det
        if max(abs(da),abs(db)) < 1e-10:
            return dict(intercept=a,slope=b,iterations=iteration,training_games=len(rows),
                        training_last_date=max(r['date'] for r in rows).isoformat(),penalty=1.0)
        old=objective(a,b); scale=1.
        while objective(a-scale*da,b-scale*db)>old+1e-10:
            scale/=2
            require(scale>1e-10, 'calibration line search failed')
        a-=scale*da; b-=scale*db
    raise ValueError('calibration did not converge')


def candidate_predictions(games):
    output={'legacy':replay(games), 'identity':replay(games,identity=True),
            'identity_carry75':replay(games,identity=True,carry=.75)}
    fitted={}
    for name in ('identity','identity_carry75'):
        c=fit_calibration([r for r in output[name] if r['season'] in TRAIN])
        fitted[name+'_calibrated']=c
        output[name+'_calibrated']=[dict(r,p=sigmoid(c['intercept']+c['slope']*logit(r['p']))) for r in output[name]]
    return output,fitted


def market(r):
    if r['ho'] is None or r['ao'] is None:
        return None
    def implied(o):
        return 100/(100+o) if o>0 else abs(o)/(100+abs(o))
    h,a=implied(r['ho']),implied(r['ao'])
    if not 1<h+a<=1.25:
        return None
    return h/(h+a)


def profit_cents(o, won):
    require(type(o) is int and 100<=abs(o)<=100000, 'odds')
    if not won:
        return -1000
    net=Decimal(o)/100 if o>0 else Decimal(100)/abs(o)
    return int((Decimal(1000)*net).quantize(Decimal(1),rounding=ROUND_HALF_UP))


def pick(r, mode='model'):
    q=market(r)
    if q is None:
        return None
    require(mode in ('model','favorite'), 'selection mode')
    if mode=='favorite':
        side=0 if q>=.5 else 1
    else:
        logit(r['p'])
        ev=[p*(1+(o/100 if o>0 else 100/abs(o)))-1 for p,o in ((r['p'],r['ho']),(1-r['p'],r['ao']))]
        side=0 if ev[0]>=ev[1] else 1
        if ev[side]<.02 or (r['p'] if side==0 else 1-r['p']) <= (q if side==0 else 1-q):
            return None
    o=r['ho'] if side==0 else r['ao']; won=(r['y']==1) if side==0 else (r['y']==0)
    prob=r['p'] if side==0 else 1-r['p']
    return dict(side=side,won=won,profit=profit_cents(o,won),
                predicted_ev=prob*(1+(o/100 if o>0 else 100/abs(o)))-1,
                longshot=o>0,probability=prob)


def score(rows):
    require(rows, 'empty scoring sample')
    bins=[]
    for i in range(10):
        rs=[r for r in rows if min(int(r['p']*10),9)==i]
        if rs:
            bins.append(dict(lower=i/10,upper=(i+1)/10,n=len(rs),
                             mean_p=sum(r['p'] for r in rs)/len(rs),rate=sum(r['y'] for r in rs)/len(rs)))
    n=len(rows)
    return dict(games=n,log_loss=sum(-math.log(r['p'] if r['y'] else 1-r['p']) for r in rows)/n,
                brier=sum((r['p']-r['y'])**2 for r in rows)/n,
                accuracy=sum((r['p']>=.5)==bool(r['y']) for r in rows)/n,
                mean_p=sum(r['p'] for r in rows)/n,home_rate=sum(r['y'] for r in rows)/n,
                ece=sum(b['n']*abs(b['mean_p']-b['rate']) for b in bins)/n,bins=bins)


def interval(clusters, draws=2000):
    """Ratio-of-sums cluster bootstrap; tuples are numerator and denominator."""
    require(type(draws) is int and draws>=100,'draws')
    values=list(clusters.values())
    if len(values)<2:
        return None
    rng=random.Random(20261012); estimates=[]
    for _ in range(draws):
        sampled=rng.choices(values,k=len(values)); den=sum(v[1] for v in sampled)
        if den:
            estimates.append(sum(v[0] for v in sampled)/den)
    estimates.sort()
    if not estimates:
        return None
    return dict(clusters=len(values),draws=draws,valid_draws=len(estimates),seed=20261012,
                percentile95=[estimates[int(.025*(len(estimates)-1))],estimates[int(.975*(len(estimates)-1))]])


def week(r):
    d=r['date'].isocalendar()
    return d.year,d.week


def paired(a,b):
    require(len(a)==len(b) and a,'paired size')
    clusters=defaultdict(lambda:[0.,0])
    for x,y in zip(a,b):
        require((x['id'],x['date'],x['y'])==(y['id'],y['date'],y['y']), 'unmatched pair')
        loss=lambda r:-math.log(r['p'] if r['y'] else 1-r['p'])
        v=clusters[week(x)];v[0]+=loss(x)-loss(y);v[1]+=1
    return dict(candidate_minus_reference=sum(v[0] for v in clusters.values())/len(a),
                weekly_bootstrap=interval(clusters))


def bet_summary(rows,mode='model',uncertainty=True):
    bets=[]; daily=defaultdict(int); weeks=defaultdict(lambda:[0,0]); seasons=defaultdict(lambda:[0,0])
    for r in rows:
        # Include days/weeks without wagers in uncertainty sampling.
        daily[r['date']]+=0; weeks[week(r)]; seasons[r['season']]
        b=pick(r,mode)
        if b is not None:
            bets.append(b);daily[r['date']]+=b['profit']
            for v in (weeks[week(r)],seasons[r['season']]):v[0]+=b['profit'];v[1]+=1000
    cum=peak=drawdown=0
    for day, pnl in sorted(daily.items()):
        cum+=pnl;peak=max(peak,cum);drawdown=max(drawdown,peak-cum)
    n=len(bets); total=sum(b['profit'] for b in bets)
    result=dict(bets=n,wins=sum(b['won'] for b in bets),stake_cents=n*1000,profit_cents=total,
                roi=total/(n*1000) if n else None,day_end_max_drawdown_cents=drawdown,
                selection_rate=n/len(rows) if rows else None,
                mean_predicted_ev=sum(b['predicted_ev'] for b in bets)/n if n else None,
                longshot_bets=sum(b['longshot'] for b in bets),
                win_probability_mean=sum(b['probability'] for b in bets)/n if n else None,
                cost_sensitivity_roi={str(c):(total-c*n)/(1000*n) if n else None for c in (5,10,25)})
    if uncertainty:
        result.update(weekly_roi_interval=interval(weeks),season_roi_interval=interval(seasons))
    return result


def choose_validation(predictions):
    return min(MODELS,key=lambda name:score([r for r in predictions[name] if r['season'] in VALID])['log_loss'])


def crosscheck(games, raw):
    require(git_blob(raw)==CROSS_BLOB,'crosscheck blob mismatch')
    sides={}
    for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
        if r['typeSeason']!='Regular Season':continue
        k=(r['newGameID'],r['slugTeam']);v=(odds(r['teamML']),r['isWin'],r['dateGame'],r['slugSeason'])
        require(k not in sides,'duplicate crosscheck side')
        sides[k]=v
    checked=0
    for r in games:
        for side,price,y in [('home',r['ho'],r['y']),('away',r['ao'],1-r['y'])]:
            v=sides.get((r['id'],r[side]));require(v is not None,'missing crosscheck side')
            require(v[0]==price and v[1]==('True' if y else 'False') and v[2]==r['date'].isoformat() and v[3]==r['season'],'crosscheck mismatch')
            checked+=price is not None
    return dict(team_outcomes_verified=2*len(games),nonmissing_prices_verified=checked,
                original_source_independent=False,blob=CROSS_BLOB)


def run(source, cross_source):
    require(git_blob(source)==BLOB,'source blob mismatch')
    protocol=json.loads(PROTOCOL.read_text())
    require(protocol['candidates']==MODELS[1:] and protocol['identity_map']==ALIASES,'protocol drift')
    games=read_games(source)
    counts=dict(sorted(Counter(r['season'] for r in games).items()))
    expected={f'{y}-{(y+1)%100:02}':1230 for y in range(2007,2020)}
    expected.update({'2011-12':990,'2012-13':1229,'2019-20':971})
    require(counts==expected,'schedule counts differ')
    checks=crosscheck(games,cross_source)
    predictions,fitted=candidate_predictions(games)
    sys.path.insert(0,str(ROOT/'analytics'))
    import nba_archived_moneyline_stress as legacy
    old_games=legacy.parse_source(source.decode('utf-8-sig'))
    for a,b in zip(games,old_games):
        require((a['id'],a['home'],a['away'],a['y'],a['ho'],a['ao'])==
                (b['id'],b['home'],b['away'],int(b['home_won']),b['home_odds'],b['away_odds']),'parser discrepancy')
    # Capture every legacy forecast while running the unmodified prior evaluator.
    captured=[];original=legacy._selection
    def capture(row,p):
        captured.append((row['id'],p));return original(row,p)
    legacy._selection=capture
    try: old=legacy.evaluate(old_games)
    finally:legacy._selection=original
    eval_rows=[r for r in predictions['legacy'] if r['season'] in VALID|TEST]
    require(len(eval_rows)==len(captured)==8351,'evaluation count')
    max_difference=max(abs(r['p']-p) for r,(ident,p) in zip(eval_rows,captured) if r['id']==ident)
    require(all(r['id']==ident and abs(r['p']-p)<1e-12 for r,(ident,p) in zip(eval_rows,captured)),'forecast discrepancy')
    for label,rs in [('whole_evaluation',eval_rows),('last_5000',eval_rows[-5000:])]:
        for mode,key in [('model','model_flat10'),('favorite','always_favorite_flat10')]:
            summary=bet_summary(rs,mode,False);prior=old[label][key]
            require(all(summary[k]==prior[k] for k in ('bets','wins','profit_cents','roi')),'money discrepancy')
    winner=choose_validation(predictions)
    comparisons={}
    train_rows=[r for r in predictions['legacy'] if r['season'] in TRAIN]
    home_prior=(sum(r['y'] for r in train_rows)+1)/(len(train_rows)+2)
    for name,rs in predictions.items():
        comparisons[name]={}
        for label,seasons in [('validation',VALID),('exposed_test',TEST),('whole_evaluation',VALID|TEST)]:
            subset=[r for r in rs if r['season'] in seasons]
            matched=[r for r in subset if market(r) is not None]
            market_rows=[dict(r,p=market(r)) for r in matched]
            comparisons[name][label]=dict(prediction=score(subset),price_scenario=bet_summary(subset),
                matched_prediction=score(matched),market_prediction=score(market_rows),paired_vs_market=paired(matched,market_rows),
                paired_vs_legacy=paired(subset,[r for r in predictions['legacy'] if r['season'] in seasons]))
        comparisons[name]['per_season']={s:dict(prediction=score([r for r in rs if r['season']==s]),
             price_scenario=bet_summary([r for r in rs if r['season']==s],uncertainty=False)) for s in sorted(VALID|TEST)}
    selected=[r for r in predictions[winner] if r['season'] in TEST]
    market_test=[dict(r,p=market(r)) for r in selected if market(r) is not None]
    cohorts={label:dict(model=bet_summary(rs),favorite=bet_summary(rs,'favorite'))
             for label,rs in [('whole_evaluation',eval_rows),('last_5000',eval_rows[-5000:])]}
    return dict(version=protocol['version'],protocol_sha256=hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(),
        source_sha256=hashlib.sha256(source).hexdigest(),source_blob=BLOB,source_counts=counts,
        crosscheck=checks,reproduction=dict(pr28=old,independent_forecasts_matched=len(captured),
            maximum_probability_difference=max_difference,independent_cohorts=cohorts),
        fitted_calibration=fitted,comparisons=comparisons,
        validation_selected=winner,baselines=dict(home_prior=home_prior,exposed_test_home=score([dict(r,p=home_prior) for r in selected]),
             exposed_test_coin=score([dict(r,p=.5) for r in selected]),exposed_test_market=score(market_test)),
        trustworthy_executable_roi=None,untouched_test_results=None,promote=False,
        conclusion='No reliable betting advantage demonstrated: archive exposed, quote timing absent; prospective test required.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True,type=Path)
    p.add_argument('--crosscheck',required=True,type=Path)
    p.add_argument('--output-dir',required=True,type=Path)
    args=p.parse_args()
    require(not args.output_dir.exists(),'output directory exists; preserve prior evidence')
    report=run(args.source.read_bytes(),args.crosscheck.read_bytes())
    args.output_dir.mkdir(parents=True,exist_ok=False)
    with (args.output_dir/'report.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False);f.write('\n')
    print(json.dumps({k:report[k] for k in ('validation_selected','fitted_calibration','conclusion')},indent=2))

if __name__=='__main__':main()
