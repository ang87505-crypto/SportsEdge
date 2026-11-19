import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMarket,normalizeBook,getWeatherOfficialResult,KALSHI_API} from './client.ts';
import {freezePaperForecast,gradePaperForecast} from './paper.ts';
const ticker='KXHIGHNY-26NOV13-T55';
const start='2026-11-13T20:00:00Z',after='2026-11-14T04:00:00Z';
const rulePrimary='NWS Central Park final high';
const rulesSecondary='Official climate report, rounded to nearest whole degree F';
const src={ticker,event_ticker:'KXHIGHNY-26NOV13',market_type:'binary',
  status:'finalized',result:'yes',settlement_ts:'2026-11-14T03:00:00Z',
  settlement_value_dollars:'1.0000',rules_primary:rulePrimary,rules_secondary:rulesSecondary,
  is_provisional:false};
const fake=(market)=>async(url,opts)=>{
 assert.equal(url,KALSHI_API+'/markets/'+ticker);
 assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
 return new Response(JSON.stringify({market}),{headers:{'content-type':'application/json'}});
};
test('finalized, non-provisional binary outcome with matching dollar settlement is normalized',async()=>{
 const v=await getWeatherOfficialResult(ticker,fake(src),()=>after);
 assert.equal(v.result,'yes');assert.equal(v.status,'settled');
 assert.equal(v.rulesSecondary,rulesSecondary);assert.equal(v.settledAt,src.settlement_ts);
 assert.equal(v.sourceDigest.length,64);
});
test('determined, disputed, amended, provisional and inconsistent payouts must never grade',async()=>{
 const modified=[
  {...src,status:'determined'}, {...src,status:'disputed'}, {...src,status:'amended'},
  {...src,is_provisional:true},{...src,result:'no'},
  {...src,settlement_value_dollars:'0.9800'},
  {...src,settlement_ts:null}
 ];
 for(const m of modified)
  await assert.rejects(getWeatherOfficialResult(ticker,fake(m),()=>after),/NOT_FINAL|PAYOUT_CONFLICT|INVALID_/);
 const no={...src,result:'no',settlement_value_dollars:'0.0000'};
 const v=await getWeatherOfficialResult(ticker,fake(no),()=>after);
 assert.equal(v.result,'no');
});
test('secondary settlement rules and provisional contract state cannot silently change',async()=>{
 const raw={...src,title:'NYC temperature',status:'active',result:'',
  close_time:'2026-11-14T01:00:00Z',updated_time:start};
 const market=normalizeMarket(raw,'KXHIGHNY',start);
 const book=normalizeBook(ticker,{orderbook_fp:{yes_dollars:[['0.4100','10.00']],no_dollars:[['0.5600','10.00']]}},start);
 const input={market,book,predictedAt:'2026-11-13T20:00:10Z',
  modelId:'fixture',modelDataAsOf:'2026-11-13T19:30:00Z',
  modelDataDigest:'a'.repeat(64),probabilityYesPpm:800000,
  maxContracts:1,slippageMicrosPerContract:1000,minEdgeMicrosPerContract:10000};
 const forecast=freezePaperForecast(input);
 assert.equal(forecast.rulesSecondary,rulesSecondary);
 const official=await getWeatherOfficialResult(ticker,fake(src),()=>after);
 const grade=gradePaperForecast(forecast,official);
 assert.equal(grade.correct,true);
 assert.throws(()=>gradePaperForecast(forecast,{...official,rulesSecondary:'revised rule'}),/NOT_VERIFIED/);
 assert.throws(()=>freezePaperForecast({...input,market:{...market,isProvisional:true}}),/NOT_ELIGIBLE/);
});
