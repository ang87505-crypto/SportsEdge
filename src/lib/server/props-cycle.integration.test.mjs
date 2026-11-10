// Opt-in end-to-end test: PROPS_PG_TEST=1 (root + local PostgreSQL 15+).
// Synthetic TEST identities and provider replies only; nothing here is a genuine observation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pgFetch,psql,resetDb,testClockSql} from './props-pg-kit.mjs';
import {propsStore} from './props-store.ts';
import {runCollect,runSettle} from './props-cycle.ts';

const enabled=process.env.PROPS_PG_TEST==='1';
const schema=name=>new URL('../../../database/props/'+name,import.meta.url).pathname;
const DB='props_it';
let clock='2026-11-05T12:00:00.000Z';
const now=()=>clock;
const model=JSON.parse(readFileSync(new URL('../../data/props/model_v1.json',import.meta.url),'utf8'));

// Three synthetic fixtures replayed nightly; two players per team.
const GAMES=[['BOS','NY','Boston Celtics','New York Knicks'],['MIA','UTAH','Miami Heat','Utah Jazz'],['LAL','DEN','Los Angeles Lakers','Denver Nuggets']];
const PLAYERS={BOS:[['9101','Test Alpha',26,7,5],['9102','Test Bravo',12,9,2]],NY:[['9201','Test Charlie',22,5,7],['9202','Test Delta',9,3,4]],
 MIA:[['9301','Test Echo',24,6,4],['9302','Test Foxtrot',14,10,2]],UTAH:[['9401','Test Golf',20,4,6],['9402','Test Hotel',11,8,1]],
 LAL:[['9501','Test India',28,8,8],['9502','Test Juliet',10,4,3]],DEN:[['9601','Test Kilo',25,11,9],['9602','Test Lima',13,5,2]]};
const eid=(day,g)=>String(401990000+day*10+g);
const startOf=(day,g)=>`2026-11-${String(day+1).padStart(2,'0')}T0${g}:00:00Z`; // ET evening of `day`
function summary(day,g,{dnp=null,bump=0}={}){
 const [h,a]=GAMES[g];
 const team=(abbr,i)=>({team:{abbreviation:abbr},statistics:[{keys:['minutes','points','rebounds','assists'],athletes:PLAYERS[abbr].map(([id,name,p,r,as],k)=>
  id===dnp?{athlete:{id,displayName:name},didNotPlay:true,reason:'TEST DNP',stats:[]}:
  {athlete:{id,displayName:name},didNotPlay:false,stats:[String(30+((day+k+i)%5)),String(p+((day*3+k)%5)-2+bump),String(r+((day+k)%3)-1),String(as+((day+2*k)%3)-1)]})}]});
 return {header:{id:eid(day,g),competitions:[{id:eid(day,g),date:startOf(day,g),status:{type:{name:'STATUS_FINAL',completed:true,state:'post'}},
  competitors:[{homeAway:'home',team:{abbreviation:h}},{homeAway:'away',team:{abbreviation:a}}]}]},boxscore:{players:[team(h,0),team(a,1)]}};
}
function scoreboard(day){return {events:GAMES.map(([h,a],g)=>({id:eid(day,g),competitions:[{date:startOf(day,g),
 status:{type:{name:'STATUS_FINAL',completed:true,state:'post'}},competitors:[{homeAway:'home',team:{abbreviation:h}},{homeAway:'away',team:{abbreviation:a}}]}]}))};}
