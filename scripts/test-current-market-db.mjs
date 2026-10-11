// Synthetic disposable PostgreSQL (PGlite). No Supabase credentials or network calls.
// SPORTSEDGE_PGLITE_MODULE points to an independently installed PGlite module.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.SPORTSEDGE_PGLITE_MODULE??'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create table public.teams(id bigint primary key,name text);
create table public.games(id bigint primary key,home_team_id bigint,away_team_id bigint,starts_at timestamptz,status text);
create table public.odds_snapshots(id bigint primary key,game_id bigint,sportsbook text,provider text,market text,line numeric,selection text,american_odds integer,observed_at timestamptz,ingested_at timestamptz);
`);
await db.exec(await readFile(new URL('../database/migrations/20261008231840_forward_research_ledger_v1.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/migrations/20261011193330_quote_current_market_guard.sql',import.meta.url),'utf8'));
await db.exec(`insert into teams values(1,'Home'),(2,'Away');
insert into games values(1,1,2,clock_timestamp()+interval '1 day','scheduled');
insert into research_model_versions values('frozen','synthetic',clock_timestamp()-interval '1 day',65,'{}','{}');
insert into research_forecasts(game_id,model_version,home_probability,starts_at,source_revision) select id,'frozen',0.7,starts_at,'synthetic' from games;
insert into research_accounts(slug,initial_cents) values('synthetic',100000);
insert into odds_snapshots values(1,1,'book','test','h2h',null,'Home',100,now()-interval '10 seconds',now()),(2,1,'book','test','h2h',null,'Away',-110,now()-interval '10 seconds',now());`);
let checks=0;
async function scenario(name,setup,expected){
 await db.exec('begin');
 try{
  if(setup)await db.exec(setup);
  if(expected)await assert.rejects(db.query('select research_place_current(1,1,1,60)'),expected);
  else {const r=await db.query('select research_place_current(1,1,1,60) as id');assert.ok(r.rows[0].id);const again=await db.query('select research_place_current(1,1,1,60) as id');assert.equal(again.rows[0].id,r.rows[0].id);const positions=await db.query('select stake_cents from research_positions');assert.equal(positions.rows.length,1);assert.equal(positions.rows[0].stake_cents,1000);}
  checks++;console.log('PASS',name);
 }finally{await db.exec('rollback');}
}
await scenario('fresh market preserves exact legacy stake and idempotency','');
await scenario('stale provider timestamp',"update odds_snapshots set observed_at=now()-interval '61 seconds'",/stale/);
await scenario('future ingestion',"update odds_snapshots set ingested_at=now()+interval '1 day'",/stale/);
await scenario('new complete price supersedes selected quote',"insert into odds_snapshots select id+2,game_id,sportsbook,provider,market,line,selection,-300,now(),now() from odds_snapshots",/superseded/);
await scenario('new incomplete market also blocks historical price',"insert into odds_snapshots select 3,game_id,sportsbook,provider,market,line,selection,-300,now(),now() from odds_snapshots where id=1",/superseded/);
await scenario('same timestamp conflicting price',"insert into odds_snapshots select 3,game_id,sportsbook,provider,market,line,selection,-300,observed_at,ingested_at from odds_snapshots where id=1",/Ambiguous/);
await scenario('missing opposing side',"delete from odds_snapshots where id=2",/no rows/);
await scenario('different provider is not a complete market',"update odds_snapshots set provider='other' where id=2",/no rows/);
await scenario('new selected price loses edge',"update odds_snapshots set american_odds=-400 where id=1",/selection rule/);
await scenario('cancelled game',"update games set status='cancelled'",/Ineligible/);
await scenario('rescheduled game',"update games set starts_at=starts_at+interval '1 day'",/Ineligible/);
await scenario('insufficient virtual cash',"alter table research_accounts disable trigger protect_audit; update research_accounts set initial_cents=50",/Insufficient/);
await assert.rejects(db.query('select research_place_current(1,1,1,61)'),/policy/);checks++;
await assert.rejects(db.query('select research_place_current(1,1,1,1)'),/stale/);checks++;
await db.exec('begin; update odds_snapshots set observed_at=now()-interval \'61 seconds\'');
await assert.rejects(db.query('select research_place(1,1,1)'),/stale/);checks++;await db.exec('rollback');
const perms=await db.query("select has_function_privilege('anon','public.research_place_current(bigint,bigint,bigint,integer)','EXECUTE') as anon,has_function_privilege('authenticated','public.research_place_current(bigint,bigint,bigint,integer)','EXECUTE') as authenticated");
assert.deepEqual(perms.rows,[{anon:false,authenticated:false}]);checks++;
console.log(`${checks} database checks passed; synthetic only. Multi-session concurrency is not tested by PGlite.`);
// Execute the real TypeScript runner through this synthetic SQL adapter.
const ts=(await import('typescript')).default;
let source=await readFile(new URL('../src/lib/server/research-operations.ts',import.meta.url),'utf8');
source=source.replace("import 'server-only';",'').replace("import {researchDb,forecasts} from './research-db';",'const researchDb=(...args)=>globalThis.__marketDb.db(...args);const forecasts=()=>globalThis.__marketDb.forecasts();');
for(const path of ['research-math','result-validation','ingestion/current-market'])source=source.replace("'@/lib/"+path+"'",JSON.stringify(new URL('../src/lib/'+path+'.ts',import.meta.url).href));
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {placeResearch}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for(const move of [false,true]){
 await db.exec('begin');
 try{
  await db.exec("update odds_snapshots set observed_at=clock_timestamp()-interval '5 seconds',ingested_at=clock_timestamp()");
  globalThis.__marketDb={forecasts:async()=>[{id:1,game_id:1,starts_at:new Date(Date.now()+86400000).toISOString(),home_probability:.7,games:{home:{name:'Home'},away:{name:'Away'}}}],db:async(path,body)=>{
   if(path.startsWith('research_accounts?'))return [{id:1}];
   if(path.startsWith('research_positions?'))return [];
   if(path.startsWith('odds_snapshots?'))return (await db.query('select * from odds_snapshots')).rows;
   if(path==='rpc/research_place_current'){
    if(move)await db.exec("insert into odds_snapshots select id+2,game_id,sportsbook,provider,market,line,selection,-400,clock_timestamp(),clock_timestamp() from odds_snapshots");
    return (await db.query('select research_place_current($1,$2,$3,$4) as id',[body.p_account,body.p_forecast,body.p_quote,body.p_max_age_seconds])).rows[0].id;
   }
   throw Error('Unexpected adapter call');
  }};
  const result=await placeResearch(1);
  assert.equal(result.positionIds.length,move?0:1);
  assert.equal(result.failedGames.length,move?1:0);
  console.log('PASS runner → PostgreSQL:',move?'moved line rejected':'exact quote persisted');
 }finally{await db.exec('rollback');}
}
await db.close();
