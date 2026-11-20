import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {normalizeMarket,normalizeBook} from './client.ts';
import {canonicalJson,sha256} from '../../props/normalize.ts';
import {createPaperLedger,setPaperLedgerPaused,recordPaperForecast,recordPaperSettlement,
 replayPaperLedger} from './paper-ledger.ts';

const config={id:'synthetic-weather-account',mode:'OFFLINE_FIXTURE',initialBalanceMicros:10_000_000,
 maxPositionCostMicros:5_000_000,maxOpenCostMicros:10_000_000,maxOpenPositions:5};
const registered='2026-11-20T12:00:00Z',quote='2026-11-20T20:00:00Z',decision='2026-11-20T20:00:15Z';
const gradeTime='2026-11-21T04:00:01Z',correctionTime='2026-11-22T04:00:01Z';
function input(ticker='KXHIGHNY-26NOV20-T55',day='2026-11-20'){
 const fetched=day+'T20:00:00Z';
 const close=new Date(Date.parse(day+'T00:00:00Z')+25*3_600_000).toISOString();
 const market=normalizeMarket({ticker,event_ticker:'KXHIGHNY-'+day,market_type:'binary',
  title:'SYNTHETIC NYC temperature',status:'active',rules_primary:'Synthetic final station rule',
  rules_secondary:'Synthetic whole-degree boundary',close_time:close,updated_time:fetched},'KXHIGHNY',fetched);
 const book=normalizeBook(ticker,{orderbook_fp:{yes_dollars:[['0.4100','10.00']],
  no_dollars:[['0.5600','5.00']]}},fetched);
 return {market,book,modelId:'synthetic-weather-fixture',modelDataAsOf:day+'T19:00:00Z',
  modelDataDigest:'a'.repeat(64),probabilityYesPpm:700000,maxContracts:2,
  slippageMicrosPerContract:5000,minEdgeMicrosPerContract:10000};
}
function opened(overrides={}){
 const journal=createPaperLedger({...config,...overrides},registered);
 return setPaperLedgerPaused(journal,'start',false,'Offline fixture replay',registered);
}
function entered(overrides={}){
 return recordPaperForecast(opened(overrides),'forecast-1',input(),decision);
}
const position=j=>replayPaperLedger(j).positions[0];
function official(f,result='yes',fetchedAt='2026-11-21T04:00:00Z',digest='b'.repeat(64)){
 return {marketTicker:f.marketTicker,eventTicker:f.eventTicker,status:'settled',result,
  rulesPrimary:f.rulesPrimary,rulesSecondary:f.rulesSecondary,settledAt:'2026-11-21T03:00:00Z',
  fetchedAt,sourceDigest:digest,source:'kalshi-public-market-get'};
}
function won(){
 const j=entered(),f=position(j).forecast;
 return recordPaperSettlement(j,'grade-1',f.id,official(f),gradeTime);
}
const clone=x=>JSON.parse(JSON.stringify(x));
function reseal(journal){
 let previous=null;
 return journal.map(e=>{
  const {hash:unused,...body}=e;void unused;
  const unsigned={...body,previousHash:previous};
  const result={...unsigned,hash:sha256(canonicalJson(unsigned))};
  previous=result.hash;return result;
 });
}

