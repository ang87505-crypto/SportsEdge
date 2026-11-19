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

test('a ready or executing gate never claims to trade when paper orders or the schedule are off',()=>{
 const planning={brokerWritesEnabled:false,scheduledRunsEnabled:true};
 const l=ledger({gateMode:'ARMED',state:'READY'});
 assert.equal(headline(l,planning).label,'Planning only');
 assert.equal(headline(l,planning).tone,'warning');
 assert.equal(headline(ledger({gateMode:'ARMED',state:'EXECUTING'}),planning).label,'Planning now');
 assert.equal(headline(l,{brokerWritesEnabled:true,scheduledRunsEnabled:false}).label,'Schedule off');
 assert.equal(headline(l,{brokerWritesEnabled:true,scheduledRunsEnabled:true}).label,'Running');
 assert.equal(headline(ledger(),planning).label,'Stopped','release never overrides the owner gate');
 assert.equal(headline(ledger({gateMode:'PAUSED',state:'PAUSED'}),planning).label,'Paused');
 assert.equal(headline(ledger({gateMode:'ARMED',state:'BLOCKED'}),planning).label,'Needs attention');
});

test('an owner Stop remains Stopped and can be explicitly started again; risk alerts still block Start',()=>{
 const l=ledger({unacknowledgedCriticalAlerts:1},{alerts:[{alertId:1,severity:'critical',
  code:'OWNER_STOP_'+'A'.repeat(32),acknowledgedAt:null}]});
 assert.equal(headline(l).label,'Stopped');assert.equal(headline(l).canStart,true);
 assert.equal(headline(ledger({unacknowledgedCriticalAlerts:2},{alerts:l.alerts})).canStart,false);
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

test('strategies have plain names; unknown models fall back to their id',async()=>{
 const {strategy}=await import('./autopilot-view.ts');
 assert.equal(strategy('stock-mom252-skip21-trend200-v1').name,'Momentum');
 assert.equal(strategy('stock-lowvol252-trend200-v1').name,'Steady stocks');
 assert.equal(strategy('other-model').name,'other-model');
});

test('the combined total adds the accounts and never estimates a missing return',async()=>{
 const {combined}=await import('./autopilot-view.ts');
 const row=(name,valueCents,returnPct,label='Running')=>({experimentId:name,name,label,tone:'positive',valueCents,
  startingCents:100000,valueSession:'2026-11-03',returnPct});
 let c=combined([row('Momentum',103000,0.03),row('Steady stocks',101000,0.01)]);
 assert.equal(c.valueCents,204000);assert.equal(c.startingCents,200000);
 assert.ok(Math.abs(c.returnPct-0.02)<1e-12);assert.equal(c.leader,'Momentum');assert.equal(c.running,2);
 c=combined([row('Momentum',103000,0.03),row('Steady stocks',100000,null,'Stopped')]);
 assert.equal(c.returnPct,null,'one strategy has no verified result yet');assert.equal(c.leader,null);
 assert.equal(c.valueCents,203000);assert.equal(c.running,1);
 c=combined([row('Momentum',101000,0.01),row('Steady stocks',101000,0.01)]);
 assert.equal(c.leader,null,'a tie has no leader');
});

test('one overall status for the top bar',async()=>{
 const {overall}=await import('./autopilot-view.ts');
 const h=(label,tone='neutral')=>({label,tone});
 assert.deepEqual(overall([]),{label:'Not set up',tone:'neutral'});
 assert.deepEqual(overall([h('Running','positive')]),{label:'Running',tone:'positive'});
 assert.deepEqual(overall([h('Planning only','warning')]),{label:'Planning only',tone:'warning'});
 assert.deepEqual(overall([h('Stopped')]),{label:'Stopped',tone:'neutral'});
 assert.deepEqual(overall([h('Running','positive'),h('Running','positive')]),{label:'Running',tone:'positive'});
 assert.deepEqual(overall([h('Running','positive'),h('Stopped')]),{label:'1 of 2 running',tone:'info'});
 assert.deepEqual(overall([h('Planning only','warning'),h('Stopped')]),{label:'1 of 2 planning only',tone:'warning'});
 assert.deepEqual(overall([h('Running','positive'),h('Needs attention','warning')]),{label:'Needs attention',tone:'warning'});
 assert.deepEqual(overall([h('Paused'),h('Stopped')]),{label:'Stopped',tone:'neutral'});
});
