import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performOwnerOneOrder} from './alpaca-owner-first-order.ts';
import {derivePaperClientOrderId} from './alpaca-paper-one-shot-writer.ts';

function fixture({failPost=false,failAck=false,haltOk=true}={}){
 const n=Date.now();
 const now=new Date(n).toISOString();
 const quote=new Date(n-4000).toISOString();
 const expiry=new Date(n+120000).toISOString();
 const close=new Date(n+7200000).toISOString();
 const pre={
  status:'READ_ONLY_PREFLIGHT',environment:'Alpaca PAPER',
  symbol:'F',shares:1,limitCents:1299,marketOpen:true,sessionCloseAt:close,
  checkedAt:now,quote:{feed:'iex',bidCents:1295,askCents:1298,observedAt:quote},
  staging:'HALTED',brokerOrderSubmitted:false,ownerApproved:false,
  executionPermitted:false,
  blockers:['STAGING_EMERGENCY_STOP_ENGAGED',
   'NO_OWNER_APPROVED_EXECUTION_PATH','NO_DURABLE_BROKER_ORDER_RELEASE'],
  completedBrokerOrderPages:1
 };
 const calls=[],cfg={},stage={halted:true};
 const initialFetch=globalThis.fetch,env={
  url:process.env.SPORTSEDGE_STAGING_SUPABASE_URL,
  key:process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY
 };
 process.env.SPORTSEDGE_STAGING_SUPABASE_URL='https://mcaxfaaohyencpspalfe.supabase.co';
 process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY='synthetic-test-secret-key-scope-preview';
 const mock=async (url,options)=>{
  const x=new URL(url),method=options.method;
  calls.push({url,method});
  if(x.origin==='https://paper-api.alpaca.markets'){
   assert.equal(x.pathname,'/v2/orders');
   assert.equal(method,'POST');
   if(failPost)return new Response(JSON.stringify({error:'synthetic'}),{status:503});
   const b=JSON.parse(options.body);
   return new Response(JSON.stringify({
    id:'synthetic-paper-id-123',client_order_id:b.client_order_id,
    symbol:b.symbol,side:b.side,type:b.type,time_in_force:b.time_in_force,
    qty:b.qty,limit_price:b.limit_price,status:'new'
   }),{status:200});
  }
  assert.equal(x.origin,'https://mcaxfaaohyencpspalfe.supabase.co');
  assert.equal(method,'POST');
  const body=JSON.parse(options.body??'{}');
  const name=x.pathname.split('/').pop();
  if(name==='sportsedge_paper_first_order_approve'){
   cfg.intentId=body.p_intent;cfg.symbol=body.p_symbol;
   cfg.limit=body.p_limit;cfg.ref=body.p_owner_ref;cfg.digest=body.p_digest;
   cfg.client=body.p_client;cfg.quoteAt=body.p_quote_at;
   cfg.until=body.p_until;cfg.close=body.p_close_at;
   assert.equal(cfg.client,derivePaperClientOrderId(cfg.intentId));
   assert.equal(cfg.limit,1299);
   assert.match(cfg.digest,/^[a-f0-9]{64}$/);
   return Response.json({status:'owner_approved',intentId:cfg.intentId,
    brokerCalls:0,gateHalted:true});
  }
  if(name==='sportsedge_paper_first_order_claim'){
   assert.equal(body.p_intent,cfg.intentId);
   stage.halted=false;
   return Response.json({
    environment:'SportsEdge Staging',accountKind:'paper',
    accountAlias:'sportsedge-paper-stage',status:'submitting',lockVersion:2,
    intentId:cfg.intentId,clientOrderId:cfg.client,
    symbol:cfg.symbol,shares:1,limitCents:cfg.limit,
    ownerApprovalRef:cfg.ref,modelVersion:'owner-reviewed-paper-test-v1',
    sourceDigest:cfg.digest,quoteVerifiedAt:cfg.quoteAt,
    approvedUntil:cfg.until,sessionCloseAt:cfg.close,
    signalReviewed:true,marketPriceReviewed:true,accountReconciled:true,
    receiptReconciled:true});
  }
  if(name==='sportsedge_paper_first_order_gate')
   return Response.json({halted:stage.halted});
  if(name==='sportsedge_paper_first_order_receipt'){
   assert.equal(body.p_intent,cfg.intentId);
   if(failAck)return new Response(JSON.stringify({error:'synthetic'}),{status:503});
   return Response.json({saved:true,state:body.p_state});
  }
  if(name==='sportsedge_paper_stage_halt'){
   if(haltOk)stage.halted=true;
   if(!haltOk)return new Response(JSON.stringify({error:'synthetic'}),{status:503});
   return Response.json({environment:'SportsEdge Staging',accountKind:'paper',
    gateConfigured:true,halted:true,storedIntentCount:1,unresolvedReceiptCount:1,
    haltAuditEvents:1,executionPermitted:false,automaticOrdersEnabled:false,
    realMoneyOrdersEnabled:false});
  }
  throw Error('Unexpected RPC: '+name);
 };
 globalThis.fetch=mock;
 const restore=()=>{
  globalThis.fetch=initialFetch;
  for(const [k,v] of [['SPORTSEDGE_STAGING_SUPABASE_URL',env.url],
   ['SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY',env.key]]){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 };
 return {pre,mock,calls,restore,stage};
}
const settings={keyId:'synthetic-paper-key',secretKey:'synthetic-paper-secret-long-enough'};
test('Owner one-click creates one stage claim, one PAPER POST, one receipt and rehalts',async()=>{
 const f=fixture();
 try{
  const result=await performOwnerOneOrder(f.pre,settings,f.mock);
  assert.equal(result.status,'paper_broker_acknowledged');
  assert.equal(result.gateHalted,true);
  assert.equal(result.requiresReconciliation,false);
  const broker=f.calls.filter(c=>c.url.includes('paper-api.alpaca.markets/v2/orders'));
  assert.equal(broker.length,1);
  assert.ok(f.calls.filter(c=>c.url.endsWith('/sportsedge_paper_stage_halt')).length===1);
  assert.equal(f.stage.halted,true);
 }finally{f.restore();}
});
test('Broker HTTP failure records uncertainty, never retries, still halts',async()=>{
 const f=fixture({failPost:true});
 try{
  const result=await performOwnerOneOrder(f.pre,settings,f.mock);
  assert.equal(result.status,'paper_submission_uncertain');
  assert.equal(result.requiresReconciliation,true);
  assert.equal(f.calls.filter(c=>c.url.includes('paper-api.alpaca.markets/v2/orders')).length,1);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/sportsedge_paper_first_order_receipt')).length,1);
  assert.equal(f.stage.halted,true);
 }finally{f.restore();}
});
test('Missing receipt or failed STOP never yields safe order success',async()=>{
 for(const flags of [{failAck:true},{haltOk:false}]){
  const f=fixture(flags);
  try{
   const result=await performOwnerOneOrder(f.pre,settings,f.mock);
   assert.equal(result.status,'paper_submission_uncertain');
   assert.equal(result.requiresReconciliation,true);
   assert.equal(f.calls.filter(c=>c.url.includes('paper-api.alpaca.markets/v2/orders')).length,1);
  }finally{f.restore();}
 }
});
test('Refuses incomplete preflight before any database write or broker POST',async()=>{
 for(const change of [
  {marketOpen:false},{staging:'UNAVAILABLE'},{blockers:['UNKNOWN']},
  {quote:null},{sessionCloseAt:null}
 ]){
  const f=fixture();
  try{
   await assert.rejects(()=>performOwnerOneOrder({...f.pre,...change},settings,f.mock));
   assert.equal(f.calls.length,0);
  }finally{f.restore();}
 }
});
