/**
 * PostgREST adapter for the recurring PAPER controller RPCs (paper_auto_v1).
 * SERVER/WORKER ONLY. Pinned to the SportsEdge staging project; there is no
 * Production fallback. Errors carry only the database's PAPER_AUTO_* code.
 */
// The owner's dedicated staging project (created 2026-10-30); never the Production project.
const STAGING_HOST='vfyzbliksooljxrlfadp.supabase.co';
const MAX_REPLY_BYTES=2_000_000;
export const PAPER_AUTO_RPCS=['register','status','stop','pause','resume','ack_alert','begin_run',
 'heartbeat','acquire_lease','finish_run','record_decision','record_snapshot','reserve_intents',
 'claim_intent','record_order','confirm_absent','record_activities','record_daily','raise_alert',
 'ledger','worker_state'] as const;
export type PaperAutoRpc=typeof PAPER_AUTO_RPCS[number];
export type StoreReply=Record<string,unknown>;
export interface PaperAutoStore{call(fn:PaperAutoRpc,p:Record<string,unknown>):Promise<StoreReply>;}
export class PaperAutoStoreError extends Error{
 /** A PAPER_AUTO_* refusal from the database, or a transport/configuration code. */
 readonly code:string;
 /** True when the database definitely refused; false when the outcome is unknown. */
 readonly refused:boolean;
 constructor(code:string,refused:boolean){
  super('Recurring PAPER store call failed: '+code);
  this.name='PaperAutoStoreError';this.code=code;this.refused=refused;
 }
}
export function storeCode(e:unknown):string{
 return e instanceof PaperAutoStoreError?e.code:'UNEXPECTED';
}
/** Maps a PostgREST error body to the database's PAPER_AUTO_* code, DB_<sqlstate>, or null. */
export function refusalCode(body:string):string|null{
 try{
  const raw=JSON.parse(body) as unknown;
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
   const {message,code}=raw as Record<string,unknown>;
   const own=typeof message==='string'?/^(PAPER_AUTO_[A-Z0-9_]{3,80})/.exec(message)?.[1]:undefined;
   if(own)return own;
   if(typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code))return 'DB_'+code;
  }
 }catch{/* not a database refusal */}
 return null;
}
type Settings={url:string;key:string};
function configuration(env:Readonly<Record<string,string|undefined>>):Settings{
 const url=env.SPORTSEDGE_STAGING_SUPABASE_URL??'',key=env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY??'';
 if(!url||!key)throw new PaperAutoStoreError('NOT_CONFIGURED',true);
 let uri:URL;
 try{uri=new URL(url);}catch{throw new PaperAutoStoreError('INVALID_CONFIG',true);}
 if(uri.protocol!=='https:'||uri.hostname!==STAGING_HOST||(uri.pathname!==''&&uri.pathname!=='/')||
  uri.username||uri.password||uri.port||uri.search||uri.hash||key.length<24||key.length>4000)
  throw new PaperAutoStoreError('INVALID_CONFIG',true);
 return {url:uri.origin,key};
}
export function stagingPaperAutoStore(env:Readonly<Record<string,string|undefined>>=process.env,
 fetcher:typeof fetch=fetch):PaperAutoStore{
 const {url,key}=configuration(env);
 return {
  async call(fn,p){
   if(!(PAPER_AUTO_RPCS as readonly string[]).includes(fn))throw new PaperAutoStoreError('RPC_NOT_ALLOWED',true);
   let response:Response;
   try{
    response=await fetcher(url+'/rest/v1/rpc/sportsedge_paper_auto_'+fn,{
     method:'POST', // Supabase RPC POST, never a broker order
     headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
      'Content-Type':'application/json',Accept:'application/json'},
     body:JSON.stringify({p}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});
   }catch{throw new PaperAutoStoreError('STORE_OUTCOME_UNKNOWN',false);}
   let body:string;
   try{body=await response.text();}catch{throw new PaperAutoStoreError('STORE_OUTCOME_UNKNOWN',false);}
   if(body.length>MAX_REPLY_BYTES)throw new PaperAutoStoreError('STORE_REPLY_TOO_LARGE',false);
   if(!response.ok){
    const code=refusalCode(body);
    // A 4xx carrying a database error proves the transaction rolled back; a 5xx,
    // timeout or unparseable reply leaves the outcome unknown.
    throw new PaperAutoStoreError(code??'STORE_HTTP_'+response.status,
     code!==null&&response.status>=400&&response.status<500);
   }
   let raw:unknown;
   try{raw=JSON.parse(body) as unknown;}catch{throw new PaperAutoStoreError('STORE_BAD_REPLY',false);}
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new PaperAutoStoreError('STORE_BAD_REPLY',false);
   return raw as StoreReply;
  }
 };
}
