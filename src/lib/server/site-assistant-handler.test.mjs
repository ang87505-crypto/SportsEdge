import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSiteAssistant,sitePorts,assistantAccess} from './site-assistant-handler.ts';
import {issueOwnerSession} from './alpaca-owner-session.ts';
import {parseOwnerAccess} from '../assistant/session.ts';
import {resetAssistantCache} from './assistant-handler.ts';
import {makeRaw} from '../assistant/fixtures.mjs';
import {routeQuestion} from '../assistant/domain.ts';
import {stockAnswer,researchAnswer} from '../assistant/stock-answer.ts';
import {loadStockResearch,resetStockResearchCache} from './stock-research-load.ts';
import {parseStockResearch} from '../research/stock-summary.ts';
import saved from '../../data/research/stock-strategy-summary.json' with {type:'json'};
const NOW='2026-11-09T23:00:00Z';
const ENV={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
function setup(owner=false){
 const calls={sports:0,accounts:0,broker:0,research:0};
 return {calls,ports:{access:{ownerAccess:owner,ownerExpiresAt:owner?Date.parse(NOW)+60000:null},
  sports:async()=>{calls.sports++;return makeRaw({nowIso:NOW});},
  accounts:async()=>{calls.accounts++;return {state:'ready',ledgers:[],brokerWritesEnabled:false};},
  broker:async()=>{calls.broker++;return {state:'unavailable'};},
  research:async()=>{calls.research++;return {summary:saved,mode:'saved',checkedAt:NOW};}}};
}
async function ask(message,s,context=null,env=ENV){
 const r=await handleSiteAssistant({contentType:'application/json',text:async()=>JSON.stringify({message,context})},env,NOW,s.ports);
 return {http:r.status,...await r.json()};
}
function mark(session,equityCents,extra={}){
 return {session,capturedAt:session+'T22:00:00Z',equityCents,cashCents:equityCents,longMarketValueCents:0,
 externalFlowCents:0,feesCents:0,dividendsCents:0,benchmarkSymbol:'SPY',benchmarkClose:'500',
 benchmarkSource:'TEST_ONLY',contaminated:false,cashReconciled:true,cashUnexplainedCents:'0',unrealizedPlCents:300,...extra};
}
function account(){
 return {state:'ready',brokerWritesEnabled:false,ledgers:[{experimentId:'TEST-weekly',registered:true,
  experiment:{registeredAt:'2026-11-01T00:00:00Z',startingEquityCents:100000},
  status:{state:'PAUSED',gateMode:'PAUSED',gateReason:'TEST_PAUSE',checkedAt:NOW,modelVersion:'stock-mom252-skip21-trend200-v1',
   lastCheckBlockers:['TEST_RECONCILE_REQUIRED'],unresolvedIntents:0,unacknowledgedCriticalAlerts:1},
  daily:[mark('2026-11-06',101000),mark('2026-11-09',102000)],runs:[],
  decisions:[{session:'2026-11-09',decisionAt:NOW,outcome:'TARGETS',targets:['OXY']}],intents:[]}]};
}
test('domain routing precedes sports interpretation',()=>{
 for(const [text,domain,topic] of [
  ['Stock bot status','stocks','automation'],['What did the stock model learn?','research','explain'],
  ["Tonight's picks",'sports','picks'],['How did sports and stocks do yesterday?','all','performance'],
  ['Why did the Berkshire strategy fail?','research','explain'],['What stocks do I hold?','stocks','holdings'],
  ['Are we copying QMOM yet?','research','overview'],['Is everything running?','all','health'],
  ['Which strategy beat SPY?','research','performance'],['Buy OXY','stocks','controls'],
 ]){
  const r=routeQuestion(text,null);assert.equal(r.domain,domain,text);assert.equal(r.topic,topic,text);
 }
});
test('follow-ups preserve domain and candidate, while explicit topic switches override them',()=>{
 const c={domain:'research',strategyId:'berkshire-13f-top5-paper-v1'};
 assert.equal(routeQuestion('Why?',c).strategyId,c.strategyId);
 assert.equal(routeQuestion('Why?',c).domain,'research');
 assert.equal(routeQuestion("Tonight's sports picks",c).domain,'sports');
 assert.equal(routeQuestion('How are we doing?',null).domain,null);
 assert.equal(routeQuestion('asdf',c).domain,null);
});
test('research works without sports configuration or owner access',async()=>{
 const s=setup();
 const r=await ask('Berkshire research results',s,null,{});
 assert.equal(r.status,'ok');assert.match(r.reply.text,/Berkshire filing follower: FAILS/);
 const next=await ask('Why?',s,r.reply.context,{});
 assert.match(next.reply.text,/risk-adjusted return did not beat SPY/);
 assert.deepEqual(s.calls,{sports:0,accounts:0,broker:0,research:2});
});
test('forged context never grants private access or invokes private loaders',async()=>{
 const s=setup(false);
 const r=await ask('Stock account balance',s,{domain:'stocks',topic:'performance'});
 assert.match(r.reply.text,/Sign in/);assert.equal(r.ownerAccess,false);
 assert.equal(s.calls.accounts,0);assert.equal(s.calls.broker,0);
 const res=await handleSiteAssistant({contentType:'application/json',text:async()=>JSON.stringify({message:'stocks',ownerAccess:true})},ENV,NOW,s.ports);
 assert.equal(res.status,400);
});
test('combined requests survive one source failure and keep accounts separate',async()=>{
 resetAssistantCache();const s=setup(true);
 s.ports.sports=async()=>{throw Error('TEST_ONLY_DOWN');};
 const r=await ask('How did sports and stocks do yesterday?',s);
 assert.match(r.reply.text,/can't read the records/);assert.match(r.reply.text,/Stock account/);
 assert.match(r.reply.text,/Stock research/);assert.match(r.reply.text,/NONE QUALIFIES/);
 assert.equal(r.reply.private,true);assert.equal(s.calls.accounts,1);assert.equal(s.calls.broker,0);
});
test('private account reads are fresh, isolated, and independent from sports data',async()=>{
 const s=setup(true);
 await ask('Stock results',s,null,{});await ask('Stock results',s,null,{});
 assert.equal(s.calls.accounts,2);assert.equal(s.calls.sports,0);assert.equal(s.calls.research,0);
 await ask('What stocks do I hold?',s);assert.equal(s.calls.broker,1);
});
test('explicit sports questions retain existing answers and clear stock follow-up context',async()=>{
 resetAssistantCache();const s=setup();
 const r=await ask("Tonight's sports picks",s,{domain:'research',strategyId:'berkshire-13f-top5-paper-v1'});
 assert.match(r.reply.text,/Booker/);assert.equal(r.reply.context.domain,'sports');
 assert.match((await ask('Why?',s,r.reply.context)).reply.text,/Booker/);
 assert.equal(s.calls.research,0);assert.equal(s.calls.accounts,0);
});
test('help and ambiguous questions need no source reads; malformed contexts are refused',async()=>{
 const s=setup();
 assert.match((await ask('How are we doing?',s)).reply.text,/Do you mean/);
 assert.match((await ask('Help',s)).reply.text,/stock paper-account/);
 assert.deepEqual(s.calls,{sports:0,accounts:0,broker:0,research:0});
 assert.equal((await ask('stocks',s,{domain:'admin'})).http,400);
});
test('account profit matches the existing dashboard calculation and contamination boundary',()=>{
 const a=account(),r=stockAnswer({domain:'stocks',topic:'performance'},a,null,NOW);
 assert.match(r.text,/\+\$20\.00/);assert.match(r.text,/2\.0%/);assert.equal(r.private,true);
 assert.match(r.cards[0].items[0].detail,/Realized: \+\$17\.00; unrealized: \+\$3\.00/);
 a.ledgers[0].daily[1].contaminated=true;
 assert.match(stockAnswer({domain:'stocks',topic:'performance'},a,null,NOW).text,/Measurement ended/);
});
test('date-range answers name actual mark boundaries and never infer zero from missing marks',()=>{
 assert.match(stockAnswer({domain:'stocks',topic:'performance'},account(),null,NOW,'today').text,/from 2026-11-06 to 2026-11-09/);
 assert.match(stockAnswer({domain:'stocks',topic:'performance'},account(),null,NOW,'yesterday').text,/Missing marks do not mean zero/);
 const a=account();a.ledgers[0].daily[1].cashReconciled=false;
 assert.match(stockAnswer({domain:'stocks',topic:'performance'},a,null,NOW,'today').text,/no complete verified/);
 a.ledgers[0].daily=[];
 assert.match(stockAnswer({domain:'stocks',topic:'performance'},a,null,NOW).text,/no verified/);
});
test('plans do not become holdings or fills, and chat actions remain read-only',()=>{
 assert.match(stockAnswer({domain:'stocks',topic:'picks'},account(),null,NOW).text,/plan, not proof/);
 assert.match(stockAnswer({domain:'stocks',topic:'holdings'},account(),{state:'unavailable'},NOW).text,/cannot verify/);
 assert.match(stockAnswer({domain:'stocks',topic:'controls'},account(),null,NOW).text,/has not submitted/);
});
test('armed account and successful worker never imply trading while the release is off',async()=>{
 const a=account(),l=a.ledgers[0];
 l.status={...l.status,state:'READY',gateMode:'ARMED',lastCheckBlockers:[],unacknowledgedCriticalAlerts:0};
 l.runs=[{kind:'execute',status:'succeeded',startedAt:NOW,finishedAt:NOW,summary:'SHADOW_PLAN_ONLY'}];
 const s=setup(true);s.ports.accounts=async()=>a;
 const r=await ask('Stock bot status',s);
 assert.match(r.reply.text,/^Planning only\. Paper trading is not enabled yet/);
 assert.match(r.reply.text,/Your Start is recorded/);
 assert.match(r.reply.text,/Planned trades \(practice mode: nothing sent\)/);
 assert.match(r.reply.text,/Account-check blockers: none reported/);
 assert.match(r.reply.text,/Pressing Start again does not enable paper orders/);
 assert.match(r.reply.text,/successful worker run is not proof that an order was placed/);
 assert.doesNotMatch(r.reply.text,/READY, gate ARMED/);
 assert.ok(r.reply.cards.flatMap(c=>c.items??[]).some(i=>i.label==='Paper-order setup steps'));
 assert.equal(r.reply.private,true);
});
test('stock status preserves owner pauses and never infers order permission from missing release data',()=>{
 const a=account();
 a.brokerWritesEnabled=true;
 const enabled=stockAnswer({domain:'stocks',topic:'automation'},a,null,NOW);
 assert.match(enabled.text,/Paper orders are released/);
 assert.match(enabled.text,/Owner permission: paused/);
 assert.doesNotMatch(enabled.text,/Your Start is recorded/);
 a.brokerWritesEnabled=null;
 assert.match(stockAnswer({domain:'stocks',topic:'automation'},a,null,NOW).text,/permission is unknown/);
});
test('historical continuous, halted and forward research are separately labeled',()=>{
 const r=researchAnswer({domain:'research',topic:'explain',strategyId:'momentum-quality-paper-v1'},{summary:saved,mode:'saved',checkedAt:NOW});
 assert.match(r.text,/Saved research report; live feed unavailable/);assert.match(r.text,/16\.4%/);assert.match(r.text,/3\.4%/);
 assert.match(r.text,/FAILS/);assert.match(r.text,/0 measured sessions/);assert.match(r.text,/No forward return measured yet/);
 assert.match(r.text,/not profit in your account/);assert.doesNotMatch(r.text,/Berkshire filing follower:/);
});
test('invalid research snapshots cannot activate candidates or manufacture a measured return',()=>{
 assert.ok(parseStockResearch(saved,NOW));
 for(const change of [
  s=>s.candidates[0].active=true,s=>s.candidates[0].forward.totalReturn=0,s=>s.benchmark.cagr=Infinity,
  s=>s.candidates.push(s.candidates[0]),s=>s.generatedAt='2099-01-01T00:00:00Z',s=>delete s.candidates[0].historical.asLive.total,
 ]){
  const s=structuredClone(saved);change(s);assert.equal(parseStockResearch(s,NOW),null);
 }
});
test('a missing live summary is dated and labeled saved; valid public data is cached separately',async()=>{
 resetStockResearchCache();
 const a=await loadStockResearch(NOW,async()=>new Response('missing',{status:404}));
 assert.equal(a.mode,'saved');assert.equal(a.summary.generatedAt,saved.generatedAt);
 resetStockResearchCache();let calls=0;
 const fetcher=async()=>{calls++;return Response.json(saved);};
 assert.equal((await loadStockResearch(NOW,fetcher)).mode,'live');
 await loadStockResearch('2026-11-09T23:00:01Z',fetcher);assert.equal(calls,1);
 await loadStockResearch('2026-11-09T23:01:01Z',fetcher);assert.equal(calls,2);
});
test('the production ports validate the signed owner cookie, never a context field',async t=>{
 const old=process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;
 t.after(()=>{if(old===undefined)delete process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;else process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=old;});
 const secret='a'.repeat(64);process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=secret;
 const cookie=issueOwnerSession(secret);
 assert.equal(assistantAccess(cookie).ownerAccess,true);
 assert.equal(assistantAccess(cookie.slice(0,-1)+'z').ownerAccess,false);
 const req={url:'https://test.invalid/api/assistant',origin:'https://test.invalid',contentType:'application/json',text:async()=>'',ownerCookie:cookie};
 const signed=sitePorts(req,{},async()=>makeRaw());
 assert.equal(signed.access.ownerAccess,true);
 assert.equal((await signed.accounts()).state,'unavailable');
 assert.equal((await signed.broker()).state,'unavailable');
 const unsigned=sitePorts({...req,ownerCookie:undefined},{},async()=>makeRaw());
 assert.equal((await unsigned.accounts()).state,'owner_required');
 assert.equal((await unsigned.broker()).state,'owner_required');
});
test('client session metadata expires and malformed access cannot reveal private messages',()=>{
 const now=100000;
 assert.equal(parseOwnerAccess({ownerAccess:true,ownerExpiresAt:now+1000},now).ownerAccess,true);
 for(const v of [{ownerAccess:true,ownerExpiresAt:now},{ownerAccess:true,ownerExpiresAt:now+31*60000},{ownerAccess:'true',ownerExpiresAt:now+1000},null])
  assert.equal(parseOwnerAccess(v,now).ownerAccess,false);
});

test('background jobs: combined status reports real runs and labels planned times; outages stay isolated', async()=>{
 const s=setup();
 const jobs={id:'research-collect',label:'Strategy research: nightly collection',area:'research',required:true,status:'PENDING_FIRST_RUN',
  detail:'No run yet',historyUrl:'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/research-collect.yml',
  lastRun:null,lastSuccess:null,lastFailure:null,running:null,slots7d:{due:0,missed:0,lastMissedAt:null},nextPlanned:['2026-11-10T02:17:00Z'],note:null};
 s.ports.ops=async()=>({mode:'live',checkedAt:NOW,monitorStale:false,status:{schemaVersion:'ops-status-v1',generatedAt:'2026-11-09T22:50:00Z',
  monitorRun:null,overall:{state:'OK',attention:[]},jobs:[jobs],blockers:[],site:{url:'x',checkedAt:NOW,ok:true,checks:[]},evidence:{},credentials:[]}});
 assert.equal(routeQuestion('Did the background jobs run?',null).domain,'all');
 const r=await ask('Did the background jobs run?',s);
 assert.match(r.reply.text,/Background jobs\n/);
 assert.match(r.reply.text,/no successful run yet; next planned .*\(planned, not yet run\)/);
 s.ports.ops=async()=>{throw new Error('feed down');};
 const down=await ask('How are sports and stocks doing?',s);
 for(const h of ['Sports','Stock account','Stock research','Background jobs'])assert.ok(down.reply.text.includes(h));
 assert.match(down.reply.text,/Planned schedules are not evidence of a run/);
 // The health briefing with the monitor down says so instead of reporting green.
 const health=await ask('Is everything running?',s);
 assert.equal(health.reply.context.topic,'health');
 assert.match(health.reply.text,/Status unknown.*Nothing is assumed to be running/s);
 assert.doesNotMatch(health.reply.text,/Everything is running/);
});

test('daily strategies: optional summary section parses on its own and reaches research answers', async()=>{
 const daily={prereg:'docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md',historicalAt:null,overall:'NOT_EVALUATED',forwardAt:null,datasetFingerprint:null,
  strategies:['daily-reversal5-v1','daily-momentum5d-v1','daily-spy-trend50-v1'].map(id=>({id,active:false,historical:null,
   forward:{status:'NOT STARTED',sessions:0,firstExecution:null,totalReturn:null,lastTargets:null}}))};
 const withDaily=parseStockResearch({...saved,daily},NOW);
 assert.equal(withDaily.daily.strategies.length,3);
 const broken=parseStockResearch({...saved,daily:{...daily,strategies:[{...daily.strategies[0],active:true}]}},NOW);
 assert.ok(broken,'a bad daily block must not hide the main study');
 assert.equal(broken.daily,null);
 assert.equal(routeQuestion('How is daily trading doing?',null).domain,'research');
 const s=setup();s.ports.research=async()=>({summary:withDaily,mode:'live',checkedAt:NOW});
 const r=await ask('How is daily trading doing?',s);
 assert.match(r.reply.text,/Daily strategies \(paper research, not active\)/);
 assert.match(r.reply.text,/forward trades start at the 2026-11-10 open/);
});

test('whole-site questions: each sprint question gets a specific answer from records, never the "which domain" prompt', async()=>{
 const s=setup();
 const opsView={mode:'live',checkedAt:NOW,monitorStale:false,status:{schemaVersion:'ops-status-v1',generatedAt:'2026-11-09T22:50:00Z',monitorRun:null,
  overall:{state:'WARN',attention:[]},jobs:[],blockers:[{id:'stock-first-session',text:'PR #102 (stock PAPER orders) is not released.',action:'See the checklist.'}],
  site:{url:'x',checkedAt:NOW,ok:true,checks:[{name:'Overview page',ok:true,ms:9,detail:null}]},evidence:{release:{pr:102,state:'open',merged:false}},credentials:[]}};
 s.ports.ops=async()=>opsView;
 const cases=[["What happened today?",'today',/Today so far|Nothing has been recorded yet today/],
  ['How much virtual money did we make this week?','money',/last 7 days: \+\$15\.00 on 3 settled entries[\s\S]*Too early to judge profitability[\s\S]*owner-only/],
  ["Why didn't we make any picks?",null,/./],
  ['What is the most promising current paper opportunity?','opportunity',/not recommendations or predictions of profit/],
  ['How is the algorithm improving?','improving',/Recorded picks hit[\s\S]*No research candidate is active/],
  ['What mistakes are we making?',null,/./],
  ["What's happening with our API credits?",null,/credit/i],
  ['Is any automation broken?','health',/Stock PAPER autopilot: Needs you/],
  ['Are we ready for Monday?','ready',/Sign in as the owner[\s\S]*Release-gate evidence/],
  ['What needs my approval?','approvals',/PR #102/]];
 for(const [q,topic,re] of cases){
  const r=await ask(q,s);
  assert.doesNotMatch(r.reply.text,/Do you mean sports picks/,q);
  if(topic)assert.equal(r.reply.context.topic,topic,q);
  assert.match(r.reply.text,re,q);
 }
 // Visitors never trigger the owner-only stock loader.
 assert.equal(s.calls.accounts,0);
 // A follow-up keeps the topic: "and all time?" after the weekly money question.
 const first=await ask('How much virtual money did we make this week?',s);
 const follow=await ask('what about all time?',s,first.reply.context);
 assert.equal(follow.reply.context.topic,'money');
 assert.doesNotMatch(follow.reply.text,/last 7 days/);
});

test('whole-site money and Monday answers read the stock ledger only with an owner session', async()=>{
 const s=setup(true);s.ports.accounts=async()=>{s.calls.accounts++;return account();};
 const r=await ask('How much virtual money did we make this week?',s);
 assert.equal(s.calls.accounts,1);
 assert.match(r.reply.text,/Stocks: /);
 assert.equal(r.reply.private,true);
 const m=await ask('Are we ready for Monday?',s);
 assert.equal(m.reply.context.topic,'ready');
 assert.doesNotMatch(m.reply.text,/Sign in as the owner to check this/);
});

test('controls: chat only proposes allowlisted owner actions; visitors, stock Start and trades get no action card', async()=>{
 const visitor=setup();
 const v=await ask('Pause the props',visitor);
 assert.match(v.reply.text,/Only the signed-in owner/);
 assert.ok(!v.reply.cards.some(c=>c.kind==='action'));
 const s=setup(true);s.ports.accounts=async()=>{s.calls.accounts++;const a=account();a.ledgers[0].experimentId='test-weekly';a.ledgers[0].status.gateMode='ARMED';return a;};
 const p=await ask('Pause the props',s);
 const card=p.reply.cards.find(c=>c.kind==='action');
 assert.equal(card.action,'props-pause');assert.equal(card.from,'RUNNING');assert.equal(p.reply.private,true);
 assert.match(p.reply.text,/Nothing has changed yet/);
 const r=await ask('resume the picks',s);
 assert.match(r.reply.text,/already running/);assert.ok(!r.reply.cards.some(c=>c.kind==='action'));
 const stop=await ask('Stop the autopilot',s);
 const sc=stop.reply.cards.find(c=>c.kind==='action');
 assert.equal(sc.action,'stock-stop');assert.equal(sc.experimentId,'test-weekly');assert.equal(sc.from,'RUNNING');
 const start=await ask('Start the stock autopilot',s);
 assert.match(start.reply.text,/never from chat/);assert.ok(!start.reply.cards.some(c=>c.kind==='action'));
 const buy=await ask('Buy OXY',s);
 assert.match(buy.reply.text,/has not submitted/);assert.ok(!buy.reply.cards.some(c=>c.kind==='action'));
 const vague=await ask('pause everything',s);
 assert.match(vague.reply.text,/Which one/);assert.ok(!vague.reply.cards.some(c=>c.kind==='action'));
});

test('security: public whole-site questions share one cached ledger read (no read amplification)', async()=>{
 resetAssistantCache();
 const s=setup();
 for(const q of ['What happened today?','Is any automation broken?','How is the algorithm improving?','What happened today?',"Tonight's picks"])await ask(q,s);
 assert.equal(s.calls.sports,1);
 resetAssistantCache();
 await ask('What happened today?',s);
 assert.equal(s.calls.sports,2);
});
