/** Server/worker-only PostgREST access. No browser import or exchange networking. */
const TABLES=new Set(['kalshi_platform_version','kalshi_weather_evidence','kalshi_contract_forecasts',
 'kalshi_contract_grades','kalshi_fixture_ledgers','kalshi_platform_runs','kalshi_demo_control',
 'kalshi_demo_intents','kalshi_demo_receipts','kalshi_demo_account_snapshots']);
const RPCS=new Set(['kalshi_begin_run','kalshi_finish_run','kalshi_record_contract_forecast',
 'kalshi_save_fixture_ledger','kalshi_set_demo_control','kalshi_note_demo_check','kalshi_claim_demo_intent']);
export class KalshiStoreError extends Error{
 readonly code:string;readonly outcomeUnknown:boolean;
 constructor(code:string,outcomeUnknown=false){super('KALSHI_STORE_'+code);this.name='KalshiStoreError';this.code=code;this.outcomeUnknown=outcomeUnknown;}
}
export interface KalshiPlatformStore{
 select<T>(table:string,query:string):Promise<T[]>;
 insert(table:string,rows:object[]):Promise<void>;
 rpc<T>(name:string,args:Record<string,unknown>):Promise<T>;
}
export function kalshiStoreConfig(env:Readonly<Record<string,string|undefined>>=process.env){
 if(env.SPORTSEDGE_PREVIEW_FIXTURES==='1')throw new KalshiStoreError('PREVIEW_FIXTURES');
 const address=env.KALSHI_SUPABASE_URL??env.SUPABASE_URL;
 const key=env.KALSHI_SUPABASE_SECRET_KEY??env.SUPABASE_SECRET_KEY??env.SUPABASE_SERVICE_ROLE_KEY;
 if(!address||!key)throw new KalshiStoreError('NOT_CONFIGURED');
 let url:URL;try{url=new URL(address);}catch{throw new KalshiStoreError('INVALID_CONFIG');}
 if(url.origin!=='https://fzyjazhvkstvwwzjhlrr.supabase.co'||!['','/'].includes(url.pathname)||
  url.search||url.hash||url.username||url.password||key.length<24||key.length>4000)
  throw new KalshiStoreError('INVALID_CONFIG');
 return {base:url.origin,key};
}
export function kalshiPlatformStore(env:Readonly<Record<string,string|undefined>>=process.env,fetcher:typeof fetch=fetch):KalshiPlatformStore{
 const {base,key}=kalshiStoreConfig(env);
 async function send(path:string,method:'GET'|'POST',body?:unknown){
  let response:Response;
  try{response=await fetcher(base+'/rest/v1/'+path,{method,redirect:'error',credentials:'omit',cache:'no-store',
   signal:AbortSignal.timeout(10_000),headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
    Accept:'application/json','Content-Type':'application/json',
    ...(!path.startsWith('rpc/')&&method==='POST'?{Prefer:'resolution=ignore-duplicates,return=minimal'}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw new KalshiStoreError('OUTCOME_UNKNOWN',method==='POST');}
  if(Number(response.headers.get('content-length'))>4_000_000)throw new KalshiStoreError('REPLY_TOO_LARGE',method==='POST');
  if(!response.body){if(response.ok&&method==='POST')return null;throw new KalshiStoreError('EMPTY_REPLY',method==='POST');}
  const reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
  try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;
   if(bytes>4_000_000){await reader.cancel();throw new KalshiStoreError('REPLY_TOO_LARGE',method==='POST');}
   text+=decoder.decode(r.value,{stream:true});}text+=decoder.decode();}
  catch(e){if(e instanceof KalshiStoreError)throw e;throw new KalshiStoreError('OUTCOME_UNKNOWN',method==='POST');}
  if(!response.ok){
   let code='HTTP_'+response.status;
   try{const d=JSON.parse(text);const own=typeof d.message==='string'?d.message.match(/KALSHI_[A-Z0-9_]{3,70}/)?.[0]:null;
    if(own)code=own;else if(typeof d.code==='string'&&/^[A-Z0-9]{5}$/.test(d.code))code='DB_'+d.code;}catch{}
   throw new KalshiStoreError(code,method==='POST'&&response.status>=500);
  }
  if(!text)return null;
  try{return JSON.parse(text) as unknown;}catch{throw new KalshiStoreError('BAD_REPLY',method==='POST');}
 }
 return {
  async select<T>(table:string,query:string){
   if(!TABLES.has(table)||query.length>6000||/[#\r\n]/.test(query))throw new KalshiStoreError('TABLE_NOT_ALLOWED');
   const data=await send(table+'?'+query,'GET');
   if(!Array.isArray(data))throw new KalshiStoreError('BAD_REPLY');return data as T[];
  },
  async insert(table,rows){
   if(!TABLES.has(table))throw new KalshiStoreError('TABLE_NOT_ALLOWED');
   if(rows.length)await send(table,'POST',rows);
  },
  async rpc<T>(name:string,args:Record<string,unknown>){
   if(!RPCS.has(name))throw new KalshiStoreError('RPC_NOT_ALLOWED');
   return await send('rpc/'+name,'POST',args) as T;
  }
 };
}
