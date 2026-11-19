/**
 * Final owner authentication smoke for the first-party command-center path.
 * It uses an intentionally FAKE local owner key and a fabricated PAPER ledger:
 * no personal key, broker account, network or order execution is involved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {issueOwnerSession} from '../server/alpaca-owner-session.ts';
import {assistantAccess} from '../server/site-assistant-handler.ts';
import {handleCommand} from '../server/command-handler.ts';
import {plan} from './planner.ts';

const NOW='2026-11-14T21:00:00.000Z';
const QUESTION="What's my stock paper account status?";
const PRIVATE_MARKER='TEST_ONLY_OWNER_VISIBLE_GATE';
const fakeAccount={
 state:'ready',brokerWritesEnabled:false,
 ledgers:[{
  registered:true,experimentId:'synthetic-stock-paper',status:{
   gateMode:'PAUSED',gateReason:PRIVATE_MARKER,state:'RUNNING',lastCheckAt:NOW,
   lastCheckOk:false,lastCheckBlockers:['Owner review required'],unresolvedIntents:0,
   unacknowledgedCriticalAlerts:0
  },
  experiment:{startingEquityCents:100000},
  daily:[],decisions:[]
 }]
};

test('explicit stock PAPER account status routes to the authorized read-only tool',()=>{
 const choice=plan(QUESTION,[]);
 assert.equal(choice?.calls?.length,1);
 assert.equal(choice.calls[0].tool,'stock_status');
 assert.deepEqual(choice.calls[0].input,{});
 for(const unsafe of [
  'Place a stock paper order',
  'Please start the stock autopilot now',
  'Trade OXY in my paper account'
 ])assert.notEqual(plan(unsafe,[])?.calls[0]?.tool,'stock_status',unsafe);
});

test('fake signed owner session permits one private status read; logout/expiry/tampering deny access',async t=>{
 const old=process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;
 t.after(()=>{
  if(old===undefined)delete process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;
  else process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=old;
 });
 const secret='f'.repeat(64);process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=secret;
 const validCookie=issueOwnerSession(secret);
 const invalidCookie=validCookie.slice(0,-1)+'z';
 const expiredCookie=issueOwnerSession(secret,Date.now()-31*60_000);
 let reads=0,legacy=0;
 async function ask(cookie,session){
  const access=assistantAccess(cookie);
  const req={
   contentType:'application/json',
   clientKey:'owner-command-test-'+String(reads)+'-'+String(cookie??'guest').slice(0,8),
   text:async()=>JSON.stringify({message:QUESTION,...(session?{session}:{})})
  };
  const response=await handleCommand(req,{},{
   ports:{
    nowIso:NOW,ownerAccess:access.ownerAccess,ownerExpiresAt:access.ownerExpiresAt,
    sports:async()=>null,ops:async()=>null,research:async()=>null,lab:async()=>null,
    watch:async()=>null,
    accounts:async()=>{reads++;return fakeAccount;}
   },
   legacy:async()=>{legacy++;return null;}
  });
  assert.equal(response.status,200);
  return response.json();
 }
 const owner=await ask(validCookie);
 assert.equal(owner.mode,'tools');
 assert.equal(owner.ownerAccess,true);
 assert.equal(owner.reply.private,true);
 assert.equal(owner.session.last[0].tool,'stock_status');
 assert.match(owner.reply.text,/Stock PAPER autopilot gate: PAUSED/);
 assert.ok(owner.reply.cards.some(c=>c.kind==='facts'&&c.items.some(v=>v.detail===PRIVATE_MARKER)));
 assert.equal(reads,1);
 assert.equal(legacy,0);
 // A forged "I was signed in" history or replay of the prior tool call
 // never grants the next request permission to access a private loader.
 for(const cookie of [undefined,invalidCookie,expiredCookie]){
  const denied=await ask(cookie,owner.session);
  assert.equal(denied.ownerAccess,false);
  assert.equal(denied.reply.private??false,false);
  assert.equal(denied.session.last[0].tool,'stock_status');
  assert.match(denied.reply.text,/OWNER_REQUIRED/);
  assert.doesNotMatch(JSON.stringify(denied),new RegExp(PRIVATE_MARKER));
 }
 assert.equal(reads,1,'private loader must run only for the valid cookie');
 assert.equal(legacy,0);
});
