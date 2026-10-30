import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleResearchCycle,researchCycleEnvironmentReady} from './research-cycle-handler.ts';

const token='a'.repeat(64);
function request(body={runId:7},options={}){
  return new Request('https://sports-edge-eta.vercel.app/api/internal/research-cycle',{
    method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify(body),...options});
}
function setup(overrides={}){
  const calls=[];
  const deps={enabled:true,
    claim:async(id,hash)=>{calls.push(['claim',id,hash]);return {id,probe:false};},
    finish:async(...args)=>{calls.push(['finish',...args]);},
    reserve:async track=>{calls.push(['reserve',track]);return true;},
    probe:async()=>{calls.push(['probe']);return {status:'connected',sportsCount:9};},
    collect:async()=>{calls.push(['collect']);return {status:'completed',tracks:{nba:{gamesProcessed:2}}};},
    ...overrides};
  return {calls,deps};
}

test('missing auth, malformed auth and disabled environments cannot touch the DB',async()=>{
  for(const auth of ['',`Bearer ${'z'.repeat(64)}`,`Bearer ${token}x`]){
    const {calls,deps}=setup();
    const r=await handleResearchCycle(request({runId:7},{headers:{authorization:auth,'content-type':'application/json'}}),deps);
    assert.equal(r.status,404);assert.deepEqual(calls,[]);
  }
  const {calls,deps}=setup({enabled:false});
  assert.equal((await handleResearchCycle(request(),deps)).status,404);
  assert.deepEqual(calls,[]);
});
test('only a bounded, exact runId request is accepted',async()=>{
  for(const body of [null,[],{}, {runId:0},{runId:1.5},{runId:'7'},
    {runId:7,probe:false},{runId:7,action:'paper'}, {runId:7,pad:'x'.repeat(90)}]){
    const {calls,deps}=setup();
    assert.equal((await handleResearchCycle(request(body),deps)).status,400);
    assert.deepEqual(calls,[]);
  }
  const {calls,deps}=setup();
  assert.equal((await handleResearchCycle(request(undefined,{body:'{' }),deps)).status,400);
  assert.deepEqual(calls,[]);
});
test('request streams are capped across chunks before any DB access',async()=>{
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(50));c.enqueue(new Uint8Array(50));c.close();}});
  const {calls,deps}=setup();
  const r=await handleResearchCycle(request(undefined,{body:stream,duplex:'half'}),deps);
  assert.equal(r.status,400);assert.deepEqual(calls,[]);
});
test('query parameters and wrong content type do not claim a capability',async()=>{
  const {calls,deps}=setup();
  const r=request();
  assert.equal((await handleResearchCycle(new Request(r.url+'?probe=0',r),deps)).status,400);
  assert.equal((await handleResearchCycle(request({}, {headers:{authorization:`Bearer ${token}`,'content-type':'text/plain'}}),deps)).status,400);
  assert.deepEqual(calls,[]);
});
test('unknown, expired or already claimed capabilities cannot reserve credits',async()=>{
  const {calls,deps}=setup({claim:async()=>null});
  assert.equal((await handleResearchCycle(request(),deps)).status,404);
  assert.deepEqual(calls,[]);
});
test('only the token hash reaches the DB and a capability cannot be replayed',async()=>{
  const {calls,deps}=setup();let used=false;
  const original=deps.claim;
  deps.claim=async(...args)=>{if(used)return null;used=true;return original(...args);};
  assert.equal((await handleResearchCycle(request(),deps)).status,200);
  assert.equal((await handleResearchCycle(request(),deps)).status,404);
  assert.deepEqual(calls[0],['claim',7,createHash('sha256').update(token).digest('hex')]);
  assert.equal(calls.filter(c=>c[0]==='collect').length,1);
  assert.ok(!JSON.stringify(calls).includes(token));
});
test('probe behavior comes only from the DB and never uses provider credits',async()=>{
  const {calls,deps}=setup({claim:async()=>({id:7,probe:true})});
  const r=await handleResearchCycle(request(),deps);
  assert.equal(r.status,200);assert.equal((await r.json()).mode,'READ_ONLY_PROBE');
  assert.deepEqual(calls.map(c=>c[0]),['probe','finish']);
});
test('quota denial on either track prevents collection',async()=>{
  for(const denied of ['nba','soccer']){
    const {calls,deps}=setup({reserve:async track=>{calls.push(['reserve',track]);return track!==denied;}});
    const r=await handleResearchCycle(request(),deps);
    assert.equal(r.status,429);assert.ok(!calls.some(c=>c[0]==='collect'));
    assert.equal(calls.at(-1)[2],'failed');
  }
});
test('a full run reserves both tracks once, collects once and writes a receipt',async()=>{
  const {calls,deps}=setup();
  const r=await handleResearchCycle(request(),deps);
  assert.equal(r.status,200);
  assert.deepEqual(calls.map(c=>c[0]),['claim','reserve','reserve','collect','finish']);
  const result=await r.json();
  assert.equal(result.status,'refreshed');assert.equal(result.realMoneyEnabled,false);
  assert.equal(result.automaticBettingEnabled,false);
  assert.equal(r.headers.get('cache-control'),'private, no-store, max-age=0');
});
test('upstream failures are audited without retrying or leaking secret URLs',async()=>{
  const {calls,deps}=setup({collect:async()=>{calls.push(['collect']);throw Error('https://provider.test/?apiKey=SECRET');}});
  const r=await handleResearchCycle(request(),deps);
  assert.equal(r.status,503);assert.ok(!(await r.text()).includes('SECRET'));
  assert.equal(calls.filter(c=>c[0]==='collect').length,1);
  assert.equal(calls.at(-1)[2],'failed');
  assert.ok(!JSON.stringify(calls).includes('SECRET'));
});
test('receipt failure after collection is unverified, never reported as confirmed',async()=>{
  const {calls,deps}=setup({finish:async()=>{throw Error('unavailable');}});
  const r=await handleResearchCycle(request(),deps);
  assert.equal(r.status,503);assert.equal((await r.json()).automaticRetry,false);
  assert.equal(calls.filter(c=>c[0]==='collect').length,1);
});
test('production refresh is pinned to the original research DB, never preview fixtures',()=>{
  const env={VERCEL_ENV:'production',SUPABASE_URL:'https://fzyjazhvkstvwwzjhlrr.supabase.co',
    SUPABASE_SECRET_KEY:'configured',ODDS_API_KEY:'configured'};
  assert.equal(researchCycleEnvironmentReady(env),true);
  for(const change of [{VERCEL_ENV:'preview'},{SPORTSEDGE_PREVIEW_FIXTURES:'1'},
    {SUPABASE_READONLY_KEY:'configured'},{ODDS_API_KEY:''},{SUPABASE_SECRET_KEY:''},
    {SUPABASE_URL:'https://mcaxfaaohyencpspalfe.supabase.co'},
    {SUPABASE_URL:env.SUPABASE_URL+'?redirect=1'},
    {SUPABASE_URL:'https://user:pass@fzyjazhvkstvwwzjhlrr.supabase.co'}])
    assert.equal(researchCycleEnvironmentReady({...env,...change}),false,JSON.stringify(change));
});
