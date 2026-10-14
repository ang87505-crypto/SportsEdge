import test from 'node:test';
import assert from 'node:assert/strict';
import {getStagingPaperStatus,haltStagingPaperExecution,StagingPaperError}
 from './alpaca-staging-operator.ts';
const staging={url:'https://mcaxfaaohyencpspalfe.supabase.co',key:'sb_secret_'+'p'.repeat(40)};
const status={
 environment:'SportsEdge Staging',accountKind:'paper',gateConfigured:true,
 halted:true,storedIntentCount:0,unresolvedReceiptCount:0,haltAuditEvents:1,
 executionPermitted:false,automaticOrdersEnabled:false,realMoneyOrdersEnabled:false
};
test('Owner staging HALT uses only fixed Supabase RPC, no broker URL, no client secrets',async()=>{
 const requests=[];
 const mock=async(url,opts)=>{
  requests.push({url,opts});
  assert.ok(url.startsWith(staging.url+'/rest/v1/rpc/'));
  assert.ok(!url.includes('alpaca.markets'));
  assert.equal(opts.method,'POST');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.apikey,staging.key);
  assert.equal(opts.body,'{}');
  return new Response(JSON.stringify(status),{status:200});
 };
 assert.deepEqual(await getStagingPaperStatus(mock,staging),status);
 assert.deepEqual(await haltStagingPaperExecution(mock,staging),status);
 assert.deepEqual(requests.map(x=>x.url),[
  staging.url+'/rest/v1/rpc/sportsedge_paper_stage_status',
  staging.url+'/rest/v1/rpc/sportsedge_paper_stage_halt'
 ]);
});
test('Production or wrong project, bad URLs and missing credentials fail closed',async()=>{
 const good=async()=>new Response(JSON.stringify(status));
 for(const bad of [
  {url:'https://fzyjazhvkstvwwzjhlrr.supabase.co',key:staging.key},
  {url:'http://mcaxfaaohyencpspalfe.supabase.co',key:staging.key},
  {url:'https://mcaxfaaohyencpspalfe.supabase.co:8080',key:staging.key},
  {url:'https://mcaxfaaohyencpspalfe.supabase.co/private',key:staging.key},
  {url:'https://mcaxfaaohyencpspalfe.supabase.co?leak=1',key:staging.key},
  {url:'https://mcaxfaaohyencpspalfe.supabase.co',key:'short'},
  {url:'',key:staging.key}
 ])await assert.rejects(()=>getStagingPaperStatus(good,bad),e=>e instanceof StagingPaperError);
});
test('Staging never advertises or accepts an enabled order gate',async()=>{
 for(const override of [
  {halted:false},
  {executionPermitted:true},
  {automaticOrdersEnabled:true},
  {realMoneyOrdersEnabled:true},
  {accountKind:'live'},
  {storedIntentCount:'0'},
  {unresolvedReceiptCount:-1},
  {gateConfigured:'maybe'}
 ]){
  const mock=async()=>new Response(JSON.stringify({...status,...override}));
  await assert.rejects(()=>getStagingPaperStatus(mock,staging),e=>
   e instanceof StagingPaperError&&e.code==='BAD_RESPONSE');
 }
});
test('Upstream failures, exceptions and invalid JSON become fixed error codes',async()=>{
 for(const [mock,code] of [
  [async()=>new Response('secrets',{status:401}),'UPSTREAM_ERROR'],
  [async()=>{throw Error('apikey secretly exposed')},'NETWORK'],
  [async()=>new Response('not json'),'BAD_RESPONSE'],
  [async()=>new Response('x'.repeat(9000)),'BAD_RESPONSE']
 ]){
  await assert.rejects(()=>haltStagingPaperExecution(mock,staging),e=>
   e instanceof StagingPaperError&&e.code===code&&!String(e).includes('secret'));
 }
});
