/** Public research snapshots. Every run is immutable; only the index is appended. */
import {fingerprint,validate,type Registry} from './experiments.ts';
import type {Job} from './view.ts';

export const ENGINE_INDEX='learning-engine/index.jsonl';
export const ENGINE_ARCHIVE_VERSION='learning-engine-archive-v1';
export const MAX_ENGINE_BYTES=2_000_000;
export type EngineReceipt={schema:typeof ENGINE_ARCHIVE_VERSION;runId:string;at:string;status:'OK'|'FAILED';
 sourceCommit:string;registrySha256:string;reportSha256:string;summary:string};
export type EngineReport={at:string;status:'OK'|'FAILED';failure:string|null;[key:string]:unknown};
export const engineRunPath=(id:string)=>{
 if(!/^\d{1,24}-\d{1,5}$/.test(id))throw Error('ENGINE_BAD_RUN_ID');
 return `learning-engine/runs/${id}`;
};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseEngineRegistry(v:unknown):Registry{
 if(!object(v)||v.schema!=='sportsedge-learning-registry-v1'||!Array.isArray(v.experiments)||v.experiments.length>2000)throw Error('ENGINE_BAD_REGISTRY');
 const reg=v as unknown as Registry,seen=new Set<string>();
 for(const e of reg.experiments){
  if(!object(e)||!['sports','stocks'].includes(e.domain)||!Array.isArray(e.history)||!object(e.sampleRequirements))throw Error('ENGINE_BAD_EXPERIMENT');
  validate(e);if(seen.has(e.id))throw Error('ENGINE_DUPLICATE_EXPERIMENT');seen.add(e.id);
 }
 return reg;
}
export function parseEngineIndex(text:string):EngineReceipt[]{
 if(Buffer.byteLength(text)>MAX_ENGINE_BYTES)throw Error('ENGINE_INDEX_TOO_LARGE');
 const seen=new Set<string>();
 const receipts=text.split('\n').filter(x=>x.trim()).map(line=>{
  const r:unknown=JSON.parse(line);
  if(!object(r)||r.schema!==ENGINE_ARCHIVE_VERSION||typeof r.runId!=='string'||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||
   !['OK','FAILED'].includes(String(r.status))||typeof r.sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(r.sourceCommit)||
   typeof r.registrySha256!=='string'||!/^[a-f0-9]{64}$/.test(r.registrySha256)||typeof r.reportSha256!=='string'||!/^[a-f0-9]{64}$/.test(r.reportSha256)||
   typeof r.summary!=='string'||r.summary.length>1000)throw Error('ENGINE_BAD_RECEIPT');
  engineRunPath(r.runId);if(seen.has(r.runId))throw Error('ENGINE_DUPLICATE_RUN');seen.add(r.runId);
  return r as EngineReceipt;
 });
 return receipts;
}
export function verifyEngineRun(receipt:EngineReceipt,registry:unknown,report:unknown){
 const reg=parseEngineRegistry(registry);
 if(fingerprint(reg)!==receipt.registrySha256||fingerprint(report)!==receipt.reportSha256)throw Error('ENGINE_DIGEST_MISMATCH');
 if(!object(report)||report.at!==receipt.at||report.status!==receipt.status)throw Error('ENGINE_REPORT_MISMATCH');
 return {registry:reg,report:report as EngineReport};
}
export function engineJobs(receipts:EngineReceipt[]):Job[]{
 return receipts.slice(-10).map(r=>({at:r.at,job:'Published learning evaluation',run:r.runId,status:r.status,summary:r.summary}));
}
