/**
 * Event-aware collection tick (props-capture-v1) for NBA player-prop PAPER testing. Worker side.
 *
 *   free events list -> plan new slates once (outcome-blind) -> captures whose window is open now, within
 *   budget -> claim (unique) -> reserve -> one event-odds request -> store lines -> predict immediately with
 *   the active model -> record picks (never for closing rechecks) -> virtual entries before lock -> receipt.
 *
 * Ticks are idempotent: lateness only changes which windows are open, a duplicate trigger in the same
 * 30-minute bucket is refused by the run ledger, and a capture is claimed in the database before any paid
 * request so it can never be repeated by another trigger. No rule, threshold or entry limit is relaxed.
 */
import {PropsStoreError} from './props-store.ts';
import {ProviderError} from './props-odds-client.ts';
import {begin,finish,heartbeat,paidCall,storeRaw,storeEventReply,predictAndPick,recordMarketViews,recordEntries,
 ago,inList,type CycleDeps,type CycleResult,type ObsRow,type BookQuoteTally} from './props-cycle.ts';
import {loadActiveModel} from './props-active-model.ts';
import {parseEventList,type ListedEvent,type BookQuote} from '../props/normalize.ts';
import {CAPTURE_PLAN_V1,planSlates,dueCaptures,captureState,slateDateOf,nextWindowOpen,
 type PlanRow,type CaptureRow,type CaptureKey} from '../props/capture-plan.ts';
import {canSpend,type BudgetPolicy,type BudgetState} from '../props/budget.ts';
import {MODEL_VERSION,SELECTION_VERSION,PLATFORMS,SPORTSBOOKS} from '../props/contract.ts';

const q=encodeURIComponent;
type DbPlan=PlanRow&{id:number};
type DbCapture={id:number;plan_id:number;provider_event_id:string;capture_key:CaptureKey;window_name:'early'|'late';claimed_at:string};
type DbOutcome={capture_id:number;outcome:string;dfs_lines:number|null};

/** The database's active budget policy (authoritative) and the effective rolling use it implies. */
export async function tickBudget(d:CycleDeps):Promise<{policy:BudgetPolicy;state:BudgetState;countsActuals:boolean}>{
 const now=d.now();
 const base='select=version,daily_credits,monthly_credits,provider_floor';
 const where='&active_from=lte.'+q(now)+'&order=active_from.desc&limit=1';
 // count_provider_actuals exists only once props_budget_v3_actuals.sql is applied (owner approval); absent = false.
 let pol:Record<string,unknown>|undefined;
 try{[pol]=await d.store.select<Record<string,unknown>>('props_budget_policy',base+',count_provider_actuals'+where);}
 catch{[pol]=await d.store.select<Record<string,unknown>>('props_budget_policy',base+where);}
 if(!pol)throw new PropsStoreError('BUDGET_POLICY_MISSING',true);
 const countsActuals=pol.count_provider_actuals===true;
 const rows=await d.store.select<{id:number;credits:number;reserved_at:string}>('props_credit_reservations',
  'select=id,credits,reserved_at&reserved_at=gt.'+q(ago(now,30*86400_000))+'&limit=10000');
 const charged=new Map<number,number>();
 if(countsActuals&&rows.length)for(let i=0;i<rows.length;i+=150){
  for(const u of await d.store.select<{reservation_id:number;requests_last:number|null}>('props_provider_usage',
   'select=reservation_id,requests_last&reservation_id='+inList(rows.slice(i,i+150).map(r=>Number(r.id)))+'&limit=1000'))
   if(u.requests_last!==null)charged.set(Number(u.reservation_id),Number(u.requests_last));
 }
 const eff=(r:{id:number;credits:number})=>{const c=charged.get(Number(r.id));return c===undefined?Number(r.credits):Math.min(Number(r.credits),c);};
 const dayAgo=Date.parse(now)-86400_000;
 const usage=await d.store.select<{requests_remaining:number}>('props_provider_usage',
  'select=requests_remaining&requests_remaining=not.is.null&order=recorded_at.desc,id.desc&limit=1');
 return {countsActuals,policy:{version:String(pol.version),dailyCredits:Number(pol.daily_credits),monthlyCredits:Number(pol.monthly_credits),
  providerFloor:Number(pol.provider_floor),maxEventsPerRun:0},
  state:{used24h:rows.filter(r=>Date.parse(r.reserved_at)>dayAgo).reduce((a,r)=>a+eff(r),0),used30d:rows.reduce((a,r)=>a+eff(r),0),
   providerRemaining:usage.length?Number(usage[0].requests_remaining):null}};
}

