// Stock forward evaluation: completed trades from real fills only, honest INSUFFICIENT_DATA, no lookahead,
// blocked/failed sessions never create profit. All ledgers here are SYNTHETIC test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStockForward,MINIMUMS,COST_BPS_PER_SIDE} from './paper-auto-evaluation.ts';

const STATUS={experimentId:'stock-v2-weekly-1',state:'READY',gateMode:'ARMED',gateReason:'OWNER_START',gateVersion:2,
 gateChangedAt:'2026-11-12T00:00:00Z',gateChangedBy:'owner',lastCheckAt:'2026-11-16T12:00:00Z',lastCheckOk:true,lastCheckBlockers:[],
 lastSuccessAt:null,executingRunId:null,leaseExpiresAt:null,unresolvedIntents:0,activeIntents:0,unacknowledgedCriticalAlerts:0,
 modelVersion:'stock-v2-weekly-1',decisionWindow:{start:'2026-11-01',end:'2027-12-31'},limits:{},checkedAt:'2026-11-16T12:00:00Z'};
const ledger = (more = {}) => ({experimentId: 'stock-v2-weekly-1', registered: true, status: STATUS,
  experiment: {registeredAt: '2026-11-01T00:00:00Z', startingEquityCents: 100000, brokerAccountNumberSuffix: '1234', configDigest: 'a'},
  decisions: [], intents: [], daily: [], alerts: [], runs: [], gateEvents: [], activityCounts: {}, ...more});
const decision = (session, outcome = 'TARGETS') => ({decisionId: 'd' + session, session, decisionAt: session + 'T13:00:00Z', outcome,
  targets: outcome === 'TARGETS' ? ['OXY', 'MO'] : [], reasons: [], recordedAt: session + 'T13:00:04Z'});
let n = 0;
const intent = (symbol, side, day, status, filledQty, price, over = {}) => ({intentId: 'pai-' + String(++n).padStart(32, '0'), symbol, side,
  phase: side === 'buy' ? 'BUY' : 'SELL', attempt: 1, shares: Number(filledQty) || 1, limitCents: 6000, status, brokerStatus: status,
  filledQty: String(filledQty), filledAvgPrice: price === null ? null : String(price), createdAt: day + 'T14:45:00Z', updatedAt: day + 'T14:46:00Z', ...over});
const mark = (session, equity, over = {}) => ({session, capturedAt: session + 'T21:40:00Z', equityCents: equity, cashCents: 50000,
  longMarketValueCents: equity - 50000, externalFlowCents: 0, feesCents: 0, dividendsCents: 0, benchmarkSymbol: 'SPY',
  benchmarkClose: '600.00', benchmarkSource: 'sip', contaminated: false, cashReconciled: true, cashUnexplainedCents: '0', unrealizedPlCents: 0, ...over});

test('no fills yet (today\'s real state): INSUFFICIENT_DATA, zero trades, no win rate, prediction accuracy not invented', () => {
  const e = evaluateStockForward(ledger({decisions: [decision('2026-11-16')]}), '2026-11-19T12:00:00Z');
  assert.equal(e.verdict, 'INSUFFICIENT_DATA');
  assert.equal(e.trades.completed, 0);
  assert.equal(e.trades.winRate, null);
  assert.equal(e.trades.netPnlCents, 0);
  assert.equal(e.sessions.states['2026-11-16'], 'MISSING_MARK');
  assert.equal(e.predictions.state, 'NOT_PROVIDED_BY_MODEL');
});

