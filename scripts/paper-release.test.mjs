import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {propsReleaseGate,stockReleaseGate,NOT_BEFORE,EXPIRES} from './paper-release-gates.mjs';
import {githubClient,reviewPull,runRelease,parseManualReceipts,loadPropsEvidence,REPOSITORY} from './paper-release.mjs';

const NOW=Date.parse('2026-11-09T22:00:00Z');
const ENV={GITHUB_REPOSITORY:REPOSITORY,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'schedule'};
const clone=x=>structuredClone(x);
const pin={system:'props',number:99,head:'a'.repeat(40),branch:'reviewed-props',checks:['unit'],title:'Paper release',
 files:[{path:'src/lib/props/schedule.ts',sha:'b'.repeat(40),status:'modified'}]};

function props(){
 const e={control:{state:'RUNNING'},policy:{version:'props-budget-v2',daily_credits:7,monthly_credits:200,
  provider_floor:60,active_from:'2026-11-08T16:00:00Z'},
  collect:{id:1,kind:'collect',status:'completed',outcome:'COMPLETED',worker:'gha:42404093295:1',
   finished_at:'2026-11-07T19:10:00Z',summary:{receipt:{observations:4}}},
  runs:[{kind:'settle',status:'completed',outcome:'COMPLETED',started_at:'2026-11-08T09:00:00Z',finished_at:'2026-11-08T09:15:00Z'}],
  observations:[],predictions:[],results:[],playerGames:[],links:[],raw:[],accounts:[],entries:[],picks:[],legs:[],settlements:[]};
 for(let n=1;n<=4;n++){
  const platform=n<=2?'prizepicks':'pick6',hash=String(n).repeat(64),event='event'+(n%2?'aaa':'bbb');
  e.observations.push({id:n,run_id:1,raw_response_id:n,platform,provider:'the_odds_api',is_fixture:false,
   provider_event_id:event,stat:'points',line:20.5,ingested_at:'2026-11-07T19:01:00Z',
   recorded_at:'2026-11-07T19:02:00Z',lock_at:'2026-11-08T01:00:00Z',response_sha256:hash});
  e.predictions.push({id:n,observation_id:n,status:'scored',model_version:'props-nb-minutes-rate-v1',
   athlete_id:String(n),data_cutoff:'2026-11-07T19:00:00Z',predicted_at:'2026-11-07T19:03:00Z'});
  e.raw.push({id:n,source:'the_odds_api',http_status:200,content_sha256:hash});
  e.results.push({observation_id:n,player_game_id:n,revision:1,outcome:'more',actual:22,graded_at:'2026-11-08T09:05:00Z'});
  e.playerGames.push({id:n,source:'espn_summary',game_status:'final',athlete_id:String(n),espn_event_id:'40000000'+(n%2),
   game_start:'2026-11-08T01:00:00Z',retrieved_at:'2026-11-08T09:01:00Z',points:22,did_not_play:false});
  if(n<=2)e.links.push({provider_event_id:event,espn_event_id:'40000000'+(n%2)});
  e.picks.push({id:n,prediction_id:n,status:'recorded',side:'more'});
  e.legs.push({entry_id:n<=2?1:2,pick_id:n});
 }
 for(const [n,platform] of [[1,'prizepicks'],[2,'pick6']]){
  e.accounts.push({id:n,platform});
  e.entries.push({id:n,account_id:n,pick_count:2,stake_cents:500,created_at:'2026-11-07T19:04:00Z',lock_at:'2026-11-08T01:00:00Z'});
  e.settlements.push({entry_id:n,outcome:n===1?'won':'payout_unknown',wins:2,losses:0,voids:0,
   return_cents:n===1?1500:null,profit_cents:n===1?1000:null,
   payout_terms_version:n===1?'prizepicks-power-standard-20261107':null,settled_at:'2026-11-08T09:06:00Z'});
 }
 return e;
}
function stock(){
 const decisionId='d'.repeat(64),runId='run-'+'1'.repeat(32);
 const raw={status:{experimentId:'stock-v2-weekly-1',realMoneyEnabled:false,brokerEnvironment:'alpaca-paper',
  state:'READY',gateMode:'ARMED',gateReason:'OWNER_RESUME',gateVersion:4,gateChangedAt:'2026-11-09T15:00:00Z',
  gateChangedBy:'owner',lastCheckAt:'2026-11-09T21:21:00Z',lastCheckOk:true,lastCheckBlockers:[],
  lastSuccessAt:'2026-11-09T21:21:00Z',executingRunId:null,leaseExpiresAt:null,
  unresolvedIntents:0,activeIntents:0,unacknowledgedCriticalAlerts:0,modelVersion:'stock-mom252-skip21-trend200-v1',
  decisionWindow:{start:'2026-10-30',end:'2027-12-31'},limits:{capitalLimitCents:125000,maxOrderNotionalCents:15000,
   maxDailyNotionalCents:120000,maxOrdersPerDay:20,maxOpenOrders:10,maxAttemptsPerLeg:3,drawdownStopBps:2500,feeReserveCents:0},
  checkedAt:'2026-11-09T22:00:00Z'},experiment:{registeredAt:'2026-10-30T14:00:00Z',startingEquityCents:100000,
   brokerAccountNumberSuffix:'1234',configDigest:'c'.repeat(64)},
  decisions:[{decisionId,session:'2026-11-09',decisionAt:'2026-11-09T13:00:00Z',outcome:'TARGETS',
   targets:[{symbol:'AAA'}],recordedAt:'2026-11-09T13:00:30Z',diagnostics:{}}],
  intents:[{intentId:'pai-'+'2'.repeat(32),decisionId,symbol:'AAA',side:'buy',phase:'BUY',attempt:1,shares:3,
   limitCents:3000,status:'filled',brokerStatus:'filled',filledQty:'3',filledAvgPrice:'29.99',
   createdAt:'2026-11-09T14:50:10Z',updatedAt:'2026-11-09T14:50:30Z'}],
  daily:[{session:'2026-11-09',capturedAt:'2026-11-09T21:20:00Z',equityCents:100001,cashCents:91003,
   longMarketValueCents:8998,externalFlowCents:0,feesCents:0,dividendsCents:0,benchmarkSymbol:'SPY',
   benchmarkClose:'600',benchmarkSource:'alpaca-sip',contaminated:false,cashReconciled:true,
   cashUnexplainedCents:'0',unrealizedPlCents:1}],alerts:[],
  runs:[{runId,kind:'execute',slot:'2026-11-09T14:45Z',attempt:1,status:'succeeded',startedAt:'2026-11-09T14:50:00Z',
   finishedAt:'2026-11-09T14:51:00Z',summary:'COMPLETE'},
  {runId:'run-'+'3'.repeat(32),kind:'reconcile',slot:'2026-11-09T14:45Z',attempt:1,status:'succeeded',
   startedAt:'2026-11-09T14:57:00Z',finishedAt:'2026-11-09T14:58:00Z',summary:'CLEAN'},
  {runId:'run-'+'4'.repeat(32),kind:'monitor',slot:'2026-11-09',attempt:1,status:'succeeded',
   startedAt:'2026-11-09T21:19:00Z',finishedAt:'2026-11-09T21:21:00Z',summary:'MARK_RECORDED'}],
  gateEvents:[{fromMode:'STOPPED',toMode:'ARMED',reason:'OWNER_RESUME',actor:'owner',at:'2026-11-09T14:40:00Z'},
   {fromMode:'ARMED',toMode:'STOPPED',reason:'OWNER_STOP',actor:'owner',at:'2026-11-09T14:55:00Z'},
   {fromMode:'STOPPED',toMode:'ARMED',reason:'OWNER_RESUME',actor:'owner',at:'2026-11-09T15:00:00Z'}],
  activityCounts:{strategy_fill:1}};
 return {raw,receipts:[{status:'DONE',kind:'execute',experimentId:'stock-v2-weekly-1',outcome:'SUCCEEDED',posts:1,runId}]};
}
function fakeGitHub(change={}){
 const calls=[],pull={state:'open',merged:false,mergeable:true,mergeable_state:'clean',draft:true,node_id:'PR_1',
  base:{ref:'main'},head:{sha:pin.head,ref:pin.branch,repo:{full_name:REPOSITORY}}};
 const gh={request:async(path,options={})=>{
  calls.push({path,...options});
  if(options.method==='PUT')return {merged:true,sha:'f'.repeat(40)};
  if(options.method==='POST')return {data:{markPullRequestReadyForReview:{pullRequest:{isDraft:false}}}};
  if(path.endsWith('/pulls/99'))return {...clone(pull),...change.pull};
  if(path.includes('/files?'))return change.files??pin.files.map(f=>({filename:f.path,sha:f.sha,status:f.status}));
  if(path.includes('/check-runs?'))return {check_runs:change.checks??[
   {id:1,name:'unit',app:{slug:'github-actions'},status:'completed',conclusion:'success',head_sha:pin.head}]};
  if(path.endsWith('/status'))return change.status??{total_count:0,state:'pending'};
  if(path.includes('/reviews?'))return change.reviews??[];
  throw Error('Unexpected fake route '+path);
 }};
 return {gh,calls};
}