const finals={};  // yyyymmdd -> day index with stored finals
const overrides={};
const espn={
 scoreboard:async d=>{const day=finals[d];return day===undefined?{ok:true,httpStatus:200,body:{events:[]},receivedAt:clock}:{ok:true,httpStatus:200,body:scoreboard(day),receivedAt:clock};},
 summary:async id=>{const n=Number(id)-401990000;const day=Math.floor(n/10),g=n%10;return {ok:true,httpStatus:200,body:summary(day,g,overrides[id]??{}),receivedAt:clock};},
};
// Provider: events for the evening of Nov 7 (ET), DFS lines near each player's mean.
const EV=GAMES.map((x,g)=>({id:'evtTEST00000'+g,commence_time:startOf(7,g),home_team:x[2],away_team:x[3],sport_key:'basketball_nba'}));
let oddsCalls=0;
const odds={
 events:async()=>{oddsCalls++;return {ok:true,httpStatus:200,body:EV,receivedAt:clock,usage:{remaining:400,used:100,last:1}};},
 eventOdds:async id=>{oddsCalls++;const e=EV.find(x=>x.id===id);const g=EV.indexOf(e);const [h,a]=GAMES[g];
  const book=(key,shift)=>({key,markets:[['player_points',2],['player_rebounds',3],['player_assists',4]].map(([m,idx])=>({key:m,last_update:clock,
   outcomes:[...PLAYERS[h],...PLAYERS[a]].flatMap(pl=>{const line=Math.max(0.5,Math.floor(pl[idx]*0.8)+0.5+shift);
    return [{name:'Over',description:pl[1],price:-137,point:line,...(key==='pick6'?{multiplier:1}:{})},{name:'Under',description:pl[1],price:-137,point:line}];})}))});
  const sportsbook=(key,shift,over,under)=>({key,markets:[['player_points',2],['player_rebounds',3],['player_assists',4]].map(([m,idx])=>({key:m,last_update:clock,
   outcomes:[...PLAYERS[h],...PLAYERS[a]].flatMap(pl=>{const line=Math.max(0.5,Math.floor(pl[idx]*0.8)+0.5+shift);
    return [{name:'Over',description:pl[1],price:over,point:line},{name:'Under',description:pl[1],price:under,point:line}];})}))});
  return {ok:true,httpStatus:200,body:{...e,bookmakers:[book('prizepicks',0),book('pick6',1),sportsbook('draftkings',0,-150,130),sportsbook('fanduel',1,-110,-110)]},
   receivedAt:clock,usage:{remaining:400-oddsCalls*3,used:100+oddsCalls*3,last:3}};},
};

test('daily cycle end to end against the real schema',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'props-it-'));
 const clockFile=join(dir,'clock.sql');writeFileSync(clockFile,testClockSql);
 resetDb(DB,[schema('props_v1.sql'),schema('props_market_v1.sql'),clockFile]);
 const env={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
 const store=propsStore(env,pgFetch(DB,now));
 const deps={store,odds,espn,model,now,worker:'test:1',seasonStart:'2026-10-01T00:00:00Z'};

 // Paused by default: nothing runs and no provider call is made.
 const paused=await runCollect(deps,'collect-2026-11-05T12',null);
 assert.equal(paused.outcome,'CONTROL_PAUSED');assert.equal(oddsCalls,0);
 await store.rpc('props_set_control',{p_state:'RUNNING',p_reason:'integration test',p_actor:'owner-test'});

 // Backfill four nights of synthetic finals (player logs).
 for(const day of [1,2,3,4])finals['202611'+String(day).padStart(2,'0')]=day;
 const bf=await runSettle(deps,'backfill-test',null,{kind:'backfill',dates:['2026-11-01','2026-11-02','2026-11-03','2026-11-04']});
 assert.equal(bf.outcome,'COMPLETED');
 assert.equal(bf.summary.boxScores.newRows,48);

 // Collect on Nov 7, started 2 hours late relative to its slot (inside the 150-minute window; see the reliability test).
 clock='2026-11-07T18:00:00.000Z';
 const c=await runCollect(deps,'collect-2026-11-07T16',`2026-11-07T16:00:00.000Z`);
 assert.equal(c.outcome,'COMPLETED',JSON.stringify(c.summary));
 assert.equal(c.summary.startDelaySeconds,7200);
 assert.equal(c.summary.plan.chosen.length,2);                  // v2 plan: 1 + 2x3 = 7 credits
 assert.equal(c.summary.receipt.observations,48);               // 8 players x 3 stats x 2 platforms
 assert.equal(c.summary.receipt.predictions,48);
 assert.equal(c.summary.predictions.scored,48,JSON.stringify(c.summary.predictions));
 // Sportsbook reference quotes ride in the same reply: no extra credits, and no platform line is lost.
 assert.deepEqual(c.summary.bookQuotes,{inserted:48,byBook:{draftkings:24,fanduel:24,betmgm:0,williamhill_us:0}}); // 2 games x 4 players x 3 stats per book
 assert.equal(psql(DB,'SELECT count(*) FROM props_book_quotes').out,'48');
 assert.equal(psql(DB,'SELECT count(*) FROM props_market_views').out,'48');
 assert.equal(c.summary.marketViews.withBooks,48);
 assert.equal(psql(DB,`SELECT count(*) FROM props_market_views WHERE books_at_same_line>0 AND p_more_books IS NOT NULL`).out,'48');
 assert.equal(psql(DB,`SELECT sum(credits) FROM props_credit_reservations WHERE run_id=${c.runId}`).out,'7');
 const pp=c.summary.entries.prizepicks,p6=c.summary.entries.pick6;
 assert.ok(pp.entries.length>=1&&p6.entries.length>=1,JSON.stringify(c.summary.entries));
 const legs=JSON.parse(psql(DB,`SELECT json_agg(x) FROM (SELECT e.id,count(DISTINCT o.provider_event_id) g,count(*) n FROM props_entries e
  JOIN props_entry_legs l ON l.entry_id=e.id JOIN props_picks k ON k.id=l.pick_id JOIN props_predictions p ON p.id=k.prediction_id
  JOIN props_observations o ON o.id=p.observation_id GROUP BY e.id) x`).out);
 assert.ok(legs.every(e=>e.g===e.n&&e.n===2),'every entry spans distinct games');

 // Same slot again: idempotent. Another slot the same day: games already collected, no new paid odds calls.
 assert.equal((await runCollect(deps,'collect-2026-11-07T16',null)).outcome,'DUPLICATE');
 const before=oddsCalls;
 clock='2026-11-07T21:00:00.000Z';
 const again=await runCollect(deps,'collect-2026-11-07T21',null);
 assert.equal(again.outcome,'BUDGET_EXHAUSTED');                // 7 used; the fallback slot spends nothing
 assert.equal(oddsCalls,before);

 // Settle after the games, with one DNP and one later stat correction.
 finals['20261107']=7;overrides[String(401990000+70)]={dnp:'9102'};
 clock='2026-11-08T07:00:00.000Z';
 const s=await runSettle(deps,'settle-2026-11-08T07',null);
 assert.equal(s.outcome,'COMPLETED',JSON.stringify(s.summary));
 assert.equal(s.summary.grading.newResults,48);
 assert.ok((s.summary.grading.graded.void_dnp??0)===6,'one DNP player voids his 3 stats on both platforms');
 const st=JSON.parse(psql(DB,`SELECT json_agg(x) FROM (SELECT a.platform,s.outcome,s.return_cents,s.profit_cents,s.wins,s.losses,s.voids
  FROM props_entry_settlements s JOIN props_entries e ON e.id=s.entry_id JOIN props_accounts a ON a.id=e.account_id) x`).out);
 assert.ok(st.length>=2);
 for(const x of st){
  if(x.platform==='pick6'){assert.equal(x.outcome,'payout_unknown');assert.equal(x.return_cents,null);}
  else assert.equal(x.profit_cents,x.return_cents-500);
 }
 // A later correction appends revisions; settlements are not rewritten.
 overrides[String(401990000+71)]={bump:7};
 clock='2026-11-08T15:00:00.000Z';
 const s2=await runSettle(deps,'settle-2026-11-08T15',null);
 assert.equal(s2.outcome,'COMPLETED');
 assert.ok(s2.summary.boxScores.corrections>0);
 assert.equal(psql(DB,'SELECT count(*) FROM props_entry_settlements').out,String(st.length));
 assert.ok(Number(psql(DB,'SELECT count(*) FROM props_line_results WHERE revision>1').out)>0);

 // Interrupted run: a run that never finishes is recovered by the next start after its lease.
 const zombie=await store.rpc('props_begin_run',{p_kind:'collect',p_slot:'collect-zombie',p_worker:'test:z',p_scheduled_for:null,p_lease_seconds:60});
 assert.equal(zombie.outcome,'STARTED');
 clock='2026-11-08T15:05:00.000Z';
 const next=await runCollect(deps,'collect-2026-11-08T15',null);
 assert.equal(next.summary.abandonedRecovered,1);
 assert.equal(psql(DB,`SELECT status FROM props_runs WHERE slot_key='collect-zombie'`).out,'abandoned');
});

