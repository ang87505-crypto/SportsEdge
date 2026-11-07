import test from 'node:test';
import assert from 'node:assert/strict';
import {performOwnerOneOrder} from './alpaca-owner-first-order.ts';
import {derivePaperClientOrderId} from './alpaca-paper-one-shot-writer.ts';

// Synthetic staging RPC and PAPER broker doubles. No network, credentials or orders.
const STAGE='https://mcaxfaaohyencpspalfe.supabase.co';
const settings={keyId:'synthetic-paper-key',secretKey:'synthetic-paper-secret-long-enough'};
function fixture({approve='ok',haltAfterClaim=false,post='ok'}={}){
 const n=Date.now();
 const pre={
  status:'READ_ONLY_PREFLIGHT',environment:'Alpaca PAPER',symbol:'F',shares:1,
  limitCents:1299,marketOpen:true,sessionCloseAt:new Date(n+7200000).toISOString(),
  checkedAt:new Date(n).toISOString(),
  quote:{feed:'iex',bidCents:1295,askCents:1298,observedAt:new Date(n-4000).toISOString()},
  staging:'HALTED',brokerOrderSubmitted:false,ownerApproved:false,executionPermitted:false,
  blockers:['STAGING_EMERGENCY_STOP_ENGAGED','NO_OWNER_APPROVED_EXECUTION_PATH',
   'NO_DURABLE_BROKER_ORDER_RELEASE'],completedBrokerOrderPages:1
 };
 const calls=[],cfg={},stage={halted:true},receipts=[];
 const saved={url:process.env.SPORTSEDGE_STAGING_SUPABASE_URL,
  key:process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY};
 process.env.SPORTSEDGE_STAGING_SUPABASE_URL=STAGE;
 process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY='synthetic-test-secret-key-scope-preview';
 const mock=async(url,options)=>{
  const x=new URL(url);
  calls.push({url,method:options.method});
  if(x.origin==='https://paper-api.alpaca.markets'){
   const b=JSON.parse(options.body);
   if(post==='throw')throw new DOMException('synthetic timeout','TimeoutError');
   if(post==='badjson')return new Response('<html>gateway</html>',{status:200});
   if(post==='duplicate')return new Response(JSON.stringify(
    {code:40010001,message:'client_order_id must be unique'}),{status:422});
   return Response.json({id:'synthetic-paper-id-1',client_order_id:b.client_order_id,
    symbol:b.symbol,side:b.side,type:b.type,time_in_force:b.time_in_force,
    qty:b.qty,limit_price:b.limit_price,status:'accepted'});
  }
  assert.equal(x.origin,STAGE);
  const body=JSON.parse(options.body??'{}'),name=x.pathname.split('/').pop();
  if(name==='sportsedge_paper_first_order_approve'){
   if(approve==='fail')return new Response('{"message":"FIRST_ORDER_PREVIOUS_INTENT_OR_GATE_NOT_HALTED"}',{status:400});
   Object.assign(cfg,{intentId:body.p_intent,client:body.p_client,symbol:body.p_symbol,
    limit:body.p_limit,ref:body.p_owner_ref,digest:body.p_digest,
    quoteAt:body.p_quote_at,until:body.p_until,close:body.p_close_at});
   assert.equal(cfg.client,derivePaperClientOrderId(cfg.intentId));
   return Response.json({status:'owner_approved',intentId:cfg.intentId,brokerCalls:0,gateHalted:true});
  }
  if(name==='sportsedge_paper_first_order_claim'){
   stage.halted=haltAfterClaim; // an operator STOP lands between claim and POST
   return Response.json({environment:'SportsEdge Staging',accountKind:'paper',
    accountAlias:'sportsedge-paper-stage',status:'submitting',lockVersion:2,
    intentId:cfg.intentId,clientOrderId:cfg.client,symbol:cfg.symbol,shares:1,
    limitCents:cfg.limit,ownerApprovalRef:cfg.ref,modelVersion:'owner-reviewed-paper-test-v1',
    sourceDigest:cfg.digest,quoteVerifiedAt:cfg.quoteAt,approvedUntil:cfg.until,
    sessionCloseAt:cfg.close,signalReviewed:true,marketPriceReviewed:true,
    accountReconciled:true,receiptReconciled:true});
  }
  if(name==='sportsedge_paper_first_order_gate')return Response.json({halted:stage.halted});
  if(name==='sportsedge_paper_first_order_receipt'){
   receipts.push(body.p_state);
   return Response.json({saved:true,state:body.p_state});
  }
  if(name==='sportsedge_paper_stage_halt'){
   stage.halted=true;
   return Response.json({environment:'SportsEdge Staging',accountKind:'paper',gateConfigured:true,
    halted:true,storedIntentCount:1,unresolvedReceiptCount:1,haltAuditEvents:1,
    executionPermitted:false,automaticOrdersEnabled:false,realMoneyOrdersEnabled:false});
  }
  throw Error('Unexpected RPC '+name);
 };
 // performOwnerOneOrder sends staging RPCs through the global fetch and only the
 // broker POST through its injected fetcher, so both must be the same double.
 const initialFetch=globalThis.fetch;
 globalThis.fetch=mock;
 const restore=()=>{
  globalThis.fetch=initialFetch;
  for(const [k,v] of [['SPORTSEDGE_STAGING_SUPABASE_URL',saved.url],
   ['SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY',saved.key]]){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 };
 const posts=()=>calls.filter(c=>c.url.startsWith('https://paper-api.alpaca.markets/')).length;
 return {pre,mock,calls,receipts,stage,restore,posts};
}

test('STOP landing between claim and POST prevents any broker request',async()=>{
 const f=fixture({haltAfterClaim:true});
 try{
  const r=await performOwnerOneOrder(f.pre,settings,f.mock);
  assert.equal(f.posts(),0);
  assert.equal(r.status,'paper_submission_uncertain');
  assert.equal(r.requiresReconciliation,true);
  assert.deepEqual(f.receipts,[]); // nothing was sent, so no uncertain receipt either
  assert.equal(f.stage.halted,true);
 }finally{f.restore();}
});

test('A duplicate owner request whose approval is refused never claims or posts',async()=>{
 const f=fixture({approve:'fail'});
 try{
  await assert.rejects(()=>performOwnerOneOrder(f.pre,settings,f.mock),/PAPER_STAGE_RPC_UNVERIFIED/);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/sportsedge_paper_first_order_approve')).length,1);
  assert.equal(f.posts(),0);
  assert.equal(f.calls.some(c=>c.url.endsWith('/sportsedge_paper_first_order_claim')),false);
 }finally{f.restore();}
});

test('Timeout, malformed reply and duplicate-id 422 are uncertain, single POST, halted',async()=>{
 for(const post of ['throw','badjson','duplicate']){
  const f=fixture({post});
  try{
   const r=await performOwnerOneOrder(f.pre,settings,f.mock);
   assert.equal(f.posts(),1,post);
   assert.equal(r.status,'paper_submission_uncertain',post);
   assert.equal(r.brokerStatus,null,post);
   assert.deepEqual(f.receipts,['submission_uncertain'],post);
   assert.equal(f.stage.halted,true,post);
  }finally{f.restore();}
 }
});

test('Only the fixed PAPER host is contacted for the broker write',async()=>{
 const f=fixture();
 try{
  const r=await performOwnerOneOrder(f.pre,settings,f.mock);
  assert.equal(r.status,'paper_broker_acknowledged');
  const hosts=new Set(f.calls.map(c=>new URL(c.url).origin));
  assert.deepEqual([...hosts].sort(),[STAGE,'https://paper-api.alpaca.markets'].sort());
  assert.ok(f.calls.every(c=>!c.url.includes('://api.alpaca.markets')));
 }finally{f.restore();}
});
