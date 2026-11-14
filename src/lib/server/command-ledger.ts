/**
 * Shared inference budget ledger in the props Postgres project (database/command/command_llm_budget_v1.sql).
 * Two RPCs only (reserve, settle), host-pinned, service key from the server environment. Fails CLOSED: any error,
 * timeout or unexpected reply is UNAVAILABLE, and no model call is made.
 */
import type {SpendLedger,Reservation} from '../command/budget.ts';
import {propsStoreConfig} from './props-store.ts';

type Env=Readonly<Record<string,string|undefined>>;
export function supabaseLedger(env:Env,capUsd:number,perMinute:number,fetcher:typeof fetch=fetch):SpendLedger{
 const {base,key}=propsStoreConfig(env);   // throws when not configured → caller treats as unavailable
 const call=async(fn:'command_llm_reserve'|'command_llm_settle',args:Record<string,unknown>)=>{
  const r=await fetcher(`${base}/rest/v1/rpc/${fn}`,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5_000),
   headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify(args)});
  if(!r.ok)throw new Error('LEDGER_HTTP_'+r.status);
  const t=await r.text();if(t.length>2000)throw new Error('LEDGER_REPLY_TOO_LARGE');
  return JSON.parse(t) as unknown;
 };
 return {
  async reserve({clientKey,model,microUsd}):Promise<Reservation>{
   try{
    const v=await call('command_llm_reserve',{p_client_key:clientKey,p_model:model,p_micro_usd:microUsd,p_cap_micro_usd:Math.round(capUsd*1e6),p_per_minute:perMinute}) as Record<string,unknown>;
    if(v?.ok===true&&(typeof v.id==='number'||typeof v.id==='string'))return {ok:true,id:String(v.id),remainingMicroUsd:Number(v.remaining)};
    if(v?.ok===false&&(v.reason==='BUDGET_EXHAUSTED'||v.reason==='RATE_LIMITED'))return {ok:false,reason:v.reason};
    return {ok:false,reason:'UNAVAILABLE'};
   }catch{return {ok:false,reason:'UNAVAILABLE'};}
  },
  async settle(id,microUsd){
   // Best effort; an unsettled reservation stays counted at its worst case (never under-counts).
   try{await call('command_llm_settle',{p_id:Number(id),p_actual_micro_usd:microUsd});}catch{/* fail closed */}
  }};
}
