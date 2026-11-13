import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMarket,normalizeBook} from './client.ts';
import {freezePaperForecast,gradePaperForecast} from './paper.ts';
import {evaluateKalshiPaper} from './evaluate.ts';
const at='2026-11-13T20:00:00Z',hash='a'.repeat(64);
const market=(id)=>normalizeMarket({ticker:'KXHIGHNY-26NOV13-T'+id,
 event_ticker:'KXHIGHNY-26NOV13',market_type:'binary',title:'Temp',status:'active',
 rules_primary:'Official station result',close_time:'2026-11-14T01:00:00Z'},'KXHIGHNY',at);
const fixture=(id='55',probabilityYesPpm=700000)=>{
 const m=market(id),b=normalizeBook(m.ticker,{orderbook_fp:{
  yes_dollars:[['0.4100','10.00']],no_dollars:[['0.5600','5.00']]}},at);
 const f=freezePaperForecast({market:m,book:b,modelId:'fixture-weather',
  modelDataAsOf:'2026-11-13T19:00:00Z',modelDataDigest:hash,
  predictedAt:'2026-11-13T20:00:05Z',probabilityYesPpm,maxContracts:1,slippageMicrosPerContract:5000,
  minEdgeMicrosPerContract:10000});
 const result={marketTicker:f.marketTicker,eventTicker:f.eventTicker,status:'settled',
  result:'yes',rulesPrimary:f.rulesPrimary,settledAt:'2026-11-14T02:00:00Z',
  fetchedAt:'2026-11-14T03:00:00Z',sourceDigest:hash,source:'kalshi-public-market-get'};
 return {f,result,g:gradePaperForecast(f,result)};
};
test('empty research returns null skill metrics, zero hypothetical profit, and no success claim',()=>{
 const a=evaluateKalshiPaper([],[]);
 assert.equal(a.modelBrier,null);assert.equal(a.hypotheticalRoi,null);
 assert.equal(a.hypotheticalNetMicros,0);assert.equal(a.status,'INSUFFICIENT_FORWARD_EVENTS');
});
test('paired Brier vs market quote, provisional hypothetical ROI, independent event count',()=>{
 const {f,g}=fixture();
 const b=evaluateKalshiPaper([f],[g]);
 assert.equal(b.graded,1);assert.equal(b.independentEvents,1);
 assert.equal(b.modelBrier,0.09);assert.equal(b.marketMidpointBrier,0.330625); // midpoint .425 => (.425 - 1)^2
 assert.equal(b.marketBenchmarkN,1);assert.equal(b.pairedModelBrier,0.09);
 assert.equal(b.hypotheticalNetMicros,g.virtualNetMicros);
 assert.equal(b.hypotheticalTrades,1);
 assert.equal(b.status,'INSUFFICIENT_FORWARD_EVENTS');
});
test('two correlated markets count as ONE independent outcome, not two',()=>{
 const a=fixture('55'),b=fixture('56');
 const result={...b.result,result:'no'};const grade=gradePaperForecast(b.f,result);
 const e=evaluateKalshiPaper([a.f,b.f],[a.g,grade]);
 assert.equal(e.graded,2);assert.equal(e.independentEvents,1);
 assert.equal(e.hypotheticalMaxDrawdownMicros>0,true);
});
test('duplicate grades, foreign forecasts and forged identity fail',()=>{
 const {f,g}=fixture();
 assert.throws(()=>evaluateKalshiPaper([f,f],[g]),/DUPLICATE_FORECAST/);
 assert.throws(()=>evaluateKalshiPaper([f],[g,g]),/DUPLICATE_GRADE/);
 assert.throws(()=>evaluateKalshiPaper([],[g]),/GRADE_MISMATCH/);
 assert.throws(()=>evaluateKalshiPaper([f],[{...g,eventTicker:'WRONG'}]),/GRADE_MISMATCH/);
});
test('unresolved grades are excluded, never marked as losses or wins',()=>{
 const a=fixture();
 const e=evaluateKalshiPaper([a.f],[]);
 assert.equal(e.graded,0);assert.equal(e.hypotheticalTrades,0);
 assert.equal(e.hypotheticalRoi,null);assert.equal(e.modelBrier,null);
});
