// Owner-only recurring PAPER dashboard API: sessions, strict actions and RPC mapping.
// Fake store and synthetic secrets only; no network, no broker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {issueOwnerSession} from './alpaca-owner-session.ts';
import {PaperAutoStoreError} from './paper-auto-store.ts';
import {configuredExperiments,handlePaperAutoGet,handlePaperAutoPost,ownerActionCall,ownerRefFor,
 parseOwnerAction} from './paper-auto-owner.ts';
import {dispatchOwnerResume,startConfigured} from './paper-auto-start.ts';

const SECRET='0123456789abcdef'.repeat(4);
process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=SECRET;
const ENV={SPORTSEDGE_PAPER_AUTO_EXPERIMENT_IDS:'fwd-2026-baseline,fwd-2026-holdrank'};
const URL_='https://sportsedge.example/api/internal/paper-auto';
const STATUS={experimentId:'fwd-2026-baseline',state:'STOPPED',gateMode:'STOPPED',gateReason:'OWNER_STOP',
 gateVersion:3,gateChangedAt:'2026-10-19T11:00:00+00:00',gateChangedBy:'owner',lastCheckAt:null,lastCheckOk:null,
 lastCheckBlockers:[],lastSuccessAt:null,executingRunId:null,leaseExpiresAt:null,unresolvedIntents:0,activeIntents:0,
 unacknowledgedCriticalAlerts:0,brokerEnvironment:'alpaca-paper',modelVersion:'stock-mom252-skip21-trend200-v1',
 decisionWindow:{start:'2026-10-01',end:'2026-12-31'},limits:{capitalLimitCents:120000,maxOrderNotionalCents:15000,
  maxDailyNotionalCents:60000,maxOrdersPerDay:12,maxOpenOrders:5,maxAttemptsPerLeg:3,drawdownStopBps:2500,
  feeReserveCents:0},checkedAt:'2026-10-19T12:00:00+00:00',realMoneyEnabled:false};
const LEDGER={status:STATUS,experiment:{registeredAt:'2026-10-19T11:00:00+00:00',startingEquityCents:100000,
 brokerAccountNumberSuffix:'ETIC',configDigest:'a'.repeat(64)},decisions:[],intents:[],daily:[],alerts:[],runs:[],
 gateEvents:[{fromMode:'NONE',toMode:'STOPPED',reason:'REGISTERED_NOT_AUTHORIZED',actor:'owner',
  at:'2026-10-19T11:00:00+00:00'}],activityCounts:{}};
function fakeStore(reply=(fn,p)=>fn==='ledger'?(p.experiment_id==='fwd-2026-baseline'?LEDGER:
 {experimentId:p.experiment_id,state:'NOT_REGISTERED'}):STATUS){
 const calls=[];
 return {calls,make:()=>({async call(fn,p){calls.push({fn,p});return reply(fn,p);}})};
}
function req(o={}){
 // An explicitly absent cookie or origin must stay absent, so defaults apply only to missing keys.
 const {url=URL_,contentType='application/json',body=''}=o;
 return {url,ownerCookie:'cookie' in o?o.cookie:issueOwnerSession(SECRET),
  origin:'origin' in o?o.origin:'https://sportsedge.example',contentType,text:async()=>body};
}

test('GET requires the owner session and returns strictly re-read ledgers',async()=>{
 const s=fakeStore();
 for(const cookie of [undefined,'v1.forged',issueOwnerSession('f'.repeat(64))]){
  const r=await handlePaperAutoGet(req({cookie}),ENV,s.make);
  assert.equal(r.status,401);
 }
 assert.equal(s.calls.length,0,'no database call before authentication');
 assert.equal((await handlePaperAutoGet(req({url:URL_+'?experiment=x'}),ENV,s.make)).status,400);
 assert.equal((await handlePaperAutoGet(req(),{},s.make)).status,503);
 assert.equal((await handlePaperAutoGet(req(),ENV,()=>{throw new PaperAutoStoreError('NOT_CONFIGURED',true);})).status,503);
 const r=await handlePaperAutoGet(req(),ENV,s.make);
 assert.equal(r.status,200);
 assert.equal(r.headers.get('cache-control'),'private, no-store, max-age=0');
 const body=await r.json();
 assert.equal(body.release.brokerWritesEnabled,false);assert.equal(body.release.realMoneyEnabled,false);
 assert.deepEqual(body.experiments.map(e=>[e.experimentId,e.registered]),
  [['fwd-2026-baseline',true],['fwd-2026-holdrank',false]]);
 assert.ok(!JSON.stringify(body).includes(SECRET));
});

