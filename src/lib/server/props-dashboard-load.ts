/**
 * Read-only loader for the player-prop paper dashboard (last 14 days). SERVER ONLY by use: imported
 * from props-dashboard.ts, kept free of `server-only` so it can be tested. Every id list is read in
 * chunks so no request exceeds the store's query-length cap however busy the fortnight was.
 */
import type {PropsStore} from './props-store.ts';
import type {Raw} from '../props/dashboard-view.ts';
import type {Stat} from '../props/contract.ts';

const IDS=150;
async function byIds<T>(store:PropsStore,table:string,select:string,column:string,ids:number[],limit=5000):Promise<T[]>{
 const out:T[]=[];
 const unique=[...new Set(ids)];
 for(let i=0;i<unique.length;i+=IDS)out.push(...await store.select<T>(table,'select='+select+'&'+column+'=in.('+unique.slice(i,i+IDS).join(',')+')&limit='+limit));
 return out;
}

export async function loadPropsDashboardFrom(store:PropsStore,nowIso:string):Promise<Raw>{
 const now=Date.parse(nowIso);
 const since=encodeURIComponent(new Date(now-14*86400_000).toISOString());
 const [control,runs,credits,usage,observations,accounts,entries]=await Promise.all([
  store.select<Raw['control']&object>('props_control','select=state,reason,changed_at&id=eq.1'),
  store.select<Raw['runs'][number]>('props_runs','select=id,kind,slot_key,status,outcome,started_at,finished_at,start_delay_seconds,summary&order=id.desc&limit=30'),
  store.select<Raw['credits'][number]>('props_credit_reservations','select=id,credits,reserved_at&reserved_at=gt.'+
   encodeURIComponent(new Date(now-30*86400_000).toISOString())+'&limit=10000'),
  store.select<{requests_remaining:number}>('props_provider_usage','select=requests_remaining&requests_remaining=not.is.null&order=recorded_at.desc,id.desc&limit=1'),
  store.select<Raw['observations'][number]>('props_observations','select=id,run_id,platform,provider_event_id,home_team,away_team,lock_at,player_name,stat,line,provider_last_update,ingested_at'+
   '&lock_at=gt.'+since+'&order=lock_at.desc&limit=3000'),
  store.select<Raw['accounts'][number]>('props_accounts','select=id,slug,platform,selection_version,initial_cents,stake_cents,max_entries_per_day&order=id.asc&limit=10'),
  store.select<Raw['entries'][number]>('props_entries','select=id,account_id,stake_cents,lock_at,created_at,payout_terms_version&order=id.desc&limit=500'),
 ]);
 // The database policy is authoritative; the source-code policy is only a fallback if it is unavailable.
 // In v3, completed provider receipts replace worst-case reservations, but an unknown charge remains
 // reserved in full. The same effective amounts feed both the collection panel and the props dashboard.
 const budgetPolicy=await optional(()=>loadBudgetPolicy(store,nowIso),null);
 const actuals=budgetPolicy?.count_provider_actuals
  ?await optional(()=>loadActualCosts(store,credits),null):null;
 const effectiveCredits=credits.map(r=>({...r,effective_credits:budgetPolicy?.count_provider_actuals
  ?Math.min(Number(r.credits),actuals?.get(Number(r.id??-1))??Number(r.credits)):Number(r.credits)}));
 const obsIds=observations.map(o=>o.id);
 const predictions=await byIds<Raw['predictions'][number]>(store,'props_predictions',
  'id,observation_id,model_version,status,reason,p_more,p_less,p_tie,mean,inputs','observation_id',obsIds);
 const [picks,results]=await Promise.all([
  byIds<Raw['picks'][number]>(store,'props_picks','id,prediction_id,status,side,reason,selection_version','prediction_id',predictions.map(p=>p.id)),
  byIds<Raw['results'][number]>(store,'props_line_results','observation_id,revision,outcome,actual','observation_id',obsIds,10000),
 ]);
 const entryIds=entries.map(e=>e.id);
 const [legs,settlements]=await Promise.all([
  byIds<Raw['legs'][number]>(store,'props_entry_legs','entry_id,pick_id','entry_id',entryIds),
  byIds<Raw['settlements'][number]>(store,'props_entry_settlements','entry_id,outcome,wins,losses,voids,return_cents,profit_cents,settled_at','entry_id',entryIds),
 ]);
 const [model,views,report]=await Promise.all([loadModel(store),
  optional(()=>byIds<NonNullable<Raw['views']>[number]>(store,'props_market_views',
   'observation_id,books_at_same_line,p_more_books,line_gap,nearest_book_line,flags','observation_id',obsIds),[]),
  optional(async()=>(await store.select<NonNullable<Raw['report']>>('props_learning_reports',
   'select=period_from,period_to,model_version,at,report&order=id.desc&limit=1'))[0]??null,null)]);
 const runCounts=await optional(()=>countsByRun(store,runs.filter(r=>r.kind==='collect').map(r=>r.id)),null);
 const {capturePlans,captures}=await optional<{capturePlans:Raw['capturePlans'];captures:Raw['captures']}>(()=>loadCaptures(store,now),{capturePlans:null,captures:null});
 return {nowIso,control:control[0]??null,runs,credits:effectiveCredits,budgetPolicy,runCounts,providerRemaining:usage.length?Number(usage[0].requests_remaining):null,
  observations,predictions,picks,results,accounts,entries,legs,settlements,model,views,report,capturePlans,captures};
}

