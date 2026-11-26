/**
 * Forecast traceability: can EVERY captured NBA prediction (every model, picked or not) be followed from its frozen line,
 * confidence and model version to its eventual outcome? Pure and read-only: no provider, database write or model change.
 *
 * Each prediction gets one outcome state:
 *  graded / void / pending (lock not yet passed + grace) / OVERDUE (lock passed more than `overdueHours` ago, no result)
 * and zero or more integrity issues. A ledger is TRACEABLE only with no issues and no overdue outcomes; otherwise the
 * report says exactly which rows break the chain. Missing evidence is never filled in or inferred.
 */
import type {ResearchRaw} from './research.ts';
import {validProbabilities} from './research.ts';

export const TRACE_POLICY={version:'props-forecast-trace-v1',overdueHours:36,windowEdgeDays:7,maxIssueRows:100} as const;
export type TraceIssue='MISSING_OBSERVATION'|'PREDICTED_AT_OR_AFTER_LOCK'|'CUTOFF_AFTER_PREDICTION'|'PREDICTED_BEFORE_LINE_RECORDED'|
 'INVALID_PROBABILITIES'|'MISSING_MODEL_VERSION'|'GRADED_BEFORE_LOCK'|'INVALID_TIMESTAMP';
export type TraceOutcome='graded'|'void'|'pending'|'overdue'|'unscorable';
export type TraceRow={predictionId:number;observationId:number;modelVersion:string;line:number|null;lockAt:string|null;
 side:'more'|'less'|null;confidence:number|null;decision:'entered'|'recorded'|'skipped'|'none';outcome:TraceOutcome;
 result:string|null;revisions:number;issues:TraceIssue[]};

type Pred=ResearchRaw['predictions'][number];
const ms=(s:string|null|undefined)=>typeof s==='string'?Date.parse(s):NaN;

export function traceForecasts(raw:ResearchRaw,policy=TRACE_POLICY){
 const now=ms(raw.nowIso),windowStart=ms(raw.windowStart);
 if(!Number.isFinite(now)||!Number.isFinite(windowStart))throw new Error('TRACE_INVALID_CLOCK');
 const obs=new Map(raw.observations.map(o=>[o.id,o]));
 const results=new Map<number,ResearchRaw['results']>();
 for(const r of raw.results){const a=results.get(r.observation_id)??[];a.push(r);results.set(r.observation_id,a);}
 const picks=new Map<number,ResearchRaw['picks']>();
 for(const k of raw.picks){const a=picks.get(k.prediction_id)??[];a.push(k);picks.set(k.prediction_id,a);}
 const entered=new Set(raw.entryLegs.map(l=>l.pick_id));
 const rows:TraceRow[]=[];let windowEdge=0;
 for(const p of raw.predictions as Pred[]){
  const issues:TraceIssue[]=[];
  if(!p.model_version)issues.push('MISSING_MODEL_VERSION');
  const o=obs.get(p.observation_id);
  if(!o){
   // Observations are windowed by recorded_at, predictions by predicted_at: an early prediction's line can sit just
   // outside the window. Only a prediction well inside the window with no line is a broken chain.
   if(ms(p.predicted_at)-windowStart<policy.windowEdgeDays*86400_000){windowEdge++;continue;}
   issues.push('MISSING_OBSERVATION');
  }
  const lock=ms(o?.lock_at),predicted=ms(p.predicted_at),cutoff=ms(p.data_cutoff),recorded=ms(o?.recorded_at);
  if(!Number.isFinite(predicted)||!Number.isFinite(cutoff)||(o&&(!Number.isFinite(lock)||!Number.isFinite(recorded))))issues.push('INVALID_TIMESTAMP');
  else{
   if(o&&predicted>=lock)issues.push('PREDICTED_AT_OR_AFTER_LOCK');
   if(cutoff>predicted)issues.push('CUTOFF_AFTER_PREDICTION');
   if(o&&predicted<recorded)issues.push('PREDICTED_BEFORE_LINE_RECORDED');
  }
  let side:'more'|'less'|null=null,confidence:number|null=null;
  const scored=p.status==='scored';
  if(scored){
   const probs={pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)};
   if(p.p_more===null||p.p_less===null||p.p_tie===null||!validProbabilities(probs))issues.push('INVALID_PROBABILITIES');
   else{side=probs.pMore>=probs.pLess?'more':'less';confidence=probs.pTie<1?Math.max(probs.pMore,probs.pLess)/(1-probs.pTie):0.5;}
  }
  const ks=picks.get(p.id)??[];
  const decision=ks.some(k=>k.status==='recorded'&&entered.has(k.id))?'entered':ks.some(k=>k.status==='recorded')?'recorded':ks.length?'skipped':'none';
  const rs=(results.get(p.observation_id)??[]).filter(r=>ms(r.graded_at)<=now);
  if(o&&rs.some(r=>!(ms(r.graded_at)>lock)))issues.push('GRADED_BEFORE_LOCK');
  const latest=rs.reduce<ResearchRaw['results'][number]|null>((a,r)=>!a||r.revision>a.revision?r:a,null);
  let outcome:TraceOutcome;
  if(!scored)outcome='unscorable';
  else if(latest)outcome=latest.outcome.startsWith('void')?'void':'graded';
  else outcome=o&&Number.isFinite(lock)&&now-lock>policy.overdueHours*3600_000?'overdue':'pending';
  rows.push({predictionId:p.id,observationId:p.observation_id,modelVersion:p.model_version,line:o?Number(o.line):null,lockAt:o?.lock_at??null,
   side,confidence,decision,outcome,result:latest?.outcome??null,revisions:rs.length,issues});
 }
 const byModel:Record<string,Record<string,number>>={};
 for(const r of rows){
  const m=byModel[r.modelVersion||'(missing)']??={predictions:0,graded:0,void:0,pending:0,overdue:0,unscorable:0,withIssues:0,
   entered:0,recorded:0,skipped:0,undecided:0,corrected:0};
  m.predictions++;m[r.outcome]++;if(r.issues.length)m.withIssues++;if(r.revisions>1)m.corrected++;
  m[r.decision==='none'?'undecided':r.decision]++;
 }
 const issueCounts:Record<string,number>={};for(const r of rows)for(const i of r.issues)issueCounts[i]=(issueCounts[i]??0)+1;
 const overdue=rows.filter(r=>r.outcome==='overdue').length,withIssues=rows.filter(r=>r.issues.length).length;
 return {policy,asOf:raw.nowIso,windowStart:raw.windowStart,predictions:rows.length,windowEdgeExcluded:windowEdge,
  state:withIssues?'INTEGRITY_ISSUES':overdue?'MISSING_OUTCOMES':'TRACEABLE' as 'INTEGRITY_ISSUES'|'MISSING_OUTCOMES'|'TRACEABLE',
  issues:issueCounts,overdue,byModel,
  examples:rows.filter(r=>r.issues.length||r.outcome==='overdue').slice(0,policy.maxIssueRows),rows};
}