test('a filled round trip is a completed trade, net of costs; win rate still withheld below the minimum sample', () => {
  const l = ledger({decisions: [decision('2026-11-16'), decision('2026-11-23')],
    intents: [intent('OXY', 'buy', '2026-11-16', 'filled', 2, 50), intent('OXY', 'sell', '2026-11-23', 'filled', 2, 55),
      intent('MO', 'buy', '2026-11-16', 'filled', 1, 80), intent('MO', 'sell', '2026-11-23', 'filled', 1, 76)],
    daily: [mark('2026-11-16', 100000), mark('2026-11-23', 100900)]});
  const e = evaluateStockForward(l, '2026-11-24T00:00:00Z');
  assert.equal(e.trades.completed, 2);
  assert.equal(e.trades.winners, 1);
  assert.equal(e.trades.losers, 1);
  const c = COST_BPS_PER_SIDE / 1e4;
  assert.ok(Math.abs(e.trades.averageWinnerReturn - ((55 * (1 - c)) / (50 * (1 + c)) - 1)) < 1e-12);
  assert.ok(e.trades.averageLoserReturn < -0.05);
  assert.equal(e.trades.winRate, null, `win rate withheld below ${MINIMUMS.completedTrades} trades`);
  assert.equal(e.verdict, 'INSUFFICIENT_DATA');
  assert.equal(e.sessions.clean, 2);
});

test('blocked, rejected, unfilled and cancelled orders never produce profit or trades', () => {
  const l = ledger({decisions: [decision('2026-11-16')],
    intents: [intent('OXY', 'buy', '2026-11-16', 'rejected', 0, null), intent('MO', 'buy', '2026-11-16', 'canceled', 0, null),
      intent('SLB', 'buy', '2026-11-16', 'not_submitted', 0, null), intent('BMY', 'buy', '2026-11-16', 'uncertain', 0, null)]});
  const e = evaluateStockForward(l, '2026-11-17T00:00:00Z');
  assert.deepEqual([e.trades.completed, e.trades.netPnlCents, e.orders.rejected, e.orders.canceledOrExpired, e.orders.notSubmitted, e.orders.uncertain, e.orders.unfilled],
    [0, 0, 1, 1, 1, 1, 4]);
});

test('no lookahead: fills and marks after asOf are ignored; an order before its decision fails integrity', () => {
  const l = ledger({decisions: [decision('2026-11-16')],
    intents: [intent('OXY', 'buy', '2026-11-16', 'filled', 1, 50), intent('OXY', 'sell', '2026-11-23', 'filled', 1, 60)],
    daily: [mark('2026-11-16', 100000), mark('2026-11-23', 101000)]});
  const before = evaluateStockForward(l, '2026-11-20T00:00:00Z');
  assert.equal(before.trades.completed, 0, 'a future sell is not visible yet');
  assert.equal(before.trades.openLots, 1);
  const bad = ledger({decisions: [decision('2026-11-16')], intents: [intent('OXY', 'buy', '2026-11-16', 'filled', 1, 50, {createdAt: '2026-11-16T12:59:00Z'})]});
  const e = evaluateStockForward(bad, '2026-11-17T00:00:00Z');
  assert.equal(e.verdict, 'INTEGRITY_FAILED');
  assert.match(e.reasons[0], /LOOKAHEAD/);
});

test('contaminated or unreconciled sessions are classified and do not count as clean evidence', () => {
  const l = ledger({decisions: [decision('2026-11-16'), decision('2026-11-23'), decision('2026-11-30')],
    daily: [mark('2026-11-16', 100000, {contaminated: true}), mark('2026-11-23', 100000, {cashReconciled: false})]});
  const e = evaluateStockForward(l, '2026-12-01T00:00:00Z');
  assert.deepEqual(e.sessions.states, {'2026-11-16': 'CONTAMINATED', '2026-11-23': 'UNRESOLVED', '2026-11-30': 'MISSING_MARK'});
  assert.equal(e.sessions.clean, 0);
});

test('a sell with no matching buy in this experiment is an integrity failure, not a profit', () => {
  const e = evaluateStockForward(ledger({decisions: [decision('2026-11-16')], intents: [intent('OXY', 'sell', '2026-11-16', 'filled', 1, 60)]}), '2026-11-17T00:00:00Z');
  assert.equal(e.verdict, 'INTEGRITY_FAILED');
  assert.equal(e.trades.netPnlCents, 0);
});