test('props waits for the budget date and verifies real pre-lock lines, grades and both payout semantics',()=>{
 assert.equal(propsReleaseGate(props(),NOT_BEFORE-1).reason,'PROPS_BUDGET_NOT_ACTIVE_YET');
 assert.equal(propsReleaseGate(props(),NOW).ready,true);
 const e=props();e.entries=[];e.legs=[];e.settlements=[];
 assert.equal(propsReleaseGate(e,NOW).ready,true,'no entry quota is manufactured');
});
test('props rejects paused controls, wrong budgets, backfill-only, missing platform, post-lock and fixture evidence',()=>{
 const mutations=[e=>e.control.state='PAUSED',e=>e.control.state='STOPPED',e=>e.policy.daily_credits=12,
  e=>e.collect.worker='gha:999:1',e=>e.runs[0].kind='backfill',e=>e.observations.splice(2),
  e=>e.observations[0].ingested_at=e.observations[0].lock_at,e=>e.observations[0].is_fixture=true,
  e=>e.raw[0].content_sha256='0'.repeat(64),e=>e.predictions[0].data_cutoff=e.observations[0].lock_at,
  e=>e.results.pop(),e=>e.playerGames[0].game_status='in_progress',e=>e.playerGames[0].athlete_id='999',
  e=>e.results[0].actual=0,e=>e.settlements.pop(),e=>e.settlements[1].return_cents=0,
  e=>e.settlements[0].profit_cents=500,e=>e.legs.pop()];
 for(const mutate of mutations){const e=props();mutate(e);assert.equal(propsReleaseGate(e,NOW).ready,false);}
});
test('stock release requires a manual real fill, clean same-session close, and owner Stop/restart',()=>{
 const {raw,receipts}=stock();assert.equal(stockReleaseGate(raw,receipts,NOW).ready,true);
 assert.equal(stockReleaseGate(raw,[],NOW).reason,'STOCK_SUPERVISED_EXECUTE_REQUIRED');
 const mutations=[r=>r.status.gateMode='STOPPED',r=>r.status.unresolvedIntents=1,r=>r.status.activeIntents=1,
  r=>r.status.lastCheckOk=false,r=>r.status.lastCheckAt='2026-11-01T00:00:00Z',
  r=>r.activityCounts.external_fill=1,r=>r.decisions[0].outcome='HOLD_NO_TARGETS',r=>r.intents[0].filledQty='0',
  r=>r.gateEvents.splice(1),r=>r.gateEvents[1].actor='worker:gha:1',r=>r.runs[1].summary='BLOCKED',
  r=>r.daily[0].session='2026-11-10',r=>r.daily[0].cashReconciled=false,r=>r.daily[0].contaminated=true,
  r=>r.daily[0].externalFlowCents=1,r=>r.runs.pop(),r=>r.status.realMoneyEnabled=true];
 for(const mutate of mutations){const r=clone(raw);mutate(r);assert.equal(stockReleaseGate(r,receipts,NOW).ready,false);}
});
test('only the reviewed PR head, file hashes and green complete checks are accepted',async()=>{
 assert.equal((await reviewPull(fakeGitHub().gh,pin)).ready,true);
 for(const change of [{pull:{head:{sha:'c'.repeat(40)}}},{pull:{mergeable:false}},
  {files:[]},{checks:[]},{checks:[{id:2,name:'unit',app:{slug:'github-actions'},status:'completed',conclusion:'failure',head_sha:pin.head}]},
  {status:{total_count:1,state:'pending'}},{reviews:[{user:{login:'reviewer'},state:'CHANGES_REQUESTED'}]}])
  assert.equal((await reviewPull(fakeGitHub(change).gh,pin)).ready,false);
});
test('check mode never writes; apply rechecks evidence and sends one exact-head squash merge',async()=>{
 for(const apply of [false,true]){
  const {gh,calls}=fakeGitHub();let reads=0;
  const result=await runRelease({env:ENV,gh,pins:[pin],readProps:async()=>{reads++;return props();},now:NOW,apply});
  const writes=calls.filter(c=>c.method);
  assert.equal(writes.length,apply?2:0);assert.equal(reads,apply?2:1);
  if(apply){assert.deepEqual(writes[1].body.sha,pin.head);assert.equal(writes[1].body.merge_method,'squash');
   assert.equal(result.systems[0].status,'MERGED');}
 }
});
test('an owner Stop between evidence checks prevents any PR write',async()=>{
 const {gh,calls}=fakeGitHub();let n=0;
 await runRelease({env:ENV,gh,pins:[pin],now:NOW,apply:true,readProps:async()=>{
  const e=props();if(n++)e.control.state='STOPPED';return e;}});
 assert.equal(calls.filter(c=>c.method).length,0);
});
test('expiry retires the watcher without reading financial credentials or merging',async()=>{
 const {gh,calls}=fakeGitHub();
 const result=await runRelease({env:ENV,gh,pins:[pin],now:EXPIRES,apply:true,
  readProps:async()=>{throw Error('must not read');}});
 assert.equal(result.terminal,true);assert.equal(result.systems[0].status,'EXPIRED_REVIEW_REQUIRED');
 assert.equal(calls.filter(c=>c.method).length,0);
});
test('a lost merge reply is never retried and cannot produce a successful release receipt',async()=>{
 const {gh}=fakeGitHub();let writes=0;
 const request=gh.request;gh.request=async(p,o)=>{
  if(o?.method==='PUT'){writes++;throw Error('GITHUB_WRITE_OUTCOME_UNKNOWN');}return request(p,o);};
 await assert.rejects(runRelease({env:ENV,gh,pins:[pin],now:NOW,apply:true,readProps:async()=>props()}),
  /GITHUB_WRITE_OUTCOME_UNKNOWN/);
 assert.equal(writes,1);
});
test('untrusted branches or event types are refused before any request',async()=>{
 for(const env of [{...ENV,GITHUB_REF:'refs/heads/release/stock-paper-orders'},
  {...ENV,GITHUB_EVENT_NAME:'pull_request'},{...ENV,GITHUB_REPOSITORY:'other/repo'},
  {...ENV,GITHUB_EVENT_NAME:'push'}])
  await assert.rejects(runRelease({env,gh:{request:()=>assert.fail('network')},pins:[pin],apply:true}),/TRUSTED_MAIN_ONLY/);
});
test('signed log downloads never receive the GitHub token and off-host redirects are refused',async()=>{
 const calls=[],token='SYNTHETIC_TOKEN';
 const gh=githubClient(token,async(url,init)=>{calls.push({url,init});return calls.length===1?
  new Response(null,{status:302,headers:{location:'https://example.blob.core.windows.net/log?sig=synthetic'}}):new Response('log');});
 assert.equal(await gh.request('/repos/'+REPOSITORY+'/actions/jobs/1/logs',{logRedirect:true}),'log');
 assert.equal(calls[1].init.headers,undefined);
 const bad=githubClient(token,async()=>new Response(null,{status:302,headers:{location:'https://example.com/log'}}));
 await assert.rejects(bad.request('/repos/'+REPOSITORY+'/actions/jobs/1/logs',{logRedirect:true}),/GITHUB_LOG_HOST_REFUSED/);
});
test('only a complete worker JSON receipt is read from manual logs',()=>{
 const {receipts}=stock(),line=JSON.stringify(receipts[0]);
 assert.deepEqual(parseManualReceipts('timestamp '+line+'\n'),receipts);
 assert.deepEqual(parseManualReceipts('echo '+line+'"\n{"status":"DONE",broken'),[]);
});
test('props read adapter uses only GET on the intended project, refuses truncated data',async()=>{
 const env={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'synthetic-'+'x'.repeat(30)};
 const seen=[];
 const e=await loadPropsEvidence(env,async(url,init)=>{seen.push({url,init});return Response.json([]);});
 assert.equal(e.collect,undefined);assert.equal(seen.length,4);assert.ok(seen.every(c=>c.init.method==='GET'));
 await assert.rejects(loadPropsEvidence(env,async()=>Response.json(Array.from({length:900},()=>({})))),/LEDGER_PAGE_LIMIT/);
});
test('the scheduled watcher has no broker, Odds API or AI credentials and PR checks have no secrets',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/paper-release.yml',import.meta.url),'utf8');
 assert.ok(!/ALPACA_.*KEY|ODDS_API_KEY|OPENAI|ANTHROPIC/.test(workflow));
 assert.ok(!workflow.split('  release:')[0].includes('secrets.'));
 const pins=JSON.parse(readFileSync(new URL('../config/paper-auto/release-watch-20261107.json',import.meta.url),'utf8'));
 assert.deepEqual(pins.map(p=>p.number),[99,102]);
 assert.ok(pins.every(p=>/^[a-f0-9]{40}$/.test(p.head)&&p.files.length>0));
});
