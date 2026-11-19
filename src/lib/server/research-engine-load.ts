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
 registry:Registry;jobs:Job[];receipt:EngineReceipt|null;scorecard:SportsScorecard|null;drift:DriftReport|null;detail:string};
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
   drift:receipt.status==='OK'?readSportsDrift(report.domains?.sports?.drift):null,
   detail:receipt.status==='FAILED'?'The latest evaluation failed; its last accepted registry is shown.':stale?'No published evaluation within 48 hours.':'Latest published evaluation; experiments remain subject to their registered evidence gates.'};
 }catch{
  value={mode:'saved',at:seedJobs.at(-1)?.at??null,checkedAt:nowIso,stale:true,status:'UNAVAILABLE',registry:seedRegistry as Registry,jobs:seedJobs,receipt:null,scorecard:null,drift:null,
   detail:'Current published evaluations are unavailable. These are dated saved research records, not proof of a running learning job.'};
 }
 cache={at:now,value};return value;
}
