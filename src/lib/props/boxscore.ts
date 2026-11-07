/**
 * Pure parsers for ESPN's public NBA JSON (site.api.espn.com scoreboard and
 * summary), the same undocumented source production already uses for
 * moneyline settlement. Field names verified on 2026-11-07 against a 2026
 * Finals summary. Missing values stay missing (null); a played row with any
 * missing graded stat is rejected rather than filled with zero.
 */
import {NBA_TEAMS} from './identity.ts';

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:null;
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const str=(v:unknown)=>typeof v==='string'?v:null;
function iso(v:unknown):string|null{
 const s=str(v);if(!s||s.length>40)return null;
 const ms=Date.parse(s);return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
export type GameStatus='final'|'postponed'|'canceled'|'in_progress'|'scheduled'|'unknown';
function status(t:Obj|null):GameStatus{
 const name=str(t?.name)??'';
 if(name==='STATUS_FINAL'&&t?.completed===true)return 'final';
 if(name==='STATUS_POSTPONED')return 'postponed';
 if(name==='STATUS_CANCELED'||name==='STATUS_CANCELLED')return 'canceled';
 if(t?.state==='in')return 'in_progress';
 if(t?.state==='pre')return 'scheduled';
 return 'unknown';
}
const KNOWN=new Set(Object.keys(NBA_TEAMS));

export type ScoreboardGame={espnEventId:string;start:string;status:GameStatus;homeAbbr:string;awayAbbr:string};
export function parseScoreboard(raw:unknown):ScoreboardGame[]{
 const out:ScoreboardGame[]=[];
 for(const e of arr(obj(raw)?.events)){
  const ev=obj(e);const comp=obj(arr(ev?.competitions)[0]);
  const id=str(ev?.id),start=iso(comp?.date??ev?.date);
  const sides=arr(comp?.competitors).map(obj);
  const home=str(obj(sides.find(c=>c?.homeAway==='home')?.team)?.abbreviation);
  const away=str(obj(sides.find(c=>c?.homeAway==='away')?.team)?.abbreviation);
  if(!id||!/^[0-9]{6,12}$/.test(id)||!start||!home||!away||!KNOWN.has(home)||!KNOWN.has(away))continue;
  out.push({espnEventId:id,start,status:status(obj(obj(comp?.status??ev?.status)?.type)),homeAbbr:home,awayAbbr:away});
 }
 return out;
}

export type PlayerLine={espnEventId:string;athleteId:string;athleteName:string;teamAbbr:string;opponentAbbr:string;
 gameStart:string;gameStatus:'final'|'postponed'|'canceled';didNotPlay:boolean;dnpReason:string|null;
 minutes:number|null;points:number|null;rebounds:number|null;assists:number|null};
export type SummaryParse={espnEventId:string;status:GameStatus;start:string|null;homeAbbr:string|null;awayAbbr:string|null;
 players:PlayerLine[];rejectedRows:number};

function statInt(v:unknown):number|null{
 const s=str(v);if(s===null||!/^\d{1,3}$/.test(s.trim()))return null;return Number(s.trim());
}
function minutes(v:unknown):number|null{
 const s=str(v);if(s===null)return null;const t=s.trim();
 if(/^\d{1,2}$/.test(t))return Number(t);
 const m=/^(\d{1,2}):(\d{2})$/.exec(t);return m?Number(m[1])+Number(m[2])/60:null;
}

export function parseSummary(raw:unknown,expectedEventId:string):SummaryParse{
 const root=obj(raw);
 const comp=obj(arr(obj(root?.header)?.competitions)[0]);
 const st=status(obj(obj(comp?.status)?.type));
 const sides=arr(comp?.competitors).map(obj);
 const home=str(obj(sides.find(c=>c?.homeAway==='home')?.team)?.abbreviation);
 const away=str(obj(sides.find(c=>c?.homeAway==='away')?.team)?.abbreviation);
 const id=str(obj(root?.header)?.id)??str(comp?.id);
 const start=iso(comp?.date);
 const base={espnEventId:expectedEventId,status:st,start,homeAbbr:home,awayAbbr:away,players:[] as PlayerLine[],rejectedRows:0};
 if(id!==expectedEventId||!home||!away||!KNOWN.has(home)||!KNOWN.has(away)||!start)return {...base,status:'unknown'};
 if(st==='postponed'||st==='canceled'||st!=='final')return base;
 let rejected=0;const players:PlayerLine[]=[];const seen=new Set<string>();
 for(const t of arr(obj(root?.boxscore)?.players)){
  const team=obj(obj(t)?.team);const abbr=str(team?.abbreviation);
  if(!abbr||(abbr!==home&&abbr!==away)){rejected++;continue;}
  const opp=abbr===home?away:home;
  const block=obj(arr(obj(t)?.statistics)[0]);
  const keys=arr(block?.keys).map(str);
  const col=(k:string)=>keys.indexOf(k);
  const [iMin,iPts,iReb,iAst]=[col('minutes'),col('points'),col('rebounds'),col('assists')];
  for(const a of arr(block?.athletes)){
   const row=obj(a);const ath=obj(row?.athlete);
   const aid=str(ath?.id),name=str(ath?.displayName);
   if(!row||!aid||!/^[0-9]{1,12}$/.test(aid)||!name||seen.has(aid)){rejected++;continue;}
   seen.add(aid);
   const dnp=row.didNotPlay===true;
   const stats=arr(row.stats);
   const line:PlayerLine={espnEventId:expectedEventId,athleteId:aid,athleteName:name.slice(0,120),teamAbbr:abbr,opponentAbbr:opp,
    gameStart:start,gameStatus:'final',didNotPlay:dnp,dnpReason:dnp?(str(row.reason)?.slice(0,120)??null):null,
    minutes:null,points:null,rebounds:null,assists:null};
   if(!dnp){
    if(Math.min(iMin,iPts,iReb,iAst)<0){rejected++;continue;}
    line.minutes=minutes(stats[iMin]);line.points=statInt(stats[iPts]);
    line.rebounds=statInt(stats[iReb]);line.assists=statInt(stats[iAst]);
    if([line.minutes,line.points,line.rebounds,line.assists].some(v=>v===null)){rejected++;continue;}
   }
   players.push(line);
  }
 }
 return {...base,players,rejectedRows:rejected};
}
