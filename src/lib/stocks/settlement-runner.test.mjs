import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

let source=await readFile(new URL('../server/research-operations.ts',import.meta.url),'utf8');
source=source.replace("import 'server-only';",'')
  .replace("import {researchDb,forecasts} from './research-db';",
           'const researchDb=(...args)=>globalThis.__settleTest.db(...args);const forecasts=()=>globalThis.__settleTest.forecasts();')
  .replace("'@/lib/research-math'",JSON.stringify(new URL('../research-math.ts',import.meta.url).href))
  .replace("'@/lib/ingestion/current-market'",JSON.stringify(new URL('../ingestion/current-market.ts',import.meta.url).href))
  .replace("'@/lib/result-validation'",JSON.stringify(new URL('../result-validation.ts',import.meta.url).href))
  .replace("'@/lib/settlement-worklist'",JSON.stringify(new URL('../settlement-worklist.ts',import.meta.url).href));
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;
const {settleResearch}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

const old='2026-01-10T19:00:00Z';
const future='2099-10-20T19:00:00Z';
const forecast=(id,date=old)=>({id,game_id:id+100,starts_at:date,
  games:{home:{name:'Home '+id},away:{name:'Away '+id}}});
function harness({positions=[],settlements=[],results=[],forecasts=[],scores=null,fail=false}={}){
  const queries=[],writes=[],network=[];
  globalThis.__settleTest={
    forecasts:async()=>forecasts,
    db:async(path,payload)=>{
      queries.push(path);
      if(path.startsWith('research_positions?'))return positions;
      if(path.startsWith('research_settlements?'))return settlements;
      if(path.startsWith('research_results?'))return results;
      if(path==='rpc/research_record_result'){writes.push({path,payload});return null;}
      if(path==='rpc/research_settle'){writes.push({path,payload});return 2;}
      throw new Error('Unexpected DB path: '+path);
    }
  };
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    network.push(String(url));
    if(fail)throw Error('Fake ESPN network unavailable');
    return {ok:true,json:async()=>scores??{events:[]}};
  };
  return {queries,writes,network,restore:()=>{globalThis.fetch=originalFetch;}};
}
function officialFinal(id){
  const f=forecast(id);
  return {date:f.starts_at,season:{type:2},competitions:[{
    status:{type:{completed:true,name:'STATUS_FINAL'}},
    competitors:[{homeAway:'home',team:{displayName:f.games.home.name},score:'111'},
                 {homeAway:'away',team:{displayName:f.games.away.name},score:'101'}]
  }]};
}
test('no bets means no results provider or result RPC requests',async()=>{
  const h=harness();
  try{
    const r=await settleResearch();
    assert.deepEqual(r.recordedGames,[]);assert.equal(r.settledPositions,0);
    assert.equal(h.network.length,0);assert.deepEqual(h.writes,[]);
    assert.equal(h.queries.filter(x=>x.startsWith('research_positions?')).length,1);
  }finally{h.restore();}
});
test('only future pending bets means zero outside score calls',async()=>{
  const h=harness({positions:[{id:1,forecast_id:1}],forecasts:[forecast(1,future)]});
  try{
    const r=await settleResearch();
    assert.equal(r.openPositions,1);
    assert.deepEqual(r.skippedFutureGames,[101]);
    assert.equal(h.network.length,0);assert.deepEqual(h.writes,[]);
  }finally{h.restore();}
});
test('prior recorded final goes directly to deterministic DB settlement',async()=>{
  const h=harness({positions:[{id:1,forecast_id:1}],forecasts:[forecast(1)],
    results:[{game_id:101}]});
  try{
    const r=await settleResearch();
    assert.deepEqual(r.reusedRecordedResults,[101]);assert.equal(r.settledPositions,2);
    assert.equal(h.network.length,0);
    assert.deepEqual(h.writes.map(x=>x.path),['rpc/research_settle']);
  }finally{h.restore();}
});
test('one verified final uses one source fetch and one record write',async()=>{
  const h=harness({positions:[{id:1,forecast_id:1}],forecasts:[forecast(1)],
    scores:{events:[officialFinal(1)]}});
  try{
    const r=await settleResearch();
    assert.deepEqual(r.recordedGames,[101]);assert.equal(h.network.length,1);
    assert.deepEqual(h.writes.map(x=>x.path),['rpc/research_record_result','rpc/research_settle']);
    assert.equal(h.writes[0].payload.p_home,111);
    assert.equal(h.writes[0].payload.p_away,101);
  }finally{h.restore();}
});
test('two different games on one calendar day share a verified scoreboard fetch',async()=>{
  const h=harness({positions:[{id:1,forecast_id:1},{id:2,forecast_id:2}],
    forecasts:[forecast(1),forecast(2)],scores:{events:[officialFinal(1),officialFinal(2)]}});
  try{
    const r=await settleResearch();
    assert.deepEqual(r.recordedGames,[101,102]);
    assert.equal(h.network.length,1);
    assert.deepEqual(h.writes.map(x=>x.path),[
      'rpc/research_record_result','rpc/research_record_result','rpc/research_settle'
    ]);
  }finally{h.restore();}
});
test('unverified scores never settle or become invented results',async()=>{
  const h=harness({positions:[{id:1,forecast_id:1}],forecasts:[forecast(1)],scores:{events:[]}});
  try{
    const r=await settleResearch();
    assert.deepEqual(r.unavailableGames,[101]);assert.equal(r.settledPositions,0);
    assert.deepEqual(h.writes,[]);
  }finally{h.restore();}
});
test('provider errors stop immediately without recording or settling',async()=>{
  const h=harness({positions:[{id:1,forecast_id:1}],forecasts:[forecast(1)],fail:true});
  try{
    await assert.rejects(settleResearch(),/Fake ESPN network unavailable/);
    assert.deepEqual(h.writes,[]);
  }finally{h.restore();}
});
test('existing completed wager does not trigger another settlement or price lookup',async()=>{
  const h=harness({positions:[{id:1,forecast_id:1}],
    settlements:[{position_id:1}],forecasts:[forecast(1)],results:[{game_id:101}]});
  try{
    const r=await settleResearch();assert.equal(r.openPositions,0);
    assert.equal(h.network.length,0);assert.deepEqual(h.writes,[]);
  }finally{h.restore();}
});