test('GET fails closed on an unverifiable ledger or an unknown store outcome',async()=>{
 const live=fakeStore(()=>({...LEDGER,status:{...STATUS,realMoneyEnabled:true}}));
 assert.equal((await handlePaperAutoGet(req(),ENV,live.make)).status,502);
 const other=fakeStore(()=>LEDGER);
 assert.equal((await handlePaperAutoGet(req(),{SPORTSEDGE_PAPER_AUTO_EXPERIMENT_IDS:'fwd-2026-holdrank'},other.make)).status,
  502,'a ledger for a different experiment is refused');
 const down=fakeStore(()=>{throw new PaperAutoStoreError('STORE_OUTCOME_UNKNOWN',false);});
 const r=await handlePaperAutoGet(req(),ENV,down.make);
 assert.equal(r.status,503);assert.equal((await r.json()).reason,'STORE_OUTCOME_UNKNOWN');
});

test('POST needs the session, the same origin, JSON and one exact action',async()=>{
 const s=fakeStore();
 const stop=JSON.stringify({action:'stop',experimentId:'fwd-2026-baseline'});
 assert.equal((await handlePaperAutoPost(req({cookie:undefined,body:stop}),ENV,s.make)).status,401);
 for(const origin of [null,'https://evil.example','http://sportsedge.example'])
  assert.equal((await handlePaperAutoPost(req({origin,body:stop}),ENV,s.make)).status,403);
 assert.equal((await handlePaperAutoPost(req({contentType:'text/plain',body:stop}),ENV,s.make)).status,400);
 assert.equal((await handlePaperAutoPost(req({url:URL_+'?a=1',body:stop}),ENV,s.make)).status,400);
 for(const body of ['not json','[]',JSON.stringify({action:'arm',experimentId:'fwd-2026-baseline'}),
  JSON.stringify({action:'stop',experimentId:'fwd-2026-other'}),
  JSON.stringify({action:'stop',experimentId:'fwd-2026-baseline',reason:'X'}),
  JSON.stringify({action:'resume',experimentId:'fwd-2026-baseline',expectedGateVersion:3}),
  JSON.stringify({action:'resume',experimentId:'fwd-2026-baseline',expectedGateVersion:0,reconcileRunId:'run-'+'a'.repeat(32)}),
  JSON.stringify({action:'resume',experimentId:'fwd-2026-baseline',expectedGateVersion:'3',reconcileRunId:'run-'+'a'.repeat(32)}),
  JSON.stringify({action:'resume',experimentId:'fwd-2026-baseline',expectedGateVersion:3,reconcileRunId:'run-x'}),
  JSON.stringify({action:'ack_alert',experimentId:'fwd-2026-baseline',alertId:'1'}),
  JSON.stringify({action:'stop',experimentId:'fwd-2026-baseline',pad:'x'.repeat(400)})])
  assert.equal((await handlePaperAutoPost(req({body}),ENV,s.make)).status,400,body.slice(0,80));
 assert.equal(s.calls.length,0,'nothing reaches the database before validation passes');
});

