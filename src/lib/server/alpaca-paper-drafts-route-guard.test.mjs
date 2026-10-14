import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const path=new URL('../../app/api/internal/alpaca-paper/drafts/route.ts',import.meta.url);
const route=readFileSync(path,'utf8');
const adapter=readFileSync(new URL('./alpaca-staging-draft-review.ts',import.meta.url),'utf8');
const component=readFileSync(new URL('../../components/alpaca-paper-first-test-draft.tsx',import.meta.url),'utf8');
test('Only owner-cookie protected GET, no broker path or mutations',()=>{
 assert.match(route,/validOwnerSession\(/);
 assert.match(route,/OWNER_COOKIE/);
 assert.match(route,/ownerSecret\(\)/);
 assert.match(route,/listUnapprovedStagingDrafts\(/);
 assert.match(route,/export async function GET/);
 for(const method of ['POST','PUT','PATCH','DELETE'])
  assert.ok(!route.includes('export async function '+method));
 for(const content of [route,adapter])
  for(const broker of ['https://paper-api.alpaca.markets','https://api.alpaca.markets'])
   assert.ok(!content.includes(broker));
 assert.match(route,/brokerOrderSubmitted:false/);
 assert.match(route,/executionPermitted:false/);
 assert.match(component,/Review saved staging drafts/);
 assert.ok(!component.includes('NEXT_PUBLIC_'));
});
