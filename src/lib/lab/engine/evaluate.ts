/**
 * AI 2.0 learning engine: turns a research result into a lifecycle status. Pure; no I/O.
 * The result's own pre-registered decision rule decides PROMISING / NO_CLEAR_EFFECT / REJECTED; this module adds
 * the sample gate. READY_FOR_REVIEW requires FORWARD (frozen-before-lock) evidence that meets the registered
 * minimums; retrospective evidence alone can reach PROMISING at most. Nothing here promotes anything.
 */
import type {Experiment,SampleRequirements,Status} from './experiments.ts';

export type Evidence='retrospective'|'forward';
export type Result={evidence:Evidence;disposition:'PROMISING'|'NO_CLEAR_EFFECT'|'REJECTED'|'ERROR';
 observations:number;dates?:number;clusters?:number;decisions?:number;weeks?:number;reason:string};

export function meetsSample(r:Result,s:SampleRequirements):{ok:boolean;missing:string[]}{
 const missing:string[]=[];
 if(r.observations<s.minObservations)missing.push(`observations ${r.observations}/${s.minObservations}`);
 if(s.minDates!==undefined&&(r.dates??0)<s.minDates)missing.push(`dates ${r.dates??0}/${s.minDates}`);
 if(s.minClusters!==undefined&&(r.clusters??0)<s.minClusters)missing.push(`clusters ${r.clusters??0}/${s.minClusters}`);
 if(s.minDecisions!==undefined&&(r.decisions??0)<s.minDecisions)missing.push(`decisions ${r.decisions??0}/${s.minDecisions}`);
 if(s.minWeeks!==undefined&&(r.weeks??0)<s.minWeeks)missing.push(`weeks ${r.weeks??0}/${s.minWeeks}`);
 return {ok:!missing.length,missing};
}

/** The status an experiment should move to given a new result. */
export function nextStatus(e:Experiment,r:Result):{to:Status;reason:string}{
 if(r.disposition==='ERROR')return {to:'FAILED',reason:'The research run failed: '+r.reason};
 if(r.disposition==='REJECTED')return {to:'REJECTED',reason:r.reason};
 const sample=meetsSample(r,e.sampleRequirements);
 if(e.status==='READY_FOR_REVIEW')return {to:'READY_FOR_REVIEW',reason:'Awaiting owner review; new evidence recorded: '+r.reason};
 if(r.evidence==='forward'&&!sample.ok)return {to:'INSUFFICIENT_DATA',reason:'Forward sample below the registered minimums: '+sample.missing.join(', ')};
 if(r.disposition==='NO_CLEAR_EFFECT')return {to:e.status==='PROPOSED'?'RUNNING':e.status==='PROMISING'?'PROMISING':'RUNNING',
  reason:'No clear effect yet; continues only through prospective evaluation. '+r.reason};
 // PROMISING
 if(r.evidence==='forward'&&sample.ok)return {to:'READY_FOR_REVIEW',reason:'Forward evidence meets the registered minimums and the decision rule. Owner review required; nothing is promoted automatically. '+r.reason};
 return {to:'PROMISING',reason:'Retrospective evidence only; forward frozen predictions must meet the registered minimums before review. '+r.reason};
}
