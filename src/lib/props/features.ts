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

export function matchupFeatures(i:{teamAbbr:string;opponentAbbr:string;home:boolean;lockAt:string;stat:Stat;rows:TeamGameRow[]}):Matchup{
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
 const restDays=Number.isFinite(previous)?Math.min(REST_CAP,Math.max(0,Math.floor((lock-previous)/86400_000)-1)):REST_CAP;
 return {oppAllowedRatio,home:i.home?1:0,restDays,backToBack:restDays===0?1:0};
}