test('collect still records lines and picks when the market tables are not migrated yet',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const db='props_it_nomarket';
 const dir=mkdtempSync(join(tmpdir(),'props-it-'));
 const clockFile=join(dir,'clock.sql');writeFileSync(clockFile,testClockSql);
 resetDb(db,[schema('props_v1.sql'),clockFile]);
 const env={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
 clock='2026-11-05T12:00:00.000Z';
 const store=propsStore(env,pgFetch(db,now));
 const deps={store,odds,espn,model,now,worker:'test:2',seasonStart:'2026-10-01T00:00:00Z'};
 await store.rpc('props_set_control',{p_state:'RUNNING',p_reason:'integration test',p_actor:'owner-test'});
 for(const day of [1,2,3,4])finals['202611'+String(day).padStart(2,'0')]=day;
 assert.equal((await runSettle(deps,'backfill-test',null,{kind:'backfill',dates:['2026-11-01','2026-11-02','2026-11-03','2026-11-04']})).outcome,'COMPLETED');
 clock='2026-11-07T19:00:00.000Z';
 const c=await runCollect(deps,'collect-2026-11-07T19',null);
 assert.equal(c.outcome,'COMPLETED',JSON.stringify(c.summary));
 assert.equal(c.summary.receipt.observations,48);
 assert.equal(c.summary.receipt.predictions,48);
 assert.match(c.summary.bookQuotes.error,/^[A-Z0-9_]+$/);
 assert.match(c.summary.marketViews.error,/^[A-Z0-9_]+$/);
});

