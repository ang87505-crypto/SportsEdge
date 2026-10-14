import test from 'node:test';
import assert from 'node:assert/strict';
import {draftBrokerPaperOrder,stagePaperOrderForReview,FIXED_ALPACA_PAPER_ORDERS_ENDPOINT}
 from './paper-broker-order-contract.ts';
const intent=()=>({
 mode:'offline_preview_only',executionPermitted:false,
 intentId:'preview-'+'a'.repeat(32),symbol:'AAPL',side:'buy',
 orderType:'limit',timeInForce:'day',shares:3,limitCents:2501,notionalCents:7503,
 sourceDigest:'f'.repeat(64),modelVersion:'fixture',signalId:'s'
});
test('fixed PAPER-only envelope and deterministic client id, no HTTP network call',()=>{
 let called=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{called++;throw Error('NETWORK NOT PERMITTED');};
 try{
  const draft=draftBrokerPaperOrder(intent());
  assert.equal(draft.target,FIXED_ALPACA_PAPER_ORDERS_ENDPOINT);
  assert.equal(draft.target,'https://paper-api.alpaca.markets/v2/orders');
  assert.equal(draft.method,'POST');
  assert.equal(draft.authorization,'NOT_GRANTED');
  assert.equal(draft.request.side,'buy');
  assert.equal(draft.request.type,'limit');
  assert.equal(draft.request.time_in_force,'day');
  assert.equal(draft.request.qty,'3');
  assert.equal(draft.request.limit_price,'25.01');
  assert.match(draft.request.client_order_id,/^sepaper_[a-f0-9]{32}$/);
  assert.deepEqual(draft,draftBrokerPaperOrder(intent()));
  assert.equal(Object.isFrozen(draft),true);
  const staged=stagePaperOrderForReview(intent());
  assert.equal(staged.canSubmit,false);
  assert.equal(staged.safeToSchedule,false);
  assert.equal(staged.requiresOwnerApproval,true);
  assert.equal(called,0);
 }finally{globalThis.fetch=originalFetch;}
});
test('all malformed, duplicate risk and live-style candidates fail closed',()=>{
 for(const bad of [
  {...intent(),executionPermitted:true},
  {...intent(),mode:'real_trade'},
  {...intent(),symbol:'AAPL?escape'},
  {...intent(),side:'sell'},
  {...intent(),orderType:'market'},
  {...intent(),timeInForce:'gtc'},
  {...intent(),intentId:'unverified'},
  {...intent(),shares:0},
  {...intent(),shares:1001},
  {...intent(),limitCents:0},
  {...intent(),notionalCents:7504},
  {...intent(),notionalCents:20000,shares:10,limitCents:2000},
  null
 ])assert.throws(()=>stagePaperOrderForReview(bad));
});
