// Stock research tracking: matched-exposure SPY, turnover, costs, rejected candidates and decision-to-fill reconciliation.
// All ledgers here are SYNTHETIC test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {stockResearchTracking} from './paper-auto-tracking.ts';
import {parseLedger} from './paper-auto-ledger.ts';

const STATUS={experimentId:'stock-v2-weekly-1',state:'READY',gateMode:'ARMED',gateReason:'OWNER_START',gateVersion:2,
 gateChangedAt:'2026-11-12T00:00:00Z',gateChangedBy:'owner',lastCheckAt:'2026-11-16T12:00:00Z',lastCheckOk:true,lastCheckBlockers:[],
 lastSuccessAt:null,executingRunId:null,leaseExpiresAt:null,unresolvedIntents:0,activeIntents:0,unacknowledgedCriticalAlerts:0,
 modelVersion:'stock-v2-weekly-1',decisionWindow:{start:'2026-11-01',end:'2027-12-31'},limits:{},checkedAt:'2026-11-16T12:00:00Z'};
const ledger=(more={})=>({experimentId:'stock-v2-weekly-1',registered:true,status:STATUS,
 experiment:{registeredAt:'2026-10-30T00:00:00Z',startingEquityCents:100000,brokerAccountNumberSuffix:'1234',configDigest:'a'},
 decisions:[],intents:[],daily:[],alerts:[],runs:[],gateEvents:[],activityCounts:{},...more});
const decision=(session,targets=['OXY','MO','SLB'],rejected={total:2,byReason:{LAST_CLOSE_ABOVE_CAP:2},symbols:[]})=>({decisionId:'d'+session,session,
 decisionAt:session+'T13:00:00Z',outcome:targets.length?'TARGETS':'HOLD_NO_TARGETS',targets,reasons:[],recordedAt:session+'T13:00:04Z',rejected});
let n=0;
const intent=(symbol,side,day,status,shares,filledQty,price,limitCents,over={})=>({intentId:'pai-'+String(++n).padStart(32,'0'),symbol,side,
 phase:side==='buy'?'BUY':'SELL',attempt:1,shares,limitCents,status,brokerStatus:status,filledQty:String(filledQty),
 filledAvgPrice:price===null?null:String(price),createdAt:day+'T14:45:00Z',updatedAt:day+'T14:46:00Z',...over});
const mark=(session,equity,long,spy,over={})=>({session,capturedAt:session+'T21:40:00Z',equityCents:equity,cashCents:equity-long,
 longMarketValueCents:long,externalFlowCents:0,feesCents:0,dividendsCents:0,benchmarkSymbol:'SPY',benchmarkClose:spy,benchmarkSource:'sip',
 contaminated:false,cashReconciled:true,cashUnexplainedCents:'0',unrealizedPlCents:0,...over});

test('SPY is compared at the strategy\'s own exposure, chained over verified marks only',()=>{
 const l=ledger({decisions:[decision('2026-11-30')],daily:[
  mark('2026-11-30',100000,30000,'600.00'),mark('2026-12-01',101000,30000,'612.00'),
  mark('2026-12-02',99000,40000,'580.00',{cashReconciled:false}),mark('2026-12-03',102000,50000,'618.00')]});
 const t=stockResearchTracking(l,'2026-12-04T00:00:00Z');
 assert.equal(t.benchmark.state,'MEASURED');assert.equal(t.benchmark.links,2,'the unreconciled mark is skipped, never interpolated');
 // Links: 11-30 -> 12-01 (exposure 0.30, SPY +2%), 12-01 -> 12-03 (exposure 30000/101000, SPY 618/612-1).
 const e2=30000/101000,matched=(1+0.3*0.02)*(1+e2*(618/612-1))-1;
 assert.ok(Math.abs(t.benchmark.matchedExposureSpyReturn-matched)<1e-6);
 assert.ok(Math.abs(t.benchmark.spyReturn-(618/600-1))<1e-6);
 assert.ok(Math.abs(t.benchmark.strategyReturn-0.02)<1e-6);
 assert.ok(Math.abs(t.benchmark.excessVsMatchedSpy-(0.02-matched))<1e-6);
 assert.ok(t.benchmark.averageExposure>0.29&&t.benchmark.averageExposure<0.31);
});

test('a single verified close is not a benchmark result',()=>{
 const t=stockResearchTracking(ledger({daily:[mark('2026-11-30',100000,30000,'600.00')]}),'2026-12-01T00:00:00Z');
 assert.equal(t.benchmark.state,'NEEDS_TWO_VERIFIED_CLOSES');assert.equal(t.benchmark.matchedExposureSpyReturn,null);
 assert.equal(t.state,'COLLECTING');
});

