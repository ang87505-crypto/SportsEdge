// The owner's operational questions (2026-11-12 checklist): routing, and answers built only from receipts.
// Synthetic TEST-ONLY ledger and monitor status; no network, no provider, no broker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {routeQuestion} from './domain.ts';
import {understand} from './understand.ts';
import {answer} from './answer.ts';
import {makeRaw} from './fixtures.mjs';
import {buildView} from '../props/dashboard-view.ts';
import {slotStatus} from '../props/slot-status.ts';
import {handleSiteAssistant} from '../server/site-assistant-handler.ts';
import {resetAssistantCache} from '../server/assistant-handler.ts';

const NOW='2026-11-11T23:30:00.000Z'; // 4:30 PM MST
const run=(id,slot,outcome,summary={},status='completed')=>({id,kind:'collect',slot_key:slot,status,outcome,
 started_at:slot.slice(8)+':12:00Z',finished_at:slot.slice(8)+':12:30Z',start_delay_seconds:120,summary});

function data(raw){
 return {nowIso:NOW,pp:buildView(raw,'prizepicks'),p6:buildView(raw,'pick6'),control:raw.control,nextCollect:'2026-11-12T19:10:00Z',
  nextSettle:'2026-11-12T09:20:00Z',slots:slotStatus(raw.runs,NOW,1,raw.runCounts??null),creditsRollOffAt:'2026-11-12T20:11:00Z'};
}
const ask=(q,d)=>answer(understand(q,null,[],NOW),d);

test('every question on the owner checklist reaches a domain instead of "which do you mean?"',()=>{
 for(const [q,domain,topic] of [
  ['Are sports picks available tonight?','sports'],["Why didn't we make any picks?",'sports'],['What player props qualified today?','sports'],
  ['How many virtual entries were created?','sports'],['What were our recent betting results?','sports'],
  ['When will the next collection occur?','sports'],['Is the Odds API budget exhausted?','sports'],
  ['Is stock PAPER trading enabled?','stocks'],['Did Alpaca actually submit any orders?','stocks'],
  ['What are the current holdings and PAPER results?','stocks','holdings'],['Which strategy is performing best?','research'],
  ['What workflows failed recently?','all','jobs'],['What requires my approval?','all','approvals'],['Is everything running automatically?','all'],
 ]){
  const r=routeQuestion(q,null);
  assert.equal(r.domain,domain,q);
  if(topic)assert.equal(r.topic,topic,q);
 }
 for(const [q,intent] of [["Why didn't we make any picks?",'nopicks'],['Why no picks today?','nopicks'],['Is the Odds API budget exhausted?','budget'],
  ['How many credits are left?','budget'],['What player props qualified today?','picks'],['When will the next collection occur?','future']])
  assert.equal(understand(q,null,['Devin Booker'],NOW).intent,intent,q);
});

test('"why no picks" explains each of today\'s slots from its receipt: dropped, budget, entry rules',()=>{
 const raw=makeRaw({nowIso:NOW,tonight:false});
 raw.runs=[
  run(41,'collect-2026-11-11T19','COMPLETED',{entries:{prizepicks:{entries:[],noEntryReason:'TOO_FEW_DISTINCT_GAMES'},pick6:{entries:[],noEntryReason:'NO_QUALIFYING_PICKS'}}}),
  run(42,'collect-2026-11-11T22','BUDGET_EXHAUSTED'),
 ];
 raw.runCounts={'41':{decisions:38,qualifyingPicks:1,entries:0}};
 const r=ask("Why didn't we make any picks?",data(raw));
 assert.match(r.text,/^No picks are queued for tonight\./);
 assert.match(r.text,/3:10 PM MST: skipped: the rolling 24-hour Odds API credit cap was already used/);
 assert.match(r.text,/12:10 PM MST: collected — 38 line decisions, 1 qualifying pick, 0 entries\. No entry: PrizePicks — Qualifying picks came from fewer different games/);
 assert.match(r.text,/DraftKings Pick6 — No line met the pick rules/);
 assert.match(r.text,/Next collection .* \(planned, not yet run\)/);
 // A slot with no run is reported as such, never as "no qualifying picks".
 raw.runs=[run(42,'collect-2026-11-11T22','BUDGET_EXHAUSTED')];
 const dropped=ask('Why no picks today?',data(raw));
 assert.match(dropped.text,/12:10 PM MST: no run recorded/);
 assert.doesNotMatch(dropped.text,/qualifying pick/);
});

