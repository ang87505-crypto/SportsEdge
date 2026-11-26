/**
 * Bridges for knyc-multisource-emos-v1-research.
 * - engineResult(): maps an evaluation (historical: 'retrospective', capped at PROMISING) or a forward PAPER
 *   summary ('forward') to the learning engine's Result. Only forward evidence that meets the registered
 *   minimums can request owner review; nothing is promoted automatically.
 * - paperReadiness(): three separate stages.
 *   1. PAPER_FORECASTING: frozen forecasts and grading only (no market data, no orders). Allowed once every anchor
 *      has the registered 30 training days from verified history, plus a verified input path. Historical archives
 *      count, because the protocol trains on a 30-day trailing window with documented availability.
 *   2. OWNER_REVIEW: the registered 50 graded FORWARD days per anchor meeting the forward rule.
 *   3. EXCHANGE: always DISABLED here. Market data, paper trading against prices and orders are separate owner
 *      decisions.
 *   Amendment 2026-11-26 (before any forward forecast existed): the original paperTestReadiness list required
 *   30 forward-frozen and 50 forward holdout days BEFORE paper forecasting, which is circular, because paper
 *   forecasting produces that evidence. Those 30/50 minimums now gate owner review, as everywhere else in
 *   SportsEdge. No model constant changed.
 */
import {ANCHORS,MULTISOURCE_MODEL_ID,MULTISOURCE_POLICY,type Anchor} from './weather-multisource.ts';
import {EVAL_POLICY,type MultisourceEvalReport} from './weather-multisource-eval.ts';
import type {ForwardAnchorSummary} from './weather-multisource-paper.ts';

export const MULTISOURCE_EXPERIMENT_ID='lab-weather-knyc-multisource-emos-v1';

export function engineResult(report:MultisourceEvalReport,evidence:'retrospective'|'forward'='retrospective'){
 if(report.modelId!==MULTISOURCE_MODEL_ID||report.schema!=='kalshi-weather-multisource-eval-v1')throw Error('WX_MS_BAD_REPORT');
 const hold=report.anchors.length?Math.min(...report.anchors.map(a=>a.holdoutDays)):0;
 return {experimentId:MULTISOURCE_EXPERIMENT_ID,result:{evidence,disposition:report.disposition,observations:hold,dates:hold,
  reason:report.anchors.map(a=>`${a.anchor}: ${a.disposition} (${a.holdoutDays} holdout days; ${a.reason})`).join(' ')+
   ' Forecast accuracy only; no market data, no profitability claim.'}};
}
/** Forward PAPER summary -> engine Result. Overall disposition is the weakest anchor's. */
export function forwardEngineResult(summary:readonly ForwardAnchorSummary[]){
 if(summary.length!==ANCHORS.length)throw Error('WX_MS_BAD_FORWARD_SUMMARY');
 const n=Math.min(...summary.map(s=>s.graded));
 const disposition=summary.some(s=>s.disposition==='REJECTED')?'REJECTED':summary.every(s=>s.disposition==='PROMISING')?'PROMISING':'NO_CLEAR_EFFECT';
 return {experimentId:MULTISOURCE_EXPERIMENT_ID,result:{evidence:'forward' as const,disposition,observations:n,dates:n,
  reason:summary.map(s=>`${s.anchor}: ${s.disposition}, ${s.graded} graded forward days, ${s.missedSince.length} missed anchors (${s.reason})`).join(' ')+
   ' Frozen before each anchor; forecast accuracy only, no market data.'}};
}

export type StageStatus={status:'READY'|'NOT_READY';missing:string[]};
export type PaperReadiness={modelId:typeof MULTISOURCE_MODEL_ID;paperForecasting:StageStatus;ownerReview:StageStatus;
 exchange:'DISABLED';ordersEnabled:false;note:string};
export function paperReadiness(x:{trainingDaysByAnchor:Partial<Record<Anchor,number>>;verifiedInputs:boolean;
 forward:readonly ForwardAnchorSummary[]}):PaperReadiness{
 const pf:string[]=[],rv:string[]=[];
 if(!x.verifiedInputs)pf.push('no receipt-verified member bulletin and CLI input for the freeze run');
 for(const a of ANCHORS){
  const t=x.trainingDaysByAnchor[a]??0;
  if(t<MULTISOURCE_POLICY.minTrainingDays)pf.push(`${a}: ${t}/${MULTISOURCE_POLICY.minTrainingDays} verified training days`);
  const f=x.forward.find(s=>s.anchor===a);
  if(!f||f.graded<EVAL_POLICY.minHoldoutDaysForReview)rv.push(`${a}: ${f?.graded??0}/${EVAL_POLICY.minHoldoutDaysForReview} graded forward days`);
  if(f&&f.disposition!=='PROMISING')rv.push(`${a}: forward rule ${f.disposition}`);
 }
 return {modelId:MULTISOURCE_MODEL_ID,paperForecasting:{status:pf.length?'NOT_READY':'READY',missing:pf},
  ownerReview:{status:rv.length?'NOT_READY':'READY',missing:rv},exchange:'DISABLED',ordersEnabled:false,
  note:'PAPER forecasting means frozen forecasts graded against NWS CLI reports. It uses no market data and places no order. Exchange access is a separate owner decision.'};
}
