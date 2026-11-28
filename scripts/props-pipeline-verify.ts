/**
 * Read-only NBA props pipeline verifier (GitHub Actions with the existing props secrets). PostgREST GET only:
 * the store handed to this script exposes select() and nothing else, so no insert or RPC is reachable.
 * Never calls a paid provider. Prints one JSON report (src/lib/props/pipeline-verify.ts) and exits 0 even when
 * issues are found: the report is evidence for review, not a gate that changes anything.
 *   FROM: ISO date, default 2026-11-07 (first paper collection)
 */
import {writeFileSync} from 'node:fs';
import {propsStore,propsStoreConfig} from '../src/lib/server/props-store.ts';
import {verifyPipeline,type Input} from '../src/lib/props/pipeline-verify.ts';

const FROM=(process.env.FROM||'2026-11-07')+'T00:00:00Z';
if(!/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(FROM))throw new Error('FROM must be YYYY-MM-DD');
const full=propsStore();
const read={select:full.select.bind(full)};   // GET only
const q=encodeURIComponent;
async function all<T>(table:string,query:string,order='id'):Promise<T[]>{
 const out:T[]=[];
 for(let offset=0;offset<100_000;offset+=1000){
  const page=await read.select<T>(table,query+'&order='+order+'.asc&limit=1000&offset='+offset);
  out.push(...page);if(page.length<1000)return out;
 }
 throw new Error('VERIFY_PAGE_LIMIT '+table);
}
async function optional<T>(table:string,query:string,order='id'):Promise<{rows:T[];state:string}>{
 try{return {rows:await all<T>(table,query,order),state:'READ'};}catch(e){return {rows:[],state:'UNREADABLE:'+((e as {code?:string}).code??'ERROR')};}
}
const since='gte.'+q(FROM);
const observations=await all<Input['observations'][number]>('props_observations',
 'select=id,run_id,platform,provider_event_id,player_name,stat,line,lock_at,commence_time,provider_last_update,ingested_at&lock_at='+since);
const obsIds=new Set(observations.map(o=>o.id));
const predictions=(await all<Input['predictions'][number]>('props_predictions',
 'select=id,observation_id,model_version,status,p_more,p_less,p_tie,predicted_at,data_cutoff&predicted_at='+since)).filter(p=>obsIds.has(p.observation_id));
const predIds=new Set(predictions.map(p=>p.id));
const picks=(await all<Input['picks'][number]>('props_picks','select=id,prediction_id,run_id,selection_version,status,side,reason,decided_at&decided_at='+since))
 .filter(k=>predIds.has(k.prediction_id));
const entries=await all<Input['entries'][number]>('props_entries','select=id,account_id,run_id,pick_count,stake_cents,lock_at,created_at&created_at='+since);
const entryIds=new Set(entries.map(e=>e.id));
const legs=(await all<Input['legs'][number]>('props_entry_legs','select=entry_id,pick_id','pick_id')).filter(l=>entryIds.has(l.entry_id));
const results=(await all<Input['results'][number]>('props_line_results','select=id,observation_id,revision,outcome,graded_at&graded_at='+since)).filter(r=>obsIds.has(r.observation_id));
const settlements=(await all<Input['settlements'][number]>('props_entry_settlements','select=entry_id,outcome,settled_at','entry_id')).filter(s=>entryIds.has(s.entry_id));
const accounts=await read.select<Input['accounts'][number]>('props_accounts','select=id,slug,platform,selection_version&limit=50');
const views=(await optional<Input['views'][number]>('props_market_views','select=id,observation_id,run_id,flags'));
const plans=await optional<Input['plans'][number]>('props_capture_plans','select=id,slate_date,provider_event_id,selected,commence_time,planned_at&commence_time='+since);
const claims=await optional<Input['claims'][number]>('props_captures','select=id,plan_id,run_id,provider_event_id,capture_key,claimed_at&claimed_at='+since);
const claimOutcomes=await optional<Input['claimOutcomes'][number]>('props_capture_outcomes','select=capture_id,outcome,dfs_lines,minutes_to_tip&recorded_at='+since,'capture_id');
const runs=await all<Input['runs'][number]>('props_runs','select=id,kind,slot_key,status,outcome,started_at,start_delay_seconds&started_at='+since);
const pennyCohorts=await optional<Input['pennyCohorts'][number]>('props_penny_cohorts','select=id,registered_at');
const pennyEntries=await optional<Input['pennyEntries'][number]>('props_penny_entries',
 'select=id,source_entry_id,probability_ppm,payout_multiplier_milli,stake_cents,reference_stake_cents,reason,recorded_at,lock_at,inputs');
const pennySettlements=await optional<Input['pennySettlements'][number]>('props_penny_settlements',
 'select=id,penny_entry_id,revision,grade_ids,outcome,multiplier_milli,return_cents,profit_cents,reference_return_cents,reference_profit_cents,recorded_at');

const report={
 databaseHost:propsStoreConfig().host,from:FROM,readOnly:true,
 tableStates:{props_market_views:views.state,props_capture_plans:plans.state,props_captures:claims.state,props_capture_outcomes:claimOutcomes.state,
  props_penny_cohorts:pennyCohorts.state,props_penny_entries:pennyEntries.state,props_penny_settlements:pennySettlements.state},
 rows:{observations:observations.length,predictions:predictions.length,picks:picks.length,entries:entries.length,legs:legs.length,results:results.length,
  settlements:settlements.length,runs:runs.length,plans:plans.rows.length,claims:claims.rows.length},
 ...verifyPipeline({nowIso:new Date().toISOString(),observations,predictions,picks,entries,legs,results,settlements,accounts,views:views.rows,
  plans:plans.rows,claims:claims.rows,claimOutcomes:claimOutcomes.rows,runs,pennyCohorts:pennyCohorts.rows,pennyEntries:pennyEntries.rows,
  pennySettlements:pennySettlements.rows}),
};
const out=process.argv[2];
if(out)writeFileSync(out,JSON.stringify(report,null,1));
console.log(JSON.stringify(report,null,1));
