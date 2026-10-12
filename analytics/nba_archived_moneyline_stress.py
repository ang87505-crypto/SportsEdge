"""Pinned *exploratory* NBA moneyline stress test. Not executable betting ROI.

A historical consensus-moneyline archive has NO quote timestamps, sportsbook
identities or guarantee of bet acceptance. This reconstructs Elo decisions
from earlier results by calendar day and tests hypothetical flat-$10 stakes,
never records/places any bet. The source data's separate license is respected:
no raw archived moneylines are bundled with this repository.
"""
from __future__ import annotations
import argparse
import csv
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import math
from pathlib import Path
import random

SOURCE_REPO="jacobburdier05/nba-moneyline-calibration"
SOURCE_COMMIT="531580ab210ff8ffda25e58e89b5d08e2e8b85b5"
SOURCE_FILE="data/raw/nba_moneylines.csv"
SOURCE_GIT_BLOB="ed143d6e608b21f791b7ff9f2e35577c9aa5997a"
REPLAY_VERSION="nba-elo-k20-h65-archived-consensus-price-stress-v1"
INITIAL=1500.0
K=20.0
HOME=65.0
STAKE_CENTS=1000
MIN_EV=0.02
EVALUATION="2013-14"

def _price(value):
    try:
        n=Decimal(value)
    except (InvalidOperation,TypeError,ValueError):
        return None
    if not n.is_finite() or n!=n.to_integral_value() or abs(n)<100 or abs(n)>100000:
        return None
    return int(n)

def _implied(o):
    return 100/(100+o) if o>0 else -o/(100-o)

def _decimal(o):
    return 1+(o/100 if o>0 else 100/abs(o))

def _win_profit(o):
    # Conservative half-up rounding at cents for a $10 nominal flat stake.
    numer=STAKE_CENTS*(o if o>0 else 100)
    denom=100 if o>0 else -o
    return (2*numer+denom)//(2*denom)

def _p(h,a):
    return 1/(1+10**(-((h+HOME-a)/400)))

def parse_source(content):
    """Parse one game per row. The external upstream checksum is validated in CLI."""
    try:
        reader=csv.DictReader(io.StringIO(content))
        required={"slugSeason","newGameID","idGame","slugTeam","slugOpp",
                  "slugMatchup","dateGame","outcomeGame.team1","teamML.team1","oppML.team1"}
        if not reader.fieldnames or set(reader.fieldnames)!=required:
            raise ValueError("Historical source columns changed; manual audit required")
        out=[];seen=set()
        for r in reader:
            sid=r["newGameID"];t1=r["slugTeam"];t2=r["slugOpp"]
            if not sid or sid in seen or not t1 or not t2 or t1==t2:
                raise ValueError("Duplicate/invalid historical game or teams")
            seen.add(sid)
            matchup=r["slugMatchup"]
            if matchup==t1+" vs. "+t2:
                home,away=t1,t2
            elif matchup==t1+" @ "+t2:
                home,away=t2,t1
            else:
                raise ValueError("Cannot authenticate historical home/away identity")
            if r["outcomeGame.team1"] not in ("W","L"):
                raise ValueError("Invalid historical result")
            dt=date.fromisoformat(r["dateGame"])
            if r["dateGame"]!=dt.isoformat():
                raise ValueError("Noncanonical historical date")
            season=r["slugSeason"]
            if len(season)!=7 or season[4]!="-" or not season[:4].isdigit() or not season[5:].isdigit() \
                or (int(season[:4])+1)%100!=int(season[5:]):
                raise ValueError("Invalid season")
            # Quoted odds are not timestamped; cannot prove historical executable availability.
            o1=_price(r["teamML.team1"]);o2=_price(r["oppML.team1"])
            outcome=(t1 if r["outcomeGame.team1"]=="W" else t2)==home
            out.append({"id":sid,"date":dt,"season":season,"home":home,"away":away,
                        "home_won":outcome,"home_odds":o1 if home==t1 else o2,
                        "away_odds":o2 if home==t1 else o1})
        if not out:
            raise ValueError("Empty historical source")
        return sorted(out,key=lambda x:(x["date"],x["id"]))
    except (TypeError,KeyError) as e:
        raise ValueError("Malformed historical CSV") from e

def _selection(row,p):
    home=row["home_odds"];away=row["away_odds"]
    if home is None or away is None:
        return None,None
    ih,ia=_implied(home),_implied(away)
    if not 1.0<ih+ia<=1.25:
        return None,None
    no_vig_home=ih/(ih+ia)
    candidates=[
        (p*_decimal(home)-1,p,no_vig_home,home,row["home_won"],row["home"]),
        ((1-p)*_decimal(away)-1,1-p,1-no_vig_home,away,not row["home_won"],row["away"])
    ]
    candidates.sort(key=lambda c:-c[0])  # Stable ties retain home-first order.
    bet=None
    for ev,prob,market,odds,won,side in candidates:
        if ev>=MIN_EV and prob>market:
            bet={"selection":side,"odds":odds,"won":won,"profit_cents":_win_profit(odds) if won else -STAKE_CENTS,"ev_at_archived_price":ev}
            break
    favorite=(home,row["home_won"]) if ih>=ia else (away,not row["home_won"])
    fav={"odds":favorite[0],"won":favorite[1],
         "profit_cents":_win_profit(favorite[0]) if favorite[1] else -STAKE_CENTS}
    return bet,fav

