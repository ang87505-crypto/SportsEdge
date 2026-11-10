/** Per-slot props status from the run ledger. Keeps scheduled, started, completed, picks recorded, entries made
 * and entries settled apart, and never presents a planned slot as a run. Pure; no I/O. */
import {PROPS_SCHEDULE} from './schedule.ts';
import {NO_ENTRY_TEXT,type NoEntryReason} from './rules.ts';

export type LedgerRun={kind:string;slot_key:string;status:string;outcome:string;started_at:string;finished_at:string|null;
 start_delay_seconds:number|null;summary:Record<string,unknown>|null};
export type SlotState='PLANNED'|'NO_RUN_RECORDED'|'RUNNING'|'COMPLETED'|'SKIPPED'|'FAILED';
export type SlotRow={slot:string;kind:'collect'|'settle';scheduledFor:string;state:SlotState;outcome:string|null;
 trigger:string|null;startedAt:string|null;startDelayMinutes:number|null;finishedAt:string|null;
 picksRecorded:number|null;entriesCreated:number|null;noEntryReasons:{platform:string;reason:string;text:string}[];
 entriesSettled:number|null;note:string|null};

const SKIP_OUTCOMES=new Set(['SKIPPED_LATE','BUDGET_EXHAUSTED','CONTROL_PAUSED','CONTROL_STOPPED','SCHEDULED_RUNS_RELEASED_OFF']);
const NOTES:Record<string,string>={
 SKIPPED_LATE:'Started too late for its slot; spent nothing so the next on-time collect keeps its credits.',
 BUDGET_EXHAUSTED:'The rolling 24-hour credit cap was already used; nothing was spent.',
 CONTROL_PAUSED:'Paused by the owner control.',CONTROL_STOPPED:'Stopped by the owner control.',
};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;

/** The slot key the worker uses for a scheduled instant (UTC hour), e.g. collect-2026-11-09T19. */
export const slotKeyFor=(kind:string,iso:string)=>`${kind}-${iso.slice(0,13)}`;

/** Scheduled slots from `days` days back through the next day, newest first, joined to the runs that claimed them. */
export function slotStatus(runs:LedgerRun[],nowIso:string,days=2):SlotRow[]{
 const now=Date.parse(nowIso);
 const out:SlotRow[]=[];
 const base=new Date(nowIso);
 for(let d=-days;d<=1;d++)for(const s of PROPS_SCHEDULE){
  const at=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate()+d,s.hour,s.minute));
  const iso=at.toISOString(),key=slotKeyFor(s.kind,iso);
  const run=runs.find(r=>r.kind===s.kind&&r.slot_key===key);
  const sum=obj(run?.summary)?run!.summary as Record<string,unknown>:{};
  let state:SlotState;
  if(!run)state=at.getTime()>now?'PLANNED':'NO_RUN_RECORDED';
  else if(run.status==='running')state='RUNNING';
  else if(run.status==='failed'||run.status==='abandoned')state='FAILED';
  else if(SKIP_OUTCOMES.has(run.outcome)||run.status==='skipped')state='SKIPPED';
  else state='COMPLETED';
  const reasons:{platform:string;reason:string;text:string}[]=[];
  let entries:number|null=null;
  if(obj(sum.entries)){
   entries=0;
   for(const [platform,v] of Object.entries(sum.entries)){
    if(!obj(v))continue;
    const made=Array.isArray(v.entries)?v.entries.filter(e=>!(obj(e)&&e.outcome==='REFUSED')).length:0;
    entries+=made;
    const r=typeof v.noEntryReason==='string'?v.noEntryReason:null;
    if(!made&&r)reasons.push({platform,reason:r,text:NO_ENTRY_TEXT[r as NoEntryReason]??r});
   }
  }
  const settlement=obj(sum.settlement)?sum.settlement:null;
  out.push({slot:key,kind:s.kind,scheduledFor:iso,state,outcome:run?.outcome??null,
   trigger:typeof sum.trigger==='string'?sum.trigger:null,startedAt:run?.started_at??null,
   startDelayMinutes:run&&run.start_delay_seconds!==null?Math.round(Number(run.start_delay_seconds)/60):null,
   finishedAt:run?.finished_at??null,
   picksRecorded:s.kind==='collect'&&obj(sum.receipt)?num(sum.receipt.picks):null,
   entriesCreated:s.kind==='collect'?entries:null,noEntryReasons:reasons,
   entriesSettled:s.kind==='settle'&&settlement?num(settlement.settled):null,
   note:run?NOTES[run.outcome]??(state==='FAILED'?'The run did not finish; see its outcome code.':null):
    state==='NO_RUN_RECORDED'?'No run has claimed this slot yet (late, dropped, or not reached).':null});
 }
 return out.sort((a,b)=>b.scheduledFor.localeCompare(a.scheduledFor));
}
