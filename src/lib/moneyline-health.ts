/** Read-only daily receipt checks. A successful dispatch is not a completed collection or a fresh price. */
import {summarizeCollection} from './ingestion/track-receipt.ts';

const HOUR=3600_000,DAY=24*HOUR;
export const MONEYLINE_HEALTH_POLICY={firstSlotUtc:'2026-11-28T11:00:00.000Z',hourUtc:11,graceHours:2,maxQuoteAgeHours:24} as const;
export const MONEYLINE_HEALTH_ISSUES=['MISSING_SLOT','RUN_UNAVAILABLE','RUN_INCOMPLETE','RUN_FAILED','UNVERIFIED_RUN',
 'SLOT_OUTSIDE_WINDOW','UNVERIFIED_REPORT','NBA_UNVERIFIED','SOCCER_UNVERIFIED','NBA_NO_PRICES','SOCCER_NO_PRICES',
 'NBA_SOURCE_STALE','SOCCER_SOURCE_STALE','NBA_SOURCE_FUTURE','SOCCER_SOURCE_FUTURE','NBA_SOURCE_REJECTED','SOCCER_SOURCE_REJECTED'] as const;
type Issue=typeof MONEYLINE_HEALTH_ISSUES[number];
type Track={outcome:string;pricesOffered:number;oddsVerified:number;newestSourceObservedAt:string|null};
export type MoneylineHealth={schemaVersion:'moneyline-refresh-health-v1';checkedAt:string;state:'OFF'|'PENDING'|'OK'|'ATTENTION'|'UNAVAILABLE';
 enabled:boolean;expectedSlot:string|null;nextPlanned:string[];issues:Issue[];
 slots7d:{due:number;missed:number;lastMissedAt:string|null};
 run:{id:number;status:string;createdAt:string;finishedAt:string|null}|null;
 tracks:{nba:Track|null;soccer:Track|null}|null};
type Policy={firstSlotUtc:string;hourUtc:number;graceHours:number;maxQuoteAgeHours:number};
type Slot={slot_key:string;run_id:number;claimed_at:string};
type Run={id:number;status:string;created_at:string;claimed_at:string|null;finished_at:string|null;probe:boolean;summary:unknown};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const stamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const dayStart=(t:number)=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());};
const key=(t:number)=>'moneyline-h2h-'+new Date(t).toISOString().slice(0,10);

