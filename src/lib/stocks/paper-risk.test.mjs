import test from 'node:test';
import assert from 'node:assert/strict';
import {paperRisk} from './paper-risk.ts';

// Synthetic TEST-ONLY ledger.
const intent=(symbol,side,shares,filledQty,limitCents,filledAvgPrice,createdAt='2026-11-16T14:50:00Z')=>({intentId:symbol+side,symbol,side,phase:side==='buy'?'BUY':'SELL',
 attempt:1,shares,limitCents,status:'submitted',brokerStatus:null,filledQty,filledAvgPrice,createdAt,updatedAt:createdAt});
const base=(over={})=>({experimentId:'t',registered:true,experiment:{registeredAt:'2026-11-01T00:00:00Z',startingEquityCents:10000000,brokerAccountNumberSuffix:'1',configDigest:'x'},
 status:{unresolvedIntents:0,unacknowledgedCriticalAlerts:0},decisions:[{decisionId:'d',session:'2026-11-16',decisionAt:'2026-11-16T13:00:00Z',outcome:'TARGETS',targets:['AAA','BBB'],reasons:[],recordedAt:'x'},
  {decisionId:'c',session:'2026-11-09',decisionAt:'2026-11-09T13:00:00Z',outcome:'HOLD_NO_TARGETS',targets:[],reasons:['TREND_FILTER'],recordedAt:'x'}],
 intents:[],daily:[],alerts:[],runs:[],gateEvents:[],activityCounts:{},...over});

test('no fills: nothing is counted as filled, exposure unknown, skipped decisions listed', () => {
  const r = paperRisk(base({intents: [intent('AAA', 'buy', 10, '0', 10000, null)],
    runs: [{runId: 'run-a', kind: 'execute', slot: '2026-11-13', attempt: 1, status: 'succeeded', startedAt: '2026-11-13T15:00:00Z', finishedAt: null, summary: 'SHADOW_PLAN_ONLY'}]}));
  assert.equal(r.planned, 1); assert.equal(r.filled, 0); assert.equal(r.unfilled, 1);
  assert.equal(r.fillVsLimitBps, null); assert.equal(r.exposure, null);
  assert.deepEqual(r.notTraded.map(d => d.outcome), ['HOLD_NO_TARGETS']);
  assert.equal(r.skippedRuns.SHADOW_PLAN_ONLY, 1);
});

test('fills: partials kept apart, fill vs limit in bps, concentration at cost, exposure from a verified close only', () => {
  const r = paperRisk(base({intents: [intent('AAA', 'buy', 10, '10', 10000, '99.50'), intent('BBB', 'buy', 10, '5', 5000, '50.10')],
    daily: [{session: '2026-11-16', capturedAt: 'x', equityCents: 10000000, cashCents: 8750000, longMarketValueCents: 1250000, contaminated: false, cashReconciled: true},
      {session: '2026-11-17', capturedAt: 'x', equityCents: 1, cashCents: 0, longMarketValueCents: 1, contaminated: false, cashReconciled: false}]}));
  assert.equal(r.filled, 1); assert.equal(r.partial, 1);
  // (10 × −50 bps + 5 × +20 bps) / 15 = −26.67 bps.
  assert.ok(Math.abs(r.fillVsLimitBps - (-400 / 15)) < 1e-9);
  assert.equal(r.exposure.session, '2026-11-16');
  assert.ok(Math.abs(r.exposure.share - 0.125) < 1e-12);
  assert.deepEqual(r.concentration.map(c => [c.symbol, c.costCents]), [['AAA', 99500], ['BBB', 25050]]);
});