test('decision-to-fill reconciliation names every target outcome and flags buys that were never targets',()=>{
 const l=ledger({decisions:[decision('2026-11-23',['OXY','MO']),decision('2026-11-30',['OXY','MO','SLB','CSX','BMY'])],
  intents:[intent('OXY','buy','2026-11-23','filled',2,2,50,5010),
   intent('MO','buy','2026-11-30','filled',1,1,80,8000),intent('SLB','buy','2026-11-30','partially_filled',3,1,40,4005),
   intent('CSX','buy','2026-11-30','canceled',2,0,null,3500),intent('XOM','buy','2026-11-30','filled',1,1,110,11000)]});
 const t=stockResearchTracking(l,'2026-12-01T00:00:00Z');
 const r=t.reconciliation.find(x=>x.session==='2026-11-30');
 assert.deepEqual(Object.fromEntries(r.rows.map(x=>[x.symbol,x.status])),
  {OXY:'NOT_ORDERED_HELD',MO:'FILLED',SLB:'PARTIAL',CSX:'UNFILLED',BMY:'NOT_ORDERED'});
 assert.deepEqual(r.unexpectedBuys,['XOM']);assert.equal(t.state,'INTEGRITY_ISSUES');
 assert.match(t.issues.join('\n'),/UNEXPECTED_BUY: XOM/);
 const first=t.reconciliation.find(x=>x.session==='2026-11-23');
 assert.deepEqual([first.filled,first.notOrdered],[1,1]);
});

test('turnover and costs come from broker-confirmed fills only; fill versus limit is measured both ways',()=>{
 const l=ledger({decisions:[decision('2026-11-30',['OXY','MO'])],
  intents:[intent('OXY','buy','2026-11-30','filled',2,2,49.9,5000),intent('MO','sell','2026-11-30','filled',1,1,79,8000),
   intent('SLB','buy','2026-11-30','rejected',1,0,null,4000)],
  daily:[mark('2026-11-30',100000,30000,'600.00')]});
 const t=stockResearchTracking(l,'2026-12-01T00:00:00Z');
 assert.equal(t.turnover.filledOrders,2,'a rejected order has no notional');
 assert.ok(Math.abs(t.turnover.filledNotional-(2*49.9+79))<1e-9);
 assert.ok(Math.abs(t.turnover.turnover-(2*49.9+79)/1000)<1e-9);
 const days=(Date.parse('2026-11-30T21:40:00Z')-Date.parse('2026-10-30T00:00:00Z'))/86400e3;
 assert.ok(Math.abs(t.turnover.annualizedTurnover-t.turnover.turnover*365/days)<1e-5,'annualized from registration to the last verified mark');
 const young=stockResearchTracking({...l,experiment:{...l.experiment,registeredAt:'2026-11-20T00:00:00Z'}},'2026-12-01T00:00:00Z');
 assert.equal(young.turnover.annualizedTurnover,null,'not annualized before 28 days');
 assert.ok(Math.abs(t.costs.assumedCostDollars-(2*49.9+79)*0.001)<1e-9);
 // OXY bought 10 cents under the 50.00 limit (improvement, negative); MO sold 1.00 under its 80.00 limit (worse, positive).
 const expected=((-0.1/50*1e4)*99.8+(1/80*1e4)*79)/(99.8+79);
 assert.ok(Math.abs(t.costs.fillVersusLimitBps-expected)<1e-6);
 assert.match(t.issues.join('\n'),/FILL_WORSE_THAN_LIMIT: .* MO/);
});

test('rejected candidates are parsed from bridge diagnostics leniently and reported per decision',()=>{
 const raw={experimentId:'stock-v2-weekly-1',registered:true,status:{...STATUS,realMoneyEnabled:false,brokerEnvironment:'alpaca-paper',modelVersion:'stock-mom252-skip21-trend200-v1',
  limits:{capitalLimitCents:125000,maxOrderNotionalCents:15000,maxDailyNotionalCents:120000,maxOrdersPerDay:20,maxOpenOrders:10,maxAttemptsPerLeg:3,drawdownStopBps:2500,feeReserveCents:0}},
  experiment:{registeredAt:'2026-10-30T00:00:00Z',startingEquityCents:100000,brokerAccountNumberSuffix:'1234',configDigest:'a'.repeat(64)},
  decisions:[{decisionId:'d'.repeat(64),session:'2026-11-23',decisionAt:'2026-11-23T13:00:00Z',outcome:'TARGETS',targets:[{symbol:'OXY'}],
   diagnostics:{universeMembers:32,skipped:{AAPL:'LAST_CLOSE_ABOVE_CAP:342.56',ABBV:'LAST_CLOSE_ABOVE_CAP:286.2',CMCSA:'UNSUPPORTED_ACTION:spinoff',
    'bad symbol':'X',EA:42}},recordedAt:'2026-11-23T13:00:04Z'}],
  intents:[],daily:[],alerts:[],runs:[],gateEvents:[],activityCounts:{}};
 const l=parseLedger(raw);
 assert.ok(l,'a ledger with diagnostics still parses');
 assert.deepEqual(l.decisions[0].rejected.byReason,{LAST_CLOSE_ABOVE_CAP:2,UNSUPPORTED_ACTION:1});
 assert.equal(l.decisions[0].rejected.total,3,'malformed entries are dropped, not guessed');
 const legacy=parseLedger({...raw,decisions:[{...raw.decisions[0],diagnostics:{}}]});
 assert.equal(legacy.decisions[0].rejected.total,0);
 const t=stockResearchTracking(l,'2026-11-24T00:00:00Z');
 assert.deepEqual(t.rejectedCandidates,[{session:'2026-11-23',outcome:'TARGETS',targets:1,rejected:3,byReason:{LAST_CLOSE_ABOVE_CAP:2,UNSUPPORTED_ACTION:1}}]);
 assert.throws(()=>stockResearchTracking(l,'x'),/INVALID_CLOCK/);
});
