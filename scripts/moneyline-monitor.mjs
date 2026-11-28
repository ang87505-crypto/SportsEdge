/** Daily moneyline job is backed by database receipts, not a fictitious GitHub cron run. */
import {MONEYLINE_HEALTH_ISSUES} from '../src/lib/moneyline-health.ts';
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const count=v=>Number.isSafeInteger(v)&&v>=0;
/** A remote receipt may be created during the read. Judge freshness after I/O, against the current local clock. */
export async function readMoneylineJob(job,{released,readHealth,now=Date.now}){
 let health=null;
 if(released){try{health=await readHealth();}catch{/* unavailable is explicit below; never retry or dispatch */}}
 return moneylineJob(job,health,now(),released);
}
export function moneylineJob(job,health,nowMs,released){
 const base={id:job.id,label:job.label,area:job.area,required:released===true,note:job.note??null,
  historyUrl:'https://github.com/ang87505-crypto/SportsEdge/blob/main/docs/MONEYLINE_WATCH_RELEASE_2026_11_26.md',
  lastRun:null,lastSuccess:null,lastFailure:null,running:null,lastScheduledSuccess:null,consecutiveFailures:0,
  workflowState:null,schedule:released?job.crons:[],nextPlanned:[],slots7d:{due:0,missed:0,lastMissedAt:null}};
 if(!released)return {...base,status:'RELEASED_OFF',detail:'The moneyline data schedule is OFF. No scheduled refresh or order is inferred.'};
 const codes=new Set(MONEYLINE_HEALTH_ISSUES);
 const valid=health?.schemaVersion==='moneyline-refresh-health-v1'&&health.enabled===true&&
  ['PENDING','OK','ATTENTION','UNAVAILABLE'].includes(health.state)&&stamp(health.checkedAt)&&Date.parse(health.checkedAt)<=nowMs&&nowMs-Date.parse(health.checkedAt)<=10*60_000&&
  Array.isArray(health.issues)&&health.issues.length<=25&&health.issues.every(x=>codes.has(x))&&
  Array.isArray(health.nextPlanned)&&health.nextPlanned.length<=2&&health.nextPlanned.every(stamp)&&
  count(health.slots7d?.due)&&count(health.slots7d?.missed)&&health.slots7d.missed<=health.slots7d.due&&
  (health.slots7d.lastMissedAt===null||stamp(health.slots7d.lastMissedAt));
 if(!valid||health.state==='UNAVAILABLE'||health.state==='PENDING'&&health.issues.length||health.state==='ATTENTION'&&!health.issues.length||
  health.state==='OK'&&(health.issues.length||!/^moneyline-h2h-\d{4}-\d{2}-\d{2}$/.test(health.expectedSlot)||health.run?.status!=='completed'||!Number.isSafeInteger(health.run.id)||health.run.id<1||!health.tracks?.nba||!health.tracks?.soccer))
  return {...base,status:'STALE',detail:'Daily moneyline receipt health is unavailable or unverified. No successful refresh is inferred.'};
 const common={...base,slots7d:health.slots7d,nextPlanned:health.nextPlanned.filter(t=>Date.parse(t)>nowMs)};
 if(health.state==='PENDING')return {...common,status:'PENDING_FIRST_RUN',
  detail:health.run?`Research run #${health.run.id} has not produced a verified completed daily receipt yet.`:
   'Awaiting the planned daily collection receipt. A planned firing or dispatch is not a completed refresh.'};
 if(health.state==='ATTENTION')return {...common,status:health.issues.includes('MISSING_SLOT')?'MISSED_SLOT':'FAILING',
  detail:'Daily moneyline collection needs review: '+health.issues.join(', ')+'. No automatic retry or order is enabled by this monitor.'};
 return {...common,status:'OK',detail:`Daily slot ${health.expectedSlot} completed as research run #${health.run.id}; NBA ${health.tracks.nba.outcome}, EPL ${health.tracks.soccer.outcome}. Quote age and trading eligibility remain separate.`};
}