test('new fixture account starts paused with no invented trades or returns',()=>{
 const v=replayPaperLedger(createPaperLedger(config,registered));
 assert.equal(v.mode,'OFFLINE_FIXTURE');assert.equal(v.paused,true);
 assert.equal(v.balanceMicros,10_000_000);assert.equal(v.availableMicros,10_000_000);
 assert.equal(v.reservedMicros,0);assert.equal(v.hypotheticalNetMicros,0);
 assert.equal(v.openPositions,0);assert.deepEqual(v.positions,[]);
 assert.match(v.warning,/hypothetical/);
});
test('hand-calculated two-contract position reserves price, provisional fee and slippage exactly once',()=>{
 const v=replayPaperLedger(entered());
 assert.equal(v.balanceMicros,10_000_000);
 assert.equal(v.reservedMicros,924_500); // .44 * 2 + .0345 fee + .01 slippage
 assert.equal(v.availableMicros,9_075_500);assert.equal(v.openPositions,1);
 assert.equal(v.positions[0].forecast.execution,'HYPOTHETICAL_UNCONFIRMED');
 assert.equal(v.positions[0].forecast.feeVerifiedForSeries,false);
 assert.equal(v.positions[0].allocationReason,'ALLOCATED');
});
test('winning and losing settlements release reservations and reconcile integer balances',()=>{
 const j=entered(),f=position(j).forecast;
 const w=replayPaperLedger(recordPaperSettlement(j,'win',f.id,official(f),gradeTime));
 assert.equal(w.balanceMicros,11_075_500);assert.equal(w.reservedMicros,0);
 assert.equal(w.hypotheticalNetMicros,1_075_500);assert.equal(w.settledPositions,1);
 const l=replayPaperLedger(recordPaperSettlement(j,'loss',f.id,official(f,'no'),gradeTime));
 assert.equal(l.balanceMicros,9_075_500);assert.equal(l.reservedMicros,0);
 assert.equal(l.hypotheticalNetMicros,-924_500);assert.equal(l.openPositions,0);
});
test('repeated requests are idempotent even after lock, but a changed request is refused',()=>{
 const j=entered();
 assert.deepEqual(recordPaperForecast(j,'forecast-1',input(),'2026-11-23T12:00:00Z'),j);
 assert.throws(()=>recordPaperForecast(j,'forecast-1',{...input(),probabilityYesPpm:800000},decision),/IDEMPOTENCY_CONFLICT/);
 const settled=won(),f=position(settled).forecast;
 assert.deepEqual(recordPaperSettlement(settled,'grade-1',f.id,official(f),correctionTime),settled);
});
test('another request cannot allocate a second position in the same market',()=>{
 assert.throws(()=>recordPaperForecast(entered(),'new-key',input(),'2026-11-20T20:00:16Z'),/DUPLICATE_MARKET/);
});
test('pause blocks new allocation while retaining its forecast and allowing settlement',()=>{
 let j=entered();
 j=setPaperLedgerPaused(j,'pause',true,'Test pause','2026-11-20T20:00:16Z');
 j=recordPaperForecast(j,'forecast-2',input('KXHIGHNY-26NOV20-T56'),'2026-11-20T20:00:17Z');
 assert.equal(replayPaperLedger(j).positions[1].allocationReason,'PAUSED');
 assert.equal(replayPaperLedger(j).reservedMicros,924_500);
 const f=position(j).forecast;
 j=recordPaperSettlement(j,'grade',f.id,official(f),gradeTime);
 assert.equal(replayPaperLedger(j).balanceMicros,11_075_500);
 assert.equal(replayPaperLedger(j).paused,true);
});
test('no-liquidity forecasts remain recorded without reserving or booking money',()=>{
 const i=input();i.book=normalizeBook(i.market.ticker,{orderbook_fp:{yes_dollars:[],no_dollars:[]}},quote);
 let j=recordPaperForecast(opened(),'no-book',i,decision),f=position(j).forecast;
 assert.equal(position(j).allocationReason,'NO_CANDIDATE');
 j=recordPaperSettlement(j,'grade',f.id,official(f),gradeTime);
 const v=replayPaperLedger(j);
 assert.equal(v.positions[0].grades.length,1);assert.equal(v.allocatedPositions,0);
 assert.equal(v.balanceMicros,10_000_000);assert.equal(v.hypotheticalNetMicros,0);
});
test('per-position, total open-cost, position-count and cash limits independently block allocations',()=>{
 let j=entered({maxPositionCostMicros:900_000});
 assert.equal(position(j).allocationReason,'POSITION_COST_LIMIT');
 assert.equal(replayPaperLedger(j).reservedMicros,0);
 const scenarios=[
  [{maxPositionCostMicros:1_000_000,maxOpenCostMicros:1_000_000},'OPEN_COST_LIMIT'],
  [{maxOpenPositions:1},'OPEN_POSITION_LIMIT'],
  [{initialBalanceMicros:1_500_000,maxPositionCostMicros:1_500_000,maxOpenCostMicros:1_500_000},'INSUFFICIENT_FUNDS']
 ];
 for(const [overrides,reason] of scenarios){
  j=recordPaperForecast(entered(overrides),'second',input('KXHIGHNY-26NOV20-T56'),'2026-11-20T20:00:16Z');
  const v=replayPaperLedger(j);
  assert.equal(v.positions[1].allocationReason,reason);assert.equal(v.reservedMicros,924_500);
 }
});
test('a blocked candidate can be scored but its hypothetical win never changes the account',()=>{
 let j=entered({maxPositionCostMicros:900_000});const f=position(j).forecast;
 j=recordPaperSettlement(j,'grade',f.id,official(f),gradeTime);
 const v=replayPaperLedger(j);
 assert.equal(v.positions[0].grades[0].grade.correct,true);
 assert.equal(v.allocatedPositions,0);assert.equal(v.settledPositions,0);
 assert.equal(v.balanceMicros,10_000_000);assert.equal(v.hypotheticalNetMicros,0);
});
test('the receipt clock overrides backdated input and rejects stale or after-lock forecasts',()=>{
 const i={...input(),predictedAt:decision};
 assert.throws(()=>recordPaperForecast(opened(),'backdated',i,'2026-11-21T01:01:00Z'),/ASOF_OR_LOCK/);
 assert.throws(()=>recordPaperForecast(opened(),'stale',input(),'2026-11-20T20:03:00Z'),/ASOF_OR_LOCK/);
 const j=recordPaperForecast(opened(),'clock',i,'2026-11-20T20:00:30Z');
 assert.equal(position(j).forecast.predictedAt,'2026-11-20T20:00:30.000Z');
});
test('future results, wrong rules, unknown forecasts and unsettled results fail closed',()=>{
 const j=entered(),f=position(j).forecast;
 assert.throws(()=>recordPaperSettlement(j,'future',f.id,official(f),'2026-11-20T23:00:00Z'),/FUTURE_RESULT/);
 assert.throws(()=>recordPaperSettlement(j,'unknown','c'.repeat(64),official(f),gradeTime),/UNKNOWN_FORECAST/);
 assert.throws(()=>recordPaperSettlement(j,'rules',f.id,{...official(f),rulesSecondary:'Changed'},gradeTime),/NOT_VERIFIED/);
 assert.throws(()=>recordPaperSettlement(j,'active',f.id,{...official(f),status:'active'},gradeTime),/NOT_VERIFIED/);
});
test('corrections append revisions and replace booked profit by the exact delta',()=>{
 const j=won(),f=position(j).forecast;
 const corrected=recordPaperSettlement(j,'correction',f.id,
  official(f,'no','2026-11-22T04:00:00Z','c'.repeat(64)),correctionTime);
 const v=replayPaperLedger(corrected);
 assert.equal(v.balanceMicros,9_075_500);assert.equal(v.hypotheticalNetMicros,-924_500);
 assert.equal(v.reservedMicros,0);assert.equal(v.positions[0].grades.length,2);
 assert.deepEqual(v.positions[0].grades.map(x=>x.grade.result),['yes','no']);
 assert.equal(replayPaperLedger(j).balanceMicros,11_075_500);
});
test('same-result retries do not book money twice or invent another result revision',()=>{
 const j=won(),f=position(j).forecast;
 const repeated=recordPaperSettlement(j,'later-fetch',f.id,official(f,'yes','2026-11-22T04:00:00Z'),correctionTime);
 assert.equal(replayPaperLedger(repeated).balanceMicros,11_075_500);
 assert.equal(position(repeated).grades.length,1);
});
test('older results and contradictory same-time sources cannot overwrite a correction',()=>{
 let j=won();const f=position(j).forecast;
 j=recordPaperSettlement(j,'correction',f.id,official(f,'no','2026-11-22T04:00:00Z','c'.repeat(64)),correctionTime);
 assert.throws(()=>recordPaperSettlement(j,'old',f.id,official(f),'2026-11-22T05:00:00Z'),/STALE_RESULT/);
 assert.throws(()=>recordPaperSettlement(j,'conflict',f.id,
  official(f,'yes','2026-11-22T04:00:00Z','d'.repeat(64)),'2026-11-22T05:00:00Z'),/RESULT_CONFLICT/);
});
test('as-of views use receipt time and preserve the original result until a correction arrived',()=>{
 let j=won();const f=position(j).forecast;
 j=recordPaperSettlement(j,'correction',f.id,official(f,'no','2026-11-22T04:00:00Z','c'.repeat(64)),correctionTime);
 const beforeGrade=replayPaperLedger(j,'2026-11-21T03:30:00Z');
 assert.equal(beforeGrade.openPositions,1);assert.equal(beforeGrade.balanceMicros,10_000_000);
 const beforeCorrection=replayPaperLedger(j,'2026-11-22T03:59:59Z');
 assert.equal(beforeCorrection.balanceMicros,11_075_500);assert.equal(beforeCorrection.positions[0].grades.length,1);
 assert.equal(replayPaperLedger(j,correctionTime).balanceMicros,9_075_500);
 assert.throws(()=>replayPaperLedger(j,'2026-11-19T12:00:00Z'),/NOT_REGISTERED_AT_ASOF/);
});
test('a late loss correction exposes a cash deficit and blocks subsequent allocations',()=>{
 let j=entered({initialBalanceMicros:1_000_000,maxPositionCostMicros:1_000_000,maxOpenCostMicros:1_000_000});
 const f=position(j).forecast;
 j=recordPaperSettlement(j,'win',f.id,official(f),gradeTime);
 j=recordPaperForecast(j,'second',input('KXHIGHNY-26NOV21-T55','2026-11-21'),'2026-11-21T20:00:15Z');
 j=recordPaperSettlement(j,'correction',f.id,official(f,'no','2026-11-22T04:00:00Z','c'.repeat(64)),correctionTime);
 let v=replayPaperLedger(j);
 assert.equal(v.balanceMicros,75_500);assert.equal(v.reservedMicros,924_500);
 assert.equal(v.availableMicros,-849_000);assert.equal(v.deficitMicros,849_000);
 j=recordPaperForecast(j,'third',input('KXHIGHNY-26NOV22-T55','2026-11-22'),'2026-11-22T20:00:15Z');
 v=replayPaperLedger(j);assert.equal(v.positions[2].allocationReason,'INSUFFICIENT_FUNDS');
 assert.equal(v.reservedMicros,924_500);
});
test('JSON serialization and key ordering preserve the journal, digests and monetary view',()=>{
 const j=won();
 assert.deepEqual(replayPaperLedger(clone(j)),replayPaperLedger(j));
 assert.deepEqual(replayPaperLedger(JSON.parse(canonicalJson(j))),replayPaperLedger(j));
});
test('callers cannot mutate accepted inputs, journal entries or returned projections',()=>{
 const i=input(),j=recordPaperForecast(opened(),'immutable',i,decision);
 i.book.buyYesAskMicros=1;
 assert.equal(position(j).costMicros,924_500);
 assert.throws(()=>{j[2].payload.input.book.buyYesAskMicros=1;},TypeError);
 const v=replayPaperLedger(j);
 assert.throws(()=>{v.positions[0].forecast.contracts=99;},TypeError);
});
test('corrupt, missing and reordered commands are detected before a balance is reported',()=>{
 const j=won(),bad=clone(j);bad[2].payload.input.maxContracts=5;
 assert.throws(()=>replayPaperLedger(bad),/CHECKSUM_MISMATCH/);
 assert.throws(()=>replayPaperLedger(j.slice(1)),/INVALID_CHAIN/);
 const reordered=clone(j);[reordered[1],reordered[2]]=[reordered[2],reordered[1]];
 assert.throws(()=>replayPaperLedger(reordered),/INVALID_CHAIN/);
});
test('runtime validation rejects invalid configuration and backward clocks even with valid checksums',()=>{
 for(const overrides of [{initialBalanceMicros:0},{initialBalanceMicros:1.5},{mode:'LIVE'},
  {maxOpenPositions:0},{maxOpenCostMicros:11_000_000}])
  assert.throws(()=>createPaperLedger({...config,...overrides},registered),/INVALID_CONFIG|INVALID_MONEY/);
 const bad=clone(entered());bad[2].recordedAt='2026-11-19T12:00:00.000Z';
 assert.throws(()=>replayPaperLedger(reseal(bad)),/NONMONOTONIC_TIME/);
 assert.throws(()=>setPaperLedgerPaused(opened(),'pause',true,'',decision),/INVALID_CONTROL/);
});
test('offline replay makes no network request',()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=()=>{calls++;throw Error('NETWORK_FORBIDDEN');};
 try{assert.equal(replayPaperLedger(won()).settledPositions,1);assert.equal(calls,0);}
 finally{globalThis.fetch=original;}
});
test('offline CLI saves a replayable private fixture file and refuses to overwrite it',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sportsedge-kalshi-ledger-'));
 const output=join(dir,'synthetic-replay.json');
 const script=fileURLToPath(new URL('../../../../scripts/kalshi-paper-replay.ts',import.meta.url));
 try{
  const run=()=>spawnSync(process.execPath,['--experimental-strip-types',script,'--output',output],{encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);
  const saved=readFileSync(output,'utf8'),report=JSON.parse(saved);
  assert.equal(report.kind,'SYNTHETIC_OFFLINE_REPLAY');
  assert.equal(report.stages.open.reservedMicros,924_500);
  assert.equal(report.stages.settled.balanceMicros,11_075_500);
  assert.equal(report.stages.corrected.balanceMicros,9_075_500);
  assert.deepEqual(replayPaperLedger(report.journal),report.stages.corrected);
  if(process.platform!=='win32')assert.equal(statSync(output).mode&0o777,0o600);
  const duplicate=run();assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/EEXIST/);
  assert.equal(readFileSync(output,'utf8'),saved);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