test('measured only after the minimum sample of real completed trades and clean sessions', () => {
  const decisions = [], intents = [], daily = [];
  for (let w = 0; w < 10; w++) {
    const d = new Date(Date.UTC(2026, 10, 16 + 7 * w)).toISOString().slice(0, 10), next = new Date(Date.UTC(2026, 10, 23 + 7 * w)).toISOString().slice(0, 10);
    decisions.push(decision(d)); daily.push(mark(d, 100000 + w * 100));
    for (const s of ['A', 'B']) {intents.push(intent('X' + s + w, 'buy', d, 'filled', 1, 50)); intents.push(intent('X' + s + w, 'sell', next, 'filled', 1, w % 3 ? 52 : 48));}
  }
  const e = evaluateStockForward(ledger({decisions, intents, daily}), '2027-02-01T00:00:00Z');
  assert.equal(e.trades.completed, 20);
  assert.equal(e.verdict, 'MEASURED');
  assert.ok(e.trades.winRate > 0 && e.trades.winRate < 1);
});

const run = (session, summary, over = {}) => ({runId: 'run-' + String(++n).padStart(32, '0'), kind: 'execute', slot: session + 'T15:45Z', attempt: 1,
  status: 'succeeded', startedAt: session + 'T15:55:20Z', finishedAt: session + 'T15:55:27Z', summary, ...over});

test('funnel: Nov 16 as it happened (TARGETS, a shadow plan on main, no orders) is SHADOW_ONLY, never a fill or a result', () => {
  const l = ledger({decisions: [{...decision('2026-11-16'), targets: ['OXY', 'MO', 'SLB', 'BMY', 'CSX']}],
    runs: [run('2026-11-16', 'SHADOW_PLAN_ONLY'), run('2026-11-16', 'SHADOW_PLAN_ONLY', {startedAt: '2026-11-16T18:38:40Z', finishedAt: '2026-11-16T18:38:47Z'})]});
  const [f] = evaluateStockForward(l, '2026-11-19T12:00:00Z').sessions.funnel;
  assert.deepEqual(f, {session: '2026-11-16', outcome: 'TARGETS', targets: 5, shadowPlans: 2, executeRuns: 2, ordersSent: 0, ordersFilled: 0,
    filledShares: 0, realizedTrades: 0, realizedNetPnlCents: 0, stage: 'SHADOW_ONLY'});
});

test('funnel: targets -> sent -> filled -> realized stay separate stages', () => {
  const decisions = [decision('2026-11-23'), decision('2026-11-30'), decision('2026-12-07', 'HOLD_NO_TARGETS'), decision('2026-12-14')];
  const intents = [
    intent('OXY', 'buy', '2026-11-23', 'filled', 1, 50), intent('MO', 'buy', '2026-11-23', 'rejected', 0, null),
    intent('OXY', 'sell', '2026-11-30', 'filled', 1, 52), intent('SLB', 'buy', '2026-11-30', 'filled', 2, 40),
    intent('BMY', 'buy', '2026-12-14', 'open', 0, null)];
  const runs = [run('2026-11-23', 'ORDERS_COMPLETE'), run('2026-11-30', 'ORDERS_COMPLETE'), run('2026-12-14', 'ORDERS_WORKING')];
  const f = Object.fromEntries(evaluateStockForward(ledger({decisions, intents, runs}), '2026-12-15T00:00:00Z').sessions.funnel.map(x => [x.session, x]));
  assert.equal(f['2026-11-23'].stage, 'REALIZED');
  assert.deepEqual([f['2026-11-23'].ordersSent, f['2026-11-23'].ordersFilled, f['2026-11-23'].realizedTrades], [2, 1, 1]);
  assert.ok(f['2026-11-23'].realizedNetPnlCents > 0 && f['2026-11-23'].realizedNetPnlCents < 200, 'net of 10 bps per side');
  assert.equal(f['2026-11-30'].stage, 'FILLED_OPEN', 'SLB is held, not yet a result');
  assert.equal(f['2026-11-30'].filledShares, 3);
  assert.equal(f['2026-12-07'].stage, 'NO_TARGETS');
  assert.equal(f['2026-12-14'].stage, 'ORDERS_UNFILLED');
  const none = evaluateStockForward(ledger({decisions: [decision('2026-11-23')]}), '2026-11-24T00:00:00Z').sessions.funnel[0];
  assert.equal(none.stage, 'NOT_EXECUTED');
});
