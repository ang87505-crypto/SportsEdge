/** Public summaries only. Private account reads never enter this cache. */
import saved from '../../data/research/stock-strategy-summary.json' with {type:'json'};
import {parseStockResearch,type ResearchView} from '../research/stock-summary.ts';
const URL='https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/summary.json';
const CACHE_MS=60_000,MAX_BYTES=100_000;
let cached:{at:number;view:ResearchView}|null=null;
export function resetStockResearchCache(){cached=null;}
export async function loadStockResearch(nowIso:string,fetcher:typeof fetch=fetch):Promise<ResearchView>{
 const now=Date.parse(nowIso);
 if(cached&&now>=cached.at&&now-cached.at<CACHE_MS)return {...cached.view,checkedAt:nowIso};
 let summary=null;
 try{
  const res=await fetcher(URL,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6000)});
  if(res.ok&&Number(res.headers.get('content-length')??0)<=MAX_BYTES){
   const body=await res.text();
   if(new TextEncoder().encode(body).length<=MAX_BYTES)summary=parseStockResearch(JSON.parse(body),nowIso);
  }
 }catch{/* A dated saved report is distinct from the live feed. */}
 const fallback=summary?null:parseStockResearch(saved,nowIso);
 const view:ResearchView={summary:summary??fallback,mode:summary?'live':fallback?'saved':'unavailable',checkedAt:nowIso};
 cached={at:now,view};return view;
}
