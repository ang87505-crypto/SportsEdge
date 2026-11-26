/**
 * Bridges for knyc-multisource-emos-v1-research:
 * - engineResult(): maps an evaluation report to the learning engine's Result. Historical evidence is
 *   'retrospective', so the engine caps it at PROMISING. Only forward frozen evidence can request review.
 * - paperReadiness(): the pre-registered gates for automated PAPER testing. Evidence alone reaches at most
 *   READY_FOR_OWNER_APPROVAL; only the owner's approval moves it further. Exchange access, orders and stakes are
 *   never enabled from here.
 */
import {ANCHORS,MULTISOURCE_MODEL_ID,MULTISOURCE_POLICY,type Anchor} from './weather-multisource.ts';
import {EVAL_POLICY,type MultisourceEvalReport} from './weather-multisource-eval.ts';

export const MULTISOURCE_EXPERIMENT_ID='lab-weather-knyc-multisource-emos-v1';

export function engineResult(report:MultisourceEvalReport,evidence:'retrospective'|'forward'='retrospective'){
 if(report.modelId!==MULTISOURCE_MODEL_ID||report.schema!=='kalshi-weather-multisource-eval-v1')throw Error('WX_MS_BAD_REPORT');
 const hold=report.anchors.length?Math.min(...report.anchors.map(a=>a.holdoutDays)):0;
 return {experimentId:MULTISOURCE_EXPERIMENT_ID,result:{evidence,disposition:report.disposition,observations:hold,dates:hold,
  reason:report.anchors.map(a=>`${a.anchor}: ${a.disposition} (${a.holdoutDays} holdout days; ${a.reason})`).join(' ')+
   ' Forecast accuracy only; no market data, no profitability claim.'}};
}

export type ForwardStatus={anchor:Anchor;forwardFrozenDays:number;forwardHoldoutDays:number;
 forwardDisposition:'PROMISING'|'NO_CLEAR_EFFECT'|'REJECTED'|null;membersCapturedForward:string[]};
export type PaperReadiness={modelId:typeof MULTISOURCE_MODEL_ID;status:'NOT_READY'|'READY_FOR_OWNER_APPROVAL'|'OWNER_APPROVED_FOR_PAPER';
 missing:string[];exchangeAccess:'DISABLED';ordersEnabled:false;note:string};
/** Pre-registered gates. Any missing item keeps the status NOT_READY. Owner approval is always the last step. */
export function paperReadiness(forward:readonly ForwardStatus[],ownerApproved:boolean):PaperReadiness{
 const missing:string[]=[];
 for(const a of ANCHORS){
  const f=forward.find(x=>x.anchor===a);
  if(!f){missing.push(`${a}: no forward-frozen evaluation`);continue;}
  if(!f.membersCapturedForward.some(m=>m==='NBM'||m==='GFS_MOS'))
   missing.push(`${a}: no forward capture of NBM or GFS MOS frozen before the anchor (collector owner's work)`);
  if(f.forwardFrozenDays<MULTISOURCE_POLICY.minTrainingDays)missing.push(`${a}: ${f.forwardFrozenDays}/${MULTISOURCE_POLICY.minTrainingDays} forward-frozen days`);
  if(f.forwardHoldoutDays<EVAL_POLICY.minHoldoutDaysForReview)missing.push(`${a}: ${f.forwardHoldoutDays}/${EVAL_POLICY.minHoldoutDaysForReview} forward holdout days`);
  if(f.forwardDisposition!=='PROMISING')missing.push(`${a}: forward decision rule not met (${f.forwardDisposition??'not evaluated'})`);
 }
 return {modelId:MULTISOURCE_MODEL_ID,status:missing.length?'NOT_READY':ownerApproved?'OWNER_APPROVED_FOR_PAPER':'READY_FOR_OWNER_APPROVAL',missing,
  exchangeAccess:'DISABLED',ordersEnabled:false,
  note:'Readiness for PAPER testing of forecast probabilities only. Exchange access, orders and stakes stay disabled; enabling them is a separate owner decision.'};
}
