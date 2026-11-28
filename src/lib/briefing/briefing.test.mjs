import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBriefing,propsInput,propsState,stocksPublicState,kalshiPublicState,engineBriefing,learningPublicState,OP_STATES,MIN_SETTLED_ENTRIES} from './briefing.ts';
import {mondayReadiness} from './monday.ts';
import {makeRaw,NOW} from '../assistant/fixtures.mjs';

// Synthetic TEST-ONLY fixtures. NOW is Mon Nov 9 2026, 12:00 PM MST.
const run=(id,conclusion='success',startedAt='2026-11-09T15:00:00.000Z')=>({id,url:'https://github.com/ang87505-crypto/SportsEdge/actions/runs/'+id,event:'schedule',status:'completed',conclusion,startedAt,finishedAt:startedAt});
const job=(over={})=>({id:'research-collect',label:'Strategy research: nightly collection',area:'research',required:true,status:'OK',detail:'ok',
 historyUrl:'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/research-collect.yml',lastRun:run(1),lastSuccess:run(1),lastFailure:null,running:null,
 slots7d:{due:1,missed:0,lastMissedAt:null},nextPlanned:['2026-11-10T02:17:00.000Z'],note:null,...over});
const ops=(over={},view={})=>({mode:'live',checkedAt:NOW,monitorStale:false,...view,status:{schemaVersion:'ops-status-v1',generatedAt:'2026-11-09T18:50:00.000Z',monitorRun:null,
 overall:{state:'OK',attention:[]},jobs:[job()],blockers:[],site:{url:'x',checkedAt:NOW,ok:true,checks:[{name:'Overview page',ok:true,ms:9,detail:null}],
  deployment:{state:'MATCHES_MAIN',detail:'Production serves main abc1234.',deployedSha:'a',deployedRef:'main',mainSha:'a'}},
 evidence:{release:{pr:102,state:'open',merged:false}},credentials:[],...over}});
const FIRST={id:'stock-first-session',text:'PR #102 is not released: it needs a genuine owner-supervised first paper session.',action:'See the checklist.'};

const engine=(over={})=>({mode:'live',status:'OK',stale:false,at:NOW,checkedAt:NOW,detail:'Synthetic verified report',
 registry:{schema:'sportsedge-learning-registry-v1',experiments:[
  {id:'auto-forward',status:'RUNNING'},{id:'needs-results',status:'INSUFFICIENT_DATA'},
  {id:'failed-shadow',status:'FAILED'},{id:'rejected-model',status:'REJECTED'}]},
 attention:{coverage:{total:4,active:2,automatic:1,ownerSuppliedOnly:1},withoutProducer:['needs-results'],inputs:{sports:'CONNECTED'},gaps:[],alarms:null},...over});

test('stock jobs cannot imply active paper orders from an old check or an absent release blocker',()=>{
 const view=ops({jobs:[job({id:'stock-worker',area:'stocks'})]});
 assert.equal(stocksPublicState({...view,monitorStale:true}).state,'UNAVAILABLE');
 assert.match(stocksPublicState({...view,monitorStale:true}).reason,/more than 8 hours old/);
 const current=stocksPublicState(view);
 assert.equal(current.state,'OWNER_ACTION');
 assert.match(current.reason,/release switch is off/);
 assert.doesNotMatch(current.reason,/orders are running|account is armed/i);
});

test('a pending first run, missing checks and published blockers cannot produce a green overall status',()=>{
 for(const view of [ops({jobs:[]}),ops({jobs:[job({status:'PENDING_FIRST_RUN'})]}),ops({blockers:[FIRST]}),
  ops({site:{url:'x',checkedAt:NOW,ok:true,checks:[]}}),ops({overall:{state:'WARN',attention:[]}})]){
  const h=buildBriefing({nowIso:NOW,props:null,ops:view,research:null}).health;
  assert.equal(h.tone,'warning');assert.notEqual(h.headline,'Everything is running');
 }
 assert.equal(buildBriefing({nowIso:NOW,props:null,ops:ops({}, {monitorStale:true}),research:null}).health.headline,'Status needs a fresh check');
});

