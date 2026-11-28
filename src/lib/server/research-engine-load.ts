/** Fresh, hash-verified public engine evidence. A saved seed is always labelled as a saved seed. */
import seedRegistry from '../../../research/engine/registry.json' with {type:'json'};
import seedJobs from '../../../research/engine/jobs.json' with {type:'json'};
import {ENGINE_INDEX,MAX_ENGINE_BYTES,engineJobs,engineRunPath,parseEngineIndex,verifyEngineRun,type EngineReceipt} from '../lab/engine/archive.ts';
import type {Registry} from '../lab/engine/experiments.ts';
import type {Job} from '../lab/engine/view.ts';
import {readSportsScorecard,type SportsScorecard} from '../lab/engine/scorecard.ts';
import {readSportsDrift,type DriftReport} from '../lab/engine/drift.ts';

export const ENGINE_PUBLIC_ROOT='https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/';
const CACHE_MS=60_000;
export type EngineSnapshot={mode:'live'|'saved';at:string|null;checkedAt:string;stale:boolean;status:'OK'|'FAILED'|'UNAVAILABLE';
 registry:Registry;jobs:Job[];receipt:EngineReceipt|null;scorecard:SportsScorecard|null;drift:DriftReport|null;
 /** What the latest run reports as missing (engine-evidence-v1) and the sports absolute alarms (sports-alarms-v1). */
 attention:EngineAttention|null;detail:string};
export type EngineAttention={gaps:{code:string;detail:string}[];inputs:Record<string,string>;
 /** Counts declared by the verified report, not inferred from connected domains. */
 coverage:{total:number;active:number;automatic:number;ownerSuppliedOnly:number}|null;
 /** Active experiments with no automatic evidence producer: they advance only on an owner-supplied result. */
 withoutProducer:string[];
 alarms:{status:string;codes:string[];details:string[]}|null};
const text=(x:unknown,n:number)=>typeof x==='string'?x.slice(0,n):'';
/** Defensive reader: only short, well-formed strings from the published report reach the page. */
export function readEngineAttention(report:unknown):EngineAttention|null{
 const r=report as {evidence?:{gaps?:unknown;inputs?:unknown;experiments?:{total?:unknown;active?:unknown;automatic?:unknown;ownerSuppliedOnly?:unknown}};domains?:{sports?:{alarms?:{status?:unknown;alarms?:unknown}}}}|null;
 if(!r||typeof r!=='object')return null;
 const gaps=Array.isArray(r.evidence?.gaps)?(r.evidence!.gaps as {code?:unknown;detail?:unknown}[]).slice(0,10)
  .filter(g=>typeof g?.code==='string'&&/^[A-Z_]{3,60}$/.test(g.code)).map(g=>({code:g.code as string,detail:text(g.detail,400)})):[];
 const inputs=r.evidence?.inputs&&typeof r.evidence.inputs==='object'?Object.fromEntries(Object.entries(r.evidence.inputs as Record<string,unknown>)
  .filter(([k,v])=>/^[a-z]{3,20}$/.test(k)&&typeof v==='string'&&/^[A-Z_]{3,40}$/.test(v)).slice(0,6)) as Record<string,string>:{};
 const a=r.domains?.sports?.alarms;
 const alarms=a&&typeof a.status==='string'&&['OK','ALARM','COLLECTING','IDLE'].includes(a.status)?{status:a.status,
  codes:(Array.isArray(a.alarms)?a.alarms:[]).map((x:{code?:unknown})=>text(x?.code,40)).filter(Boolean).slice(0,8),
  details:(Array.isArray(a.alarms)?a.alarms:[]).map((x:{detail?:unknown})=>text(x?.detail,300)).filter(Boolean).slice(0,8)}:null;
 const own=r.evidence?.experiments?.ownerSuppliedOnly;
 const withoutProducer=Array.isArray(own)?own.map((x:{id?:unknown})=>x?.id).filter((id):id is string=>typeof id==='string'&&/^[a-z0-9][a-z0-9.-]{2,80}$/.test(id)).slice(0,30):[];
 const e=r.evidence?.experiments;
 const count=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1000;
 const coverage=e&&count(e.total)&&count(e.active)&&count(e.automatic)&&e.active<=e.total&&Array.isArray(own)&&
  own.length===withoutProducer.length&&new Set(withoutProducer).size===own.length&&e.automatic+own.length===e.active
  ?{total:e.total,active:e.active,automatic:e.automatic,ownerSuppliedOnly:own.length}:null;
 return {gaps,inputs,withoutProducer,coverage,alarms};
}
let cache:{at:number;value:EngineSnapshot}|null=null;
export function resetResearchEngineCache(){cache=null;}
export async function loadResearchEngine(nowIso:string,fetcher:typeof fetch=fetch):Promise<EngineSnapshot>{
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('ENGINE_BAD_CLOCK');
 if(cache&&now>=cache.at&&now-cache.at<CACHE_MS)return {...cache.value,checkedAt:nowIso};
 async function read(path:string){
  const res=await fetcher(ENGINE_PUBLIC_ROOT+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6000)});
  if(!res.ok||Number(res.headers.get('content-length')??0)>MAX_ENGINE_BYTES)throw Error('ENGINE_ARCHIVE_UNAVAILABLE');
  const body=await res.text();if(Buffer.byteLength(body)>MAX_ENGINE_BYTES)throw Error('ENGINE_REPLY_TOO_LARGE');return body;
 }
 let value:EngineSnapshot;
 try{
  const receipts=parseEngineIndex(await read(ENGINE_INDEX)),receipt=receipts.at(-1);
  if(!receipt||Date.parse(receipt.at)>now)throw Error('ENGINE_NO_VALID_RUN');
  const root=engineRunPath(receipt.runId);
  const [registry,report]=await Promise.all(['registry','report'].map(async n=>JSON.parse(await read(`${root}/${n}.json`))));
  const verified=verifyEngineRun(receipt,registry,report);
  const scorecard=readSportsScorecard(report.domains?.sports?.scorecard);
  const stale=now-Date.parse(receipt.at)>48*3600_000;
  value={mode:'live',at:receipt.at,checkedAt:nowIso,stale,status:receipt.status,registry:verified.registry,jobs:engineJobs(receipts),receipt,scorecard:receipt.status==='OK'?scorecard:null,
   drift:receipt.status==='OK'?readSportsDrift(report.domains?.sports?.drift):null,attention:readEngineAttention(report),
   detail:receipt.status==='FAILED'?'The latest evaluation failed; its last accepted registry is shown.':stale?'No published evaluation within 48 hours.':'Latest published evaluation; experiments remain subject to their registered evidence gates.'};
 }catch{
  value={mode:'saved',at:seedJobs.at(-1)?.at??null,checkedAt:nowIso,stale:true,status:'UNAVAILABLE',registry:seedRegistry as Registry,jobs:seedJobs,receipt:null,scorecard:null,drift:null,attention:null,
   detail:'Current published evaluations are unavailable. These are dated saved research records, not proof of a running learning job.'};
 }
 cache={at:now,value};return value;
}
