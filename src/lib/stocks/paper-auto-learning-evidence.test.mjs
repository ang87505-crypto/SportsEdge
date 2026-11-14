import test from 'node:test';
import assert from 'node:assert/strict';
import {stockPaperLearningEvidence} from './paper-auto-learning-evidence.ts';
const decisionId='a'.repeat(64),id='pai-'+'b'.repeat(32);
const start='2026-11-16T13:00:00Z';
function ledger({
 decisions=[],intents=[],daily=[],status={}
}={}){
 return {experimentId:'stock-v2-weekly-1',registered:true,
  status:{unresolvedIntents:0,...status},
  experiment:{registeredAt:'2026-10-30T12:00:00Z',startingEquityCents:100000},
  decisions,intents,daily,alerts:[],runs:[],gateEvents:[],activityCounts:{}};
}
const decision=()=>({decisionId,session:'2026-11-16',decisionAt:start,
 outcome:'TARGETS',targets:['CSX'],reasons:[],recordedAt:'2026-11-16T13:00:30Z'});
const intent=(extra={})=>({intentId:id,decisionId,symbol:'CSX',side:'buy',shares:1,
 filledQty:'1.0',filledAvgPrice:'34.10',createdAt:'2026-11-16T14:50:00Z',
 updatedAt:'2026-11-16T14:51:00Z',...extra});
const mark=(session,equity,extra={})=>({
 session,capturedAt:session+'T21:40:00Z',equityCents:equity,cashCents:60000,
 longMarketValueCents:equity-60000,externalFlowCents:0,feesCents:0,dividendsCents:0,
 benchmarkSymbol:'SPY',benchmarkClose:'580',benchmarkSource:'alpaca:paper-sip',
 contaminated:false,cashReconciled:true,cashUnexplainedCents:'0',
 unrealizedPlCents:0,...extra});
test('no evidence never becomes a fictitious 0% trade win rate',()=>{
 const a=stockPaperLearningEvidence(ledger());
 assert.equal(a.status,'AWAITING_FIRST_DECISION');
 assert.equal(a.tradeWinRate,null);
 assert.equal(a.modelPredictionAccuracy,null);
 assert.equal(a.portfolioReturn,null);
 assert.equal(a.automaticTrainingActive,false);
 assert.equal(a.verifiedCloses,0);
});
test('TARGETS is recorded but no proposed or unfinished order counts as a fill',()=>{
 const a=stockPaperLearningEvidence(ledger({
  decisions:[decision()],intents:[intent({filledQty:'0',filledAvgPrice:null})]}));
 assert.equal(a.targetDecisions,1);assert.equal(a.filledIntents,0);
 assert.equal(a.intentsLinkedToVisibleDecision,1);
 assert.equal(a.status,'DECISIONS_ONLY');
 assert.equal(a.tradeWinRate,null);
});
test('validated fill linked to frozen decision plus close mark is forward observation only',()=>{
 const a=stockPaperLearningEvidence(ledger({
  decisions:[decision()],intents:[intent()],daily:[mark('2026-11-16',101000)]}));
 assert.equal(a.status,'OBSERVING_FORWARD_PAPER');
 assert.equal(a.filledIntents,1);assert.equal(a.intentsLinkedToVisibleDecision,1);
 assert.equal(a.verifiedCloses,1);assert.equal(a.portfolioReturn,0.01);
 assert.equal(a.completedRoundTrips,null);assert.equal(a.tradeWinRate,null);
 assert.equal(a.benchmarkExcessReturn,null,'SPY needs two verified closes');
});
test('future decision cannot explain earlier order; reject inconsistent backdated evidence',()=>{
 const a=stockPaperLearningEvidence(ledger({decisions:[decision()],
  intents:[intent({createdAt:'2026-11-16T12:55:00Z'})]}));
 assert.equal(a.status,'EVIDENCE_CONFLICT');
 assert.ok(a.warnings.includes('INTENT_PRECEDES_FROZEN_DECISION'));
 const b=stockPaperLearningEvidence(ledger({decisions:[{...decision(),outcome:'HOLD_NO_TARGETS'}],
  intents:[intent()]}));
 assert.equal(b.status,'EVIDENCE_CONFLICT');
 assert.ok(b.warnings.includes('INTENT_LINKS_TO_NON_TARGET_DECISION'));
});
test('older intents outside 36-decision window do not create false integrity failure',()=>{
 const a=stockPaperLearningEvidence(ledger({
  decisions:[decision()],intents:[intent({decisionId:'d'.repeat(64)})]}));
 assert.equal(a.status,'AWAITING_VERIFIED_CLOSE');
 assert.equal(a.intentsWithoutVisibleLink,1);
 assert.ok(a.warnings.includes('SOME_INTENT_LINKS_NOT_IN_BOUNDED_VIEW'));
});
test('contaminated and unreconciled marks never become learning returns or trade wins',()=>{
 const a=stockPaperLearningEvidence(ledger({decisions:[decision()],intents:[intent()],
  daily:[mark('2026-11-16',120000,{contaminated:true,externalFlowCents:20000}),
   mark('2026-11-17',130000)]}));
 assert.equal(a.verifiedCloses,0);
 assert.equal(a.portfolioReturn,null);
 assert.equal(a.contaminatedOrLaterCloses,2);
 assert.ok(a.warnings.includes('PERFORMANCE_CHAIN_CONTAMINATED'));
 const b=stockPaperLearningEvidence(ledger({decisions:[decision()],intents:[intent()],
  daily:[mark('2026-11-16',105000,{cashReconciled:false})]}));
 assert.equal(b.portfolioReturn,null);assert.equal(b.unreconciledCloses,1);
});
test('fractional/oversized fake fill and missing price fail closed',()=>{
 const a=stockPaperLearningEvidence(ledger({decisions:[decision()],
  intents:[intent({filledQty:'2'})]}));
 assert.equal(a.status,'EVIDENCE_CONFLICT');
 assert.ok(a.warnings.includes('INVALID_RECORDED_FILLED_QUANTITY'));
 const b=stockPaperLearningEvidence(ledger({decisions:[decision()],
  intents:[intent({filledAvgPrice:null})]}));
 assert.equal(b.status,'EVIDENCE_CONFLICT');
 assert.ok(b.warnings.includes('FILL_WITHOUT_AVERAGE_PRICE'));
});
