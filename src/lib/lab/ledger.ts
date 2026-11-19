/**
 * Immutable forward predictions. Pure mirror of the database rules in database/props/props_lab_v1.sql,
 * so the same guarantees hold in tests and in any offline replay:
 *  - one record per (experiment, variant, observation); a second write is refused, never merged;
 *  - recorded strictly before lock, with a data cutoff no later than the record time;
 *  - refused once any result exists for the observation (outcomes can never revise a prediction);
 *  - every record carries a SHA-256 over its content, so any later edit is detectable.
 * Grades are a separate append-only stream joined at evaluation time.
 */
import {canonicalJson,sha256} from '../props/normalize.ts';

export type FrozenPrediction={experimentId:string;specSha256:string;variantId:string;observationId:string;
 pMore:number;pLess:number;pTie:number;dataCutoff:string;predictedAt:string;lockAt:string;inputs:Record<string,unknown>};
export type LedgerRecord=FrozenPrediction&{recordSha256:string};
export type Grade={observationId:string;outcome:'more'|'less'|'tie'|'void';gradedAt:string};
export type Refusal='LAB_DUPLICATE'|'LAB_AFTER_LOCK'|'LAB_CUTOFF_AFTER_PREDICTION'|'LAB_RESULT_ALREADY_KNOWN'|'LAB_INVALID_PROBABILITIES'|'LAB_INVALID_CLOCK';

export const recordKey=(p:Pick<FrozenPrediction,'experimentId'|'variantId'|'observationId'>)=>[p.experimentId,p.variantId,p.observationId].join('|');
export function recordSha256(p:FrozenPrediction):string{return sha256(canonicalJson(p));}

export class ForwardLedger{
 #records=new Map<string,LedgerRecord>();
 #grades=new Map<string,Grade[]>();
 /** Append a prediction made at `nowIso`. Returns the stored record or a refusal; never overwrites. */
 append(p:Omit<FrozenPrediction,'predictedAt'>,nowIso:string):{ok:true;record:LedgerRecord}|{ok:false;refusal:Refusal}{
  const now=Date.parse(nowIso),lock=Date.parse(p.lockAt),cut=Date.parse(p.dataCutoff);
  if(![now,lock,cut].every(Number.isFinite))return {ok:false,refusal:'LAB_INVALID_CLOCK'};
  const probs=[p.pMore,p.pLess,p.pTie];
  if(!probs.every(x=>Number.isFinite(x)&&x>=0&&x<=1)||Math.abs(p.pMore+p.pLess+p.pTie-1)>1e-6)return {ok:false,refusal:'LAB_INVALID_PROBABILITIES'};
  if(now>=lock)return {ok:false,refusal:'LAB_AFTER_LOCK'};
  if(cut>now||cut>=lock)return {ok:false,refusal:'LAB_CUTOFF_AFTER_PREDICTION'};
  if(this.#grades.has(p.observationId))return {ok:false,refusal:'LAB_RESULT_ALREADY_KNOWN'};
  const key=recordKey(p);
  if(this.#records.has(key))return {ok:false,refusal:'LAB_DUPLICATE'};
  const base:FrozenPrediction={...p,inputs:structuredClone(p.inputs),predictedAt:new Date(now).toISOString()};
  const record=Object.freeze({...base,inputs:Object.freeze(base.inputs),recordSha256:recordSha256(base)}) as LedgerRecord;
  this.#records.set(key,record);
  return {ok:true,record};
 }
 /** Grades only arrive after lock and are append-only revisions; they never touch a prediction. */
 grade(g:Grade){
  const any=[...this.#records.values()].find(r=>r.observationId===g.observationId);
  if(any&&Date.parse(g.gradedAt)<=Date.parse(any.lockAt))throw new Error('LAB_GRADE_BEFORE_LOCK');
  this.#grades.set(g.observationId,[...(this.#grades.get(g.observationId)??[]),g]);
 }
 latestGrade(observationId:string):Grade|null{const g=this.#grades.get(observationId);return g?g[g.length-1]:null;}
 records():LedgerRecord[]{return [...this.#records.values()];}
}

/** Recompute every record's hash; any record whose content no longer matches is reported. */
export function verifyRecords(records:LedgerRecord[]):{ok:boolean;tampered:string[]}{
 const tampered=records.filter(r=>{const {recordSha256:h,...rest}=r;return recordSha256(rest)!==h;}).map(recordKey);
 return {ok:tampered.length===0,tampered};
}