const weatherJobs=(state='OK')=>['kalshi-weather','kalshi-weather-shadow'].map(id=>job({id,label:id,status:state}));
test('weather status requires both current workflow receipts and never claims exchange or trading activity',()=>{
 assert.equal(kalshiPublicState(null).state,'UNAVAILABLE');
 assert.equal(kalshiPublicState(ops()).state,'UNAVAILABLE');
 assert.equal(kalshiPublicState(ops({jobs:weatherJobs()}, {monitorStale:true})).state,'UNAVAILABLE');
 const current=kalshiPublicState(ops({jobs:weatherJobs()}));
 assert.equal(current.state,'EXECUTING');assert.match(current.reason,/not evidence of trading performance/);
 assert.match(current.reason,/Exchange access remains disabled/);
 assert.equal(kalshiPublicState(ops({jobs:weatherJobs('FAILING')})).state,'UNAVAILABLE');
 assert.equal(kalshiPublicState(ops({jobs:weatherJobs('RAN_LATE')})).state,'ATTENTION');
 assert.equal(kalshiPublicState(ops({jobs:weatherJobs('MISSED_SLOT')})).state,'ATTENTION');
 assert.equal(kalshiPublicState(ops({jobs:weatherJobs('PENDING_FIRST_RUN')})).state,'WAITING_FOR_DATA');
});

test('learning coverage uses the reported experiment paths, preserving failed and rejected findings',()=>{
 const e=engineBriefing(engine(),NOW);
 assert.equal(e.current,true);assert.deepEqual(e.coverage,{active:2,automatic:1,ownerSuppliedOnly:1});
 assert.equal(e.total,4);assert.equal(e.failed,1);assert.equal(e.rejected,1);assert.equal(e.readyForReview,0);
 assert.match(e.note,/1 of 2 active experiments have an automatic evidence path/);
 assert.match(e.note,/Nothing is promoted automatically/);
 assert.equal(learningPublicState(e).state,'WAITING_FOR_DATA');
});

test('saved, failed, old and future engine records never imply current automatic learning',()=>{
 assert.equal(engineBriefing(null,NOW),null);
 for(const change of [{mode:'saved'},{status:'FAILED'},{stale:true},{at:'2026-11-01T00:00:00Z'},{at:'2026-11-10T00:00:00Z'}]){
  const e=engineBriefing(engine(change),NOW);
  assert.equal(e.current,false);assert.equal(e.coverage,null);assert.equal(learningPublicState(e).state,'UNAVAILABLE');
  assert.equal(e.failed,1);assert.equal(e.rejected,1);
 }
});

test('unknown or registry-mismatched coverage stays unknown even if all domain inputs are connected',()=>{
 for(const attention of [null,{coverage:null,withoutProducer:[],inputs:{sports:'CONNECTED',stocks:'CONNECTED',weather:'CONNECTED'}},
  {coverage:{total:4,active:3,automatic:2,ownerSuppliedOnly:1},withoutProducer:['needs-results']},
  {coverage:{total:4,active:2,automatic:1,ownerSuppliedOnly:1},withoutProducer:['not-registered']}]){
  const e=engineBriefing(engine({attention}),NOW);assert.equal(e.coverage,null);
  assert.equal(learningPublicState(e).state,'ATTENTION');
 }
});

test('the shared briefing always names sports, stocks, weather and learning with their own evidence states',()=>{
 const b=buildBriefing({nowIso:NOW,props:null,ops:null,research:null});
 assert.deepEqual(b.systems.map(s=>s.id),['props','stocks','kalshi','learning']);
 assert.ok(b.systems.every(s=>s.state==='UNAVAILABLE'));
 assert.equal(b.engine,null);
});

