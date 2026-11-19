/** Public append-only research intake receipt contract. */
export const INTAKE_INDEX='research-intake/index.jsonl';
export type IntakeReceipt={schema:'research-intake-archive-v1';runId:string;at:string;sourceCommit:string;status:'OK'|'PARTIAL';
 manifestSha256:string;reportSha256:string;objectsSha256:string;reviewQueue:number;quarantined:number;objectsAdded:number;objectsReused:number};
export function intakeIndex(text:string):IntakeReceipt[]{
 if(Buffer.byteLength(text)>2_000_000)throw Error('INTAKE_INDEX_TOO_LARGE');const ids=new Set<string>();
 return text.split('\n').filter(l=>l.trim()).map(l=>{
  const r=JSON.parse(l) as IntakeReceipt;
  if(r.schema!=='research-intake-archive-v1'||!/^\d{1,24}-\d{1,5}$/.test(r.runId)||!Number.isFinite(Date.parse(r.at))||
   !/^[a-f0-9]{40}$/.test(r.sourceCommit)||!['OK','PARTIAL'].includes(r.status)||
   ![r.manifestSha256,r.reportSha256,r.objectsSha256].every(h=>/^[a-f0-9]{64}$/.test(h))||
   ![r.reviewQueue,r.quarantined,r.objectsAdded,r.objectsReused].every(n=>Number.isSafeInteger(n)&&n>=0)||ids.has(r.runId))throw Error('INTAKE_BAD_RECEIPT');
  ids.add(r.runId);return r;
 });
}
