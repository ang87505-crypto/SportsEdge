/**
 * Read-only, dependency-free source freshness evaluator, prototype only.
 * It does not fetch providers, inspect broker credentials, read databases,
 * schedule jobs, dispatch workflows, place orders or change any release flag.
 * Do not use as an automatic trading/betting gate without a separate review.
 */
const DOMAINS=new Set(['sports','stocks','public_events','platform']);
const RESULT=new Set(['success','failure','unknown']);
const ID=/^[a-z][a-z0-9-]{1,80}$/;
const instant=x=>typeof x==='string'&&x.endsWith('Z')&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const rounded=n=>Number.isFinite(n)?Math.round(n):null;

export function inspectSource(source, nowIso){
 const now=instant(nowIso);
 if(now===null)throw Error('HEALTH_INVALID_NOW');
 if(!source||typeof source!=='object'||!ID.test(source.id??'')||
  !DOMAINS.has(source.domain)||typeof source.label!=='string'||!source.label.trim()||
  typeof source.enabled!=='boolean'||!Number.isInteger(source.cadenceMinutes)||
  source.cadenceMinutes<1||source.cadenceMinutes>10080||
  !Number.isInteger(source.graceMinutes)||source.graceMinutes<0||source.graceMinutes>1440||
  !RESULT.has(source.lastResult??'unknown'))throw Error('HEALTH_BAD_SOURCE');
 const safe={id:source.id,label:source.label,domain:source.domain,checkedAt:nowIso,
  enabled:source.enabled,lastSuccessAt:source.lastSuccessAt??null,
  lastAttemptAt:source.lastAttemptAt??null,cadenceMinutes:source.cadenceMinutes};
 if(!source.enabled)return {...safe,state:'disabled',actionable:false,ageMinutes:null,
  reason:'Collection is intentionally disabled. This is not zero predictions or zero opportunities.'};
 const success=source.lastSuccessAt===null||source.lastSuccessAt===undefined?null:instant(source.lastSuccessAt);
 const attempt=source.lastAttemptAt===null||source.lastAttemptAt===undefined?null:instant(source.lastAttemptAt);
 if((source.lastSuccessAt!=null&&success===null)||(source.lastAttemptAt!=null&&attempt===null)||
  (success!==null&&success>now)||(attempt!==null&&attempt>now)||
  (success!==null&&attempt!==null&&attempt<success))
  return {...safe,state:'unverified_clock',actionable:true,ageMinutes:null,
   reason:'Timestamps are missing, invalid, out of order or in the future. Verify receipts; no performance inference.'};
 if(success===null){
  if(source.lastResult==='failure')return {...safe,state:'failed',actionable:true,ageMinutes:null,
   reason:'The latest attempt failed and no successful collection is verified.'};
  return {...safe,state:'awaiting_first_capture',actionable:attempt!==null,ageMinutes:null,
   reason:'No successful capture is recorded. This is unavailable evidence, not zero results.'};
 }
 const age=(now-success)/60000,deadline=source.cadenceMinutes+source.graceMinutes;
 if(attempt!==null&&attempt>success&&source.lastResult==='failure')
  return {...safe,state:'failed',actionable:true,ageMinutes:rounded(age),
   reason:'The latest run failed after the last confirmed success. Review the job receipt; stale evidence must not be presented as current.'};
 if(age>deadline)
  return {...safe,state:'stale',actionable:true,ageMinutes:rounded(age),
   reason:'The last successful collection is older than the cadence plus delay allowance. A missing run is not zero predictions.'};
 return {...safe,state:'fresh',actionable:false,ageMinutes:rounded(age),
  reason:'A successful source capture was recorded within the expected window. This does not prove forecasts were accurate.'};
}

export function readOnlyHealthSummary(sources,nowIso){
 if(!Array.isArray(sources)||sources.length>50)throw Error('HEALTH_BAD_LIST');
 const ids=new Set();
 const rows=sources.map(s=>{
  const row=inspectSource(s,nowIso);
  if(ids.has(row.id))throw Error('HEALTH_DUPLICATE_SOURCE');
  ids.add(row.id);
  return row;
 });
 const counts={fresh:0,stale:0,failed:0,disabled:0,awaiting_first_capture:0,unverified_clock:0};
 for(const row of rows)counts[row.state]++;
 const problems=rows.filter(r=>r.actionable);
 const operating=rows.filter(r=>r.enabled);
 return {
  checkedAt:nowIso,records:rows.length,operating:operating.length,
  counts,actionable:problems.length,attention:problems.map(r=>({id:r.id,state:r.state,reason:r.reason})),
  systemState:!operating.length?'not_observed':problems.length?'needs_attention':
   rows.some(r=>r.enabled&&r.state==='awaiting_first_capture')?'incomplete':'healthy',
  note:'Source freshness only; not a trade, probability, betting edge or model health claim. Disabled and unknown are never scored as zero.'
 };
}
