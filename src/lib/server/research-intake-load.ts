/** Dated intake receipts, not source claims inferred from a deployment or green workflow. */
import {INTAKE_INDEX,intakeIndex,type IntakeReceipt} from '../research/archive.ts';
import {checksum} from '../research/provenance.ts';
const ROOT='https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/';
export type IntakeSnapshot={receipt:IntakeReceipt|null;stale:boolean;sources:{id:string;state:string}[];detail:string};
export async function loadResearchIntake(nowIso:string,fetcher:typeof fetch=fetch):Promise<IntakeSnapshot>{
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('INTAKE_INVALID_CLOCK');
 const read=async(path:string)=>{
  const r=await fetcher(ROOT+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6000)});
  if(!r.ok||Number(r.headers.get('content-length')??0)>2_000_000)throw Error('INTAKE_UNAVAILABLE');
  const text=await r.text();if(Buffer.byteLength(text)>2_000_000)throw Error('INTAKE_TOO_LARGE');return text;
 };
 try{
  const receipt=intakeIndex(await read(INTAKE_INDEX)).at(-1);
  if(!receipt||Date.parse(receipt.at)>now)throw Error('INTAKE_NO_VALID_RECEIPT');
  const root='research-intake/runs/'+receipt.runId+'/';
  const [report,manifest]=await Promise.all(['report','manifest'].map(async f=>JSON.parse(await read(root+f+'.json'))));
  if(checksum(report)!==receipt.reportSha256||checksum(manifest)!==receipt.manifestSha256||report.retrievedAt!==receipt.at)throw Error('INTAKE_DIGEST');
  const sources=Object.entries(report.sources??{}).map(([id,s])=>({id,state:(s as {connected:string}).connected}));
  if(!sources.length||sources.some(s=>!['VERIFIED_THIS_RUN','PARTIAL','FAILED'].includes(s.state)))throw Error('INTAKE_BAD_SOURCES');
  const stale=now-Date.parse(receipt.at)>48*3600_000;
  return {receipt,stale,sources,detail:stale?'Latest source check is older than 48 hours.':receipt.status==='PARTIAL'?'Some sources failed or were incomplete; inspect the per-source states.':
   'Source checks completed. Literature metadata is queued for review; methods and claimed findings are not independently verified.'};
 }catch{return {receipt:null,stale:true,sources:[],detail:'No current verified intake receipt is available. Connected source code alone does not prove a fresh collection.'};}
}
