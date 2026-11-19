import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMarket,normalizeBook} from './client.ts';
import {provisionalTakerFeeMicros,freezePaperForecast,gradePaperForecast,appendUnique} from './paper.ts';
const hash='a'.repeat(64),now='2026-11-13T20:00:00Z';
const mk=()=>normalizeMarket({ticker:'KXHIGHNY-26NOV13-T55',event_ticker:'KXHIGHNY-26NOV13',
 market_type:'binary',title:'NYC high temperature',status:'active',rules_primary:'Final NWS Central Park',
 close_time:'2026-11-14T01:00:00Z',updated_time:now},'KXHIGHNY',now);
const bk=()=>normalizeBook('KXHIGHNY-26NOV13-T55',{orderbook_fp:{
 yes_dollars:[['0.4100','10.00']],no_dollars:[['0.5600','5.00']]}},now);
const input=()=>({market:mk(),book:bk(),modelId:'independent-nws-v0',modelDataAsOf:'2026-11-13T19:00:00Z',
 modelDataDigest:hash,predictedAt:'2026-11-13T20:00:15Z',probabilityYesPpm:700000,
 maxContracts:2,slippageMicrosPerContract:5000,minEdgeMicrosPerContract:10000});
test('fee rounding uses July 2026 general taker centicents, never zeroes or silently claims series verification',()=>{
 assert.equal(provisionalTakerFeeMicros(600000,1),16800);
 assert.equal(provisionalTakerFeeMicros(420000,2),34200);
 assert.throws(()=>provisionalTakerFeeMicros(0,1));
 assert.throws(()=>provisionalTakerFeeMicros(600000,0));
});
test('frozen paper candidate prices buys from opposing bid, uses visible whole-contract depth and fee+slippage',()=>{
 const p=freezePaperForecast(input());
 assert.equal(p.side,'yes');assert.equal(p.priceMicros,440000);
 assert.equal(p.contracts,2);assert.equal(p.feeMicros,34500); // ceil(0.07*2*.44*.56, 0.0001) = .0345
 assert.equal(p.slippageMicros,10000);assert.equal(p.expectedNetMicros,475500);
 assert.equal(p.decision,'PAPER_CANDIDATE');assert.equal(p.feeVerifiedForSeries,false);
 assert.equal(p.execution,'HYPOTHETICAL_UNCONFIRMED');
 assert.deepEqual(freezePaperForecast(input()),p);
});
test('model probability, source identity, quote freshness, and pre-lock checks fail closed',()=>{
 const i=input();i.modelDataAsOf='2026-11-13T21:00:00Z';assert.throws(()=>freezePaperForecast(i),/ASOF/);
 const q=input();q.predictedAt='2026-11-14T00:57:00Z';assert.throws(()=>freezePaperForecast(q),/ASOF/);
 const b=input();b.book={...b.book,ticker:'KXNBAGAME-1'};assert.throws(()=>freezePaperForecast(b),/ELIGIBLE/);
 const m=input();m.modelDataDigest='example';assert.throws(()=>freezePaperForecast(m),/DIGEST/);
 const z=input();z.market={...z.market,rulesPrimary:null};assert.throws(()=>freezePaperForecast(z),/RULES/);
});
test('no liquidity and no edge yield no simulated fill or invented profit',()=>{
 const i=input();i.book=normalizeBook(i.market.ticker,{orderbook_fp:{yes_dollars:[],no_dollars:[]}},now);
 const a=freezePaperForecast(i);assert.equal(a.decision,'NO_LIQUIDITY');assert.equal(a.side,null);assert.equal(a.expectedNetMicros,null);
 const b=input();b.probabilityYesPpm=500000;b.slippageMicrosPerContract=100000;
 const x=freezePaperForecast(b);assert.equal(x.decision,'NO_POSITIVE_EDGE');assert.equal(x.side,null);
});
test('verified official settlement creates separate immutable grade; never asserts a real fill',()=>{
 const p=freezePaperForecast(input());
 const o={marketTicker:p.marketTicker,eventTicker:p.eventTicker,status:'settled',result:'yes',rulesPrimary:p.rulesPrimary,rulesSecondary:p.rulesSecondary,
  settledAt:'2026-11-14T03:00:00Z',fetchedAt:'2026-11-14T04:00:00Z',sourceDigest:hash,source:'kalshi-public-market-get'};
 const a=gradePaperForecast(p,o);
 assert.equal(a.correct,true);assert.equal(a.virtualReturnMicros,2_000_000);
 assert.equal(a.virtualNetMicros,1_075_500);
 assert.equal(a.execution,'HYPOTHETICAL_UNCONFIRMED');
 assert.deepEqual(appendUnique([a],a),[a]);assert.equal(appendUnique([],a).length,1);
 assert.throws(()=>gradePaperForecast(p,{...o,status:'active'}),/NOT_VERIFIED/);
 assert.throws(()=>gradePaperForecast(p,{...o,sourceDigest:'bad'}),/DIGEST/);
 assert.throws(()=>gradePaperForecast(p,{...o,rulesPrimary:'Changed rules'}),/NOT_VERIFIED/);
});
test('failed and zero-trade markets are graded for accuracy, not falsified as P&L',()=>{
 const z=input();z.book=normalizeBook(z.market.ticker,{orderbook_fp:{yes_dollars:[],no_dollars:[]}},now);
 const p=freezePaperForecast(z);
 const o={marketTicker:p.marketTicker,eventTicker:p.eventTicker,status:'settled',result:'no',rulesPrimary:p.rulesPrimary,rulesSecondary:p.rulesSecondary,
  settledAt:'2026-11-14T03:00:00Z',fetchedAt:'2026-11-14T04:00:00Z',sourceDigest:hash,source:'kalshi-public-market-get'};
 assert.equal(gradePaperForecast(p,o).virtualNetMicros,null);
 const a=gradePaperForecast(freezePaperForecast(input()),{...o,result:'no'});
 assert.equal(a.virtualNetMicros,-924500);
});
