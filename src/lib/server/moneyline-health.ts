/** Fixed-project GET-only metadata reader. No provider, dispatcher, control or account capability. */
import {moneylineHealth,MONEYLINE_HEALTH_POLICY,type MoneylineHealth} from '../moneyline-health.ts';
import {MONEYLINE_REFRESH_RELEASE} from './moneyline-refresh.ts';

type Env=Readonly<Record<string,string|undefined>>;
type Deps={fetcher?:typeof fetch;enabled?:boolean};
const ROOT='https://fzyjazhvkstvwwzjhlrr.supabase.co';
export async function loadMoneylineHealth(nowIso:string,env:Env,deps:Deps={}):Promise<MoneylineHealth>{
 const enabled=deps.enabled??MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled as boolean;
 const pending=moneylineHealth(nowIso,enabled,[],[]);
 if(!enabled)return pending;
 const unavailable=()=>({...pending,state:'UNAVAILABLE' as const,issues:[],slots7d:{due:pending.slots7d.due,missed:0,lastMissedAt:null}});
 const key=env.SUPABASE_SECRET_KEY??env.SUPABASE_SERVICE_ROLE_KEY;
 let url:URL;try{url=new URL(env.SUPABASE_URL??'');}catch{return unavailable();}
 if(env.VERCEL_ENV!=='production'||env.SPORTSEDGE_PREVIEW_FIXTURES==='1'||env.SUPABASE_READONLY_KEY||!env.ODDS_API_KEY||url.origin!==ROOT||url.pathname!=='/'||
  url.search||url.hash||url.username||url.password||!key)return unavailable();
 if(Date.parse(nowIso)<Date.parse(MONEYLINE_HEALTH_POLICY.firstSlotUtc))return pending;
 const fetcher=deps.fetcher??fetch;
 async function read(path:string){
  const r=await fetcher(ROOT+'/rest/v1/'+path,{method:'GET',headers:{apikey:key!,...(key!.startsWith('eyJ')?{Authorization:'Bearer '+key!}:{}),Accept:'application/json'},
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('MONEYLINE_HEALTH_READ_UNAVAILABLE');
  const text=await r.text();if(Buffer.byteLength(text)>100_000)throw Error('MONEYLINE_HEALTH_READ_TOO_LARGE');return JSON.parse(text);
 }
 try{
  const since=new Date(Date.parse(nowIso)-8*86400_000).toISOString();
  const slots=await read('research_refresh_slots?select=slot_key,run_id,claimed_at&claimed_at=gte.'+encodeURIComponent(since)+'&order=claimed_at.desc&limit=8');
  if(!Array.isArray(slots)||slots.length>8||slots.some(s=>!Number.isSafeInteger(s?.run_id)||s.run_id<1))return unavailable();
  const ids=[...new Set(slots.map(s=>s.run_id))];
  const runs=ids.length?await read('research_runs?select=id,status,created_at,claimed_at,finished_at,probe,summary&id=in.('+ids.join(',')+')&limit=8'):[];
  return moneylineHealth(nowIso,enabled,slots,runs);
 }catch{return unavailable();}
}
let cache:{at:number;value:MoneylineHealth}|null=null;
let loading:Promise<MoneylineHealth>|null=null;
export async function cachedMoneylineHealth(nowIso:string,env:Env){
 const at=Date.parse(nowIso);
 if(cache&&at>=cache.at&&at-cache.at<60_000)return cache.value;
 if(loading)return loading;
 loading=loadMoneylineHealth(nowIso,env).then(value=>{cache={at,value};return value;}).finally(()=>{loading=null;});
 return loading;
}
