import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
let source=await readFile(new URL('../server/research-operations.ts',import.meta.url),'utf8');
source=source.replace("import 'server-only';",'').replace("import {researchDb,forecasts} from './research-db';",'const researchDb=(...args)=>globalThis.__paperTest.db(...args);const forecasts=()=>globalThis.__paperTest.forecasts();').replace("'@/lib/research-math'",JSON.stringify(new URL('../research-math.ts',import.meta.url).href)).replace("'@/lib/result-validation'",JSON.stringify(new URL('../result-validation.ts',import.meta.url).href));
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {placeResearch}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const forecast=id=>({id,game_id:id,starts_at:'2099-01-01T00:00:00Z',home_probability:.7,games:{home:{name:'Home'},away:{name:'Away'}}});
function setup({count=2,existing=[],empty=false,fail=false}={}){const writes=[],reads=[];globalThis.__paperTest={forecasts:async()=>Array.from({length:count},(_,i)=>forecast(i+1)),db:async(path,body)=>{reads.push(path);if(path.startsWith('research_accounts?'))return [{id:1}];if(path.startsWith('research_positions?'))return existing.map(id=>({id,forecast_id:id}));if(path.startsWith('odds_snapshots?'))return empty?[]:[{id:11,sportsbook:'fixture',provider:'fixture',selection:'Home',american_odds:100,observed_at:new Date().toISOString()},{id:12,sportsbook:'fixture',provider:'fixture',selection:'Away',american_odds:-110,observed_at:new Date().toISOString()}].map(q=>({...q,observed_at:'fixture-same-market'}));if(path==='rpc/research_place'){writes.push(body);if(fail)throw Error('uncertain write');return body.p_forecast;}throw Error('unexpected DB call');}};return {writes,reads};}
test('already recorded forecasts never place again',async()=>{const {writes}=setup({existing:[1,2]});const r=await placeResearch(10);assert.deepEqual(r.alreadyRecordedPositionIds,[1,2]);assert.deepEqual(writes,[]);});
test('fresh complete model edge goes through existing checked DB RPC',async()=>{const {writes}=setup();const r=await placeResearch(1);assert.deepEqual(r.positionIds,[1]);assert.deepEqual(writes,[{p_account:1,p_forecast:1,p_quote:11}]);});
test('no source quotes means no fabricated bets',async()=>{const {writes}=setup({empty:true});const r=await placeResearch(10);assert.deepEqual(r.skippedGames,[1,2]);assert.deepEqual(writes,[]);});
test('uncertain receipt stops batch instead of retrying',async()=>{const {writes}=setup({fail:true});const r=await placeResearch(10);assert.equal(writes.length,1);assert.deepEqual(r.failedGames,[1]);assert.deepEqual(r.positionIds,[]);});
test('quote scanning is bounded even when nothing qualifies',async()=>{const {reads}=setup({count:20,empty:true});await placeResearch(10);assert.equal(reads.filter(s=>s.startsWith('odds_snapshots?')).length,10);});
test('bad limits reject before DB access',async()=>{const {reads}=setup();for(const n of [0,101,1.5])await assert.rejects(placeResearch(n));assert.deepEqual(reads,[]);});

test('empty quote skips retain PR20 reason reporting',async()=>{setup({empty:true});const r=await placeResearch(1);assert.deepEqual(r.skippedReasons,[{gameId:1,reason:'no_fresh_quotes'}]);assert.equal(r.candidateRpcsReturned,0);});
