import test from 'node:test';
import assert from 'node:assert/strict';
import {theOddsApiClient,ProviderError} from './props-odds-client.ts';
import {paidCall} from './props-cycle.ts';

// Synthetic TEST-ONLY key and replies; nothing here reaches the network.
const KEY='testkey'+'0'.repeat(25);
const reply=(body,{status=200,headers={}}={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});
function client(fn){const calls=[];return {calls,c:theOddsApiClient(KEY,async(url,init)=>{calls.push({url:String(url),init});return fn(url,init);},()=>'2026-11-14T20:00:00.000Z')};}
async function code(p){try{await p;}catch(e){assert.ok(e instanceof ProviderError);assert.doesNotMatch(e.message,new RegExp(KEY));return e.code;}assert.fail('expected a ProviderError');}

test('a provider timeout or transport failure is a ProviderError that never carries the key or URL', async () => {
  const {c,calls} = client(() => { const e = new Error('timed out https://api.the-odds-api.com/?apiKey=' + KEY); e.name = 'TimeoutError'; throw e; });
  assert.equal(await code(c.eventOdds('abcdef123456')), 'TRANSPORT_OR_TIMEOUT');
  assert.equal(calls.length, 1, 'one attempt only: provider calls are never retried');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'every request has a timeout signal');
  assert.equal(calls[0].init.redirect, 'error');
});

test('invalid provider responses: non-JSON success, oversized body; an error status with a non-JSON body is a plain failed reply', async () => {
  assert.equal(await code(client(() => reply('<html>maintenance</html>')).c.events()), 'BODY_NOT_JSON');
  assert.equal(await code(client(() => reply('x'.repeat(3_000_001))).c.events()), 'BODY_TOO_LARGE');
  const r = await client(() => reply('Bad Gateway', {status: 502})).c.events();
  assert.deepEqual([r.ok, r.httpStatus, r.body], [false, 502, null]);
});

test('an empty event list and a 200 with no lines are replies, not errors (the tick records "no lines", never invents any)', async () => {
  const r = await client(() => reply([])).c.events();
  assert.deepEqual([r.ok, r.body], [true, []]);
  const o = await client(() => reply({id: 'abcdef123456', bookmakers: []})).c.eventOdds('abcdef123456');
  assert.deepEqual(o.body.bookmakers, []);
});

test('usage headers are read strictly; malformed counts are unknown, not zero', async () => {
  const r = await client(() => reply([], {headers: {'x-requests-remaining': '480', 'x-requests-used': '20', 'x-requests-last': 'three'}})).c.events();
  assert.deepEqual(r.usage, {remaining: 480, used: 20, last: null});
});

test('a malformed key or event id is refused before any request is made', async () => {
  assert.throws(() => theOddsApiClient('short', async () => assert.fail('no request')), {code: 'INVALID_KEY_FORMAT'});
  const {c, calls} = client(() => reply({}));
  assert.equal(await code(Promise.resolve().then(() => c.eventOdds('../../sports'))), 'INVALID_EVENT_ID');
  assert.equal(await code(Promise.resolve().then(() => c.events({from: 'yesterday', to: 'x'}))), 'INVALID_WINDOW');
  assert.equal(calls.length, 0);
});

// paidCall: the only path from the workers to a paid provider endpoint.
function fakeStore({refuse = false} = {}) {
  const rpcs = [], inserts = [];
  return {rpcs, inserts, store: {
    async rpc(name, args) { rpcs.push({name, args}); if (name === 'props_reserve_credits') { if (refuse) { const {PropsStoreError} = await import('./props-store.ts'); throw new PropsStoreError('BUDGET_EXHAUSTED', true); } return 41; } return null; },
    async insert(table, rows) { inserts.push({table, rows}); return [{id: 7}]; },
    async select() { return []; },
  }};
}

test('provider timeout after the credit reservation: no retry, reservation kept (counted), no raw evidence, no usage invented', async () => {
  const f = fakeStore(); let attempts = 0;
  const r = await paidCall({store: f.store}, 1, 'event_odds', 'abcdef123456', 3, async () => { attempts++; throw new ProviderError('TRANSPORT_OR_TIMEOUT'); });
  assert.deepEqual(r, {kind: 'provider_error', code: 'TRANSPORT_OR_TIMEOUT'});
  assert.equal(attempts, 1);
  assert.deepEqual(f.rpcs.map(x => x.name), ['props_reserve_credits']);
  assert.equal(f.inserts.length, 0);
});

test('credits exhausted: the database refuses the reservation and the provider is never called', async () => {
  const f = fakeStore({refuse: true});
  const r = await paidCall({store: f.store}, 1, 'event_odds', 'abcdef123456', 3, async () => assert.fail('provider must not be called'));
  assert.equal(r.kind, 'refused');
  assert.equal(r.code, 'BUDGET_EXHAUSTED');
});
