/** SERVER/WORKER only. Database triggers compute and freeze stakes/returns; no provider or broker calls. */
import type {PropsStore} from './props-store.ts';
import {PropsStoreError} from './props-store.ts';
import {PENNY_PAPER_POLICY,PENNY_PAPER_SHA256,pennySummary,type PennyEntry,type PennySettlement} from '../lab/penny-paper.ts';
const q=encodeURIComponent;
const missing=(e:unknown)=>e instanceof PropsStoreError&&/^(DB_42P01|STORE_HTTP_404|DB_PGRST\w*|PGRST\w*)$/.test(e.code);
export type PennyDeps={store:PropsStore;now:()=>string};
async function pages<T>(store:PropsStore,table:string,query:string):Promise<T[]>{
 const all:T[]=[];for(let p=0;p<50;p++){const r=await store.select<T>(table,query+'&limit=1000&offset='+p*1000);all.push(...r);if(r.length<1000)return all;}
 throw Error('PENNY_ROW_LIMIT');
}
export async function pennyCohort(store:PropsStore){
 const rows=await store.select<{id:string;policy_sha256:string;registered_at:string}>('props_penny_cohorts','select=id,policy_sha256,registered_at&id=eq.'+PENNY_PAPER_POLICY.id);
 if(rows.length&&rows[0].policy_sha256!==PENNY_PAPER_SHA256)throw Error('PENNY_POLICY_CONFLICT');return rows[0]??null;
}
export async function freezePennyEntries(d:PennyDeps){
 let cohort;try{cohort=await pennyCohort(d.store);}catch(e){if(missing(e))return {status:'NOT_MIGRATED'};throw e;}
 if(!cohort){
  await d.store.insert('props_penny_cohorts',[{id:PENNY_PAPER_POLICY.id,policy_sha256:PENNY_PAPER_SHA256,policy:PENNY_PAPER_POLICY}],{onConflict:'id',ignoreDuplicates:true});
  cohort=await pennyCohort(d.store);if(!cohort)throw Error('PENNY_REGISTRATION_UNVERIFIED');
 }
 const now=d.now(),deadline=new Date(Date.parse(now)+120_000).toISOString();
 const sources=await pages<{id:number}>(d.store,'props_entries','select=id&created_at=gte.'+q(cohort.registered_at)+'&lock_at=gt.'+q(deadline)+'&order=id.asc');
 const frozen=await pages<{source_entry_id:number}>(d.store,'props_penny_entries','select=source_entry_id&cohort_id=eq.'+cohort.id+'&order=id.asc');
 const done=new Set(frozen.map(e=>Number(e.source_entry_id)));let recorded=0,refused=0;
 for(const e of sources){if(done.has(Number(e.id)))continue;
  try{const inserted=await d.store.insert('props_penny_entries',[{cohort_id:cohort.id,source_entry_id:e.id}],
   {onConflict:'cohort_id,source_entry_id',ignoreDuplicates:true,select:'id'});recorded+=inserted.length;}
  catch(err){if(err instanceof PropsStoreError&&err.refused){refused++;continue;}throw err;}
 }
 return {status:refused?'ATTENTION':'OK',cohort:cohort.id,registeredAt:cohort.registered_at,sourceEntries:sources.length,recorded,alreadyFrozen:frozen.length,refused,paidRequests:0};
}
export async function settlePennyEntries(d:PennyDeps){
 let cohort;try{cohort=await pennyCohort(d.store);}catch(e){if(missing(e))return {status:'NOT_MIGRATED'};throw e;}
 if(!cohort)return {status:'NOT_REGISTERED'};
 const entries=await pages<PennyEntry&{inputs:{legs:{pick_id:number;observation_id:number}[]}}>(d.store,'props_penny_entries','select=*&cohort_id=eq.'+cohort.id+'&order=id.asc');
 const settlements=await pages<PennySettlement>(d.store,'props_penny_settlements','select=*&order=id.asc');
 const known=new Set(settlements.map(s=>s.penny_entry_id+'|'+s.grade_ids.join(',')));let written=0,pending=0,refused=0;
 const ids=[...new Set(entries.flatMap(e=>e.inputs.legs.map(l=>l.observation_id)))];
 const results:{id:number;observation_id:number;revision:number}[]=[];
 for(let i=0;i<ids.length;i+=100)results.push(...await d.store.select<{id:number;observation_id:number;revision:number}>('props_line_results',
  'select=id,observation_id,revision&observation_id=in.('+ids.slice(i,i+100).join(',')+')&graded_at=lte.'+q(d.now())+'&order=revision.desc&limit=5000'));
 const latest=new Map<number,{id:number;revision:number}>();for(const r of results){const old=latest.get(Number(r.observation_id));if(!old||r.revision>old.revision)latest.set(Number(r.observation_id),r);}
 for(const e of entries){
  if(Date.parse(e.lock_at)>Date.parse(d.now())){pending++;continue;}
  const gradeIds=[...e.inputs.legs].sort((a,b)=>a.pick_id-b.pick_id).flatMap(l=>{const r=latest.get(l.observation_id);return r?[Number(r.id)]:[];});
  if(gradeIds.length!==2){pending++;continue;}
  if(known.has(e.id+'|'+gradeIds.join(',')))continue;
  try{const rows=await d.store.insert('props_penny_settlements',[{penny_entry_id:e.id,grade_ids:gradeIds}],
   {onConflict:'penny_entry_id,grade_ids',ignoreDuplicates:true,select:'id'});written+=rows.length;}
  catch(err){if(err instanceof PropsStoreError&&err.refused){refused++;continue;}throw err;}
 }
 return {status:refused?'ATTENTION':'OK',entries:entries.length,settlements:written,pending,refused,paidRequests:0};
}
export async function readPennyStudy(d:PennyDeps){
 let cohort;try{cohort=await pennyCohort(d.store);}catch(e){if(missing(e))return {state:'not_migrated' as const,cohort:null,summary:null};throw e;}
 if(!cohort)return {state:'awaiting_registration' as const,cohort:null,summary:null};
 const [entries,settlements,tampering]=await Promise.all([
  pages<PennyEntry>(d.store,'props_penny_entries','select=*&cohort_id=eq.'+cohort.id+'&order=id.asc'),
  pages<PennySettlement>(d.store,'props_penny_settlements','select=*&order=id.asc'),
  d.store.select<{id:number}>('props_penny_tampering','select=id&limit=1')]);
 if(tampering.length)throw Error('PENNY_LEDGER_INTEGRITY');
 return {state:'ready' as const,cohort,summary:pennySummary(entries,settlements,d.now())};
}