// ---- learning layer: active model, shadows, v2 selection, fallback (synthetic TEST-ONLY artifacts)
async function learningDb(db){
 const {artifactSha256,FEATURES}=await import('../props/learn.ts');
 const dir=mkdtempSync(join(tmpdir(),'props-it-'));
 const clockFile=join(dir,'clock.sql');writeFileSync(clockFile,testClockSql);
 resetDb(db,[schema('props_v1.sql'),schema('props_market_v1.sql'),schema('props_learning_v1.sql'),clockFile]);
 const env={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
 clock='2026-11-05T12:00:00.000Z';
 const store=propsStore(env,pgFetch(db,now));
 const deps={store,odds,espn,model,now,worker:'test:l',seasonStart:'2026-10-01T00:00:00Z'};
 await store.rpc('props_set_control',{p_state:'RUNNING',p_reason:'integration test',p_actor:'owner-test'});
 for(const day of [1,2,3,4])finals['202611'+String(day).padStart(2,'0')]=day;
 assert.equal((await runSettle(deps,'backfill-test',null,{kind:'backfill',dates:['2026-11-01','2026-11-02','2026-11-03','2026-11-04']})).outcome,'COMPLETED');
 const w=[0,1,0,0,0,0,0,0,0];
 const artifact=v=>({modelVersion:v,baseModelVersion:'props-nb-minutes-rate-v1',trainedAt:'2026-11-05T12:00:00Z',dataCutoff:'2026-11-05T12:00:00Z',
  features:[...FEATURES],weights:{points:w,rebounds:w,assists:w},lambda:{points:1,rebounds:1,assists:1},marketWeightsActive:false,
  counts:{points:{historical:1,forward:0,forwardWithBooks:0},rebounds:{historical:1,forward:0,forwardWithBooks:0},assists:{historical:1,forward:0,forwardWithBooks:0}}});
 const add=async(v,sha)=>{const a=artifact(v);await store.insert('props_model_artifacts',[{version:v,sha256:sha??artifactSha256(a),artifact:a}]);};
 const event=(version,ev)=>store.insert('props_model_events',[{version,event:ev,reason:'integration test',actor:'system:test',
  detail:ev==='eligible'?{activeVersion:'props-nb-minutes-rate-v1'}:{}}]);
 return {store,deps,add,event};
}

test('a promoted learning model picks into the v2 accounts while a shadow only scores',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const db='props_it_learn';
 const {store,deps,add,event}=await learningDb(db);
 await add('props-learn-v1');await event('props-learn-v1','eligible');
 await store.rpc('props_promote_model',{p_version:'props-learn-v1',p_actor:'system:test',p_reason:'integration test'});
 await add('props-learn-v2');await event('props-learn-v2','shadow_start');
 clock='2026-11-07T19:00:00.000Z';
 const c=await runCollect(deps,'collect-2026-11-07T19',null);
 assert.equal(c.outcome,'COMPLETED',JSON.stringify(c.summary));
 assert.deepEqual(c.summary.activeModel,{version:'props-learn-v1',fallback:false,controlAvailable:true,shadows:['props-learn-v2']});
 const byVersion=JSON.parse(psql(db,`SELECT json_object_agg(model_version,n) FROM (SELECT model_version,count(*) n FROM props_predictions GROUP BY 1) x`).out);
 assert.deepEqual(byVersion,{'props-nb-minutes-rate-v1':48,'props-learn-v1':48,'props-learn-v2':48});
 const picks=JSON.parse(psql(db,`SELECT json_object_agg(k,n) FROM (SELECT p.model_version||'/'||k.selection_version k,count(*) n
  FROM props_picks k JOIN props_predictions p ON p.id=k.prediction_id GROUP BY 1) x`).out);
 assert.deepEqual(Object.keys(picks),['props-learn-v1/props-select-v2']);
 assert.equal(picks['props-learn-v1/props-select-v2'],48);
 const accounts=psql(db,`SELECT string_agg(DISTINCT a.slug,',') FROM props_entries e JOIN props_accounts a ON a.id=e.account_id`).out;
 assert.ok(accounts.length>0&&accounts.split(',').every(s=>s.endsWith('-v2')),accounts);
});

