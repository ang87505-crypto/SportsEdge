import 'server-only';
/** Read-only loader for the player-prop paper dashboard (last 14 days). */
import {propsStore,propsStoreConfig} from './props-store';
import type {Raw} from '@/lib/props/dashboard-view';

export function propsDashboardConfigured(){
 // Synthetic Preview deployments never read a real ledger.
 if(process.env.SPORTSEDGE_PREVIEW_FIXTURES==='1')return false;
 try{propsStoreConfig();return true;}catch{return false;}
}
const ids=(xs:number[])=>'in.('+[...new Set(xs)].join(',')+')';

export async function loadPropsDashboard():Promise<Raw>{
 const store=propsStore();
 const nowIso=new Date().toISOString();
 const since=encodeURIComponent(new Date(Date.now()-14*86400_000).toISOString());
 const [control,runs,credits,usage,observations,accounts,entries]=await Promise.all([
  store.select<Raw['control']&object>('props_control','select=state,reason,changed_at&id=eq.1'),
  store.select<Raw['runs'][number]>('props_runs','select=id,kind,slot_key,status,outcome,started_at,finished_at,start_delay_seconds,summary&order=id.desc&limit=30'),
  store.select<Raw['credits'][number]>('props_credit_reservations','select=credits,reserved_at&reserved_at=gt.'+
   encodeURIComponent(new Date(Date.now()-30*86400_000).toISOString())+'&limit=10000'),
  store.select<{requests_remaining:number}>('props_provider_usage','select=requests_remaining&requests_remaining=not.is.null&order=recorded_at.desc,id.desc&limit=1'),
  store.select<Raw['observations'][number]>('props_observations','select=id,platform,provider_event_id,home_team,away_team,lock_at,player_name,stat,line,provider_last_update,ingested_at'+
   '&lock_at=gt.'+since+'&order=lock_at.desc&limit=3000'),
  store.select<Raw['accounts'][number]>('props_accounts','select=id,slug,platform,initial_cents,stake_cents,max_entries_per_day&limit=10'),
  store.select<Raw['entries'][number]>('props_entries','select=id,account_id,stake_cents,lock_at,created_at,payout_terms_version&order=id.desc&limit=500'),
 ]);
 const obsIds=observations.map(o=>o.id);
 const predictions=obsIds.length?await store.select<Raw['predictions'][number]>('props_predictions',
  'select=id,observation_id,model_version,status,reason,p_more,p_less,p_tie,mean&observation_id='+ids(obsIds)+'&limit=5000'):[];
 const [picks,results]=await Promise.all([
  predictions.length?store.select<Raw['picks'][number]>('props_picks','select=id,prediction_id,status,side,reason,selection_version&prediction_id='+ids(predictions.map(p=>p.id))+'&limit=5000'):Promise.resolve([]),
  obsIds.length?store.select<Raw['results'][number]>('props_line_results','select=observation_id,revision,outcome,actual&observation_id='+ids(obsIds)+'&limit=10000'):Promise.resolve([]),
 ]);
 const entryIds=entries.map(e=>e.id);
 const [legs,settlements]=await Promise.all([
  entryIds.length?store.select<Raw['legs'][number]>('props_entry_legs','select=entry_id,pick_id&entry_id='+ids(entryIds)+'&limit=5000'):Promise.resolve([]),
  entryIds.length?store.select<Raw['settlements'][number]>('props_entry_settlements','select=entry_id,outcome,wins,losses,voids,return_cents,profit_cents,settled_at&entry_id='+ids(entryIds)+'&limit=5000'):Promise.resolve([]),
 ]);
 return {nowIso,control:control[0]??null,runs,credits,providerRemaining:usage.length?Number(usage[0].requests_remaining):null,
  observations,predictions,picks,results,accounts,entries,legs,settlements};
}
