/**
 * Matchup features for the learning layer. Pure, and leakage-safe by construction: every
 * input row at or after the line's lock is dropped before anything is computed.
 */
import type {Stat} from './contract.ts';

/** Opponent games used for the allowed-rate estimate. */
export const OPP_WINDOW_GAMES=15;
/** Rest days are capped here; more rest is treated the same. */
export const REST_CAP=3;
const MIN_OPP_GAMES=5;
const LEAGUE_WINDOW_MS=60*86400_000;

export type TeamGameRow={espnEventId:string;teamAbbr:string;opponentAbbr:string;gameStart:string;minutes:number|null;
 points:number|null;rebounds:number|null;assists:number|null;didNotPlay:boolean};
export type Matchup={oppAllowedRatio:number;home:0|1;restDays:number;backToBack:0|1};

/**
 * How rest is counted. 'elapsed-v1' is the FROZEN definition used by props-learn-v1 (floor of elapsed 24 h periods − 1):
 * it depends on tip times, so one full day off with a tip 30 minutes earlier (≈47.5 h) counts as 0 and is flagged
 * back-to-back (≈22.5% of research lines). 'calendar-v2' counts whole calendar days off between the two game dates in
 * New York time, which is what NBA rest means. Changing a model's rest definition changes the model: calendar-v2 may
 * only be used by a NEW model version after owner approval (after the Monday 2026-11-16 release), never by
 * props-learn-v1, whose forward evaluation is running on elapsed-v1.
 */
export type RestDefinition='elapsed-v1'|'calendar-v2';
const ET_DAY=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const etDay=(ms:number)=>Date.parse(ET_DAY.format(new Date(ms))+'T00:00:00Z')/86400_000;
export function restDaysBetween(previousMs:number,lockMs:number,def:RestDefinition):number{
 if(!Number.isFinite(previousMs))return REST_CAP;
 const raw=def==='calendar-v2'?etDay(lockMs)-etDay(previousMs)-1:Math.floor((lockMs-previousMs)/86400_000)-1;
 return Math.min(REST_CAP,Math.max(0,raw));
}

/** Sum of stat over sum of minutes for rows where the player appeared and the stat is known. */
function perMinute(rows:TeamGameRow[],stat:Stat):number|null{
 let s=0,m=0;
 for(const r of rows){
  const v=r[stat];
  if(r.didNotPlay||r.minutes===null||r.minutes<=0||v===null)continue;
  s+=v;m+=r.minutes;
 }
 return m>0?s/m:null;
}

export function matchupFeatures(i:{teamAbbr:string;opponentAbbr:string;home:boolean;lockAt:string;stat:Stat;rows:TeamGameRow[]},rest:RestDefinition='elapsed-v1'):Matchup{
 const lock=Date.parse(i.lockAt);
 const before=i.rows.filter(r=>Date.parse(r.gameStart)<lock);

 // What the opponent allows: output of players facing it, over its most recent games.
 const facing=before.filter(r=>r.opponentAbbr===i.opponentAbbr);
 const games=[...new Map(facing.map(r=>[r.espnEventId,r.gameStart])).entries()]
  .sort((a,b)=>b[1].localeCompare(a[1])).slice(0,OPP_WINDOW_GAMES).map(([id])=>id);
 let oppAllowedRatio=1;
 if(games.length>=MIN_OPP_GAMES){
  const window=new Set(games);
  const allowed=perMinute(facing.filter(r=>window.has(r.espnEventId)),i.stat);
  const league=perMinute(before.filter(r=>lock-Date.parse(r.gameStart)<=LEAGUE_WINDOW_MS),i.stat);
  if(allowed!==null&&league!==null&&league>0)oppAllowedRatio=allowed/league;
 }

 const previous=before.filter(r=>r.teamAbbr===i.teamAbbr).reduce((m,r)=>Math.max(m,Date.parse(r.gameStart)),-Infinity);
 const restDays=restDaysBetween(previous,lock,rest);
 return {oppAllowedRatio,home:i.home?1:0,restDays,backToBack:restDays===0?1:0};
}