test('a tampered active artifact falls back to the stats model and its accounts',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const db='props_it_fallback';
 const {store,deps,add,event}=await learningDb(db);
 await add('props-learn-v1','f'.repeat(64));await event('props-learn-v1','eligible');
 await store.rpc('props_promote_model',{p_version:'props-learn-v1',p_actor:'system:test',p_reason:'integration test'});
 clock='2026-11-07T19:00:00.000Z';
 const c=await runCollect(deps,'collect-2026-11-07T19',null);
 assert.equal(c.outcome,'COMPLETED',JSON.stringify(c.summary));
 assert.equal(c.summary.activeModel.fallback,true);
 assert.equal(c.summary.activeModel.version,'props-nb-minutes-rate-v1');
 assert.equal(psql(db,`SELECT string_agg(DISTINCT selection_version,',') FROM props_picks`).out,'props-select-v1');
 const accounts=psql(db,`SELECT string_agg(DISTINCT a.slug,',') FROM props_entries e JOIN props_accounts a ON a.id=e.account_id`).out;
 assert.ok(accounts.length>0&&accounts.split(',').every(s=>s.endsWith('-v1')),accounts);
});

test('weekly learning loop: settle brake, train, evaluate, auto-switch, review and owner actions',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const {runTrain,runEvaluate,runReview,runOwnerAction}=await import('./props-learn-worker.ts');
 const {verifiedArtifact}=await import('./props-active-model.ts');
 const db='props_it_loop';
 const {store,deps,add,event}=await learningDb(db);
 await add('props-learn-v1');await event('props-learn-v1','shadow_start');
 clock='2026-11-07T19:00:00.000Z';
 assert.equal((await runCollect(deps,'collect-2026-11-07T19',null)).outcome,'COMPLETED');
 finals['20261107']=7;
 clock='2026-11-08T07:00:00.000Z';
 const s=await runSettle(deps,'settle-2026-11-08T07',null);
 assert.equal(s.outcome,'COMPLETED',JSON.stringify(s.summary));
 assert.equal(s.summary.safetyBrake.trip,false);
 assert.ok(s.summary.safetyBrake.n>0&&s.summary.safetyBrake.n<50,JSON.stringify(s.summary.safetyBrake));
 assert.equal(s.summary.safetyBrake.model,'props-nb-minutes-rate-v1');

 const learn={store,now,historical:[]};
 // Learning off: nothing is trained, evaluated or switched.
 await runOwnerAction(store,'learning_off',{reason:'integration test',actor:'owner:test'});
 assert.deepEqual(await runTrain(learn),{status:'LEARNING_DISABLED'});
 const frozen=await runEvaluate({store,now},{minGradedLines:1,minDates:1,minGames:1,minCandidateDecisions:0,maxBrierDifferenceUpper95:1,bootstrapReplicates:50,bootstrapSeed:1,requireNoWorseLogLoss:false});
 assert.equal(frozen.status,'LEARNING_DISABLED');
 assert.equal(frozen.promoted,null);
 assert.equal(psql(db,`SELECT count(*) FROM props_model_events WHERE event='eligible'`).out,'0');
 assert.equal(psql(db,'SELECT count(*) FROM props_model_artifacts').out,'1');
 await runOwnerAction(store,'learning_on',{reason:'integration test',actor:'owner:test'});

 // Synthetic history (TEST-ONLY) plus the graded forward lines.
 let seed=11;const r=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
 const historical=Array.from({length:900},(_,i)=>{const p=0.35+r()*0.3;return {stat:['points','rebounds','assists'][i%3],
  input:{base:{pMore:p,pLess:1-p,pTie:0},market:null,matchup:{oppAllowedRatio:0.9+r()*0.2,home:i%2,restDays:i%4,backToBack:i%4===0?1:0}},
  y:r()<p?1:0,at:new Date(Date.UTC(2026,0,1)+i*3600_000).toISOString(),key:'h'+i,eventId:'h'+(i%60),date:'2026-01-01'};});
 const t=await runTrain({...learn,historical});
 assert.ok(['SHADOWING','DROPPED'].includes(t.status),JSON.stringify(t));
 assert.equal(t.version,'props-learn-v2');
 assert.equal(t.marketWeightsActive,false);
 const row=JSON.parse(psql(db,`SELECT json_build_object('version',version,'sha256',sha256,'artifact',artifact) FROM props_model_artifacts WHERE version='props-learn-v2'`).out);
 assert.ok(verifiedArtifact(row),'stored artifact verifies');
 const evs=psql(db,`SELECT string_agg(event,',' ORDER BY id) FROM props_model_events WHERE version='props-learn-v2'`).out;
 assert.ok(evs==='created,shadow_start'||evs==='created,dropped',evs);

 // A broken fit writes nothing.
 const bad=historical.map((h,i)=>i===0?{...h,input:{...h.input,base:{pMore:NaN,pLess:NaN,pTie:0}}}:h);
 assert.equal((await runTrain({...learn,historical:bad})).status,'FAILED_INVALID_ARTIFACT');
 assert.equal(psql(db,'SELECT count(*) FROM props_model_artifacts').out,'2');

 // The registered gate needs far more evidence than one night.
 const strict=await runEvaluate({store,now});
 assert.ok(strict.challengers.find(c=>c.version==='props-learn-v1').failed.includes('min_lines'));
 assert.equal(strict.promoted,null);
 // A relaxed TEST gate: auto-switch off records eligibility only; on, it promotes.
 const relaxed={minGradedLines:1,minDates:1,minGames:1,minCandidateDecisions:0,maxBrierDifferenceUpper95:1,bootstrapReplicates:50,bootstrapSeed:1,requireNoWorseLogLoss:false};
 await runOwnerAction(store,'auto_off',{reason:'integration test',actor:'owner:test'});
 const held=await runEvaluate({store,now},relaxed);
 assert.equal(held.promoted,null);
 assert.equal(psql(db,`SELECT event FROM props_model_events WHERE version='props-learn-v1' ORDER BY id DESC LIMIT 1`).out,'eligible');
 // A later failing check withdraws the eligibility, so a stale pass can never be approved.
 await runEvaluate({store,now});
 assert.equal(psql(db,`SELECT event||'|'||reason FROM props_model_events WHERE version='props-learn-v1' ORDER BY id DESC LIMIT 1`).out.split('|')[0],'shadow_start');
 assert.match(psql(db,`SELECT reason FROM props_model_events WHERE version='props-learn-v1' ORDER BY id DESC LIMIT 1`).out,/^No longer eligible/);
 await assert.rejects(store.rpc('props_promote_model',{p_version:'props-learn-v1',p_actor:'owner:test',p_reason:'stale'}),/PROPS_MODEL_NOT_ELIGIBLE/);
 await runEvaluate({store,now},relaxed);
 await runOwnerAction(store,'auto_on',{reason:'integration test',actor:'owner:test'});
 const auto=await runEvaluate({store,now},relaxed);
 assert.equal(auto.promoted,'props-learn-v1');
 assert.equal(psql(db,'SELECT active_model_version FROM props_model_control').out,'props-learn-v1');

 // Weekly review stored; owner roll back restores the stats model.
 const rv=await runReview({store,now});
 assert.equal(rv.status,'OK');
 assert.equal(psql(db,'SELECT count(*) FROM props_learning_reports').out,'1');
 await runOwnerAction(store,'rollback',{reason:'integration test',actor:'owner:test'});
 assert.equal(psql(db,'SELECT active_model_version FROM props_model_control').out,'props-nb-minutes-rate-v1');
 await assert.rejects(runOwnerAction(store,'approve',{version:'v1; drop table',reason:'x',actor:'owner:test'}),/PROPS_INVALID_VERSION/);
});