/** Read the actual active policy, including pre-v3 schemas where the optional column is absent. */
async function loadBudgetPolicy(store:PropsStore,nowIso:string):Promise<NonNullable<Raw['budgetPolicy']>>{
 const base='select=version,daily_credits,monthly_credits,provider_floor';
 const tail='&active_from=lte.'+encodeURIComponent(nowIso)+'&order=active_from.desc&limit=1';
 try{
  const [p]=await store.select<NonNullable<Raw['budgetPolicy']>>('props_budget_policy',base+',count_provider_actuals'+tail);
  if(!p)throw new Error('PROPS_BUDGET_POLICY_MISSING');
  return {...p,count_provider_actuals:p.count_provider_actuals===true};
 }catch(err){
  // Only fall back for the pre-v3 column; a missing/failed table still fails closed to a null policy.
  const [p]=await store.select<Omit<NonNullable<Raw['budgetPolicy']>,'count_provider_actuals'>>('props_budget_policy',base+tail);
  if(!p)throw err;
  return {...p,count_provider_actuals:false};
 }
}
/** Provider receipts are unique per reservation. Unknown costs are deliberately not assumed free. */
async function loadActualCosts(store:PropsStore,credits:Raw['credits']):Promise<Map<number,number>>{
 const ids=credits.map(c=>Number(c.id)).filter(n=>Number.isSafeInteger(n)&&n>0);
 const rows=await byIds<{reservation_id:number;requests_last:number|null}>(store,'props_provider_usage',
  'reservation_id,requests_last','reservation_id',ids);
 return new Map(rows.filter(r=>r.requests_last!==null&&Number.isSafeInteger(Number(r.requests_last))&&Number(r.requests_last)>=0)
  .map(r=>[Number(r.reservation_id),Number(r.requests_last)]));
}

