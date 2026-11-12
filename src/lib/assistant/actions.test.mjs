import test from 'node:test';
import assert from 'node:assert/strict';
import {parseControlRequest,chatActionRequest,CHAT_ACTIONS} from './actions.ts';

test('control requests: verb and target, ambiguity kept ambiguous, trades recognised', () => {
  assert.deepEqual(parseControlRequest('Pause the props'), {verb: 'pause', target: 'props'});
  assert.deepEqual(parseControlRequest('please resume PrizePicks picks'), {verb: 'resume', target: 'props'});
  assert.deepEqual(parseControlRequest('Stop the autopilot'), {verb: 'stop', target: 'stocks'});
  assert.deepEqual(parseControlRequest('can you start the stock bot'), {verb: 'start', target: 'stocks'});
  assert.deepEqual(parseControlRequest('pause everything'), {verb: 'pause', target: null});
  assert.equal(parseControlRequest('Buy OXY').verb, 'trade');
  assert.equal(parseControlRequest('how are we doing'), null);
});

test('only allowlisted actions produce a request; stock actions need a well-formed experiment id; nothing can start, resume stocks or trade', () => {
  assert.deepEqual(chatActionRequest('props-pause'), {endpoint: '/api/internal/props/control', body: {action: 'pause', reason: 'Paused from Ask SportsEdge'}});
  assert.deepEqual(chatActionRequest('stock-stop', 'stock-v2-weekly-1'), {endpoint: '/api/internal/paper-auto', body: {action: 'stop', experimentId: 'stock-v2-weekly-1'}});
  assert.equal(chatActionRequest('stock-stop'), null);
  assert.equal(chatActionRequest('stock-stop', '../x'), null);
  for (const bad of ['stock-start', 'stock-resume', 'props-approve', 'buy', '__proto__', 'constructor', null, 7])
    assert.equal(chatActionRequest(bad, 'stock-v2-weekly-1'), null, String(bad));
  for (const a of Object.values(CHAT_ACTIONS)) {
    assert.ok(['pause', 'resume', 'stop'].includes(a.body('stock-v2-weekly-1').action));
    if (a.target === 'stocks') assert.notEqual(a.body('stock-v2-weekly-1').action, 'resume');
  }
});