test('review fix: a learning-layer failure never costs the run its picks',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const {PropsStoreError}=await import('./props-store.ts');
 for(const withActive of [true,false]){
  const db=withActive?'props_it_learnfail_a':'props_it_learnfail_s';
  const {store,deps,add,event}=await learningDb(db);
  if(withActive){await add('props-learn-v1');await event('props-learn-v1','eligible');
   await store.rpc('props_promote_model',{p_version:'props-learn-v1',p_actor:'system:test',p_reason:'integration test'});}
  await add('props-learn-v2');await event('props-learn-v2','shadow_start');
  // The matchup read (paged with offset) fails, as a transient Supabase error would.
  const flaky={...store,select:async(t,q)=>{if(t==='props_player_games'&&q.includes('offset='))throw new PropsStoreError('STORE_OUTCOME_UNKNOWN',false);return store.select(t,q);}};
  clock='2026-11-07T19:00:00.000Z';
  const c=await runCollect({...deps,store:flaky},'collect-2026-11-07T19',null);
  assert.equal(c.outcome,'COMPLETED',JSON.stringify(c.summary));
  assert.equal(c.summary.predictions.learnError,'STORE_OUTCOME_UNKNOWN');
  assert.equal(c.summary.activeModel.fallback,withActive);
  assert.equal(psql(db,`SELECT string_agg(DISTINCT selection_version,',') FROM props_picks`).out,'props-select-v1');
  const accounts=psql(db,`SELECT string_agg(DISTINCT a.slug,',') FROM props_entries e JOIN props_accounts a ON a.id=e.account_id`).out;
  assert.ok(accounts.length>0&&accounts.split(',').every(s=>s.endsWith('-v1')),accounts);
 }
});

