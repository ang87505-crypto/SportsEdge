import test from 'node:test';
import assert from 'node:assert/strict';
import {issueOwnerSession} from './alpaca-owner-session.ts';
import {handleKalshiOwnerGet,handleKalshiOwnerPost,handleKalshiTick} from './kalshi-platform-owner.ts';
import {runKalshiPlatform} from './kalshi-platform-worker.ts';
import {runKalshiDemo,startKalshiDemo,stopKalshiDemo,reconcileKalshiDemo} from './kalshi-demo-worker.ts';
import {KalshiDemoError} from './kalshi-demo-client.ts';
import {loadKalshiWeatherSources} from './kalshi-weather-source.ts';
import {memoryStore,demoFixture,forecastFixture,memoryFixture,trainingFixture,NOW,clone} from './kalshi-platform-test-kit.mjs';
const clock=()=>Date.parse(NOW),iso=()=>NOW;
async function armed(store,client){await startKalshiDemo(store,client);}
const secret='a'.repeat(64),env={SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY:secret};
const request=(body={action:'offline-check'})=>({url:'https://sports-edge-eta.vercel.app/api/internal/kalshi-paper',
 origin:'https://sports-edge-eta.vercel.app',ownerCookie:issueOwnerSession(secret,clock()),body});

test('owner authentication and same-origin checks precede body parsing, storage and demo access',async()=>{
 let reads=0,stores=0,demos=0;
 const deps={env,now:clock,store:()=>{stores++;throw Error('forbidden');},demo:()=>{demos++;throw Error('forbidden');}};
 assert.equal((await handleKalshiOwnerGet({url:request().url},deps)).status,401);
 assert.equal((await handleKalshiOwnerPost({...request(),ownerCookie:'bad',readBody:async()=>{reads++;}},deps)).status,401);
 assert.equal((await handleKalshiOwnerPost({...request(),origin:'https://attacker.invalid'},deps)).status,403);
 assert.equal((await handleKalshiOwnerPost(request({action:'execute-live'}),deps)).status,400);
 assert.deepEqual([reads,stores,demos],[0,0,0]);
});
test('offline owner check is saved once and remains explicitly synthetic in the private read model',async()=>{
 const store=memoryStore(),deps={env,now:clock,store:()=>store};
 assert.equal((await handleKalshiOwnerPost(request(),deps)).status,200);
 assert.equal((await handleKalshiOwnerPost(request(),deps)).status,200);
 assert.equal(store.get('kalshi_fixture_ledgers').length,1);
 const view=await handleKalshiOwnerGet(request(),deps);
 assert.equal(view.status,200);assert.equal(view.body.fixture.balanceMicros,9075500);
 assert.equal(view.body.fixture.corrections,1);assert.equal(view.body.demo.account,null);
 assert.equal(view.body.demo.attempts,0);assert.equal(view.body.research.gradedDays,0);
});
test('scheduler token cannot authorize owner actions or run a smoke order',async()=>{
 const store=memoryStore();let runs=0;
 const deps={env:{CRON_SECRET:'synthetic-scheduler-key'},now:clock,store:()=>store,
  run:async(_s,opts)=>{runs++;assert.equal(opts.slot,'tick-2026-11-20T20:00');return {status:'COMPLETED'};}};
 assert.equal((await handleKalshiTick({},deps)).status,401);
 assert.equal((await handleKalshiTick({authorization:'Bearer wrong'},deps)).status,401);
 assert.equal((await handleKalshiTick({authorization:'Bearer synthetic-scheduler-key'},deps)).status,200);
 assert.equal((await handleKalshiOwnerPost({...request(),ownerCookie:undefined},deps)).status,401);
 assert.equal(runs,1);
});
test('a schema failure is unavailable and cannot invent a zero balance or successful job',async()=>{
 const store=memoryStore();store.get('kalshi_platform_version').splice(0);
 const view=await handleKalshiOwnerGet(request(),{env,now:clock,store:()=>store});
 assert.equal(view.status,503);assert.equal(view.body.code,'KALSHI_SCHEMA_NOT_READY');assert.equal('fixture' in view.body,false);
 await assert.rejects(runKalshiPlatform(store,{slot:'owner-'+NOW}),/SCHEMA_NOT_READY/);
 assert.equal(store.get('kalshi_platform_runs').length,0);
});
test('research worker freezes actual current output without inventing probabilities or a demo order',async()=>{
 const store=memoryStore();let demos=0;
 const sources=async()=>({archiveRef:'b'.repeat(40),forecasts:[memoryFixture()],outcomes:[],training:[],imported:1,complete:true});
 const options={slot:'owner-'+NOW,now:iso,sources,demo:()=>{demos++;throw Error('not configured');}};
 const first=await runKalshiPlatform(store,options);
 assert.equal(first.status,'COMPLETED');assert.equal(first.modelStatus,'AWAITING_VERIFIED_HISTORY');
 assert.equal(first.trainingPairs,0);assert.equal(demos,0);
 const initial=store.get('kalshi_contract_forecasts')[0].document;
 assert.equal(JSON.parse(initial).contracts.every(c=>c.probabilityYesPpm===null),true);
 assert.equal((await runKalshiPlatform(store,options)).status,'DUPLICATE');
 await runKalshiPlatform(store,{...options,slot:'owner-2026-11-20T21:00:00Z',now:()=> '2026-11-20T21:00:00Z'});
 assert.equal(store.get('kalshi_contract_forecasts').length,1);assert.equal(store.get('kalshi_contract_forecasts')[0].document,initial);
});
test('partial archive catch-up fails visibly instead of training from a selected subset',async()=>{
 const store=memoryStore();
 await assert.rejects(runKalshiPlatform(store,{slot:'owner-'+NOW,now:iso,
  sources:async()=>({complete:false})}),/EVIDENCE_CATCHUP_REQUIRED/);
 assert.equal(store.get('kalshi_platform_runs')[0].status,'FAILED');assert.equal(store.get('kalshi_contract_forecasts').length,0);
});
test('owner can arm and stop an account, while automatic model orders wait for history',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);
 const result=await runKalshiDemo(store,client,{forecast:forecastFixture(),training:[],kind:'MODEL',now:clock});
 assert.equal(result.status,'AWAITING_VERIFIED_HISTORY');
 assert.equal(client.calls.filter(c=>Array.isArray(c)&&c[0]==='submit').length,0);
 assert.ok(store.get('kalshi_demo_account_snapshots').length>=2,'reconciliation continues while model training waits');
 await stopKalshiDemo(store);assert.equal(store.get('kalshi_demo_control')[0].state,'STOPPED');
});
test('one smoke order works before the training minimum and preserves the pre-submit decision',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);
 const submit=client.submit;client.submit=async i=>{assert.equal(store.get('kalshi_demo_intents').length,1);return submit(i);};
 const result=await runKalshiDemo(store,client,{forecast:forecastFixture(),training:[],kind:'SMOKE',now:clock});
 assert.equal(result.status,'ACKNOWLEDGED');assert.equal(result.acknowledgement.filledMicros,500000);
 const intent=store.get('kalshi_demo_intents')[0],d=JSON.parse(intent.decision_document);
 assert.equal(d.kind,'SMOKE');assert.equal(d.probabilityYesPpm,null);assert.equal(d.modelForecastId,null);
 assert.equal(d.market.ticker,intent.ticker);assert.equal(d.source,'KALSHI_DEMO');
 assert.equal(store.get('kalshi_demo_receipts')[0].kind,'ACKNOWLEDGED');
});
test('an unknown order outcome is persisted, disarms automation and is never blindly retried',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);let posts=0;
 client.submit=async()=>{posts++;throw new KalshiDemoError('ORDER_OUTCOME_UNKNOWN',true);};
 await assert.rejects(runKalshiDemo(store,client,{forecast:forecastFixture(),training:[],kind:'SMOKE',now:clock}),/ORDER_OUTCOME_UNKNOWN/);
 assert.equal(store.get('kalshi_demo_intents').length,1);assert.equal(store.get('kalshi_demo_receipts').at(-1).kind,'OUTCOME_UNKNOWN');
 assert.equal(store.get('kalshi_demo_control')[0].state,'STOPPED');
 assert.equal((await runKalshiDemo(store,client,{forecast:forecastFixture(),training:[],kind:'SMOKE',now:clock})).status,'STOPPED');
 await assert.rejects(startKalshiDemo(store,client),/RECONCILE_REQUIRED/);assert.equal(posts,1);
});
test('a definitive rejected order remains a rejection rather than a fill or profit',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);
 client.submit=async()=>{throw new KalshiDemoError('HTTP_400',false);};
 await assert.rejects(runKalshiDemo(store,client,{forecast:forecastFixture(),training:[],kind:'SMOKE',now:clock}),/HTTP_400/);
 assert.equal(store.get('kalshi_demo_receipts')[0].kind,'REJECTED');
 assert.equal(store.get('kalshi_demo_control')[0].state,'ARMED');
});
test('a ledger write failure after acknowledgement leaves a durable pending intent for read-only recovery',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);const insert=store.insert;
 store.insert=async(table,rows)=>{if(table==='kalshi_demo_receipts')throw Error('KALSHI_STORE_OUTCOME_UNKNOWN');return insert(table,rows);};
 const f=forecastFixture();await assert.rejects(runKalshiDemo(store,client,{forecast:f,training:[],kind:'SMOKE',now:clock}),/OUTCOME_UNKNOWN/);
 const intent=store.get('kalshi_demo_intents')[0];store.insert=insert;
 client.accountData.orders=[{clientOrderId:intent.id,orderId:'10000000-0000-4000-8000-000000000001',ticker:intent.ticker,side:intent.side,
  status:'canceled',filledMicros:500000,remainingMicros:0,costMicros:50000,feesMicros:10000}];
 await reconcileKalshiDemo(store,client);
 assert.equal(store.get('kalshi_demo_receipts').at(-1).kind,'RECONCILED');
 assert.equal(client.calls.filter(c=>Array.isArray(c)&&c[0]==='submit').length,1);
});
test('model inputs must reproduce the frozen training digest before any order is attempted',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);
 const changed=trainingFixture().map(r=>({...r,observedHighF:r.observedHighF+1}));
 await assert.rejects(runKalshiDemo(store,client,{forecast:forecastFixture(35),training:changed,kind:'MODEL',now:clock}),/ARTIFACT_MISMATCH/);
 assert.equal(store.get('kalshi_demo_intents').length,0);
});
test('a weather-source outage stops new orders and still reconciles an earlier acknowledgement',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);
 await runKalshiDemo(store,client,{forecast:forecastFixture(),training:[],kind:'SMOKE',now:clock});
 const intent=store.get('kalshi_demo_intents')[0];
 client.accountData.orders=[{clientOrderId:intent.id,orderId:'10000000-0000-4000-8000-000000000001',ticker:intent.ticker,side:intent.side,
  status:'canceled',filledMicros:500000,remainingMicros:0,costMicros:50000,feesMicros:10000}];
 await assert.rejects(runKalshiPlatform(store,{slot:'outage-'+NOW,now:iso,demo:()=>client,
  sources:async()=>{throw Error('KALSHI_ARCHIVE_HTTP_503');}}),/ARCHIVE_HTTP_503/);
 assert.equal(store.get('kalshi_demo_control')[0].state,'STOPPED');
 assert.equal(store.get('kalshi_demo_receipts').at(-1).kind,'RECONCILED');
 assert.equal(store.get('kalshi_platform_runs')[0].summary.demoStatus,'RECONCILED_AFTER_RESEARCH_FAILURE');
 assert.equal(client.calls.filter(c=>Array.isArray(c)&&c[0]==='submit').length,1);
});
test('unknown holdings and an incomplete account cannot be treated as a clean trading account',async()=>{
 const store=memoryStore(),client=demoFixture();client.accountData.positions=[{ticker:'UNRELATED',quantityMicros:1000000}];
 await assert.rejects(startKalshiDemo(store,client),/ACCOUNT_NOT_CLEAN/);
 assert.equal(store.get('kalshi_demo_control')[0].state,'STOPPED');
});
test('a clock-correct model path can submit, and official demo settlement stays separate from NWS grading',async()=>{
 const store=memoryStore(),client=demoFixture();await armed(store,client);
 await runKalshiDemo(store,client,{forecast:forecastFixture(35),training:trainingFixture(),kind:'MODEL',now:clock});
 const intent=store.get('kalshi_demo_intents')[0],d=JSON.parse(intent.decision_document);
 assert.equal(intent.kind,'MODEL');assert.ok(d.probabilityYesPpm>0);assert.ok(d.estimatedEdgeMicros>=30000);
 client.accountData.fetchedAt='2026-11-23T12:00:00Z';
 client.accountData.orders=[{clientOrderId:intent.id,orderId:'10000000-0000-4000-8000-000000000001',ticker:intent.ticker,side:intent.side,
  status:'executed',filledMicros:1000000,remainingMicros:0,costMicros:100000,feesMicros:10000}];
 client.result=async()=>({source:'KALSHI_DEMO',ticker:intent.ticker,eventTicker:d.market.eventTicker,result:'yes',
  rulesPrimary:d.market.rulesPrimary,rulesSecondary:d.market.rulesSecondary,settledAt:'2026-11-23T10:00:00Z',fetchedAt:client.accountData.fetchedAt});
 await reconcileKalshiDemo(store,client);
 assert.equal(store.get('kalshi_demo_receipts').at(-1).kind,'SETTLED');assert.equal(store.get('kalshi_contract_grades').length,0);
});
test('archive import is pinned, bounded and cached without contacting any exchange',async()=>{
 const store=memoryStore(),memory=memoryFixture(),calls=[];
 const fake=async(url,opts)=>{
  calls.push(url);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.doesNotMatch(url,/kalshi\.(com|co)/);
  let data;
  if(url.includes('/git/ref/'))data={object:{sha:'b'.repeat(40)}};
  else if(url.includes('/contents/')&&url.includes('/forecasts?'))data=[{name:'2026-11-21.json',type:'file',sha:'c'.repeat(40),download_url:'https://attacker.invalid'}];
  else if(url.includes('/contents/'))data=[];
  else{assert.ok(url.includes('/'+'b'.repeat(40)+'/'));data=memory;}
  return new Response(JSON.stringify(data));
 };
 const first=await loadKalshiWeatherSources(store,NOW,fake);
 assert.equal(first.imported,1);assert.equal(first.training.length,0);assert.equal(first.complete,true);
 const count=calls.length,second=await loadKalshiWeatherSources(store,NOW,fake);
 assert.equal(second.imported,0);assert.equal(calls.length-count,3);assert.equal(store.get('kalshi_weather_evidence').length,1);
 const corrupt=clone(store.get('kalshi_weather_evidence')[0]);corrupt.blob_sha='d'.repeat(40);store.get('kalshi_weather_evidence')[0]=corrupt;
 await assert.rejects(loadKalshiWeatherSources(store,NOW,fake),/ARCHIVE_CHANGED/);
});