async function loadPlans(d:CycleDeps,fromSlate:string){
 const plans=await d.store.select<DbPlan>('props_capture_plans','select=id,plan_version,slate_date,provider_event_id,home_team,away_team,'+
  'commence_time,selected,selection_rank,arm,reason,planned_at&plan_version=eq.'+CAPTURE_PLAN_V1.version+'&slate_date=gte.'+fromSlate+'&order=id.asc&limit=500');
 const caps=plans.length?await d.store.select<DbCapture>('props_captures','select=id,plan_id,provider_event_id,capture_key,window_name,claimed_at'+
  '&plan_id='+inList(plans.map(p=>Number(p.id)))+'&limit=2000'):[];
 const outs=caps.length?await d.store.select<DbOutcome>('props_capture_outcomes','select=capture_id,outcome,dfs_lines&capture_id='+
  inList(caps.map(c=>Number(c.id)))+'&limit=2000'):[];
 const norm=(p:DbPlan):DbPlan=>({...p,commence_time:new Date(p.commence_time).toISOString(),slate_date:String(p.slate_date).slice(0,10)});
 const captures:CaptureRow[]=caps.map(c=>{const o=outs.find(x=>Number(x.capture_id)===Number(c.id));
  return {provider_event_id:c.provider_event_id,capture_key:c.capture_key,window_name:c.window_name,claimed_at:new Date(c.claimed_at).toISOString(),
   outcome:o?o.outcome:null,dfs_lines:o&&o.dfs_lines!==null?Number(o.dfs_lines):null};});
 return {plans:plans.map(norm),captures};
}