// ---------------------------------------------------------------- reliability (primary/backup races, delays, failures)
function oddsFor(evs,{fail=new Set(),throwOn=new Set()}={}){
 const c={calls:0};
 c.events=async()=>{c.calls++;return {ok:true,httpStatus:200,body:evs,receivedAt:clock,usage:{remaining:400,used:100,last:1}};};
 c.eventOdds=async id=>{c.calls++;
  if(throwOn.has(id))throw new Error('TEST_NETWORK_DROP');
  if(fail.has(id))return {ok:false,httpStatus:500,body:{message:'TEST provider error'},receivedAt:clock,usage:{remaining:390,used:110,last:3}};
  const g=evs.findIndex(x=>x.id===id);const [h,a]=GAMES[g];
  const book=(key,shift)=>({key,markets:[['player_points',2],['player_rebounds',3],['player_assists',4]].map(([m,idx])=>({key:m,last_update:clock,
   outcomes:[...PLAYERS[h],...PLAYERS[a]].flatMap(pl=>{const line=Math.max(0.5,Math.floor(pl[idx]*0.8)+0.5+shift);
    return [{name:'Over',description:pl[1],price:-137,point:line,...(key==='pick6'?{multiplier:1}:{})},{name:'Under',description:pl[1],price:-137,point:line}];})}))});
  return {ok:true,httpStatus:200,body:{...evs[g],bookmakers:[book('prizepicks',0),book('pick6',1)]},receivedAt:clock,usage:{remaining:390,used:110,last:3}};};
 return c;
}
const evsAt=(day,prefix)=>GAMES.map((x,g)=>({id:prefix+g,commence_time:`2026-11-${String(day+1).padStart(2,'0')}T0${g}:00:00Z`,home_team:x[2],away_team:x[3],sport_key:'basketball_nba'}));
const count=(sql)=>Number(psql(DB,sql).out);

