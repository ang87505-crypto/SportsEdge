import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const order=read('./alpaca-paper-one-order.tsx');
const readiness=read('./alpaca-paper-automation-readiness.tsx');
const dashboard=read('./alpaca-paper-dashboard.tsx');
const performance=read('./alpaca-paper-performance-evidence.tsx');
const manifest=read('../lib/stocks/paper-automation-release.ts');

test('failed status checks invalidate the old release, old stage and approval',()=>{
 for(const expected of ['setReleased(false);setState(null);setStatusCheckedAt(null)',
  'setCheck(null);setApproved(false)','parseOneOrderCheck(body)',
  "state?.gateHalted===true&&state.status==='not_authorized'"])
  assert.ok(order.includes(expected),expected);
});
test('frontend reports safety blockers and rejects unverified broker responses',()=>{
 for(const expected of ['parsePaperPreflight(body,ticker,limit)',
 'explainPaperRequestFailure(response.status,body','explainPaperBlocker(b)'])
  assert.ok(order.includes(expected),expected);
});
test('readiness shows separate one-order acceptance rather than false no-order claim',()=>{
 assert.match(readiness,/First owner-authorized PAPER order/);
 assert.match(readiness,/Unattended scheduled paper trading/);
 assert.doesNotMatch(readiness,/No manual or automatic paper-order button exists/);
 assert.match(dashboard,/AlpacaPaperPerformanceEvidence/);
 assert.match(performance,/Strategy returns not established/);
 assert.doesNotMatch(performance,/return\s*:\s*[0-9]/);
});
test('no client component adds broker credentials or live-money release',()=>{
 for(const file of [order,readiness,dashboard,performance]){
  assert.ok(!file.includes('ALPACA_PAPER_SECRET_KEY'));
  assert.ok(!file.includes('NEXT_PUBLIC_'));
  assert.ok(!file.includes('api.alpaca.markets/v2/orders'));
 }
 for(const v of ['placeOrdersEnabled:false','scheduledOrdersEnabled:false',
  'realMoneyEnabled:false','manualOwnerOneShotEnabled:false'])
  assert.ok(manifest.includes(v));
});
