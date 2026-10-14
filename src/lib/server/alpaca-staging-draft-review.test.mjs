import test from 'node:test';
import assert from 'node:assert/strict';
import {listUnapprovedStagingDrafts,validateDraftInventory}
 from './alpaca-staging-draft-review.ts';
import {StagingPaperError} from './alpaca-staging-operator.ts';
const endpoint='https://mcaxfaaohyencpspalfe.supabase.co/rest/v1/rpc/sportsedge_paper_stage_drafts';
const settings={url:'https://mcaxfaaohyencpspalfe.supabase.co',key:'sb_secret_'+'x'.repeat(50)};
const id='preview-'+'a'.repeat(32);
const good={environment:'SportsEdge Staging',accountKind:'paper',gateHalted:true,
 executionPermitted:false,brokerCalls:0,drafts:[{
  intentId:id,symbol:'F',shares:1,limitCents:1299,status:'planned',
  createdAt:'2026-10-14T21:00:00.000Z'
 }]};
test('Fixed staging host, read-only PostgREST RPC, and sanitized public fields',async()=>{
 let calls=0;
 const mock=async(url,opts)=>{
  calls++;assert.equal(url,endpoint);
  assert.equal(opts.method,'POST');assert.equal(opts.body,'{}');
  assert.equal(opts.headers.apikey,settings.key);
  assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');
  return new Response(JSON.stringify({...good,
   drafts:[{...good.drafts[0],clientOrderId:'SHOULD_NEVER_RETURN',
    brokerOrderId:'SHOULD_NEVER_RETURN',internalSecret:'SHOULD_NEVER_RETURN'}]}));
 };
 const r=await listUnapprovedStagingDrafts(mock,settings);
 assert.equal(calls,1);
 assert.deepEqual(r.drafts,good.drafts);
 assert.ok(!JSON.stringify(r).includes('SHOULD_NEVER_RETURN'));
 assert.equal(r.executionPermitted,false);
});
test('Empty staging inventory is allowed only with a verified HALTED gate',()=>{
 assert.deepEqual(validateDraftInventory({...good,drafts:[]}).drafts,[]);
 for(const changed of [
  {gateHalted:false},{environment:'Production'},{accountKind:'live'},
  {executionPermitted:true},{brokerCalls:1},{drafts:'not an array'},
  {drafts:Array(21).fill(good.drafts[0])},
  {drafts:[good.drafts[0],good.drafts[0]]},
  {drafts:[{...good.drafts[0],limitCents:2501}]},
  {drafts:[{...good.drafts[0],shares:2}]},
  {drafts:[{...good.drafts[0],status:'submitting'}]},
  {drafts:[{...good.drafts[0],createdAt:'yesterday'}]},
  {drafts:[{...good.drafts[0],symbol:'BTCUSD'}]}
 ])assert.throws(()=>validateDraftInventory({...good,...changed}),StagingPaperError);
});
test('Cannot change staging host or redirect to Production',async()=>{
 for(const url of [
  'https://fzyjazhvkstvwwzjhlrr.supabase.co',
  'https://mcaxfaaohyencpspalfe.supabase.co/foreign',
  'http://mcaxfaaohyencpspalfe.supabase.co',
  'https://mcaxfaaohyencpspalfe.supabase.co?q=1'
 ])await assert.rejects(
  ()=>listUnapprovedStagingDrafts(async()=>{throw Error('unreachable')},{...settings,url}),
  e=>e instanceof StagingPaperError&&e.code==='INVALID_CONFIG');
});
test('Never retry upstream failure, do not claim missing records',async()=>{
 let calls=0;
 await assert.rejects(()=>listUnapprovedStagingDrafts(async()=>{
  calls++;throw Error('timeout');
 },settings),e=>e instanceof StagingPaperError&&e.code==='NETWORK');
 assert.equal(calls,1);
 for(const mock of [
  async()=>new Response('upstream error',{status:503}),
  async()=>new Response('{not json}'),
  async()=>new Response('x'.repeat(12001)),
  async()=>new Response(JSON.stringify({...good,gateHalted:false}))
 ])await assert.rejects(()=>listUnapprovedStagingDrafts(mock,settings),StagingPaperError);
});
