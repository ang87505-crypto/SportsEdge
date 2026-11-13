/**
 * AI 2.0 learning engine: the experiment record and its lifecycle. Pure; no I/O.
 *
 * New verified results → diagnostics → hypothesis → registered experiment → frozen prediction → verified outcome →
 * statistical evaluation → recommendation. The engine records and recommends; it NEVER promotes. There is no
 * "promoted" or "active" status: a READY_FOR_REVIEW experiment waits for the owner, and any live change happens
 * outside this module through the existing owner-approved paths.
 */
import {canonicalJson,sha256} from '../../props/normalize.ts';

export type Domain='sports'|'stocks';
export const STATUSES=['PROPOSED','RUNNING','INSUFFICIENT_DATA','FAILED','PROMISING','READY_FOR_REVIEW','REJECTED'] as const;
export type Status=typeof STATUSES[number];

/** Allowed transitions. REJECTED is terminal (the idea is remembered, never silently retested). */
export const TRANSITIONS:Record<Status,Status[]>={
 PROPOSED:['RUNNING','REJECTED','FAILED'],
 RUNNING:['INSUFFICIENT_DATA','PROMISING','REJECTED','FAILED','RUNNING'],
 INSUFFICIENT_DATA:['RUNNING','INSUFFICIENT_DATA','PROMISING','REJECTED','FAILED'],
 FAILED:['RUNNING','REJECTED'],
 PROMISING:['RUNNING','PROMISING','READY_FOR_REVIEW','REJECTED','INSUFFICIENT_DATA'],
 READY_FOR_REVIEW:['READY_FOR_REVIEW','REJECTED'],
 REJECTED:[],
};

export type SampleRequirements={minObservations:number;minDates?:number;minClusters?:number;minDecisions?:number;minWeeks?:number};
export type Experiment={
 id:string;domain:Domain;
 /** Normalised idea key: two experiments with the same key test the same idea. */
 hypothesisKey:string;hypothesis:string;
 /** Other idea keys this experiment also tests (so the engine does not re-propose them). */
 alsoCovers?:string[];
 dataDependencies:string[];frozen:{features:string[];parameters:Record<string,unknown>};
 dataCutoff:string;codeFingerprint:string;datasetFingerprints:{name:string;sha256:string}[];
 metrics:{primary:string;secondary:string[]};sampleRequirements:SampleRequirements;baseline:string;
 costAssumptions:string|null;decisionRule:string;
 status:Status;result:Record<string,unknown>|null;disposition:string|null;
 source:'existing'|'engine';registeredAt:string;
 history:{at:string;from:Status|null;to:Status;reason:string;inputFingerprint:string|null}[];
};
export type Registry={schema:'sportsedge-learning-registry-v1';experiments:Experiment[]};

export const hypothesisKey=(domain:Domain,idea:string)=>`${domain}:${idea.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`;
export const fingerprint=(x:unknown)=>sha256(canonicalJson(x));

export class EngineError extends Error{
 readonly code:string;
 constructor(code:string){super('Learning engine: '+code);this.name='EngineError';this.code=code;}
}

const REQUIRED:(keyof Experiment)[]=['id','domain','hypothesisKey','hypothesis','dataCutoff','codeFingerprint','metrics','sampleRequirements','baseline','decisionRule'];
export function validate(e:Experiment):void{
 for(const k of REQUIRED)if(e[k]===undefined||e[k]===null||e[k]==='')throw new EngineError('MISSING_'+String(k).toUpperCase());
 if(!/^[a-z0-9][a-z0-9.-]{2,80}$/.test(e.id))throw new EngineError('BAD_ID');
 if(!STATUSES.includes(e.status))throw new EngineError('BAD_STATUS');
 if(!e.hypothesisKey.startsWith(e.domain+':'))throw new EngineError('DOMAIN_MISMATCH');
 if(!Number.isFinite(Date.parse(e.dataCutoff)))throw new EngineError('BAD_CUTOFF');
}

/** Register a new experiment. Refuses a duplicate id and an idea that was already rejected or is still being tested. */
export function register(reg:Registry,e:Experiment,at:string):Registry{
 validate(e);
 if(reg.experiments.some(x=>x.id===e.id))throw new EngineError('DUPLICATE_ID');
 const keys=new Set([e.hypothesisKey,...(e.alsoCovers??[])]);
 const same=reg.experiments.filter(x=>[x.hypothesisKey,...(x.alsoCovers??[])].some(k=>keys.has(k)));
 if(same.some(x=>x.status==='REJECTED'))throw new EngineError('IDEA_ALREADY_REJECTED');
 if(same.some(x=>x.status!=='FAILED'))throw new EngineError('IDEA_ALREADY_UNDER_TEST');
 const rec:Experiment={...e,history:[...e.history,{at,from:null,to:e.status,reason:'registered',inputFingerprint:null}]};
 return {...reg,experiments:[...reg.experiments,rec]};
}

/** Move an experiment through its lifecycle. Idempotent per input: the same input fingerprint is processed once. */
export function transition(reg:Registry,id:string,to:Status,reason:string,at:string,inputFingerprint:string|null,
 result?:Record<string,unknown>,disposition?:string):{registry:Registry;changed:boolean}{
 const i=reg.experiments.findIndex(x=>x.id===id);
 if(i<0)throw new EngineError('UNKNOWN_EXPERIMENT');
 const e=reg.experiments[i];
 if(inputFingerprint&&e.history.some(h=>h.inputFingerprint===inputFingerprint))return {registry:reg,changed:false};
 if(!TRANSITIONS[e.status].includes(to))throw new EngineError(`ILLEGAL_TRANSITION_${e.status}_TO_${to}`);
 const next:Experiment={...e,status:to,result:result??e.result,disposition:disposition??e.disposition,
  history:[...e.history,{at,from:e.status,to,reason,inputFingerprint}]};
 const experiments=[...reg.experiments];experiments[i]=next;
 return {registry:{...reg,experiments},changed:true};
}

/** Ideas the engine must not propose again (rejected) or that are already being tested. */
export function blockedIdeas(reg:Registry):{rejected:Set<string>;active:Set<string>}{
 const rejected=new Set<string>(),active=new Set<string>();
 for(const e of reg.experiments)for(const k of [e.hypothesisKey,...(e.alsoCovers??[])]){
  if(e.status==='REJECTED')rejected.add(k);else if(e.status!=='FAILED')active.add(k);
 }
 for(const k of rejected)active.delete(k);
 return {rejected,active};
}
