/** Public operations status from the ops-status branch. No saved fallback: an old status must never look current. */
import {parseOpsStatus,OPS_STATUS_URL,MONITOR_STALE_HOURS,type OpsView} from '../ops/status.ts';
const CACHE_MS=60_000,MAX_BYTES=200_000;
let cached:{at:number;view:OpsView}|null=null;
export function resetOpsStatusCache(){cached=null;}
export async function loadOpsStatus(nowIso:string,fetcher:typeof fetch=fetch):Promise<OpsView>{
 const now=Date.parse(nowIso);
 if(cached&&now>=cached.at&&now-cached.at<CACHE_MS)return {...cached.view,checkedAt:nowIso};
 let status=null;
 try{
  const res=await fetcher(OPS_STATUS_URL,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6000)});
  if(res.ok){const body=await res.text();if(new TextEncoder().encode(body).length<=MAX_BYTES)status=parseOpsStatus(JSON.parse(body),nowIso);}
 }catch{/* reported as unavailable */}
 const view:OpsView={status,mode:status?'live':'unavailable',checkedAt:nowIso,
  monitorStale:!!status&&now-Date.parse(status.generatedAt)>MONITOR_STALE_HOURS*3600_000};
 cached={at:now,view};return view;
}
