import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OWNER_COOKIE,OWNER_SESSION_SECONDS,secureTextEquals,issueOwnerSession,validOwnerSession,ownerSecret} from './alpaca-owner-session.ts';

const key='0123456789abcdef'.repeat(4);
const other='fedcba9876543210'.repeat(4);
const now=1_800_000_000_000;
test('owner-only key is independently configured, not the Alpaca API or diagnostic bearer',()=>{
  const previous=process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;
  try {
    delete process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;
    assert.equal(ownerSecret(),null);
    process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY='not-a-secure-owner-key';
    assert.equal(ownerSecret(),null);
    process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=key;
    assert.equal(ownerSecret(),key);
    assert.notEqual(OWNER_COOKIE,'SPORTSEDGE_ALPACA_PAPER_READ_TOKEN');
    assert.equal(OWNER_SESSION_SECONDS,1800);
  } finally {
    if(previous===undefined)delete process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;
    else process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=previous;
  }
});
test('signed cookie expires after 30m, rejects tampering and key rotation',()=>{
  const session=issueOwnerSession(key,now);
  assert.ok(validOwnerSession(session,key,now));
  assert.ok(validOwnerSession(session,key,now+1799_000));
  assert.ok(!validOwnerSession(session,key,now+1_800_000));
  assert.ok(!validOwnerSession(session,other,now));
  assert.ok(!validOwnerSession(session.slice(0,-1)+(session.at(-1)==='a'?'b':'a'),key,now));
  assert.ok(!validOwnerSession(session,key,now-1));
  assert.ok(!validOwnerSession(null,key,now));
  assert.ok(!validOwnerSession('wrong',key,now));
});
test('owner login comparison requires full, exact secret',()=>{
  assert.equal(secureTextEquals(key,key),true);
  assert.equal(secureTextEquals(key,key+'0'),false);
  assert.equal(secureTextEquals(key,other),false);
});
test('owner viewer is cookie protected, no-store and has no broker mutation route',()=>{
  const sessionRoute=readFileSync(new URL('../../app/api/internal/alpaca-paper/session/route.ts',import.meta.url),'utf8');
  const viewRoute=readFileSync(new URL('../../app/api/internal/alpaca-paper/view/route.ts',import.meta.url),'utf8');
  const client=readFileSync(new URL('../../components/alpaca-paper-dashboard.tsx',import.meta.url),'utf8');
  assert.ok(sessionRoute.includes('sameOrigin(req)'));
  assert.ok(sessionRoute.includes('httpOnly:true,secure:true,sameSite:\'strict\''));
  assert.ok(viewRoute.includes('validOwnerSession('));
  assert.ok(viewRoute.includes('private, no-store'));
  assert.ok(!viewRoute.includes('export async function POST'));
  assert.ok(!viewRoute.includes('export async function DELETE'));
  assert.ok(!client.includes('localStorage'));
  assert.ok(!client.includes('NEXT_PUBLIC_'));
  assert.ok(!client.includes('SPORTSEDGE_ALPACA_PAPER_READ_TOKEN'));
  assert.ok(!client.includes('APCA-API-SECRET-KEY'));
});
