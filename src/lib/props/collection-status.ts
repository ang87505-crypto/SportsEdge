/**
 * Props line-collection status for the dashboard (pure; no I/O). Keeps four stages apart and never
 * presents one as another: PLANNED work (capture windows or legacy slots not yet due), COMPLETED jobs
 * (collect runs that finished), RECORDED picks (qualifying picks saved by those runs) and VIRTUAL ENTRIES.
 * Unknown stays unknown: missing tables or receipts are reported as unavailable, never as zero.
 */
import {captureState,nextWindowOpen,planWindows,CAPTURE_PLAN_V1,type PlanRow,type CaptureRow,type CaptureState} from './capture-plan.ts';
import {nextPlannedRuns} from './schedule.ts';
import {slotStatus,type LedgerRun,type RunCounts} from './slot-status.ts';
import {NO_ENTRY_TEXT,type NoEntryReason} from './rules.ts';
import {PROPS_RELEASE,ticksReleased} from './schedule.ts';
import {effectiveBudgetPolicy} from './budget.ts';
import type {Raw} from './dashboard-view.ts';

export type CollectionInput={nowIso:string;
 runs:(LedgerRun&{id:number})[];
 credits:{credits:number;reserved_at:string;effective_credits?:number}[];
 providerRemaining:number|null;
 runCounts:RunCounts|null;
 /** null = the capture tables are not migrated (shown as unavailable). */
 plans:(PlanRow&{planned_at:string})[]|null;
 captures:(CaptureRow&{run_id:number;lines_by_platform?:Record<string,number>|null;minutes_to_tip?:number|null})[]|null;
 policy:{dailyCredits:number;monthlyCredits:number;providerFloor:number;countsProviderActuals?:boolean};
 ticksReleased:boolean;scheduledRunsEnabled:boolean;controlState:string|null};

const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const MISSING:CaptureState[]=['MISSED','NO_LINES_FOUND','BUDGET_REFUSED','FAILED','ATTEMPT_UNRESOLVED'];
const isTick=(slot:string)=>slot.startsWith('collect-tick-');

/**
 * The next time a props collection is planned: the next capture window once ticks are released (null when the
 * capture plans are unavailable), otherwise the next legacy collect slot. Every page and the assistant use this.
 */
export function nextCollectionAt(x:{nowIso:string;ticksReleased:boolean;plans:PlanRow[]|null|undefined;captures:CaptureRow[]|null|undefined}):string|null{
 if(x.ticksReleased)return x.plans?nextWindowOpen(x.plans,x.captures??[],x.nowIso)?.at??null:null;
 return nextPlannedRuns(x.nowIso,4).find(r=>r.kind==='collect')?.at??null;
}