test('reliability: backup races, late arrivals and partial failures never repeat paid calls or entries',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'props-rel-'));
 const clockFile=join(dir,'clock.sql');writeFileSync(clockFile,testClockSql);
 resetDb(DB,[schema('props_v1.sql'),schema('props_market_v1.sql'),clockFile]);
 const env={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
 const store=propsStore(env,pgFetch(DB,now));
 await store.rpc('props_set_control',{p_state:'RUNNING',p_reason:'reliability test',p_actor:'owner-test'});
 for(const day of [1,2,3,4])finals['202611'+String(day).padStart(2,'0')]=day;
 const base={store,espn,model,now,seasonStart:'2026-10-01T00:00:00Z'};
 clock='2026-11-06T12:00:00.000Z';
 assert.equal((await runSettle({...base,odds:null,worker:'test:bf'},'backfill-rel',null,{kind:'backfill',dates:['2026-11-01','2026-11-02','2026-11-03','2026-11-04']})).outcome,'COMPLETED');

 // 1. Primary and backup start the same slot together: exactly one does the work and pays.
 const o1=oddsFor(evsAt(7,'evtRELa000'));
 clock='2026-11-07T20:05:00.000Z';                       // 55 min after the 19:10 slot (a Vercel backup time)
 const slot='collect-2026-11-07T19',sch='2026-11-07T19:10:00.000Z';
 const [a,b]=await Promise.all([runCollect({...base,odds:o1,worker:'gha:1:1',trigger:'github-schedule'},slot,sch),
  runCollect({...base,odds:o1,worker:'gha:2:1',trigger:'backup-dispatch'},slot,sch)]);
 const outcomes=[a.outcome,b.outcome].sort();
 assert.ok(outcomes[0]==='BUSY'||outcomes[0]==='COMPLETED'||outcomes[0]==='DUPLICATE',outcomes.join());
 assert.equal(outcomes.filter(x=>x==='COMPLETED').length,1,outcomes.join());
 const won=a.outcome==='COMPLETED'?a:b;
 assert.equal(o1.calls,3,'one events list + two games, once');
 assert.equal(count(`SELECT coalesce(sum(credits),0) FROM props_credit_reservations`),7);
 const entries=count('SELECT count(*) FROM props_entries');
 assert.ok(entries>=1,JSON.stringify(won.summary.entries));
 assert.ok(['github-schedule','backup-dispatch'].includes(won.summary.trigger));
 // The late GitHub run of the same slot arrives hours later: refused before any spend.
 clock='2026-11-08T02:00:00.000Z';
 assert.equal((await runCollect({...base,odds:o1,worker:'gha:3:1',trigger:'github-schedule'},slot,sch)).outcome,'DUPLICATE');
 assert.equal(o1.calls,3);assert.equal(count('SELECT count(*) FROM props_entries'),entries);
 assert.equal(count(`SELECT coalesce(sum(credits),0) FROM props_credit_reservations`),7);
 assert.equal(count(`SELECT count(*) FROM props_runs WHERE slot_key='${slot}'`),1);

 // 2. A collect that arrives more than 150 minutes late spends nothing, so the next day's slot keeps its budget.
 const o2=oddsFor(evsAt(8,'evtRELb000'));
 clock='2026-11-08T21:45:00.000Z';                       // 155 minutes after 19:10
 const late=await runCollect({...base,odds:o2,worker:'gha:4:1',trigger:'github-schedule'},'collect-2026-11-08T19','2026-11-08T19:10:00.000Z');
 assert.equal(late.outcome,'SKIPPED_LATE');assert.equal(late.summary.reason,'started_too_late_for_slot');
 assert.equal(o2.calls,0);
 assert.equal(count(`SELECT count(*) FROM props_credit_reservations WHERE run_id=${late.runId}`),0);
 assert.equal(psql(DB,`SELECT status||':'||outcome FROM props_runs WHERE id=${late.runId}`).out,'completed:SKIPPED_LATE');
 // 149 minutes late (the 22:10 slot, just after midnight UTC) still collects, under its own slot key.
 clock='2026-11-09T00:39:00.000Z';
 const onTime=await runCollect({...base,odds:o2,worker:'gha:5:1',trigger:'backup-dispatch'},'collect-2026-11-08T22','2026-11-08T22:10:00.000Z');
 assert.equal(onTime.outcome,'COMPLETED',JSON.stringify(onTime.summary).slice(0,400));
 assert.equal(onTime.summary.startDelaySeconds,149*60);

 // 3. Partial failure: one game's provider call fails. The run records the other game; a backup for the
 //    same slot is refused, so the paid calls are not repeated.
 const o3=oddsFor(evsAt(10,'evtRELc000'),{fail:new Set(['evtRELc0001'])});
 clock='2026-11-10T20:00:00.000Z';
 const part=await runCollect({...base,odds:o3,worker:'gha:6:1',trigger:'github-schedule'},'collect-2026-11-10T19','2026-11-10T19:10:00.000Z');
 assert.equal(part.outcome,'COMPLETED');
 const perEvent=part.summary.collection;
 assert.ok(perEvent.some(x=>x.event==='evtRELc0001'&&x.outcome!=='stored'),JSON.stringify(perEvent));
 const callsAfter=o3.calls;
 assert.equal((await runCollect({...base,odds:o3,worker:'gha:7:1',trigger:'backup-dispatch'},'collect-2026-11-10T19','2026-11-10T19:10:00.000Z')).outcome,'DUPLICATE');
 assert.equal(o3.calls,callsAfter);
 // Entries never fall back to a single game to fill a quota: one priced game gives an explicit reason.
 for(const p of ['prizepicks','pick6']){
  const e=part.summary.entries[p];
  if(!e.entries.length)assert.ok(['TOO_FEW_DISTINCT_GAMES','NO_QUALIFYING_PICKS'].includes(e.noEntryReason),JSON.stringify(e));
 }
 assert.equal(count(`SELECT count(*) FROM (SELECT e.id FROM props_entries e JOIN props_entry_legs l ON l.entry_id=e.id
  JOIN props_picks k ON k.id=l.pick_id JOIN props_predictions p ON p.id=k.prediction_id JOIN props_observations o ON o.id=p.observation_id
  GROUP BY e.id HAVING count(DISTINCT o.provider_event_id)<count(*)) x`),0,'no entry ever repeats a game');

 // 4. A run that dies mid-way (network drop on every game) stays one row; its backup does not pay again.
 const entriesBefore=count('SELECT count(*) FROM props_entries'),legsBefore=count('SELECT count(*) FROM props_entry_legs');
 const o4=oddsFor(evsAt(11,'evtRELd000'),{throwOn:new Set(['evtRELd0000','evtRELd0001','evtRELd0002'])});
 clock='2026-11-11T22:30:00.000Z';
 const drop=await runCollect({...base,odds:o4,worker:'gha:8:1',trigger:'github-schedule'},'collect-2026-11-11T22','2026-11-11T22:10:00.000Z');
 const paid=o4.calls;
 assert.ok(paid>=1);
 assert.equal((await runCollect({...base,odds:o4,worker:'gha:9:1',trigger:'backup-dispatch'},'collect-2026-11-11T22','2026-11-11T22:10:00.000Z')).outcome,'DUPLICATE');
 assert.equal(o4.calls,paid);
 assert.equal(count(`SELECT count(*) FROM props_runs WHERE slot_key='collect-2026-11-11T22'`),1,drop.outcome);
 // Append-only: the failed run and its refused backup add no entry and change no earlier leg.
 assert.equal(count('SELECT count(*) FROM props_entries'),entriesBefore);
 assert.equal(count('SELECT count(*) FROM props_entry_legs'),legsBefore);
});