export async function runTick(d:CycleDeps,slot:string,scheduledFor:string|null=null):Promise<CycleResult>{
 const start=await begin(d,'collect',slot,scheduledFor);
 if(start.outcome!=='STARTED'||!start.runId)return {kind:'collect',outcome:start.outcome,runId:start.runId??null,summary:{...start}};
 const runId=start.runId;
 const s:Record<string,unknown>={mode:'tick',planVersion:CAPTURE_PLAN_V1.version,startDelaySeconds:start.startDelaySeconds??null,
  abandonedRecovered:start.abandoned??0,modelVersion:MODEL_VERSION,trigger:d.trigger??null};
 try{
  if(!d.odds){await finish(d,runId,false,'ODDS_NOT_CONFIGURED',s);return {kind:'collect',outcome:'ODDS_NOT_CONFIGURED',runId,summary:s};}
  const odds=d.odds;const now=d.now();
  // 1. Free events list for the next 36 hours (no reservation; a non-zero charge stops all spending).
  let ev;
  try{ev=await odds.events({from:now,to:new Date(Date.parse(now)+CAPTURE_PLAN_V1.eventsHorizonHours*3600_000).toISOString()});}
  catch(e){s.events={error:e instanceof ProviderError?e.code:'UNKNOWN'};await finish(d,runId,false,'PROVIDER_EVENTS_FAILED',s);
   return {kind:'collect',outcome:'PROVIDER_EVENTS_FAILED',runId,summary:s};}
  s.events={httpStatus:ev.httpStatus,costLast:ev.usage.last,remaining:ev.usage.remaining};
  if(!ev.ok){await finish(d,runId,false,'PROVIDER_EVENTS_FAILED',s);return {kind:'collect',outcome:'PROVIDER_EVENTS_FAILED',runId,summary:s};}
  if(ev.usage.last!==null&&ev.usage.last>0){
   // The provider charged for a call documented (and observed) as free: stop before any paid request.
   await finish(d,runId,false,'EVENTS_LIST_CHARGED',s);return {kind:'collect',outcome:'EVENTS_LIST_CHARGED',runId,summary:s};
  }
  await storeRaw(d,runId,'the_odds_api','events','nba',ev.httpStatus,ev.receivedAt,ev.body);
  const listed=parseEventList(ev.body,now);
  (s.events as Record<string,unknown>).listed=listed.events.length;(s.events as Record<string,unknown>).startedOrPast=listed.startedOrPast;
  const budget=await tickBudget(d);s.budgetBefore={...budget.state,policy:budget.policy.version,countsProviderActuals:budget.countsActuals};

  // 2. Plan slates seen for the first time (written before any of their lines are requested).
  const fromSlate=slateDateOf(ago(now,36*3600_000));
  let {plans,captures}=await loadPlans(d,fromSlate);
  const fresh=planSlates({events:listed.events,existing:plans,nowIso:now,policy:budget.policy});
  if(fresh.length){
   const rows=fresh.map(p=>({...p,run_id:runId}));
   await d.store.insert('props_capture_plans',rows,{onConflict:'plan_version,provider_event_id',ignoreDuplicates:true});
   ({plans,captures}=await loadPlans(d,fromSlate));
  }
  s.planned={newRows:fresh.length,newSelected:fresh.filter(p=>p.selected).length};

  // 3. Captures due now, in priority order and within budget.
  const plan=dueCaptures({plans,captures,nowIso:now,policy:budget.policy,state:budget.state});
  s.deferred=plan.deferred;
  const observed:{obs:ObsRow;event:ListedEvent}[]=[];const quotes:BookQuote[]=[];const observeOnly=new Set<number>();
  const bookQuotes:BookQuoteTally={inserted:0,byBook:Object.fromEntries(SPORTSBOOKS.map(b=>[b,0]))};
  const done:Record<string,unknown>[]=[];
  for(const due of plan.due){
   await heartbeat(d,runId);
   const p=due.plan as DbPlan;const ev0:ListedEvent={id:p.provider_event_id,commenceTime:p.commence_time,homeTeam:p.home_team,awayTeam:p.away_team};
   // Re-check spendability right before claiming (the rolling window moves; another trigger may have spent).
   const fresh24=await tickBudget(d);
   if(!canSpend(fresh24.policy,fresh24.state,CAPTURE_PLAN_V1.creditsPerGame).allowed){done.push({event:p.provider_event_id,key:due.captureKey,skipped:'budget_changed'});continue;}
   const claim=await d.store.insert<{id:number}>('props_captures',[{plan_id:p.id,provider_event_id:p.provider_event_id,run_id:runId,
    capture_key:due.captureKey,window_name:due.window,fallback:due.fallback}],{onConflict:'plan_id,capture_key',ignoreDuplicates:true,select:'id'});
   if(!claim.length){done.push({event:p.provider_event_id,key:due.captureKey,skipped:'already_claimed'});continue;}
   const captureId=Number(claim[0].id);
   const minutesToTip=Math.round((Date.parse(p.commence_time)-Date.parse(d.now()))/6000)/10;
   const r=await paidCall(d,runId,'event_odds',p.provider_event_id,CAPTURE_PLAN_V1.creditsPerGame,()=>odds.eventOdds(p.provider_event_id));
   let out:Record<string,unknown>;
   if(r.kind==='refused')out={outcome:'budget_refused'};
   else if(r.kind==='provider_error')out={outcome:'provider_error'};
   else if(!r.reply.ok)out={outcome:'provider_http',reservation_id:r.reservation,http_status:r.reply.httpStatus,provider_cost_last:r.reply.usage.last};
   else{
    const stored=await storeEventReply(d,runId,ev0,r.reply,r.rawId,{observed,quotes,bookQuotes});
    if(due.captureKey==='recheck')for(const o of stored.inserted)observeOnly.add(Number(o.id));
    const dfs=stored.norm.observations.length;
    out={outcome:stored.norm.eventLocked?'event_locked':dfs?'stored':'no_dfs_lines',reservation_id:r.reservation,http_status:r.reply.httpStatus,
     provider_cost_last:r.reply.usage.last,dfs_lines:dfs,lines_by_platform:stored.byPlatform};
   }
   await d.store.insert('props_capture_outcomes',[{capture_id:captureId,minutes_to_tip:minutesToTip,...out}],{onConflict:'capture_id',ignoreDuplicates:true});
   const row={provider_event_id:p.provider_event_id,capture_key:due.captureKey,window_name:due.window,claimed_at:d.now(),
    outcome:String(out.outcome),dfs_lines:typeof out.dfs_lines==='number'?out.dfs_lines:null} as CaptureRow;
   captures=[...captures,row];
   done.push({event:p.provider_event_id,matchup:`${p.away_team} @ ${p.home_team}`,key:due.captureKey,window:due.window,arm:p.arm,
    fallback:due.fallback,minutesToTip,...Object.fromEntries(Object.entries(out).filter(([k])=>k!=='reservation_id'))});
   if(out.outcome==='budget_refused')break;
  }
  s.captures=done;s.bookQuotes=bookQuotes;

  // 4. Predict immediately with the active model, record picks (not for rechecks), market views, entries.
  if(observed.length){
   await heartbeat(d,runId);
   const active=await loadActiveModel(d.store);
   s.activeModel={version:active.version,fallback:active.fallback,shadows:active.shadows.map(x=>x.version)};
   const picked=await predictAndPick(d,runId,observed,quotes,active,observeOnly);
   s.predictions=picked.out;s.marketViews=await recordMarketViews(d,picked.views);
   s.entries=await recordEntries(d,runId,picked.out.selectionVersion);
  }

  // 5. Receipt read back from the durable rows, and the plan state of every game in the open slates.
  const [o,p2,k,e]=await Promise.all([
   d.store.select<{id:number}>('props_observations','select=id&run_id=eq.'+runId+'&limit=5000'),
   d.store.select<{id:number}>('props_predictions','select=id&run_id=eq.'+runId+'&limit=5000'),
   d.store.select<{id:number;status:string}>('props_picks','select=id,status&run_id=eq.'+runId+'&limit=5000'),
   d.store.select<{id:number}>('props_entries','select=id&run_id=eq.'+runId+'&limit=500')]);
  s.receipt={observations:o.length,predictions:p2.length,decisions:k.length,qualifyingPicks:k.filter(x=>x.status==='recorded').length,
   skippedDecisions:k.filter(x=>x.status!=='recorded').length,entriesCreated:e.length,observeOnlyLines:observeOnly.size,
   selectionVersion:(s.predictions as {selectionVersion?:string}|undefined)?.selectionVersion??SELECTION_VERSION};
  const slates:Record<string,Record<string,number>>={};
  for(const pl of plans){const st=captureState(pl,captures,d.now());const b=slates[pl.slate_date]??={};b[st]=(b[st]??0)+1;}
  s.slates=slates;s.next=nextWindowOpen(plans,captures,d.now());
  s.platforms=PLATFORMS;
  const outcome=done.some(x=>x.outcome==='stored')?'COMPLETED':plan.due.length?'NO_LINES_CAPTURED':'NOTHING_DUE';
  await finish(d,runId,true,outcome,s);
  return {kind:'collect',outcome,runId,summary:s};
 }catch(err){
  const code=err instanceof PropsStoreError?err.code:err instanceof ProviderError?err.code:'UNEXPECTED';
  s.error=code;await finish(d,runId,false,'FAILED_'+code.replace(/[^A-Z0-9_]/g,'_').slice(0,50),s);
  return {kind:'collect',outcome:'FAILED',runId,summary:s};
 }
}
