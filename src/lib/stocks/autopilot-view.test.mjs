// Plain-language autopilot view: status wording, schedule times across daylight saving, holdings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {headline,activity,holdings,latestPicks,nextRuns,nyInstant} from './autopilot-view.ts';

const STATUS={experimentId:'e',state:'STOPPED',gateMode:'STOPPED',gateReason:'REGISTERED_NOT_AUTHORIZED',gateVersion:1,
 gateChangedAt:'2026-10-30T06:02:00Z',gateChangedBy:'owner',lastCheckAt:null,lastCheckOk:null,lastCheckBlockers:[],
 lastSuccessAt:null,executingRunId:null,leaseExpiresAt:null,unresolvedIntents:0,activeIntents:0,
 unacknowledgedCriticalAlerts:0,modelVersion:'m',decisionWindow:{start:'2026-10-30',end:'2027-12-31'},limits:{},
 checkedAt:'2026-10-31T12:00:00Z'};
const ledger=(status={},more={})=>({experimentId:'e',registered:true,status:{...STATUS,...status},
 experiment:{registeredAt:'2026-10-30T06:02:00Z',startingEquityCents:100000,brokerAccountNumberSuffix:'1234',configDigest:'a'},
 decisions:[],intents:[],daily:[],alerts:[],runs:[],gateEvents:[],activityCounts:{},...more});

test('New York wall-clock times convert correctly on both sides of the daylight-saving change',()=>{
 assert.equal(nyInstant(2026,10,30,8,0),Date.parse('2026-10-30T12:00:00Z'));
 assert.equal(nyInstant(2026,11,2,8,0),Date.parse('2026-11-02T13:00:00Z'));
 assert.equal(nyInstant(2026,11,2,9,50),Date.parse('2026-11-02T14:50:00Z'));
});

test('next scheduled runs from a Saturday land on Monday in New York time',()=>{
 const n=nextRuns(Date.parse('2026-10-31T21:30:00Z'));
 assert.equal(n.pick,Date.parse('2026-11-02T13:00:00Z'));
 assert.equal(n.trade,Date.parse('2026-11-02T14:50:00Z'));
 assert.equal(n.close,Date.parse('2026-11-02T21:35:00Z'));
 // Monday after the pick: the next pick is a week later, the trade run is that morning.
 const m=nextRuns(Date.parse('2026-11-02T13:30:00Z'));
 assert.equal(m.pick,Date.parse('2026-11-09T13:00:00Z'));
 assert.equal(m.trade,Date.parse('2026-11-02T14:50:00Z'));
});

test('the headline says plainly whether the autopilot is on, off or needs attention',()=>{
 let h=headline(ledger());
 assert.equal(h.label,'Stopped');assert.equal(h.canStart,true);
 h=headline(ledger({gateMode:'ARMED',state:'READY'}));
 assert.equal(h.label,'Running');assert.equal(h.tone,'positive');assert.equal(h.canStart,false);
 h=headline(ledger({gateMode:'ARMED',state:'EXECUTING'}));assert.equal(h.label,'Trading now');
 h=headline(ledger({gateMode:'ARMED',state:'BLOCKED',lastCheckBlockers:['EXTERNAL_OPEN_ORDER:x']}));
 assert.equal(h.label,'Needs attention');assert.match(h.reasons[0],/did not place/);
 h=headline(ledger({unacknowledgedCriticalAlerts:1}));
 assert.equal(h.label,'Needs attention');assert.equal(h.canStart,false,'Start waits until alerts are reviewed');
 h=headline(ledger({gateMode:'PAUSED',state:'PAUSED'}));assert.equal(h.label,'Paused');assert.equal(h.canStart,true);
});

test('holdings, picks and activity read the ledger in plain words',()=>{
 const l=ledger({},{
  intents:[{intentId:'a',symbol:'F',side:'buy',phase:'BUY',attempt:1,shares:8,limitCents:1200,status:'filled',
   brokerStatus:'filled',filledQty:'8',filledAvgPrice:'12',createdAt:'x',updatedAt:'x'},
   {intentId:'b',symbol:'T',side:'buy',phase:'BUY',attempt:1,shares:3,limitCents:2500,status:'canceled',
    brokerStatus:'canceled',filledQty:'0',filledAvgPrice:null,createdAt:'x',updatedAt:'x'}],
  decisions:[{decisionId:'d1',session:'2026-10-30',decisionAt:'x',outcome:'TARGETS',targets:['F','T'],reasons:[],recordedAt:'x'},
   {decisionId:'d0',session:'2026-10-23',decisionAt:'x',outcome:'MISSED',targets:[],reasons:[],recordedAt:'x'}],
  runs:[{runId:'r1',kind:'execute',slot:'s',attempt:1,status:'succeeded',startedAt:'2026-10-30T14:50:00Z',finishedAt:null,
   summary:'SHADOW_PLAN_ONLY'},{runId:'r2',kind:'decision',slot:'s',attempt:1,status:'succeeded',
   startedAt:'2026-10-30T12:00:00Z',finishedAt:null,summary:'RECORDED'}]});
 assert.deepEqual(holdings(l),[{symbol:'F',shares:8}]);
 const p=latestPicks(l);assert.equal(p.session,'2026-10-30');assert.deepEqual(p.targets,['F','T']);
 const a=activity(l);
 assert.deepEqual(a.map(x=>x.what),['Trade run','Weekly pick']);
 assert.match(a[0].result,/practice mode/);assert.equal(a[1].result,'Picks recorded');
 assert.equal(latestPicks(ledger()),null);
});
