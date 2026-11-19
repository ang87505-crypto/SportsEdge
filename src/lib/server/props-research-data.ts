/** Read-only, bounded ledger snapshot shared by the research page and the independent GitHub reporter. */
import {propsStore,type PropsStore} from './props-store.ts';
import {MODEL_VERSION,SELECTION_VERSION} from '../props/contract.ts';
import type {ResearchRaw} from '../props/research.ts';

const PAGE=500,MAX_ROWS=20000;
export async function readResearchRows<T>(store:Pick<PropsStore,'select'>,table:string,query:string):Promise<T[]>{
 const all:T[]=[];
 for(let offset=0;offset<=MAX_ROWS;offset+=PAGE){
  const rows=await store.select<T>(table,query+'&limit='+PAGE+'&offset='+offset);
  if(rows.length>PAGE||all.length+rows.length>MAX_ROWS)throw new Error('RESEARCH_SNAPSHOT_LIMIT');
  all.push(...rows);if(rows.length<PAGE)return all;
 }
 throw new Error('RESEARCH_SNAPSHOT_LIMIT');
}
export async function loadPropsResearch(store:Pick<PropsStore,'select'>=propsStore(),nowIso=new Date().toISOString()):Promise<ResearchRaw>{
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw new Error('RESEARCH_INVALID_CLOCK');
 const windowStart=new Date(now-90*86400_000).toISOString();
 const bounds=(name:string)=>'&'+name+'=gte.'+encodeURIComponent(windowStart)+'&'+name+'=lte.'+encodeURIComponent(nowIso);
 const [controls,observations,predictions,picks,results]=await Promise.all([
  store.select<NonNullable<ResearchRaw['control']>>('props_control','select=state,reason&id=eq.1'),
  readResearchRows<ResearchRaw['observations'][number]>(store,'props_observations',
   'select=id,platform,provider_event_id,home_team,away_team,lock_at,player_name,stat,line,provider_last_update,ingested_at,recorded_at&is_fixture=eq.false'+bounds('recorded_at')+'&order=id.asc'),
  readResearchRows<ResearchRaw['predictions'][number]>(store,'props_predictions',
   'select=id,observation_id,model_version,status,athlete_id,p_more,p_less,p_tie,mean,data_cutoff,predicted_at&model_version=eq.'+MODEL_VERSION+bounds('predicted_at')+'&order=id.asc'),
  readResearchRows<ResearchRaw['picks'][number]>(store,'props_picks',
   'select=id,prediction_id,selection_version,status,side&selection_version=eq.'+SELECTION_VERSION+bounds('decided_at')+'&order=id.asc'),
  readResearchRows<ResearchRaw['results'][number]>(store,'props_line_results',
   'select=observation_id,revision,outcome,actual,graded_at'+bounds('graded_at')+'&order=id.asc'),
 ]);
 const upcoming=new Set(observations.filter(o=>Date.parse(o.lock_at)>now).map(o=>o.id));
 const predictionIds=new Set(predictions.filter(p=>upcoming.has(p.observation_id)).map(p=>p.id));
 const pickIds=picks.filter(p=>predictionIds.has(p.prediction_id)&&p.status==='recorded').map(p=>p.id);
 const entryLegs:ResearchRaw['entryLegs']=[];
 for(let i=0;i<pickIds.length;i+=100){
  const chunk=pickIds.slice(i,i+100);
  entryLegs.push(...await readResearchRows<ResearchRaw['entryLegs'][number]>(store,'props_entry_legs',
   'select=entry_id,pick_id&pick_id=in.('+chunk.join(',')+')&order=entry_id.asc,pick_id.asc'));
 }
 return {nowIso,windowStart,control:controls[0]??null,observations,predictions,picks,results,entryLegs};
}