export function moneylineHealth(nowIso:string,enabled:boolean,slotRows:unknown,runRows:unknown,P:Policy=MONEYLINE_HEALTH_POLICY):MoneylineHealth{
 const now=Date.parse(nowIso),first=Date.parse(P.firstSlotUtc);
 if(!Number.isFinite(now)||!Number.isFinite(first)||first!==dayStart(first)+P.hourUtc*HOUR)throw Error('MONEYLINE_HEALTH_BAD_CLOCK');
 const h:MoneylineHealth={schemaVersion:'moneyline-refresh-health-v1',checkedAt:nowIso,state:enabled?'PENDING':'OFF',enabled,
  expectedSlot:null,nextPlanned:[],issues:[],slots7d:{due:0,missed:0,lastMissedAt:null},run:null,tracks:null};
 if(!enabled)return h;
 const next=now<first?first:first+(Math.floor((now-first)/DAY)+1)*DAY;
 h.nextPlanned=[next,next+DAY].map(t=>new Date(t).toISOString());
 if(now<first)return h;
 const expected=first+Math.floor((now-first)/DAY)*DAY;h.expectedSlot=key(expected);
 if(!Array.isArray(slotRows)||!Array.isArray(runRows)||slotRows.length>8||runRows.length>8){h.state='UNAVAILABLE';return h;}
 const slots=new Map<string,Slot>(),runs=new Map<number,Run>();
 for(const s of slotRows){
  if(!object(s)||typeof s.slot_key!=='string'||!/^moneyline-h2h-\d{4}-\d{2}-\d{2}$/.test(s.slot_key)||!positive(s.run_id)||
   !stamp(s.claimed_at)||Date.parse(s.claimed_at)>now||slots.has(s.slot_key)){h.state='UNAVAILABLE';return h;}
  const t=Date.parse(s.slot_key.slice(14)+'T11:00:00Z');
  if(!Number.isFinite(t)||key(t)!==s.slot_key){h.state='UNAVAILABLE';return h;}
  slots.set(s.slot_key,s as Slot);
 }
 for(const r of runRows){
  if(!object(r)||!positive(r.id)||!['queued','running','completed','failed'].includes(String(r.status))||!stamp(r.created_at)||
   Date.parse(r.created_at)>now||(r.claimed_at!==null&&(!stamp(r.claimed_at)||Date.parse(r.claimed_at)>now))||
   (r.finished_at!==null&&(!stamp(r.finished_at)||Date.parse(r.finished_at)>now))||typeof r.probe!=='boolean'||runs.has(r.id)){
   h.state='UNAVAILABLE';return h;
  }
  runs.set(r.id,r as Run);
 }
 let start=Math.max(first,dayStart(now-7*DAY)+P.hourUtc*HOUR);if(start<=now-7*DAY)start+=DAY;
 for(let t=start;t<=now-P.graceHours*HOUR;t+=DAY){
  h.slots7d.due++;
  if(!slots.has(key(t))){h.slots7d.missed++;h.slots7d.lastMissedAt=new Date(t).toISOString();}
 }
 const s=slots.get(h.expectedSlot),grace=now<expected+P.graceHours*HOUR;
 if(!s){if(!grace){h.issues.push('MISSING_SLOT');h.state='ATTENTION';}return h;}
 if(Date.parse(s.claimed_at)<expected||Date.parse(s.claimed_at)>=expected+HOUR)h.issues.push('SLOT_OUTSIDE_WINDOW');
 const r=runs.get(s.run_id);
 if(!r){h.issues.push('RUN_UNAVAILABLE');h.state='ATTENTION';return h;}
 h.run={id:r.id,status:r.status,createdAt:r.created_at,finishedAt:r.finished_at};
 if(r.probe||Date.parse(r.created_at)<Date.parse(s.claimed_at)-60_000||
  (r.status==='queued'?r.claimed_at!==null:!r.claimed_at)||
  r.claimed_at&&Date.parse(r.claimed_at)<Date.parse(r.created_at)||
  r.finished_at&&r.claimed_at&&Date.parse(r.finished_at)<Date.parse(r.claimed_at)||
  ['queued','running'].includes(r.status)&&r.finished_at!==null)h.issues.push('UNVERIFIED_RUN');
 if(r.status==='queued'||r.status==='running'){
  if(!grace)h.issues.push('RUN_INCOMPLETE');h.state=h.issues.length?'ATTENTION':'PENDING';return h;
 }
 if(r.status==='failed')h.issues.push('RUN_FAILED');
 const summary=object(r.summary)?r.summary:null,report=object(summary?.report)?summary.report:null;
 const derived=summarizeCollection(report);
 const summaryTracks=object(summary?.tracks)?summary.tracks:null;
 if(!summary||summary.runId!==r.id||!r.finished_at||derived.tracks===null||summary.status!==derived.status||
  !summaryTracks||['nba','soccer'].some(t=>summaryTracks[t]!==derived.tracks![t]))h.issues.push('UNVERIFIED_REPORT');
 const raw=object(report?.tracks)?report.tracks:null;h.tracks={nba:null,soccer:null};
 for(const name of ['nba','soccer'] as const){
  const prefix=name==='nba'?'NBA':'SOCCER',t=raw?.[name];
  if(!object(t)||t.track!==name||!['saved','unchanged','empty_slate','no_prices'].includes(String(t.outcome))||
   !['providerGames','gamesStored','pricesOffered','oddsInserted','oddsVerified','rejectedEvents','skippedLive','skippedMarkets'].every(k=>count(t[k]))||
   t.oddsInserted!==t.oddsVerified||(t.oddsInserted as number)>(t.pricesOffered as number)||(t.gamesStored as number)>(t.providerGames as number)){
   h.issues.push(`${prefix}_UNVERIFIED`);continue;
  }
  const empty=t.outcome==='empty_slate';
  if(empty&&(t.providerGames!==0||t.pricesOffered!==0||t.newestSourceObservedAt!==null)||
   !empty&&(t.providerGames===0||t.outcome==='saved'&&t.oddsInserted===0||t.outcome==='unchanged'&&(t.oddsInserted!==0||t.pricesOffered===0)))
   h.issues.push(`${prefix}_UNVERIFIED`);
  if((t.rejectedEvents as number)>0)h.issues.push(`${prefix}_SOURCE_REJECTED`);
  if(t.outcome==='no_prices')h.issues.push(`${prefix}_NO_PRICES`);
  if((t.pricesOffered as number)>0){
   if(!stamp(t.newestSourceObservedAt))h.issues.push(`${prefix}_UNVERIFIED`);
   else if(Date.parse(t.newestSourceObservedAt)>now)h.issues.push(`${prefix}_SOURCE_FUTURE`);
   else if(now-Date.parse(t.newestSourceObservedAt)>P.maxQuoteAgeHours*HOUR)h.issues.push(`${prefix}_SOURCE_STALE`);
  }
  h.tracks[name]={outcome:String(t.outcome),pricesOffered:t.pricesOffered as number,oddsVerified:t.oddsVerified as number,
   newestSourceObservedAt:stamp(t.newestSourceObservedAt)?t.newestSourceObservedAt:null};
 }
 h.issues=[...new Set(h.issues)];h.state=h.issues.length?'ATTENTION':'OK';return h;
}