test('owner actions map to exactly one RPC with an opaque owner reference',async()=>{
 const s=fakeStore();
 const r=await handlePaperAutoPost(req({body:JSON.stringify({action:'stop',experimentId:'fwd-2026-baseline'})}),ENV,s.make);
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.status,'recorded');assert.equal(body.state.state,'STOPPED');
 const ref=ownerRefFor(SECRET);
 assert.match(ref,/^owner-[a-f0-9]{32}$/);assert.ok(!ref.includes(SECRET.slice(0,32)));
 assert.equal(ref,ownerRefFor(SECRET));assert.notEqual(ref,ownerRefFor('f'.repeat(64)));
 assert.deepEqual(s.calls,[{fn:'stop',p:{experiment_id:'fwd-2026-baseline',reason:'OWNER_STOP',actor:ref,
  evidence:{source:'owner-dashboard'}}}]);
 const run='run-'+'b'.repeat(32);
 assert.deepEqual(ownerActionCall(parseOwnerAction(JSON.stringify({action:'resume',experimentId:'fwd-2026-holdrank',
  expectedGateVersion:7,reconcileRunId:run}),['fwd-2026-holdrank']),ref),{fn:'resume',p:{experiment_id:'fwd-2026-holdrank',
  owner_ref:ref,expected_gate_version:7,reconcile_run_id:run}});
 assert.deepEqual(ownerActionCall({action:'ack_alert',experimentId:'fwd-2026-holdrank',alertId:4},ref),
  {fn:'ack_alert',p:{experiment_id:'fwd-2026-holdrank',owner_ref:ref,alert_id:4}});
 assert.deepEqual(ownerActionCall({action:'pause',experimentId:'fwd-2026-holdrank'},ref),
  {fn:'pause',p:{experiment_id:'fwd-2026-holdrank',owner_ref:ref}});
 assert.throws(()=>ownerActionCall({action:'stop',experimentId:'fwd-2026-holdrank'},'owner'),/INVALID_OWNER_REF/);
});

test('database refusals and unknown outcomes are reported, never retried by the server',async()=>{
 const refused=fakeStore(()=>{throw new PaperAutoStoreError('PAPER_AUTO_RESUME_STALE_VERSION',true);});
 const body=JSON.stringify({action:'resume',experimentId:'fwd-2026-baseline',expectedGateVersion:2,
  reconcileRunId:'run-'+'c'.repeat(32)});
 const r=await handlePaperAutoPost(req({body}),ENV,refused.make);
 assert.equal(r.status,409);assert.equal((await r.json()).code,'PAPER_AUTO_RESUME_STALE_VERSION');
 assert.equal(refused.calls.length,1);
 const lost=fakeStore(()=>{throw new PaperAutoStoreError('STORE_OUTCOME_UNKNOWN',false);});
 const u=await handlePaperAutoPost(req({body:JSON.stringify({action:'stop',experimentId:'fwd-2026-baseline'})}),ENV,lost.make);
 assert.equal(u.status,503);
 const ub=await u.json();
 assert.equal(ub.status,'outcome_unknown');assert.equal(ub.retrySafe,true);
 assert.equal(lost.calls.length,1,'one attempt only');
});

test('Start dispatches the owner resume workflow only while stopped, and never touches the gate itself',async()=>{
 const body=JSON.stringify({action:'start',experimentId:'fwd-2026-baseline'});
 const sent=[];const ok=async(id)=>{sent.push(id);return {result:'dispatched'};};
 const s=fakeStore();
 const r=await handlePaperAutoPost(req({body}),ENV,s.make,ok);
 assert.equal(r.status,202);assert.equal((await r.json()).status,'started');
 assert.deepEqual(sent,['fwd-2026-baseline']);
 assert.deepEqual(s.calls.map(c=>c.fn),['status'],'only a status read; the workflow\'s database resume arms');
 // Already running: refused before any dispatch.
 const armed=fakeStore(()=>({...STATUS,gateMode:'ARMED',state:'READY'}));
 const a=await handlePaperAutoPost(req({body}),ENV,armed.make,ok);
 assert.equal(a.status,409);assert.equal((await a.json()).code,'ALREADY_RUNNING');assert.equal(sent.length,1);
 // Owner session, same origin and exact fields still apply.
 assert.equal((await handlePaperAutoPost(req({body,cookie:undefined}),ENV,s.make,ok)).status,401);
 assert.equal((await handlePaperAutoPost(req({body,origin:'https://evil.example'}),ENV,s.make,ok)).status,403);
 assert.equal(parseOwnerAction(JSON.stringify({action:'start',experimentId:'fwd-2026-baseline',x:1}),
  ['fwd-2026-baseline']),null);
 assert.equal(sent.length,1);
 // Not configured and GitHub refusals are reported, not hidden.
 const nc=await handlePaperAutoPost(req({body}),ENV,s.make,async()=>({result:'not_configured'}));
 assert.equal(nc.status,503);assert.equal((await nc.json()).status,'start_not_configured');
 const no=await handlePaperAutoPost(req({body}),ENV,s.make,async()=>({result:'refused',code:'GITHUB_403'}));
 assert.equal(no.status,409);assert.equal((await no.json()).code,'GITHUB_403');
});