test('operating states distinguish warnings and failures from healthy execution', () => {
  assert.equal(OP_STATES.ATTENTION.tone, 'warning');
  assert.equal(propsState(null).state, 'UNAVAILABLE');
  const brake = propsState({control: {state: 'PAUSED', reason: 'SAFETY_BRAKE: last 60 picks hit 40.0%, confidently below the 57.7% break-even'}, noPicks: {code: 'PAUSED', headline: 'x', detail: null}});
  assert.equal(brake.state, 'SAFETY_STOPPED');
  assert.match(brake.reason, /Only the owner can resume/);
  assert.equal(propsState({control: {state: 'PAUSED', reason: 'owner'}, noPicks: {code: 'PAUSED', headline: 'Paused', detail: null}}).state, 'OWNER_PAUSED');
  for (const [code, state] of [['BUDGET_EXHAUSTED', 'BUDGET_EXHAUSTED'], ['NO_QUALIFYING_LINES', 'NOTHING_QUALIFIES'], ['WAITING_FOR_WINDOW', 'WAITING_FOR_DATA'],
    ['CAPTURE_FAILED', 'UNAVAILABLE'], ['WINDOWS_MISSED', 'UNAVAILABLE'], ['HAS_PICKS', 'EXECUTING']])
    assert.equal(propsState({control: {state: 'RUNNING', reason: ''}, noPicks: {code, headline: code, detail: null}}).state, state, code);
  assert.equal(stocksPublicState(null).state, 'UNAVAILABLE');
  assert.equal(stocksPublicState(ops({blockers: [FIRST]})).state, 'OWNER_ACTION');
  assert.equal(stocksPublicState(ops({jobs: [job({id: 'stock-worker', area: 'stocks', status: 'FAILING', detail: 'Last run failed'})], blockers: [FIRST]})).state, 'UNAVAILABLE');
});

test('health: unknown without the monitor, red for a failing required job or live check, warning when stale', () => {
  const none = buildBriefing({nowIso: NOW, props: null, ops: null, research: null});
  assert.equal(none.health.headline, 'Status unknown');
  assert.equal(buildBriefing({nowIso: NOW, props: null, ops: ops(), research: null}).health.tone, 'positive');
  const bad = buildBriefing({nowIso: NOW, props: null, ops: ops({jobs: [job({status: 'FAILING', detail: 'Last run failed'})]}), research: null});
  assert.equal(bad.health.tone, 'negative');
  assert.match(bad.health.problems.join(' '), /Last run failed/);
  const site = ops(); site.status.site.checks = [{name: 'Chat answers', ok: false, ms: 1, detail: null}];
  assert.equal(buildBriefing({nowIso: NOW, props: null, ops: site, research: null}).health.tone, 'negative');
  assert.equal(buildBriefing({nowIso: NOW, props: null, ops: ops({}, {monitorStale: true}), research: null}).health.tone, 'warning');
});

