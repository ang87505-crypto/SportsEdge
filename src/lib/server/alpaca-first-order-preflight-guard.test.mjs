import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../../app/api/internal/alpaca-paper/preflight/route.ts',import.meta.url),'utf8');
const reader=readFileSync(new URL('./alpaca-first-order-preflight.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../../components/alpaca-paper-first-test-draft.tsx',import.meta.url),'utf8');
test('First-order preflight requires owner and cannot submit or approve',()=>{
 for(const v of ['validOwnerSession(','OWNER_COOKIE','ownerSecret()',
  "brokerOrderSubmitted:false","executionPermitted:false"])assert.ok(route.includes(v));
 assert.ok(route.includes('export async function GET'));
 for(const method of ['POST','PUT','PATCH','DELETE'])
  assert.ok(!route.includes('export async function '+method));
 assert.ok(reader.includes("method:'GET'"));
 assert.ok(!reader.includes('https://api.alpaca.markets'));
 assert.ok(!reader.includes('fetcher(PAPER+\'/v2/orders\''));
 assert.ok(!reader.includes('NEXT_PUBLIC_'));
 assert.ok(ui.includes('Check Alpaca PAPER preflight'));
});
