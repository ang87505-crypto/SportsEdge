/** Public, bounded research read model. Shared by the dashboard and chat. */
export const RESEARCH_IDS=['momentum-quality-paper-v1','qmom-disclosure-follower-v1','berkshire-13f-top5-paper-v1'] as const;
export type ResearchId=typeof RESEARCH_IDS[number];
export const RESEARCH_NAMES:Record<ResearchId,string>={
 'momentum-quality-paper-v1':'Momentum quality',
 'qmom-disclosure-follower-v1':'QMOM holdings follower',
 'berkshire-13f-top5-paper-v1':'Berkshire filing follower',
};
export type ResearchMetrics={cagr:number|null;total:number|null;sharpe:number|null;max_drawdown:number|null;end_value:number|null};
export type StockResearchSummary={
 schemaVersion:'stock-research-summary-v1';generatedAt:string;sourceCommit:string|null;overall:string;
 historicalAt:string|null;window:[string,string]|null;capital:number|null;datasetFingerprint:string|null;
 benchmark:ResearchMetrics;forwardAt:string|null;
 sources:{id:string;status:string;retrievedAt:string;lastSuccessAt:string|null}[];
 candidates:{id:ResearchId;active:false;historical:null|{verdict:string;failedChecks:string[];costBps:number;continuous:ResearchMetrics;asLive:ResearchMetrics};
 forward:{status:string;sessions:number;firstExecution:string|null;totalReturn:number|null}}[];
 limitations:string[];
};
export type ResearchView={summary:StockResearchSummary|null;mode:'live'|'saved'|'unavailable';checkedAt:string};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=160):v is string=>typeof v==='string'&&v.length<=max;
const time=(v:unknown):v is string=>text(v,40)&&Number.isFinite(Date.parse(v));
const nullableTime=(v:unknown)=>v===null||time(v);
const num=(v:unknown)=>v===null||(typeof v==='number'&&Number.isFinite(v));
const metrics=(v:unknown):v is ResearchMetrics=>obj(v)&&['cagr','total','sharpe','max_drawdown','end_value'].every(k=>num(v[k]));
/** Invalid/incomplete/future-dated snapshots are refused as a whole. */
export function parseStockResearch(v:unknown,nowIso:string):StockResearchSummary|null{
 if(!obj(v)||v.schemaVersion!=='stock-research-summary-v1'||!time(v.generatedAt)||
  Date.parse(v.generatedAt)>Date.parse(nowIso)+300_000||!text(v.overall)||
  !(v.sourceCommit===null||(text(v.sourceCommit,64)&&/^[a-f0-9]{40}$/.test(v.sourceCommit)))||
  !nullableTime(v.historicalAt)||!nullableTime(v.forwardAt)||!num(v.capital)||
  !(v.window===null||(Array.isArray(v.window)&&v.window.length===2&&v.window.every(d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d))))||
  !(v.datasetFingerprint===null||(text(v.datasetFingerprint,64)&&/^[a-f0-9]{64}$/.test(v.datasetFingerprint)))||
  !metrics(v.benchmark)||!Array.isArray(v.candidates)||v.candidates.length!==3||
  !Array.isArray(v.sources)||v.sources.length>12||!Array.isArray(v.limitations)||v.limitations.length>8||
  !v.limitations.every(s=>text(s,500)))return null;
 const ids=new Set();
 for(const c of v.candidates){
  if(!obj(c)||!RESEARCH_IDS.includes(c.id as ResearchId)||ids.has(c.id)||c.active!==false||!obj(c.forward)||
    !text(c.forward.status)||!Number.isSafeInteger(c.forward.sessions)||(c.forward.sessions as number)<0||
    !nullableTime(c.forward.firstExecution)||!num(c.forward.totalReturn))return null;
  if(c.forward.sessions===0&&c.forward.totalReturn!==null)return null;
  ids.add(c.id);
  const h=c.historical;
  if(h!==null&&(!obj(h)||!text(h.verdict)||h.costBps!==10||!metrics(h.continuous)||!metrics(h.asLive)||
    !Array.isArray(h.failedChecks)||h.failedChecks.length>30||!h.failedChecks.every(s=>text(s))))return null;
 }
 for(const s of v.sources)if(!obj(s)||!text(s.id)||!text(s.status)||!time(s.retrievedAt)||!nullableTime(s.lastSuccessAt))return null;
 return v as unknown as StockResearchSummary;
}
export const RESEARCH_REPORT_URL='https://github.com/ang87505-crypto/SportsEdge/blob/research-data/reports/LATEST.md';
