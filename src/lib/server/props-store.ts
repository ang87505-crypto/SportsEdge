/**
 * PostgREST adapter for the props_* paper-testing tables and RPCs (props_v1.sql).
 * SERVER/WORKER ONLY. Host-pinned to the owner's two known Supabase projects;
 * errors carry only a PROPS_* refusal code or a transport code, never secrets.
 */
const ALLOWED_HOSTS=new Set(['fzyjazhvkstvwwzjhlrr.supabase.co','vfyzbliksooljxrlfadp.supabase.co']);
const MAX_REPLY_BYTES=4_000_000;
const RPCS=['props_begin_run','props_heartbeat','props_finish_run','props_reserve_credits','props_record_usage',
 'props_set_control','props_record_entry','props_record_settlement'] as const;
export type PropsRpc=typeof RPCS[number];
const TABLE=/^props_[a-z_]{3,40}$/;

export class PropsStoreError extends Error{
 readonly code:string;
 /** True when the database definitely refused (rolled back); false when the outcome is unknown. */
 readonly refused:boolean;
 constructor(code:string,refused:boolean){super('Props store call failed: '+code);this.name='PropsStoreError';this.code=code;this.refused=refused;}
}
export function propsRefusal(body:string):string|null{
 try{
  const raw=JSON.parse(body) as unknown;
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
   const {message,code}=raw as Record<string,unknown>;
   const own=typeof message==='string'?/(PROPS_[A-Z0-9_]{3,60})/.exec(message)?.[1]:undefined;
   if(own)return own;
   if(typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code))return 'DB_'+code;
  }
 }catch{/* not a database refusal */}
 return null;
}

export interface PropsStore{
 rpc<T=unknown>(fn:PropsRpc,args:Record<string,unknown>):Promise<T>;
 insert<T=unknown>(table:string,rows:object[],opts?:{onConflict?:string;ignoreDuplicates?:boolean;select?:string}):Promise<T[]>;
 select<T=unknown>(table:string,query:string):Promise<T[]>;
}

export function propsStoreConfig(env:Readonly<Record<string,string|undefined>>=process.env){
 const url=env.SPORTSEDGE_PROPS_SUPABASE_URL??'',key=env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY??'';
 if(!url||!key)throw new PropsStoreError('NOT_CONFIGURED',true);
 let u:URL;try{u=new URL(url);}catch{throw new PropsStoreError('INVALID_CONFIG',true);}
 if(u.protocol!=='https:'||!ALLOWED_HOSTS.has(u.hostname)||(u.pathname!==''&&u.pathname!=='/')||
  u.username||u.password||u.port||u.search||u.hash||key.length<24||key.length>4000)
  throw new PropsStoreError('INVALID_CONFIG',true);
 return {base:u.origin,key,host:u.hostname};
}

export function propsStore(env:Readonly<Record<string,string|undefined>>=process.env,fetcher:typeof fetch=fetch):PropsStore{
 const {base,key}=propsStoreConfig(env);
 const headers=(extra:Record<string,string>={})=>({apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
  'Content-Type':'application/json',Accept:'application/json',...extra});
 async function send(path:string,init:RequestInit):Promise<unknown>{
  let response:Response;
  try{response=await fetcher(base+'/rest/v1/'+path,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12_000)});}
  catch{throw new PropsStoreError('STORE_OUTCOME_UNKNOWN',false);}
  let body:string;
  try{body=await response.text();}catch{throw new PropsStoreError('STORE_OUTCOME_UNKNOWN',false);}
  if(body.length>MAX_REPLY_BYTES)throw new PropsStoreError('STORE_REPLY_TOO_LARGE',false);
  if(!response.ok){
   const code=propsRefusal(body);
   throw new PropsStoreError(code??'STORE_HTTP_'+response.status,code!==null&&response.status>=400&&response.status<500);
  }
  if(!body)return null;
  try{return JSON.parse(body) as unknown;}catch{throw new PropsStoreError('STORE_BAD_REPLY',false);}
 }
 return {
  async rpc<T>(fn:PropsRpc,args:Record<string,unknown>){
   if(!(RPCS as readonly string[]).includes(fn))throw new PropsStoreError('RPC_NOT_ALLOWED',true);
   return await send('rpc/'+fn,{method:'POST',headers:headers(),body:JSON.stringify(args)}) as T;
  },
  async insert<T>(table:string,rows:object[],opts:{onConflict?:string;ignoreDuplicates?:boolean;select?:string}={}){
   if(!TABLE.test(table))throw new PropsStoreError('TABLE_NOT_ALLOWED',true);
   if(!rows.length)return [];
   const q=new URLSearchParams();
   if(opts.onConflict)q.set('on_conflict',opts.onConflict);
   if(opts.select)q.set('select',opts.select);
   const prefer=[opts.ignoreDuplicates?'resolution=ignore-duplicates':null,'missing=default',
    opts.select?'return=representation':'return=minimal'].filter(Boolean).join(',');
   const out=await send(table+(q.size?'?'+q:''),{method:'POST',headers:headers({Prefer:prefer}),body:JSON.stringify(rows)});
   if(!opts.select)return [];
   if(!Array.isArray(out))throw new PropsStoreError('STORE_BAD_REPLY',false);
   return out as T[];
  },
  async select<T>(table:string,query:string){
   if(!TABLE.test(table)||query.length>3000)throw new PropsStoreError('TABLE_NOT_ALLOWED',true);
   for(let attempt=0;;attempt++){
    try{
     const out=await send(table+'?'+query,{method:'GET',headers:headers()});
     if(!Array.isArray(out))throw new PropsStoreError('STORE_BAD_REPLY',false);
     return out as T[];
    }catch(e){
     // Reads are safe to retry (bounded); writes never are.
     if(attempt>=2||(e instanceof PropsStoreError&&e.refused))throw e;
     await new Promise(r=>setTimeout(r,500*2**attempt));
    }
   }
  },
 };
}