export function collectionStatus(x:CollectionInput){
 const now=Date.parse(x.nowIso);const dayAgo=now-86400_000;
 const collects=x.runs.filter(r=>r.kind==='collect').sort((a,b)=>b.id-a.id);
 const success=collects.find(r=>r.status==='completed'&&(r.outcome==='COMPLETED'));
 const lastSuccess=success?{at:success.finished_at??success.started_at,slot:success.slot_key,mode:isTick(success.slot_key)?'tick':'slot',
  trigger:obj(success.summary)&&typeof success.summary.trigger==='string'?success.summary.trigger:null}:null;

 // Actual execution versus schedule, for every recent collect (ticks have no fixed slot unless a backup named its hour).
 const executions=collects.slice(0,12).map(r=>{
  const sum=obj(r.summary)?r.summary:{};
  const counts=x.runCounts?x.runCounts[String(r.id)]??null:null;
  return {id:r.id,slot:r.slot_key,mode:isTick(r.slot_key)?'tick' as const:'slot' as const,
   trigger:typeof sum.trigger==='string'?sum.trigger:null,startedAt:r.started_at,
   delayMinutes:r.start_delay_seconds===null||r.start_delay_seconds===undefined?null:Math.round(Number(r.start_delay_seconds)/60),
   status:r.status,outcome:r.outcome,
   gamesCaptured:Array.isArray(sum.captures)?sum.captures.filter(c=>obj(c)&&c.outcome==='stored').length:
    obj(sum.plan)&&Array.isArray(sum.plan.chosen)?sum.plan.chosen.length:null,
   qualifyingPicks:counts?counts.qualifyingPicks:null,entries:counts?counts.entries:null};
 });

 // Rolling budget (reservations as recorded) and when the oldest in-window credits roll off.
 const charge=(c:{credits:number;effective_credits?:number})=>Number(c.effective_credits??c.credits);
 const in24=x.credits.filter(c=>Date.parse(c.reserved_at)>dayAgo).sort((a,b)=>a.reserved_at.localeCompare(b.reserved_at));
 const used24h=in24.reduce((a,c)=>a+charge(c),0),used30d=x.credits.reduce((a,c)=>a+charge(c),0);
 const pendingRelease=in24.filter(c=>charge(c)>0);
 const nextRelease=pendingRelease.length?{at:new Date(Date.parse(pendingRelease[0].reserved_at)+86400_000).toISOString(),
  credits:pendingRelease.filter(c=>c.reserved_at.slice(0,16)===pendingRelease[0].reserved_at.slice(0,16)).reduce((a,c)=>a+charge(c),0)}:null;
 const budget={daily:x.policy.dailyCredits,monthly:x.policy.monthlyCredits,used24h,used30d,
  remaining24h:Math.max(0,x.policy.dailyCredits-used24h),remaining30d:Math.max(0,x.policy.monthlyCredits-used30d),
  providerRemaining:x.providerRemaining,providerFloor:x.policy.providerFloor,nextRelease,
  countsProviderActuals:x.policy.countsProviderActuals===true};

 // Slates from capture plans: games examined, selected, captured, lines, misses.
 const plans=x.plans??[],caps=x.captures??[];
 const slateDates=[...new Set(plans.map(p=>p.slate_date))].sort().reverse().slice(0,4);
 const slates=slateDates.map(date=>{
  const ps=plans.filter(p=>p.slate_date===date);
  const states=ps.map(p=>({p,state:captureState(p,caps,x.nowIso,CAPTURE_PLAN_V1,plans)}));
  const sc=caps.filter(c=>ps.some(p=>p.provider_event_id===c.provider_event_id));
  const runIds=[...new Set(sc.map(c=>c.run_id))];
  const sumCounts=(k:'qualifyingPicks'|'entries')=>x.runCounts?runIds.reduce((a,id)=>a+(x.runCounts![String(id)]?.[k]??0),0):null;
  return {date,arm:ps.find(p=>p.selected)?.arm??null,gamesExamined:ps.length,selected:ps.filter(p=>p.selected).length,
   captured:states.filter(s=>s.state==='CAPTURED').length,
   linesObserved:sc.filter(c=>c.capture_key!=='recheck').reduce((a,c)=>a+(c.dfs_lines??0),0),
   qualifyingPicks:sumCounts('qualifyingPicks'),entries:sumCounts('entries'),
   games:states.filter(s=>s.p.selected).map(({p,state})=>{const w=planWindows(p,plans);
    const c=caps.filter(v=>v.provider_event_id===p.provider_event_id).sort((a,b)=>a.claimed_at.localeCompare(b.claimed_at));
    return {event:p.provider_event_id,matchup:`${p.away_team} @ ${p.home_team}`,tipoff:p.commence_time,arm:p.arm,state,
     window:p.arm==='early'?{from:w.earlyFrom,to:w.earlyTo}:{from:w.lateFrom,to:w.lateTo},
     captures:c.map(v=>({key:v.capture_key,window:v.window_name,at:v.claimed_at,outcome:v.outcome,lines:v.dfs_lines,minutesToTip:v.minutes_to_tip??null}))};})};
 });

 // Missing or late collection windows, legacy and tick alike.
 const missing:{when:string;what:string;why:string}[]=[];
 for(const s of slotStatus(x.runs,x.nowIso,2,x.runCounts).filter(r=>r.kind==='collect'&&Date.parse(r.scheduledFor)<=now)){
  if(s.state==='NO_RUN_RECORDED'&&!x.ticksReleased)missing.push({when:s.scheduledFor,what:'Collect slot',why:'No run recorded'});
  else if(s.state==='SKIPPED')missing.push({when:s.scheduledFor,what:'Collect slot',why:s.outcome==='BUDGET_EXHAUSTED'?'Rolling 24-hour credits already used':s.note??s.outcome??'Skipped'});
  else if(s.startDelayMinutes!==null&&s.startDelayMinutes>60)missing.push({when:s.scheduledFor,what:'Collect slot',why:`Started ${s.startDelayMinutes} min late`});
 }
 for(const sl of slates)for(const g of sl.games)if(MISSING.includes(g.state))
  missing.push({when:g.window.to,what:g.matchup,why:{MISSED:'No tick ran inside its capture window',NO_LINES_FOUND:'No PrizePicks/Pick6 lines were posted when captured',
   BUDGET_REFUSED:'Credits were not available inside its window',FAILED:'The capture request failed (not retried)',
   ATTEMPT_UNRESOLVED:'A capture started but its outcome was not recorded (never retried automatically)'}[g.state as string]??g.state});

 // Why the latest completed collect made no entries (per platform).
 const withEntries=collects.find(r=>r.status==='completed'&&obj(r.summary)&&obj(r.summary.entries));
 const noEntryReasons=withEntries?Object.entries(withEntries.summary!.entries as Record<string,unknown>).flatMap(([platform,v])=>{
  if(!obj(v))return [];const made=Array.isArray(v.entries)?v.entries.filter(e=>!(obj(e)&&e.outcome==='REFUSED')).length:0;
  const r=typeof v.noEntryReason==='string'?v.noEntryReason:null;
  return !made&&r?[{platform,reason:r,text:NO_ENTRY_TEXT[r as NoEntryReason]??r,at:withEntries.finished_at}]:[];}):[];

 // Next planned collection: the next capture window while ticks are released; otherwise the next legacy slot.
 const active=x.scheduledRunsEnabled&&x.controlState==='RUNNING';
 const tickNext=x.plans?nextWindowOpen(plans,caps,x.nowIso):null;
 const slotNext=nextPlannedRuns(x.nowIso,4).find(r=>r.kind==='collect')??null;
 const next=!active?null:x.ticksReleased?(tickNext?{at:tickNext.at,what:`${tickNext.matchup} · ${tickNext.window.toUpperCase()} window opens`,source:'capture-window' as const}:null):
  slotNext?{at:slotNext.at,what:'Collect slot',source:'slot' as const}:null;

 const recent=collects.filter(r=>Date.parse(r.started_at)>now-48*3600_000);
 const stages={
  planned:x.ticksReleased?plans.filter(p=>p.selected&&!caps.some(c=>c.provider_event_id===p.provider_event_id&&c.capture_key==='primary')&&
   Date.parse(p.commence_time)-now>CAPTURE_PLAN_V1.windows.late.toMin*60_000).length:nextPlannedRuns(x.nowIso,8).filter(r=>r.kind==='collect'&&Date.parse(r.at)-now<36*3600_000).length,
  completedJobs:recent.filter(r=>r.status==='completed').length,
  recordedPicks:x.runCounts?recent.reduce((a,r)=>a+(x.runCounts![String(r.id)]?.qualifyingPicks??0),0):null,
  virtualEntries:x.runCounts?recent.reduce((a,r)=>a+(x.runCounts![String(r.id)]?.entries??0),0):null};
 return {mode:x.ticksReleased?'ticks' as const:'slots' as const,capturesAvailable:x.plans!==null,lastSuccess,next,executions,budget,slates,
  missing:missing.sort((a,b)=>b.when.localeCompare(a.when)).slice(0,12),noEntryReasons,stages};
}
export type CollectionStatus=ReturnType<typeof collectionStatus>;

/** The collection status from a loaded dashboard ledger, with the live release switches. Shared by every page and the assistant. */
export function collectionStatusFromRaw(raw:Raw):CollectionStatus{
 return collectionStatus({nowIso:raw.nowIso,runs:raw.runs as CollectionInput['runs'],credits:raw.credits,providerRemaining:raw.providerRemaining,runCounts:raw.runCounts??null,
  plans:(raw.capturePlans??null) as CollectionInput['plans'],captures:(raw.captures??null) as CollectionInput['captures'],
  policy:{...effectiveBudgetPolicy(raw.budgetPolicy),countsProviderActuals:raw.budgetPolicy?.count_provider_actuals===true},
  ticksReleased:ticksReleased(),scheduledRunsEnabled:PROPS_RELEASE.scheduledRunsEnabled,controlState:raw.control?.state??null});
}
