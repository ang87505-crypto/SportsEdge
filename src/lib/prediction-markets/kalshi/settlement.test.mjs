import test from 'node:test';
import assert from 'node:assert/strict';
import {getWeatherOfficialResult,KALSHI_API,normalizeMarket,normalizeBook} from './client.ts';
import {freezePaperForecast,gradePaperForecast} from './paper.ts';
const ticker='KXHIGHNY-26NOV13-T55';
const now='2026-11-14T04:00:00Z',snapAt='2026-11-13T20:00:00Z';
const market={ticker,event_ticker:'KXHIGHNY-26NOV13',market_type:'binary',
 title:'NYC high temperature?',status:'settled',result:'yes',rules_primary:'Official NWS Central Park',
 settlement_ts:'2026-11-14T03:00:00Z'};
const mock=(x,assertReq=()=>{})=>async(url,opts)=>{assertReq(url,opts);return new Response(JSON.stringify({market:x}),{
 status:200,headers:{'content-type':'application/json'}});};
test('read-only official settlement GET returns fingerprint and precise resolved outcome',async()=>{
 let calls=0;
 const result=await getWeatherOfficialResult(ticker,mock(market,(url,init)=>{
  calls++;assert.equal(url,KALSHI_API+'/markets/'+ticker);assert.equal(init.method,'GET');
  assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
 }),()=>now);
 assert.equal(calls,1);assert.equal(result.result,'yes');
 assert.equal(result.sourceDigest.length,64);assert.equal(result.status,'settled');
});
test('unresolved, canceled, ambiguous, mismatched, future and missing-rule results are excluded',async()=>{
 for(const x of [
  {...market,status:'active'}, {...market,result:''},{...market,result:'void'},
  {...market,ticker:'KXHIGHNY-26NOV13-T56'},{...market,settlement_ts:null},
  {...market,rules_primary:''},
 ]){
  await assert.rejects(getWeatherOfficialResult(ticker,mock(x),()=>now));
 }
 await assert.rejects(getWeatherOfficialResult(ticker,mock(market),()=>'2026-11-14T01:00:00Z'),/FUTURE/);
});
test('verified market result grades a frozen forecast with matching rule version',async()=>{
 const m=normalizeMarket({...market,status:'active',result:undefined,close_time:'2026-11-14T01:00:00Z'},'KXHIGHNY',snapAt);
 const b=normalizeBook(ticker,{orderbook_fp:{yes_dollars:[['0.4100','10.00']],no_dollars:[['0.5600','10.00']]}},snapAt);
 const f=freezePaperForecast({market:m,book:b,modelId:'fixture',modelDataAsOf:'2026-11-13T19:00:00Z',
  modelDataDigest:'b'.repeat(64),predictedAt:'2026-11-13T20:00:05Z',
  probabilityYesPpm:700000,maxContracts:1,slippageMicrosPerContract:5000,minEdgeMicrosPerContract:20000});
 const result=await getWeatherOfficialResult(ticker,mock(market),()=>now);
 const grade=gradePaperForecast(f,result);
 assert.equal(grade.result,'yes');assert.equal(grade.correct,true);
 assert.equal(grade.execution,'HYPOTHETICAL_UNCONFIRMED');
});
