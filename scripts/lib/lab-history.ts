/**
 * Historical lab items from the pinned SportsDataverse box scores: for every proxy line, the layer-1 and
 * role-minutes probabilities, the lock-bounded matchup, the layer-1 inputs needed by the pre-lock risk flags,
 * and the realised stat and minutes (used ONLY for grading and diagnosis, never as a feature).
 * Every input uses games that started strictly before the predicted game; violations are counted and refused.
 */
import {predictLine,type GameLog,type ModelParams,type PriorSummary} from '../../src/lib/props/model.ts';
import {STATS,type Stat} from '../../src/lib/props/contract.ts';
import {matchupFeatures,type TeamGameRow,type Matchup} from '../../src/lib/props/features.ts';
import type {Probabilities} from '../../src/lib/props/research.ts';
import {proxyLine,statOf,byAthlete,type BoxRow} from './box-csv.ts';
import {ROLE_CHANGE} from '../../src/lib/lab/sports/role.ts';

const LEAGUE_WINDOW_MS=60*86400_000;
export type LabHistoryItem={key:string;eventId:string;date:string;stat:Stat;at:string;line:number;y:0|1;
 base:Probabilities;role:Probabilities;matchup:Matchup;mean:number;roleMean:number;
 layer1:{games:number;expMinutes:number;sdMinutes:number;lastPlayed:string;cutoff:string};roleExpMinutes:number;
 actual:number;actualMinutes:number|null;player:string;team:string};

export function labItems(seasonRows:BoxRow[],params:ModelParams,priorOf:(athlete:string)=>PriorSummary|null){
 const roleParams:ModelParams={...params,roleChange:{...ROLE_CHANGE}};
 const teamRows:TeamGameRow[]=seasonRows.map(r=>({espnEventId:r.game,teamAbbr:r.team,opponentAbbr:r.opponent,gameStart:r.start,
  minutes:r.log.minutes,points:r.log.points,rebounds:r.log.rebounds,assists:r.log.assists,didNotPlay:r.log.didNotPlay}))
  .sort((a,b)=>a.gameStart.localeCompare(b.gameStart));
 const lowerBound=(t:number)=>{let lo=0,hi=teamRows.length;while(lo<hi){const m=(lo+hi)>>1;if(Date.parse(teamRows[m].gameStart)<t)lo=m+1;else hi=m;}return lo;};
 const cache=new Map<string,Matchup>();
 let checked=0,violations=0;
 const matchupFor=(r:BoxRow,stat:Stat)=>{
  const key=[r.game,r.team,stat].join('|');const hit=cache.get(key);if(hit)return hit;
  const lock=Date.parse(r.start);
  const rows=teamRows.slice(lowerBound(lock-LEAGUE_WINDOW_MS-30*86400_000),lowerBound(lock));
  for(const x of rows){checked++;if(Date.parse(x.gameStart)>=lock)violations++;}
  const m=matchupFeatures({teamAbbr:r.team,opponentAbbr:r.opponent,home:r.home,lockAt:r.start,stat,rows});
  cache.set(key,m);return m;
 };
 const items:LabHistoryItem[]=[];
 for(const rows of byAthlete(seasonRows).values()){
  rows.sort((a,b)=>a.start.localeCompare(b.start));
  rows.forEach((r,i)=>{
   if(r.log.didNotPlay||r.log.minutes===null)return;
   const history:GameLog[]=rows.slice(0,i).map(x=>x.log);
   for(const h of rows.slice(0,i)){checked++;if(Date.parse(h.start)>=Date.parse(r.start))violations++;}
   for(const s of STATS){
    const actual=statOf(r.log,s);if(actual===null||actual===undefined)continue;
    const line=proxyLine(history,s);if(line===null)continue;
    const p=predictLine({logs:history,prior:priorOf(r.athlete),stat:s,line,cutoff:r.start,params});
    const q=predictLine({logs:history,prior:priorOf(r.athlete),stat:s,line,cutoff:r.start,params:roleParams});
    if(p.status!=='scored'||q.status!=='scored')continue;
    items.push({key:[r.game,r.athlete,s,line].join('|'),eventId:r.game,date:r.start.slice(0,10),stat:s,at:r.start,line,y:actual>line?1:0,
     base:{pMore:p.pMore,pLess:p.pLess,pTie:p.pTie},role:{pMore:q.pMore,pLess:q.pLess,pTie:q.pTie},matchup:matchupFor(r,s),mean:p.mean,roleMean:q.mean,
     layer1:{games:p.inputs.games,expMinutes:p.inputs.expMinutes,sdMinutes:p.inputs.sdMinutes,lastPlayed:p.inputs.lastPlayed,cutoff:r.start},
     roleExpMinutes:q.inputs.expMinutes,actual,actualMinutes:r.log.minutes,player:r.name,team:r.team});
   }
  });
 }
 if(violations!==0)throw new Error('LEAKAGE: '+violations+' inputs at or after lock');
 return {items,checked,violations};
}