test('the Start dispatcher sends one fixed workflow_dispatch to this repository only',async()=>{
 const TOKEN='github_pat_'+'A1'.repeat(20);
 assert.equal(startConfigured({}),false);assert.equal(startConfigured({SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN}),true);
 assert.deepEqual(await dispatchOwnerResume('fwd-2026-baseline',{}),{result:'not_configured'});
 const calls=[];
 const fetcher=async(url,init)=>{calls.push({url,init});return new Response(null,{status:204});};
 assert.deepEqual(await dispatchOwnerResume('fwd-2026-baseline',{SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},fetcher),
  {result:'dispatched'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://api.github.com/repos/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-owner.yml/dispatches');
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.redirect,'error');
 assert.deepEqual(JSON.parse(calls[0].init.body),{ref:'main',inputs:{action:'resume',experiment:'fwd-2026-baseline'}});
 const refused=async()=>new Response('{}',{status:403});
 assert.deepEqual(await dispatchOwnerResume('fwd-2026-baseline',{SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},refused),
  {result:'refused',code:'GITHUB_403'});
 let n=0;const lost=async()=>{n++;throw Error('reset');};
 assert.deepEqual(await dispatchOwnerResume('fwd-2026-baseline',{SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},lost),
  {result:'unknown',code:'GITHUB_NETWORK'});
 assert.equal(n,1,'never retried');
 assert.deepEqual(await dispatchOwnerResume('../x',{SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},fetcher),
  {result:'refused',code:'INVALID_EXPERIMENT'});
 assert.equal(calls.length,1);
});

test('configured experiments are few, unique and well formed',()=>{
 assert.deepEqual(configuredExperiments({SPORTSEDGE_PAPER_AUTO_EXPERIMENT_IDS:' fwd-a1, fwd-b2 '}),['fwd-a1','fwd-b2']);
 for(const v of [undefined,'','fwd-a1,fwd-a1','Bad_Id','a,b,c,d,e'.split(',').map(x=>'fwd-'+x).join(','),'fwd-a1,'])
  assert.equal(configuredExperiments({SPORTSEDGE_PAPER_AUTO_EXPERIMENT_IDS:v}),null,String(v));
});

test('the owner API, page and component never reach a broker or expose a credential',()=>{
 const owner=readFileSync(new URL('./paper-auto-owner.ts',import.meta.url),'utf8');
 const route=readFileSync(new URL('../../app/api/internal/paper-auto/route.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../../components/paper-auto-operations.tsx',import.meta.url),'utf8');
 for(const src of [owner,route,ui]){
  assert.ok(!src.includes('alpaca.markets'));assert.ok(!src.includes('ALPACA_PAPER'));
  assert.ok(!src.includes('SERVICE_KEY'));assert.ok(!src.includes('localStorage'));
 }
 assert.ok(route.includes('await connection();'),'GET must not be prerendered');
 assert.ok(!/export async function (PUT|PATCH|DELETE)/.test(route));
 assert.ok(!ui.includes('Submit order'));
 assert.ok(ui.includes('Stop autopilot')&&ui.includes("action:'stop'"),'Stop must stay on the owner page');
});