test('today lists real receipts only: settlements with money, unknown payouts labelled, failures shown, quiet ticks grouped', () => {
  const raw = makeRaw();
  raw.runs.push({id: 7, kind: 'collect', slot_key: 'collect-tick-2026-11-09T1807', status: 'completed', outcome: 'NOTHING_DUE', started_at: '2026-11-09T18:07:00Z', finished_at: '2026-11-09T18:07:02Z', start_delay_seconds: 0, summary: {}},
    {id: 8, kind: 'collect', slot_key: 'collect-tick-2026-11-09T1837', status: 'completed', outcome: 'NOTHING_DUE', started_at: '2026-11-09T18:37:00Z', finished_at: '2026-11-09T18:37:02Z', start_delay_seconds: 0, summary: {}},
    {id: 9, kind: 'collect', slot_key: 'collect-tick-2026-11-09T1700', status: 'failed', outcome: 'FAILED_UNEXPECTED', started_at: '2026-11-09T17:00:00Z', finished_at: null, start_delay_seconds: 0, summary: {}});
  const b = buildBriefing({nowIso: NOW, props: propsInput(raw), ops: ops(), research: null});
  const text = b.today.map(t => t.text).join('\n');
  assert.match(text, /PrizePicks entry #7 won \$10\.00/);
  assert.match(text, /PrizePicks entry #8 lost −\$5\.00/);
  assert.match(text, /2 capture checks ran with nothing due \(no credits used\)/);
  assert.ok(b.today.some(t => t.tone === 'negative' && /did not complete/.test(t.text)));
  assert.match(text, /Strategy research: nightly collection: ran successfully/);
  // Yesterday's activity is not "today".
  assert.doesNotMatch(text, /Made 3 virtual/);
});

test('money: known PrizePicks results only, Pick6 unknowns kept apart, and small samples called preliminary', () => {
  const b = buildBriefing({nowIso: NOW, props: propsInput(makeRaw()), ops: null, research: null});
  assert.equal(b.money.prizepicks.netCents, 1500);
  assert.equal(b.money.prizepicks.weekNetCents, 1500);
  assert.equal(b.money.prizepicks.weekSettled, 3);
  assert.equal(b.money.preliminary, true);
  assert.match(b.money.note, new RegExp(`Too early.*at least ${MIN_SETTLED_ENTRIES}`));
  assert.match(b.money.note, /Pick6 payouts are unknown and are never added/);
  const unread = buildBriefing({nowIso: NOW, props: null, ops: null, research: null});
  assert.equal(unread.money.prizepicks, null);
  assert.match(unread.money.note, /could not be read/);
});

test('learning: overconfidence is flagged from graded picks; next lists only future plans, including the weekly stock pick', () => {
  const raw = makeRaw();
  // Make every graded pick a loss at 66% stated confidence.
  raw.results = raw.results.map(r => r.observation_id <= 14 ? {...r, outcome: r.observation_id <= 2 ? 'more' : 'less'} : r);
  const b = buildBriefing({nowIso: NOW, props: propsInput(raw), ops: ops(), research: null});
  assert.equal(b.learning.overconfident, true);
  assert.match(b.learning.note, /overconfident/);
  assert.match(b.learning.note, /sample is small/);
  assert.ok(b.next.every(n => Date.parse(n.at) > Date.parse(NOW)));
  assert.ok(b.next.some(n => /weekly pick/.test(n.what)));
});

const ledger = (over = {}) => ({experimentId: 'test-weekly', registered: true,
  experiment: {registeredAt: '2026-11-01T00:00:00Z', startingEquityCents: 100000, brokerAccountNumberSuffix: '1234', configDigest: 'x'},
  status: {experimentId: 'test-weekly', state: 'READY', gateMode: 'ARMED', gateReason: 'OWNER_START', gateVersion: 3, gateChangedAt: '2026-11-15T20:00:00Z', gateChangedBy: 'owner',
    lastCheckAt: '2026-11-15T20:00:05Z', lastCheckOk: true, lastCheckBlockers: [], lastSuccessAt: null, executingRunId: null, leaseExpiresAt: null, unresolvedIntents: 0,
    activeIntents: 0, unacknowledgedCriticalAlerts: 0, modelVersion: 'stock-mom252-skip21-trend200-v1', decisionWindow: {start: '2026-11-16', end: '2026-11-20'},
    limits: {capitalLimitCents: 1000000, maxOrderNotionalCents: 200000, maxDailyNotionalCents: 1000000, maxOrdersPerDay: 10, maxOpenOrders: 10, maxAttemptsPerLeg: 2, drawdownStopBps: 1500, feeReserveCents: 100},
    checkedAt: '2026-11-15T20:00:05Z'},
  decisions: [], intents: [], daily: [], alerts: [], runs: [], gateEvents: [], activityCounts: {}, ...over});
const SUN = '2026-11-15T22:00:00.000Z';

test('Monday readiness: visitors see only public items; an armed, clean, unblocked ledger is ready before the session', () => {
  const visitor = mondayReadiness({nowIso: SUN, ops: ops({blockers: [FIRST]}), ledger: null, ownerSignedIn: false});
  assert.equal(visitor.ready, false);
  assert.equal(visitor.session, '2026-11-16');
  assert.ok(visitor.items.filter(i => ['account', 'arm', 'check', 'protections'].includes(i.id)).every(i => i.state === 'OWNER_ONLY'));
  assert.match(visitor.verdict, /Sign in as the owner/);
  const ready = mondayReadiness({nowIso: SUN, ops: ops({blockers: [FIRST]}), ledger: ledger(), ownerSignedIn: true});
  assert.equal(ready.ready, true, ready.verdict);
  assert.equal(ready.items.find(i => i.id === 'fills').state, 'ON_THE_DAY');
  assert.equal(ready.items.find(i => i.id === 'gate').state, 'ON_THE_DAY');
  const stopped = mondayReadiness({nowIso: SUN, ops: ops(), ledger: ledger({status: {...ledger().status, gateMode: 'STOPPED'}}), ownerSignedIn: true});
  assert.equal(stopped.ready, false);
  assert.match(stopped.items.find(i => i.id === 'arm').detail, /never arm it for you/);
  const old = mondayReadiness({nowIso: SUN, ops: ops(), ledger: ledger({status: {...ledger().status, lastCheckAt: '2026-11-13T12:00:00Z'}}), ownerSignedIn: true});
  assert.equal(old.items.find(i => i.id === 'check').state, 'NOT_YET');
  const blocked = mondayReadiness({nowIso: SUN, ops: ops(), ledger: ledger({status: {...ledger().status, unresolvedIntents: 1}}), ownerSignedIn: true});
  assert.equal(blocked.items.find(i => i.id === 'protections').state, 'BLOCKED');
});

test('Monday readiness: an unfilled intent is not a fill; a broker-confirmed quantity is', () => {
  const MON = '2026-11-16T17:00:00.000Z';
  const intent = (filledQty) => ({intentId: 'i1', symbol: 'TEST', side: 'buy', phase: 'entry', attempt: 1, shares: 5, limitCents: 1000, status: 'submitted', brokerStatus: 'new',
    filledQty, filledAvgPrice: null, createdAt: '2026-11-16T14:50:00Z', updatedAt: '2026-11-16T14:50:00Z'});
  const unfilled = mondayReadiness({nowIso: MON, ops: ops(), ledger: ledger({intents: [intent('0')]}), ownerSignedIn: true});
  assert.equal(unfilled.session, '2026-11-16');
  assert.equal(unfilled.items.find(i => i.id === 'fills').state, 'ON_THE_DAY');
  const filled = mondayReadiness({nowIso: MON, ops: ops(), ledger: ledger({intents: [intent('5')]}), ownerSignedIn: true});
  assert.equal(filled.items.find(i => i.id === 'fills').state, 'READY');
  // Stop → CLEAN reconcile → Start recorded by the owner.
  const done = mondayReadiness({nowIso: MON, ops: ops(), ownerSignedIn: true, ledger: ledger({intents: [intent('5')],
    gateEvents: [{fromMode: 'ARMED', toMode: 'STOPPED', reason: 'OWNER_STOP', actor: 'owner', at: '2026-11-16T16:00:00Z'},
      {fromMode: 'STOPPED', toMode: 'ARMED', reason: 'OWNER_START', actor: 'owner', at: '2026-11-16T16:10:00Z'}],
    runs: [{runId: 'run-x', kind: 'reconcile', slot: 's', attempt: 1, status: 'succeeded', startedAt: '2026-11-16T16:05:00Z', finishedAt: '2026-11-16T16:05:30Z', summary: 'CLEAN'}]})});
  assert.equal(done.items.find(i => i.id === 'stop-start').state, 'READY');
  const dirty = mondayReadiness({nowIso: MON, ops: ops(), ownerSignedIn: true, ledger: ledger({
    gateEvents: [{fromMode: 'ARMED', toMode: 'STOPPED', reason: 'OWNER_STOP', actor: 'owner', at: '2026-11-16T16:00:00Z'},
      {fromMode: 'STOPPED', toMode: 'ARMED', reason: 'OWNER_START', actor: 'owner', at: '2026-11-16T16:10:00Z'}],
    runs: [{runId: 'run-x', kind: 'reconcile', slot: 's', attempt: 1, status: 'succeeded', startedAt: '2026-11-16T16:05:00Z', finishedAt: '2026-11-16T16:05:30Z', summary: 'NOT_CLEAN'}]})});
  assert.equal(dirty.items.find(i => i.id === 'stop-start').state, 'ON_THE_DAY');
});

test('a run GitHub never started is a warning, not a failure', () => {
  const b = buildBriefing({nowIso: NOW, props: null, ops: ops({jobs: [job({stuckQueued: 1, detail: 'Last run succeeded. 1 run queued for over 2 hours.'})]}), research: null});
  assert.equal(b.health.tone, 'warning');
  assert.equal(b.health.headline, 'Running, with warnings');
});

test('money: yesterday\'s slate is reported on its own, from settled entries with a known payout',async()=>{
 const {buildBriefing,propsInput}=await import('./briefing.ts');
 const {briefingAnswer}=await import('../assistant/briefing-answer.ts');
 const {makeRaw,NOW}=await import('../assistant/fixtures.mjs');
 const b=buildBriefing({nowIso:NOW,props:propsInput(makeRaw()),ops:null,research:null});
 assert.equal(b.money.prizepicks.yesterdaySettled,3);
 assert.equal(b.money.prizepicks.yesterdayNetCents,1500);
 assert.match(briefingAnswer('money',b,{range:'yesterday'}).text,/Yesterday's slate \(2026-11-08, Mountain time\): \+\$15\.00 on 3 settled/);
 const empty=buildBriefing({nowIso:'2026-11-12T19:00:00.000Z',props:propsInput(makeRaw({nowIso:'2026-11-12T19:00:00.000Z'})),ops:null,research:null});
 assert.match(briefingAnswer('money',empty,{range:'yesterday'}).text,/No PrizePicks virtual entry was made for yesterday's slate/);
});

test('Monday readiness: a shadow plan is not the supervised execute; only orders actually sent are', () => {
  const MON = '2026-11-23T17:00:00.000Z';
  const targets = {decisionId: 'd1', session: '2026-11-23', decisionAt: '2026-11-23T13:00:00Z', outcome: 'TARGETS', targets: ['OXY', 'MO'], reasons: [], recordedAt: '2026-11-23T13:00:04Z'};
  const shadow = {runId: 'run-s', kind: 'execute', slot: '2026-11-23T15:45Z', attempt: 1, status: 'succeeded', startedAt: '2026-11-23T15:55:20Z', finishedAt: '2026-11-23T15:55:27Z', summary: 'SHADOW_PLAN_ONLY'};
  const onlyShadow = mondayReadiness({nowIso: MON, ops: ops(), ownerSignedIn: true, ledger: ledger({decisions: [targets], runs: [shadow]})});
  const ex = onlyShadow.items.find(i => i.id === 'execute');
  assert.equal(ex.state, 'ON_THE_DAY');
  assert.match(ex.detail, /Only 1 shadow plan\(s\).*not orders/);
  assert.match(ex.detail, /branch release\/stock-paper-orders, kind execute/);
  const sentIntent = {intentId: 'i1', symbol: 'OXY', side: 'buy', phase: 'BUY', attempt: 1, shares: 1, limitCents: 5816, status: 'open', brokerStatus: 'new',
    filledQty: '0', filledAvgPrice: null, createdAt: '2026-11-23T14:45:00Z', updatedAt: '2026-11-23T14:45:01Z'};
  const sent = mondayReadiness({nowIso: MON, ops: ops(), ownerSignedIn: true, ledger: ledger({decisions: [targets], runs: [shadow], intents: [sentIntent]})});
  assert.equal(sent.items.find(i => i.id === 'execute').state, 'READY');
  assert.equal(sent.items.find(i => i.id === 'fills').state, 'ON_THE_DAY', 'sent is not filled');
  const hold = mondayReadiness({nowIso: MON, ops: ops(), ownerSignedIn: true, ledger: ledger({decisions: [{...targets, outcome: 'HOLD_NO_TARGETS', targets: []}]})});
  assert.equal(hold.items.find(i => i.id === 'execute').state, 'BLOCKED');
  assert.match(hold.items.find(i => i.id === 'execute').detail, /no order day/);
  assert.match(sent.items.find(i => i.id === 'stop-start').detail, /every order .* filled/);
});