test('"why no picks" when paused, or before any slot is due, says so plainly',()=>{
 const raw=makeRaw({nowIso:NOW,tonight:false,control:{state:'PAUSED',reason:'Owner pause',changed_at:'2026-11-11T00:00:00Z'}});
 assert.match(ask('Why no picks?',data(raw)).text,/^Picking is paused \(Owner pause\)/);
 const early=makeRaw({nowIso:'2026-11-11T15:00:00.000Z',tonight:false});
 const d={...data(early),nowIso:'2026-11-11T15:00:00.000Z',slots:slotStatus(early.runs,'2026-11-11T15:00:00.000Z',1,null)};
 assert.match(answer(understand('Why no picks?',null,[],d.nowIso),d).text,/No collection slot has come due yet today/);
});

test('budget answers use the worker\'s own rule and name when credits roll off; never claims credits it cannot see',()=>{
 const raw=makeRaw({nowIso:NOW});
 raw.credits=[{id:1,credits:1,reserved_at:'2026-11-11T20:11:00Z'},{id:2,credits:3,reserved_at:'2026-11-11T20:11:05Z'},{id:3,credits:3,reserved_at:'2026-11-11T20:11:10Z'}];
 const full=ask('Is the Odds API budget exhausted?',data(raw));
 assert.match(full.text,/^Exhausted for now: the rolling 24-hour cap is used up/);
 assert.match(full.text,/7 of 7 credits used in the last 24 hours and 7 of 200 in 30 days \(policy props-budget-v2\)/);
 assert.match(full.text,/roll off Thu, Nov 12, 1:11 PM MST/);
 assert.match(full.text,/485 credits remaining \(reserve floor 60\)/);
 raw.credits=raw.credits.slice(0,1);
 assert.match(ask('How many credits are left?',data(raw)).text,/^Not exhausted: a collection can still spend \(it needs up to 4\)/);
 raw.providerRemaining=null;raw.credits=[];
 assert.match(ask('credits left?',data(raw)).text,/has not reported its remaining credits yet/);
});

test('approvals and failed workflows come from the monitor only; no monitor means no claim',async()=>{
 resetAssistantCache();
 const status={schemaVersion:'ops-status-v1',generatedAt:'2026-11-11T23:25:00Z',monitorRun:null,overall:{state:'WARN',attention:['research-collect']},
  jobs:[{id:'research-collect',label:'Strategy research',area:'research',required:true,status:'RAN_LATE',detail:'ran 7.3 h late',historyUrl:'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/research-collect.yml',
   lastRun:null,lastSuccess:null,lastFailure:null,running:null,slots7d:{due:2,missed:1,lastMissedAt:null},nextPlanned:[],note:null}],
  blockers:[{id:'stock-first-session',text:'PR #102 (stock PAPER orders) is not released.',action:'See docs/AUTOMATION_OPERATIONS_2026_11_10.md.'}],
  site:{url:'x',checkedAt:NOW,ok:true,checks:[]},evidence:{},credentials:[]};
 const ports={access:{ownerAccess:false,ownerExpiresAt:null},sports:async()=>{throw new Error('not used');},
  accounts:async()=>{throw new Error('not used');},broker:async()=>{throw new Error('not used');},research:async()=>{throw new Error('not used');},
  ops:async()=>({mode:'live',checkedAt:NOW,monitorStale:false,status})};
 const q=async(message,p=ports)=>(await (await handleSiteAssistant({contentType:'application/json',text:async()=>JSON.stringify({message,context:null})},{},NOW,p)).json()).reply;
 const appr=await q('What requires my approval?');
 assert.match(appr.text,/1 item needs you:\n- PR #102 \(stock PAPER orders\) is not released\. Next step: See docs\/AUTOMATION_OPERATIONS/);
 const wf=await q('What workflows failed recently?');
 assert.match(wf.text,/Strategy research: Ran late/);
 status.blockers=[];
 assert.match((await q('What needs my approval?')).text,/lists nothing waiting on you/);
 const {ops,...noOps}=ports;void ops;
 assert.match((await q('What requires my approval?',noOps)).text,/cannot list what is waiting on you/);
});
