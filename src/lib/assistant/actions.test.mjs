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

test('questions, quoted commands, negations and future requests cannot propose owner mutations',()=>{
 for(const message of [
  'Why did you stop the stock bot?',
  'How do I pause props?',
  'What happens if I stop everything?',
  'Do not stop the stock bot',
  "Don't pause PrizePicks",
  'Please never start stock trading',
  'Stop stock autopilot tomorrow',
  'Pause picks after the game',
  'Could you stop stocks if the market drops?',
  'Tell me to pause the props',
  'I wrote stop the bot in a note',
  'did the assistant buy OXY'
 ])assert.equal(parseControlRequest(message),null,message);
});
test('explicit immediate owner requests still parse but never execute from parsing',()=>{
 for(const [message,verb,target] of [
  ['Please pause PrizePicks now','pause','props'],
  ['Could you stop stock autopilot?','stop','stocks'],
  ['Can you resume picks?','resume','props'],
  ['Turn off the stock autopilot','stop','stocks'],
  ['Can you start stock bot','start','stocks'],
  ['pause everything','pause',null],
  ['buy OXY','trade',null]
 ]){
  const parsed=parseControlRequest(message);
  assert.deepEqual(parsed,{verb,target},message);
 }
 assert.equal(parseControlRequest('x'.repeat(301)),null);
});