def _summary(rows,key):
    picks=[r[key] for r in rows if r[key] is not None]
    profit=sum(x["profit_cents"] for x in picks)
    stake=STAKE_CENTS*len(picks)
    return {"bets":len(picks),"wins":sum(x["won"] for x in picks),
            "staked_cents":stake,"profit_cents":profit,
            "roi":profit/stake if stake else None}

def _bootstrap(rows,key,seed=20261011,draws=2000):
    """Resample complete calendar days (not individual correlated games)."""
    by_day={}
    for r in rows:
        if r[key] is not None:
            a=by_day.setdefault(r["date"],[0,0])
            a[0]+=r[key]["profit_cents"];a[1]+=STAKE_CENTS
    values=list(by_day.values())
    if len(values)<2:
        return None
    rng=random.Random(seed)
    samples=[]
    for _ in range(draws):
        profit=stake=0
        for _ in range(len(values)):
            a,b=values[rng.randrange(len(values))]
            profit+=a;stake+=b
        samples.append(profit/stake)
    samples.sort()
    return {"day_clusters":len(values),"draws":draws,"seed":seed,
            "roi_interval_95_percentile":[samples[int(.025*(draws-1))],
                                           samples[int(.975*(draws-1))]]}

def evaluate(games):
    """Fixed Elo from earlier days. Identical-date games never inform each other."""
    if not isinstance(games,list) or not games:
        raise ValueError("Empty source")
    ordered=sorted(games,key=lambda r:(r["date"],r["id"]))
    if len({r["id"] for r in ordered})!=len(ordered):
        raise ValueError("Duplicate game")
    ratings={}
    results=[]
    i=0
    while i<len(ordered):
        day=ordered[i]["date"];j=i+1
        while j<len(ordered) and ordered[j]["date"]==day:
            j+=1
        batch=ordered[i:j]
        estimates=[]
        for r in batch:
            h=ratings.get(r["home"],INITIAL)
            a=ratings.get(r["away"],INITIAL)
            p=_p(h,a)
            estimates.append(p)
            if r["season"]>=EVALUATION:
                chosen,favorite=_selection(r,p)
                results.append({"id":r["id"],"date":r["date"],
                  "season":r["season"],"p_home":p,"home_won":r["home_won"],
                  "correct":(p>=.5)==r["home_won"],"chosen":chosen,"favorite":favorite})
        for r,p in zip(batch,estimates):
            delta=K*(int(r["home_won"])-p)
            ratings[r["home"]]=ratings.get(r["home"],INITIAL)+delta
            ratings[r["away"]]=ratings.get(r["away"],INITIAL)-delta
        i=j
    if len(results)<5000:
        scope="short_fixture_only"
        last=results
    else:
        scope="full_pinned_archive"
        last=results[-5000:]
    seasons={}
    for season in sorted({r["season"] for r in results}):
        rs=[r for r in results if r["season"]==season]
        seasons[season]={"games":len(rs),"winner_accuracy":sum(r["correct"] for r in rs)/len(rs),
                         "model_flat10":_summary(rs,"chosen")}
    return {"version":REPLAY_VERSION,
       "source":{"repo":SOURCE_REPO,"commit":SOURCE_COMMIT,"path":SOURCE_FILE,
                 "blob_sha":SOURCE_GIT_BLOB,"historical_quote_timestamp_known":False,
                 "sportsbook_identity_known":False,"raw_source_license_separate":True},
       "model":{"initial_rating":INITIAL,"k":K,"home_advantage":HOME,
                "evaluation_start":EVALUATION,"ev_minimum":MIN_EV,
                "selection":"max positive model EV, 2% minimum and positive proportional no-vig gap"},
       "scope":scope,"evaluation_games":len(results),
       "accuracy":sum(r["correct"] for r in results)/len(results) if results else None,
       "whole_evaluation":{"games":len(results),"model_flat10":_summary(results,"chosen"),
         "always_favorite_flat10":_summary(results,"favorite"),
         "model_day_cluster_roi_interval":_bootstrap(results,"chosen")},
       "last_5000":{"games":len(last),"first_date":last[0]["date"].isoformat() if last else None,
         "last_date":last[-1]["date"].isoformat() if last else None,
         "accuracy":sum(r["correct"] for r in last)/len(last) if last else None,
         "model_flat10":_summary(last,"chosen"),
         "always_favorite_flat10":_summary(last,"favorite"),
         "model_day_cluster_roi_interval":_bootstrap(last,"chosen")},
       "seasons":seasons,
       "interpretation":"Historical, un-timestamped consensus prices are NOT guaranteed obtainable. Apparent returns are research scenarios, not actual executable bankroll outcomes. Holdouts were previously exposed. No model upgrade or profit claim."}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    data=a.source.read_bytes()
    digest=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
    if digest!=SOURCE_GIT_BLOB:
        raise ValueError("Historical archive Git blob SHA differs from pinned source")
    report=evaluate(parse_source(data.decode("utf-8-sig")))
    if report["scope"]!="full_pinned_archive" or report["evaluation_games"]!=8351:
        raise ValueError("Pinned evaluation game count mismatch")
    with a.output.open("x",encoding="utf-8") as f:
        json.dump(report,f,indent=2,allow_nan=False)
        f.write("\n")

if __name__=="__main__":
    main()
