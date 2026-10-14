import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnapprovedPaperTestDraft,validateManualPaperDraft}
 from './alpaca-staging-manual-preview.ts';
import {StagingPaperError} from './alpaca-staging-operator.ts';
const endpoint='https://mcaxfaaohyencpspalfe.supabase.co/rest/v1/rpc/sportsedge_paper_stage_preview';
const settings={url:'https://mcaxfaaohyencpspalfe.supabase.co',key:'sb_secret_'+'t'.repeat(50)};
const valid={symbol:'F',shares:1,limitCents:1234};
test('Accepted request is strictly one share, simple uppercase ticker, <=$25 max price',()=>{
 assert.deepEqual(validateManualPaperDraft(valid),valid);
 for(const x of [
  {...valid,shares:0},{...valid,shares:2},{...valid,limitCents:2501},
  {...valid,limitCents:0},{...valid,limitCents:NaN},{...valid,limitCents:12.34},
  {...valid,symbol:'F/USD'},{...valid,symbol:'BITCOIN'},
  {...valid,symbol:'aapl'},{...valid,symbol:'AAPL;drop'},
  {...valid,extended_hours:true},null,{},'F'
 ])assert.throws(()=>validateManualPaperDraft(x));
});
test('Only fixed STAGING RPC request is sent; never Alpaca or a broker order',async()=>{
 const seen=[];
 const mock=async(url,opts)=>{
  seen.push(url);
  assert.equal(url,endpoint);
  assert.equal(opts.method,'POST');
  assert.equal(opts.cache,'no-store');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.apikey,settings.key);
  const request=JSON.parse(opts.body);
  assert.match(request.p_intent_id,/^preview-[a-f0-9]{32}$/);
  assert.match(request.p_client_order_id,/^sepaper_[a-f0-9]{32}$/);
  assert.match(request.p_source_digest,/^[a-f0-9]{64}$/);
  assert.equal(request.p_symbol,'F');
  assert.equal(request.p_limit_cents,1234);
  assert.equal(Object.keys(request).length,5);
  return new Response(JSON.stringify({
   status:'planned',environment:'SportsEdge Staging',accountKind:'paper',
   intentId:request.p_intent_id,symbol:'F',shares:1,limitCents:1234,
   approved:false,executionPermitted:false,brokerCalls:0,gateHalted:true
  }));
 };
 const r=await createUnapprovedPaperTestDraft(valid,mock,settings);
 assert.equal(r.status,'planned');
 assert.equal(r.approved,false);
 assert.equal(r.executionPermitted,false);
 assert.equal(r.brokerCalls,0);
 assert.equal(r.gateHalted,true);
 assert.deepEqual(seen,[endpoint]);
});
test('No retry after an ambiguous or timeout failure',async()=>{
 let attempts=0;
 await assert.rejects(()=>createUnapprovedPaperTestDraft(valid,async()=>{
  attempts++;throw Error('upstream timeout; service may have written intent');
 },settings),e=>e instanceof StagingPaperError&&e.code==='NETWORK');
 assert.equal(attempts,1);
});
test('Staging refuses mismatched saved ID, unhalted gate or any execution flag',async()=>{
 for(const bad of [
  {gateHalted:false},{approved:true},{executionPermitted:true},{brokerCalls:1},
  {intentId:'preview-'+'a'.repeat(32)},{environment:'Production'},
  {accountKind:'live'},{symbol:'BTCUSD'},{limitCents:2501}
 ]){
  const mock=async(url,opts)=>{
   const body=JSON.parse(opts.body);
   return new Response(JSON.stringify({
    status:'planned',environment:'SportsEdge Staging',accountKind:'paper',
    intentId:body.p_intent_id,symbol:'F',shares:1,limitCents:1234,
    approved:false,executionPermitted:false,brokerCalls:0,gateHalted:true,
    ...bad
   }));
  };
  await assert.rejects(()=>createUnapprovedPaperTestDraft(valid,mock,settings),
   e=>e instanceof StagingPaperError&&e.code==='BAD_RESPONSE');
 }
});
test('Cannot redirect staging persistence to Production or unaudited URL',async()=>{
 for(const config of [
  {...settings,url:'https://fzyjazhvkstvwwzjhlrr.supabase.co'},
  {...settings,url:'http://mcaxfaaohyencpspalfe.supabase.co'},
  {...settings,url:'https://mcaxfaaohyencpspalfe.supabase.co/evil'},
  {...settings,url:'https://mcaxfaaohyencpspalfe.supabase.co/?x=1'},
  {...settings,key:'short'}
 ])await assert.rejects(
  ()=>createUnapprovedPaperTestDraft(valid,async()=>{throw Error('must not be called');},config),
  e=>e instanceof StagingPaperError&&e.code==='INVALID_CONFIG');
});
test('Provider failure and malformed results do not claim saved draft',async()=>{
 for(const [mock,expected] of [
  [async()=>new Response('DO NOT LEAK',{status:429}),'UPSTREAM_ERROR'],
  [async()=>new Response('bad json'),'BAD_RESPONSE'],
  [async()=>new Response('x'.repeat(5000)),'BAD_RESPONSE']
 ])await assert.rejects(()=>createUnapprovedPaperTestDraft(valid,mock,settings),
 e=>e instanceof StagingPaperError&&e.code===expected&&!String(e).includes('LEAK'));
});
