/**
 * Read-only stock PAPER learning-evidence audit. Derives from the existing
 * owner-only database ledger, never from a proposed order or broker snapshot.
 * This is NOT a training job and cannot change the frozen production model.
 *
 * IMPORTANT: the owner read model is a bounded RECENT window (36 decisions,
 * 200 intents). Database contains the immutable full signal, source evidence,
 * order events, activities and close marks. This view does not certify full
 * historical retention, individual-trade P&L or a probabilistic win rate.
 */
import type {PaperAutoLedger} from './paper-auto-ledger.ts';
import {forwardPerformance} from './paper-auto-performance.ts';

export type StockPaperLearningEvidence={
 status:'AWAITING_FIRST_DECISION'|'DECISIONS_ONLY'|'AWAITING_VERIFIED_CLOSE'|
  'OBSERVING_FORWARD_PAPER'|'EVIDENCE_CONFLICT';
 decisionsInView:number;targetDecisions:number;holdDecisions:number;missedDecisions:number;
 intentsInView:number;intentsLinkedToVisibleDecision:number;intentsWithoutVisibleLink:number;
 filledIntents:number;unresolvedIntents:number;
 verifiedCloses:number;unreconciledCloses:number;contaminatedOrLaterCloses:number;
 latestVerifiedSession:string|null;portfolioReturn:number|null;benchmarkExcessReturn:number|null;
 /** Intents are NOT independent completed round-trip trades. */
 completedRoundTrips:number|null;tradeWinRate:number|null;
 modelPredictionAccuracy:number|null;automaticTrainingActive:false;
 warnings:string[];
};
const time=(v:string)=>Date.parse(v);
export function stockPaperLearningEvidence(l:PaperAutoLedger):StockPaperLearningEvidence{
 const warnings:string[]=[];
 const byId=new Map(l.decisions.map(x=>[x.decisionId,x]));
 const decisionIds=new Set(l.decisions.map(d=>d.decisionId));
 if(decisionIds.size!==l.decisions.length)warnings.push('DUPLICATED_VISIBLE_DECISION_ID');
 const intentIds=new Set(l.intents.map(i=>i.intentId));
 if(intentIds.size!==l.intents.length)warnings.push('DUPLICATED_VISIBLE_INTENT_ID');
 let linked=0,unlinked=0,filled=0;
 for(const i of l.intents){
  if(!i.decisionId||!byId.has(i.decisionId)){unlinked++;continue;}
  const d=byId.get(i.decisionId)!;
  // Neither a fill nor a planned intent can legitimately predate the frozen
  // decision it was derived from.
  if(!Number.isFinite(time(d.decisionAt))||!Number.isFinite(time(i.createdAt))||
   time(d.decisionAt)>time(i.createdAt))warnings.push('INTENT_PRECEDES_FROZEN_DECISION');
  if(d.outcome!=='TARGETS')warnings.push('INTENT_LINKS_TO_NON_TARGET_DECISION');
  linked++;
 }
 // Count observed *partially or fully filled intents*, not orders or completed trades.
 for(const i of l.intents){
  const q=Number(i.filledQty);
  if(!Number.isFinite(q)||q<0||q>i.shares){
   warnings.push('INVALID_RECORDED_FILLED_QUANTITY');continue;
  }
  if(q>0){
   filled++;
   if(i.filledAvgPrice===null)warnings.push('FILL_WITHOUT_AVERAGE_PRICE');
  }
 }
 const performance=forwardPerformance(l.experiment.startingEquityCents,
  l.experiment.registeredAt,l.daily);
 const verified=performance.verified;
 const marks=performance.marks;
 const contaminated=marks.filter(m=>m.verdict==='CONTAMINATED'||m.verdict==='AFTER_CONTAMINATION').length;
 if(unlinked)warnings.push('SOME_INTENT_LINKS_NOT_IN_BOUNDED_VIEW');
 if(performance.verified.skippedMarks)warnings.push('UNRECONCILED_CLOSE_MARKS');
 if(contaminated)warnings.push('PERFORMANCE_CHAIN_CONTAMINATED');
 if(filled===0)warnings.push('NO_CONFIRMED_PAPER_FILLS');
 if(verified.verifiedMarks===0)warnings.push('NO_VERIFIED_CLOSE_MARKS');
 warnings.push('NO_PER_TRADE_PROBABILITIES_OR_ROUND_TRIP_PROFIT_LABELS_IN_THIS_VIEW');
 warnings.push('NO_AUTOMATIC_PRODUCTION_MODEL_RETRAINING');
 const conflict=warnings.some(w=>[
  'DUPLICATED_VISIBLE_DECISION_ID','DUPLICATED_VISIBLE_INTENT_ID',
  'INTENT_PRECEDES_FROZEN_DECISION','INTENT_LINKS_TO_NON_TARGET_DECISION',
  'INVALID_RECORDED_FILLED_QUANTITY','FILL_WITHOUT_AVERAGE_PRICE'
 ].includes(w));
 return {
  status:conflict?'EVIDENCE_CONFLICT':l.decisions.length===0?'AWAITING_FIRST_DECISION':
   filled===0?'DECISIONS_ONLY':verified.verifiedMarks===0?'AWAITING_VERIFIED_CLOSE':
   'OBSERVING_FORWARD_PAPER',
  decisionsInView:l.decisions.length,
  targetDecisions:l.decisions.filter(d=>d.outcome==='TARGETS').length,
  holdDecisions:l.decisions.filter(d=>d.outcome==='HOLD_NO_TARGETS').length,
  missedDecisions:l.decisions.filter(d=>d.outcome==='MISSED'||d.outcome==='INPUT_REJECTED').length,
  intentsInView:l.intents.length,intentsLinkedToVisibleDecision:linked,
  intentsWithoutVisibleLink:unlinked,filledIntents:filled,
  unresolvedIntents:l.status.unresolvedIntents,
  verifiedCloses:verified.verifiedMarks,unreconciledCloses:verified.skippedMarks,
  contaminatedOrLaterCloses:contaminated,latestVerifiedSession:verified.throughSession,
  portfolioReturn:verified.cumulativeReturn,benchmarkExcessReturn:performance.benchmark.excessReturn,
  completedRoundTrips:null,tradeWinRate:null,modelPredictionAccuracy:null,automaticTrainingActive:false,
  warnings:[...new Set(warnings)]
 };
}
