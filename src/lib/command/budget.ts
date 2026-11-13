/**
 * Command Center 2.0: inference spending guard.
 *
 * Every model call RESERVES its worst-case cost in a shared ledger before it is made and SETTLES its actual cost after.
 * In production the ledger is Postgres (database/command/command_llm_budget_v1.sql): the reservation runs under a row
 * lock on the day, so any number of Vercel instances together can never commit more than the daily cap. The ledger
 * also enforces the per-client rate limit for model calls. If the ledger is unreachable, no model call is made.
 * `memoryLedger` is single-process and exists for tests only; production configuration cannot select it.
 */
export const PRICES_PER_MTOK:Record<string,{input:number;output:number}>={
 // Anthropic first-party list prices (USD per million tokens), checked 2026-11-13. Cache writes 1.25x input, reads 0.1x.
 'claude-opus-5-5':{input:4,output:20},'claude-sonnet-5-5':{input:2,output:10},'claude-haiku-5-5':{input:0.1,output:0.5},
};
export type Usage={input_tokens:number;output_tokens:number;cache_creation_input_tokens?:number|null;cache_read_input_tokens?:number|null};

/** Actual cost in integer micro-USD (rounded up). Unknown model → null (treated as unaffordable). */
export function costMicroUsd(model:string,u:Usage):number|null{
 const p=PRICES_PER_MTOK[model];if(!p)return null;
 const usd=(u.input_tokens*p.input+(u.cache_creation_input_tokens??0)*p.input*1.25+(u.cache_read_input_tokens??0)*p.input*0.1+u.output_tokens*p.output)/1e6;
 return Math.ceil(usd*1e6);
}
/**
 * Worst case of one call: every request byte billed as a cache-write input token (a token is at least one byte of
 * UTF-8; 1.25x covers cache writes), plus 2,000 tokens of message framing, plus the full output cap (which includes
 * thinking). Server-side model fallback is NOT used, so no other model's prices can apply.
 */
export function worstCaseMicroUsd(model:string,requestBytes:number,maxOutputTokens:number):number|null{
 const p=PRICES_PER_MTOK[model];if(!p)return null;
 return Math.ceil(((requestBytes+2000)*p.input*1.25+maxOutputTokens*p.output));
}

export type Reservation={ok:true;id:string;remainingMicroUsd:number}|{ok:false;reason:'BUDGET_EXHAUSTED'|'RATE_LIMITED'|'UNAVAILABLE'};
export interface SpendLedger{
 reserve(x:{clientKey:string;model:string;microUsd:number}):Promise<Reservation>;
 /** Settle once with the actual cost. When the cost is unknown (call failed mid-flight) the caller settles the full reservation. */
 settle(id:string,microUsd:number):Promise<void>;
}

/** TEST-ONLY single-process ledger with the same semantics as the SQL functions (atomic per event-loop turn). */
export function memoryLedger(capUsd:number,perMinute:number,clock:()=>number=Date.now){
 const cap=Math.round(capUsd*1e6);let committed=0,seq=0;
 const res=new Map<string,{reserved:number;settled:boolean;at:number;client:string}>();
 const ledger:SpendLedger&{committed:()=>number;open:()=>number}={
  async reserve({clientKey,microUsd}){
   await Promise.resolve();
   const now=clock(),recent=[...res.values()].filter(r=>r.client===clientKey&&now-r.at<60_000).length;
   if(recent>=perMinute)return {ok:false,reason:'RATE_LIMITED'};
   if(committed+microUsd>cap)return {ok:false,reason:'BUDGET_EXHAUSTED'};
   committed+=microUsd;const id=String(++seq);res.set(id,{reserved:microUsd,settled:false,at:now,client:clientKey});
   return {ok:true,id,remainingMicroUsd:cap-committed};
  },
  async settle(id,microUsd){
   await Promise.resolve();
   const r=res.get(id);if(!r||r.settled)return;
   r.settled=true;committed=Math.max(0,committed-r.reserved+microUsd);
  },
  committed:()=>committed,open:()=>[...res.values()].filter(r=>!r.settled).length};
 return ledger;
}

export type LlmConfig={provider:'anthropic';model:string;dailyCapUsd:number;perMinute:number;maxOutputTokens:number;maxToolRounds:number};
/**
 * Paid inference is OFF unless every one of these is set explicitly: provider, key, a daily cap (0 < cap ≤ 50 USD),
 * a known model price, and the shared Postgres ledger (COMMAND_LLM_LEDGER=supabase, after the SQL is applied).
 */
export function llmConfig(env:Readonly<Record<string,string|undefined>>):LlmConfig|null{
 const cap=Number(env.COMMAND_LLM_DAILY_BUDGET_USD);
 if(env.COMMAND_LLM_PROVIDER!=='anthropic'||!env.ANTHROPIC_API_KEY||!(cap>0)||cap>50||env.COMMAND_LLM_LEDGER!=='supabase')return null;
 const model=env.COMMAND_LLM_MODEL||'claude-opus-5-5';
 if(!PRICES_PER_MTOK[model])return null;
 return {provider:'anthropic',model,dailyCapUsd:cap,perMinute:6,maxOutputTokens:2000,maxToolRounds:4};
}

/**
 * Per-instance request limiter for the endpoint itself (protects the server, not money). Spending and model-call rate
 * limits are enforced by the shared ledger above, never by this.
 */
export class RateLimiter{
 private hits=new Map<string,number[]>();
 readonly perMinute:number;readonly maxKeys:number;
 constructor(perMinute:number,maxKeys=5000){this.perMinute=perMinute;this.maxKeys=maxKeys;}
 allow(key:string,nowMs:number):boolean{
  const recent=(this.hits.get(key)??[]).filter(t=>nowMs-t<60_000);
  if(recent.length>=this.perMinute){this.hits.set(key,recent);return false;}
  recent.push(nowMs);this.hits.set(key,recent);
  if(this.hits.size>this.maxKeys)this.hits.delete(this.hits.keys().next().value!);
  return true;
 }
}