/** Decisions, qualifying picks and entries per collect run, from the immutable pick and entry rows. */
async function countsByRun(store:PropsStore,runIds:number[]){
 const out:Record<string,{decisions:number;qualifyingPicks:number;entries:number}>={};
 if(!runIds.length)return out;
 for(const id of runIds)out[id]={decisions:0,qualifyingPicks:0,entries:0};
 const [picks,entries]=await Promise.all([
  byIds<{run_id:number;status:string}>(store,'props_picks','run_id,status','run_id',runIds,20000),
  byIds<{run_id:number}>(store,'props_entries','run_id','run_id',runIds,5000)]);
 if(picks.length>=20000||entries.length>=5000)throw new Error('PROPS_RUN_COUNTS_TRUNCATED');  // never show a partial count
 for(const p of picks){const c=out[p.run_id];if(!c)continue;c.decisions++;if(p.status==='recorded')c.qualifyingPicks++;}
 for(const e of entries){const c=out[e.run_id];if(c)c.entries++;}
 return out;
}
/** Tables from later migrations may be absent; the dashboard then shows them as not set up, never as zero. */
async function optional<T>(f:()=>Promise<T>,fallback:T):Promise<T>{try{return await f();}catch{return fallback;}}
async function loadModel(store:PropsStore):Promise<Raw['model']>{
 return optional(async()=>{
  const [[c],events]=await Promise.all([
   store.select<{active_model_version:string;previous_model_version:string|null;learning_enabled:boolean;auto_switch_enabled:boolean}>(
    'props_model_control','select=active_model_version,previous_model_version,learning_enabled,auto_switch_enabled'),
   store.select<NonNullable<Raw['model']>['events'][number]>('props_model_events','select=id,version,event,reason,detail,at&order=id.desc&limit=200')]);
  if(!c)return null;
  let weights:Record<Stat,number[]>|null=null;
  if(/^props-learn-v[0-9]+$/.test(c.active_model_version)){
   const [a]=await store.select<{artifact:{weights?:Record<Stat,number[]>}}>('props_model_artifacts',
    'select=artifact&version=eq.'+encodeURIComponent(c.active_model_version));
   weights=a?.artifact?.weights??null;
  }
  return {active:c.active_model_version,previous:c.previous_model_version,learningEnabled:c.learning_enabled,
   autoSwitchEnabled:c.auto_switch_enabled,weights,events};
 },null);
}

/** Capture plans (last 21 slates) with their claims and outcomes. Throws when the tables are absent (caller maps to null). */
async function loadCaptures(store:PropsStore,now:number):Promise<{capturePlans:NonNullable<Raw['capturePlans']>;captures:NonNullable<Raw['captures']>}>{
 const from=new Date(now-21*86400_000).toISOString().slice(0,10);
 const plans=await store.select<NonNullable<Raw['capturePlans']>[number]&{id:number}>('props_capture_plans',
  'select=id,plan_version,slate_date,provider_event_id,home_team,away_team,commence_time,selected,selection_rank,arm,reason,planned_at'+
  '&slate_date=gte.'+from+'&order=id.asc&limit=1000');
 const claims=await byIds<{id:number;plan_id:number;run_id:number;provider_event_id:string;capture_key:'primary'|'retry'|'recheck';window_name:'early'|'late';claimed_at:string}>(
  store,'props_captures','id,plan_id,run_id,provider_event_id,capture_key,window_name,claimed_at','plan_id',plans.map(p=>Number(p.id)));
 const outs=await byIds<{capture_id:number;outcome:string;dfs_lines:number|null;minutes_to_tip:number|null;lines_by_platform:Record<string,number>|null}>(
  store,'props_capture_outcomes','capture_id,outcome,dfs_lines,minutes_to_tip,lines_by_platform','capture_id',claims.map(c=>Number(c.id)));
 const iso=(t:string)=>new Date(t).toISOString();
 return {capturePlans:plans.map(p=>({plan_version:p.plan_version,provider_event_id:p.provider_event_id,home_team:p.home_team,away_team:p.away_team,
  selected:p.selected,selection_rank:p.selection_rank,arm:p.arm,reason:p.reason,slate_date:String(p.slate_date).slice(0,10),commence_time:iso(p.commence_time),planned_at:iso(p.planned_at)})),
  captures:claims.map(c=>{const o=outs.find(x=>Number(x.capture_id)===Number(c.id));
   return {run_id:Number(c.run_id),provider_event_id:c.provider_event_id,capture_key:c.capture_key,window_name:c.window_name,claimed_at:iso(c.claimed_at),
    outcome:o?.outcome??null,dfs_lines:o&&o.dfs_lines!==null?Number(o.dfs_lines):null,minutes_to_tip:o&&o.minutes_to_tip!==null?Number(o.minutes_to_tip):null,
    lines_by_platform:o?.lines_by_platform??null};})};
}
