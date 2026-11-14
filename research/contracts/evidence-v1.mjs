/**
 * SportsEdge research-only point-in-time evidence contract.
 *
 * Portable pure functions; NO account, Odds API, Kalshi, model-switch,
 * provider download, storage, database, order or execution imports.
 * This module is a prototype and is NOT wired into the running website.
 */
export const DOMAINS=Object.freeze(['sports','stocks','public_events']);
export const DECISIONS=Object.freeze(['candidate_only','paper_entry','abstain']);
const ID=/^[a-zA-Z0-9_.:-]{1,160}$/;
const SHA=/^[a-f0-9]{64}$/;
const time=s=>typeof s==='string'&&s.endsWith('Z')&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
const status=(usable,reason)=>({usable,reason});

/** A provider record must have been legitimately available AND observed by the decision cutoff. */
export function sourceAtDecision(source,cutoff){
 const t=time(cutoff);
 if(t===null)return status(false,'BAD_CUTOFF');
 if(!source||typeof source!=='object')return status(false,'SOURCE_UNAVAILABLE');
 if(!ID.test(source.sourceId??'')||!SHA.test(source.payloadSha256??'')||
   typeof source.attribution!=='string'||!source.attribution.trim())
  return status(false,'BAD_SOURCE_PROVENANCE');
 if(source.permissionState!=='approved')return status(false,'SOURCE_PERMISSION_UNVERIFIED');
 const a=time(source.availableAt),o=time(source.observedAt);
 if(a===null)return status(false,'AVAILABILITY_UNKNOWN');
 if(o===null)return status(false,'OBSERVATION_UNKNOWN');
 if(a>=t)return status(false,'SOURCE_NOT_PUBLIC_AT_DECISION');
 if(o>t)return status(false,'SOURCE_NOT_CAPTURED_AT_DECISION');
 return status(true,'PROVEN_PRE_DECISION');
}

/** Returns only evidence metadata, not raw source text or account details. */
export function auditFrozenForecast(forecast,sourceRecords,outcome=null,receipt=null){
 const reasons=[];
 const domain=forecast?.domain,decision=forecast?.decision;
 if(!DOMAINS.includes(domain))reasons.push('BAD_DOMAIN');
 if(!DECISIONS.includes(decision))reasons.push('BAD_DECISION');
 if(!ID.test(forecast?.forecastId??'')||!ID.test(forecast?.eventId??'')||
   !ID.test(forecast?.modelVersion??''))reasons.push('BAD_IDENTITY');
 const created=time(forecast?.createdAt),cutoff=time(forecast?.featureCutoff),lock=time(forecast?.lockAt);
 if(created===null||cutoff===null||lock===null||cutoff>created||created>=lock)
  reasons.push('INVALID_FORECAST_TIMELINE');
 if(typeof forecast?.probability!=='number'||!Number.isFinite(forecast.probability)||
   forecast.probability<0||forecast.probability>1)reasons.push('INVALID_PROBABILITY');
 if(!Array.isArray(sourceRecords)||sourceRecords.length===0)reasons.push('NO_SOURCE_EVIDENCE');
 else if(cutoff!==null){
  const seen=new Set();
  for(const source of sourceRecords){
   const key=(source?.sourceId??'')+'|'+(source?.payloadSha256??'');
   if(seen.has(key)){reasons.push('DUPLICATE_SOURCE');continue;}
   seen.add(key);
   if(source?.domain!==domain){reasons.push('CROSS_DOMAIN_SOURCE');continue;}
   const result=sourceAtDecision(source,forecast.featureCutoff);
   if(!result.usable)reasons.push(result.reason);
  }
 }
 const uniq=[...new Set(reasons)],eligible=uniq.length===0;
 const base={
  forecastId:typeof forecast?.forecastId==='string'?forecast.forecastId:null,
  domain:DOMAINS.includes(domain)?domain:null,decision:DECISIONS.includes(decision)?decision:null,
  eligibleForForwardEvaluation:eligible,exclusions:uniq,
  evidenceCount:Array.isArray(sourceRecords)?sourceRecords.length:0
 };
 // A future, unverifiable result is unknown, NOT a loss and NOT a win.
 if(!eligible)return {...base,gradeState:'excluded',correct:null,netVirtualCents:null};
 const verified=outcome&&outcome.eventId===forecast.eventId&&outcome.state==='verified'&&
  typeof outcome.correct==='boolean'&&time(outcome.verifiedAt)!==null&&time(outcome.verifiedAt)>lock;
 if(!verified)return {...base,gradeState:'pending',correct:null,netVirtualCents:null};
 // A correct prediction is not a bet, and accuracy cannot imply winnings.
 const validReceipt=decision==='paper_entry'&&receipt&&receipt.forecastId===forecast.forecastId&&
  receipt.state==='settled'&&ID.test(receipt.entryId??'')&&
  time(receipt.recordedAt)!==null&&time(receipt.recordedAt)<lock&&
  time(receipt.verifiedAt)!==null&&time(receipt.verifiedAt)>lock&&
  Number.isSafeInteger(receipt.netVirtualCents);
 return {...base,gradeState:'graded',correct:outcome.correct,
  netVirtualCents:validReceipt?receipt.netVirtualCents:null};
}
/** Important: unknown metric is null, never a misleading numeric 0. */
export function summarizeReadOnlyAudit(records){
 if(!Array.isArray(records))throw Error('AUDIT_EXPECTS_RECORDS');
 const total=records.length,eligible=records.filter(r=>r.eligibleForForwardEvaluation).length;
 const graded=records.filter(r=>r.gradeState==='graded');
 const settled=graded.filter(r=>r.decision==='paper_entry'&&Number.isSafeInteger(r.netVirtualCents));
 return {
  total,eligible,excluded:total-eligible,graded:graded.length,
  pending:records.filter(r=>r.gradeState==='pending').length,
  correct:graded.filter(r=>r.correct===true).length,
  accuracy:graded.length?graded.filter(r=>r.correct===true).length/graded.length:null,
  paperSettled:settled.length,
  paperNetVirtualCents:settled.length?settled.reduce((sum,r)=>sum+r.netVirtualCents,0):null,
  note:'Read-only audit of frozen forecasts. Accuracy is not betting ROI, and an unknown amount is not $0.'
 };
}
