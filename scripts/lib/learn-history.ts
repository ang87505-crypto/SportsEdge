/**
 * Historical training items for the props learning layer, from the pinned SportsDataverse box
 * scores. Layer-1 priors from the prior season; NB dispersion fit through `dispersionThrough`.
 * Every input comes from games that started before the predicted game; the count is returned and
 * any violation throws. PROXY lines (floor of last-10 median + 0.5), never platform lines.
 */
import {readFileSync} from 'node:fs';
import {predictLine,type GameLog,type ModelParams,type PriorSummary} from '../../src/lib/props/model.ts';
import {STATS,type Stat} from '../../src/lib/props/contract.ts';
import {matchupFeatures,type TeamGameRow,type Matchup} from '../../src/lib/props/features.ts';
import type {Probabilities} from '../../src/lib/props/research.ts';
import {loadBoxCsv,proxyLine,statOf,priors,fitDispersion,byAthlete,MODEL_FIXED,type BoxRow} from './box-csv.ts';

const protocol=JSON.parse(readFileSync(new URL('../../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
const LEAGUE_WINDOW_MS=60*86400_000;
export type HistoricalItem={key:string;eventId:string;date:string;stat:Stat;at:string;base:Probabilities;matchup:Matchup;y:0|1};

export function buildHistoricalItems(priorPath:string,seasonPath:string,dispersionThrough:string){
 function pinned(path:string){
  const f=loadBoxCsv(path);
  if(!f.file||protocol.sourceHashes[f.file]!==f.sha256)throw new Error('SOURCE_HASH_MISMATCH: '+f.file);
  return f;
 }
 const prior=pinned(priorPath),season=pinned(seasonPath);
 const pr=priors(prior.rows);
 const dispersion=fitDispersion(season.rows,pr,Date.parse(dispersionThrough));
 const params:ModelParams={...MODEL_FIXED,leagueRate:pr.leagueRate,dispersion};
 const built=itemsFromSeason(season.rows,params,a=>pr.players.get(a)??null);
 return {...built,dispersion,sources:[prior,season].map(f=>({file:f.file,sha256:f.sha256}))};
}

/** Scored items for one season's rows with given layer-1 params and priors; every input is checked to be pre-game. */
export function itemsFromSeason(seasonRows:BoxRow[],params:ModelParams,priorOf:(athlete:string)=>PriorSummary|null){
 const season={rows:seasonRows};
 
 // Team rows, time-sorted, so each game's matchup sees only a 60-day window before it.
 const teamRows:TeamGameRow[]=season.rows.map(r=>({espnEventId:r.game,teamAbbr:r.team,opponentAbbr:r.opponent,gameStart:r.start,
  minutes:r.log.minutes,points:r.log.points,rebounds:r.log.rebounds,assists:r.log.assists,didNotPlay:r.log.didNotPlay}))
  .sort((a,b)=>a.gameStart.localeCompare(b.gameStart));
 const lowerBound=(t:number)=>{let lo=0,hi=teamRows.length;while(lo<hi){const m=(lo+hi)>>1;if(Date.parse(teamRows[m].gameStart)<t)lo=m+1;else hi=m;}return lo;};
 const matchupCache=new Map<string,Matchup>();
 let checked=0,violations=0;
 function matchupFor(r:BoxRow,stat:Stat):Matchup{
  const key=[r.game,r.team,stat].join('|');
  const hit=matchupCache.get(key);if(hit)return hit;
  const lock=Date.parse(r.start);
  const rows=teamRows.slice(lowerBound(lock-LEAGUE_WINDOW_MS-30*86400_000),lowerBound(lock));
  for(const x of rows){checked++;if(Date.parse(x.gameStart)>=lock)violations++;}
  const m=matchupFeatures({teamAbbr:r.team,opponentAbbr:r.opponent,home:r.home,lockAt:r.start,stat,rows});
  matchupCache.set(key,m);return m;
 }
 
 const items:HistoricalItem[]=[];
 for(const rows of byAthlete(season.rows).values()){
  rows.sort((a,b)=>a.start.localeCompare(b.start));
  rows.forEach((r,i)=>{
   if(r.log.didNotPlay||r.log.minutes===null)return;
   const history:GameLog[]=rows.slice(0,i).map(x=>x.log);
   for(const h of rows.slice(0,i)){checked++;if(Date.parse(h.start)>=Date.parse(r.start))violations++;}
   for(const s of STATS){
    const y=statOf(r.log,s);
    if(y===null||y===undefined)continue;
    const line=proxyLine(history,s);if(line===null)continue;
    const p=predictLine({logs:history,prior:priorOf(r.athlete),stat:s,line,cutoff:r.start,params});
    if(p.status!=='scored')continue;
    items.push({key:[r.game,r.athlete,s,line].join('|'),eventId:r.game,date:r.start.slice(0,10),stat:s,at:r.start,
     base:{pMore:p.pMore,pLess:p.pLess,pTie:p.pTie},matchup:matchupFor(r,s),y:y>line?1:0});
   }
  });
 }
 if(violations!==0)throw new Error('LEAKAGE: '+violations+' inputs at or after lock');
 return {items,checked,violations};
}
