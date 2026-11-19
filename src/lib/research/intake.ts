/**
 * Research intake (design foundation, INACTIVE): the structured card every externally discovered idea must become
 * before any test, the duplicate / already-rejected check against config/research/registry.json, and a transparent
 * source-credibility score. Pure: no network, no scheduler, no model or registry writes. Nothing here can change an
 * active model, a pick rule, a stake or a schedule. See docs/SPORTSEDGE_NOV12_AI_READINESS.md §7.
 */
import {createHash} from 'node:crypto';

export type Domain='sports'|'stocks';
export type SourceKind='primary-filing'|'peer-reviewed'|'working-paper'|'official-fund-disclosure'|'audited-track-record'|
 'practitioner-writeup'|'self-reported-claim'|'social-media'|'marketing';
export type SourceRef={url:string;kind:SourceKind;retrievedAt:string;author:string|null;
 /** Does the author sell picks, a fund, a course or a subscription tied to the claim? */
 sellsProduct:boolean;
 /** Is the claimed performance independently verifiable from public records (filings, audited statements, a public ledger)? */
 performanceVerifiable:boolean};
export type HypothesisCard={
 domain:Domain;title:string;
 /** One testable rule in plain words, e.g. "Less on points when expected minutes fall >= 5 vs the 10-game mean". */
 rule:string;
 /** Every input the rule needs, and when each is known; anything not knowable before the decision is a leak. */
 inputs:{name:string;availableBeforeDecision:boolean;freeSource:string|null}[];
 holdingPeriod:string;baseline:string;costsModel:string;
 sources:SourceRef[];
 /** Bias review: each must be answered before a test is registered. */
 biases:{survivorship:string;selection:string;disclosureDelay:string;transactionCosts:string;dataSnooping:string};
};
export type IntakeVerdict={status:'READY_TO_PREREGISTER'|'DUPLICATE'|'PREVIOUSLY_REJECTED'|'NOT_TESTABLE'|'INCOMPLETE';
 key:string;credibility:number;reasons:string[]};

const WEIGHT:Record<SourceKind,number>={'primary-filing':1,'official-fund-disclosure':0.9,'audited-track-record':0.9,'peer-reviewed':0.8,
 'working-paper':0.6,'practitioner-writeup':0.4,'self-reported-claim':0.2,'social-media':0.1,'marketing':0};

/** 0..1: the best source's base weight, halved for a conflict of interest, capped at 0.3 when performance can't be verified. */
export function credibility(sources:SourceRef[]):number{
 let best=0;
 for(const s of sources){
  let w=WEIGHT[s.kind];
  if(s.sellsProduct)w/=2;
  if(!s.performanceVerifiable)w=Math.min(w,0.3);
  best=Math.max(best,w);
 }
 return Math.round(best*100)/100;
}

const norm=(t:string)=>t.normalize('NFKD').toLowerCase().replace(/[^a-z0-9%<>=.+-]+/g,' ').replace(/\s+/g,' ').trim();
/** Stable duplicate key: domain + normalized rule + sorted input names. Wording of the title never matters. */
export function hypothesisKey(c:Pick<HypothesisCard,'domain'|'rule'|'inputs'>):string{
 const inputs=[...new Set(c.inputs.map(i=>norm(i.name)))].sort().join(',');
 return createHash('sha256').update(`${c.domain}|${norm(c.rule)}|${inputs}`).digest('hex').slice(0,32);
}

/** Registry shape actually used by config/research/registry.json (only the fields intake reads). */
export type RegistryLike={strategies:{id:string;status:string;intakeKey?:string}[]};

export function assessIntake(c:HypothesisCard,registry:RegistryLike,seenKeys:ReadonlySet<string>=new Set()):IntakeVerdict{
 const key=hypothesisKey(c),reasons:string[]=[],score=credibility(c.sources);
 const prior=registry.strategies.find(s=>s.intakeKey===key);
 if(prior)return {status:prior.status==='rejected'?'PREVIOUSLY_REJECTED':'DUPLICATE',key,credibility:score,
  reasons:[`Already registered as ${prior.id} (${prior.status}); not re-researched.`]};
 if(seenKeys.has(key))return {status:'DUPLICATE',key,credibility:score,reasons:['Same rule and inputs already queued.']};
 if(!c.rule.trim()||!c.baseline.trim()||!c.costsModel.trim()||!c.holdingPeriod.trim())reasons.push('Rule, baseline, costs model and holding period are all required.');
 if(!c.sources.length)reasons.push('At least one source with a URL and retrieval time is required.');
 for(const s of c.sources)if(!/^https:\/\//.test(s.url)||!Number.isFinite(Date.parse(s.retrievedAt)))reasons.push(`Source needs an https URL and a retrieval time: ${s.url||'(none)'}.`);
 for(const [k,v] of Object.entries(c.biases))if(!v.trim())reasons.push(`Bias review missing: ${k}.`);
 if(reasons.length)return {status:'INCOMPLETE',key,credibility:score,reasons};
 const leaks=c.inputs.filter(i=>!i.availableBeforeDecision).map(i=>i.name);
 const paid=c.inputs.filter(i=>!i.freeSource).map(i=>i.name);
 if(leaks.length)reasons.push(`Inputs not knowable before the decision (look-ahead): ${leaks.join(', ')}.`);
 if(paid.length)reasons.push(`No free, lawful source for: ${paid.join(', ')} (paid data needs owner approval).`);
 if(reasons.length)return {status:'NOT_TESTABLE',key,credibility:score,reasons};
 return {status:'READY_TO_PREREGISTER',key,credibility:score,
  reasons:[score<0.5?'Low-credibility source: test only as an exploratory hypothesis; the claim itself is not evidence.':'Testable with free, pre-decision inputs.']};
}
