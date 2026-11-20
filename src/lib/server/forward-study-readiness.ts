/** GET-only checks use the configured props database, never a guessed project or synthetic readiness. */
import type {PropsStore} from './props-store.ts';
import {PropsStoreError} from './props-store.ts';
export const FORWARD_TABLES={
 lab:{props_lab_experiments:'id,spec_sha256,artifact_sha256',props_lab_predictions:'id,variant_id,record_sha256',props_lab_flags:'id,rules_version',props_lab_reports:'id,kind',props_lab_events:'id,event',props_lab_stakes:'id,policy_version'},
 penny:{props_penny_cohorts:'id,policy_sha256,registered_at',props_penny_entries:'id,record_sha256,stake_cents',props_penny_settlements:'id,revision,grade_ids',props_penny_tampering:'id'}
} as const;
export async function forwardStudyReadiness(store:PropsStore){
 const results=await Promise.all(Object.entries(FORWARD_TABLES).flatMap(([group,tables])=>Object.entries(tables).map(async([table,cols])=>{
  try{await store.select(table,'select='+cols+'&limit=1');return {group,table,state:'READY',code:null};}
  catch(e){const code=e instanceof PropsStoreError?e.code:'UNEXPECTED';return {group,table,state:/^(DB_42P01|STORE_HTTP_404|DB_PGRST\w*|PGRST\w*)$/.test(code)?'NOT_MIGRATED':'UNAVAILABLE',code};}
 })));
 const state=results.every(r=>r.state==='READY')?'READY':results.some(r=>r.state==='UNAVAILABLE')?'UNAVAILABLE':'NOT_MIGRATED';
 return {state,tables:results,paidRequests:0};
}
