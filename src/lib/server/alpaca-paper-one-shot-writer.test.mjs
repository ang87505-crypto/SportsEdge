import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 derivePaperClientOrderId,preparePaperSubmission,
 classifyPaperPostResponse,assertPaperWriterReleased,
 submitApprovedPaperOrderOnce,PaperWriteError
} from './alpaca-paper-one-shot-writer.ts';
const when='2026-10-14T17:01:00Z';
const intentId='preview-'+'a'.repeat(32);
const clientOrderId='sepaper_'+createHash('sha256')
 .update('sportsedge-unapproved-paper-test-v1\0'+intentId).digest('hex').slice(0,32);
const good={
 environment:'SportsEdge Staging',accountKind:'paper',
 accountAlias:'sportsedge-paper-stage',status:'submitting',lockVersion:2,
 intentId,clientOrderId,symbol:'F',shares:1,limitCents:1299,
 ownerApprovalRef:'owner-'+'b'.repeat(32),modelVersion:'stock-signal-v1',
 sourceDigest:'c'.repeat(64),quoteVerifiedAt:'2026-10-14T17:00:30Z',
 approvedUntil:'2026-10-14T17:04:00Z',
 sessionCloseAt:'2026-10-14T20:00:00Z',
 signalReviewed:true,marketPriceReviewed:true,
 accountReconciled:true,receiptReconciled:true
};
const valid=preparePaperSubmission(good,when);
test('Matching one-share approved receipt becomes fixed PAPER limit DAY buy',()=>{
 assert.equal(derivePaperClientOrderId(intentId),clientOrderId);
 assert.deepEqual(valid,{
  intentId,clientOrderId,url:'https://paper-api.alpaca.markets/v2/orders',
  method:'POST',body:{
   symbol:'F',side:'buy',type:'limit',time_in_force:'day',
   qty:'1',limit_price:'12.99',client_order_id:clientOrderId,
   extended_hours:false
  }
 });
 assert.equal(Object.keys(valid.body).length,8);
 assert.throws(()=>derivePaperClientOrderId('another-id'),PaperWriteError);
});
test('No plan from unapproved stage draft, wrong account, stale quote or changed economics',()=>{
 const mutations=[
  {status:'planned'},{status:'owner_approved'},{accountKind:'live'},
  {environment:'Production'},{accountAlias:'other-account'},
  {lockVersion:1},{shares:2},{symbol:'BTCUSD'},{symbol:'AAPL.US'},
  {limitCents:2501},{limitCents:0},{limitCents:12.5},
  {ownerApprovalRef:'missing'},{modelVersion:'manual-unverified-test-draft-v1'},
  {sourceDigest:'x'.repeat(64)},{quoteVerifiedAt:'2026-10-14T16:00:00Z'},
  {quoteVerifiedAt:'2026-10-14T17:01:01Z'},
  {approvedUntil:'2026-10-14T17:01:00Z'},
  {approvedUntil:'2026-10-14T18:01:00Z'},
  {sessionCloseAt:'2026-10-14T17:15:00Z'},
  {sessionCloseAt:'2026-10-15T16:00:00Z'},
  {signalReviewed:false},{marketPriceReviewed:false},
  {accountReconciled:false},{receiptReconciled:false},
  {clientOrderId:'sepaper_'+'1'.repeat(32)},
  {intentId:'preview-'+'1'.repeat(32)}
 ];
 for(const mutation of mutations)
  assert.throws(()=>preparePaperSubmission({...good,...mutation},when),PaperWriteError);
 for(const x of [null,undefined,{},[],123,'x'])
  assert.throws(()=>preparePaperSubmission(x,when),PaperWriteError);
 for(const x of ['2026-10-14','tomorrow','2026-10-14T17:01:00-04:00'])
  assert.throws(()=>preparePaperSubmission(good,x),PaperWriteError);
});
test('Alpaca responses validate broker identity, economics and known statuses',()=>{
 for(const status of ['new','accepted','pending_new','filled','rejected','partially_filled']){
  const d=classifyPaperPostResponse(200,{
    id:'paper-broker-id-1',client_order_id:clientOrderId,
    symbol:'F',side:'buy',type:'limit',time_in_force:'day',
    qty:'1',limit_price:'12.99',status,legs:null
  },valid);
  assert.deepEqual(d,{state:'broker_acknowledged',brokerOrderId:'paper-broker-id-1',brokerStatus:status});
 }
});
test('All ambiguous HTTP, malformed and mismatched replies fail closed and never authorize retries',()=>{
 const body={
  id:'paper-broker-id-1',client_order_id:clientOrderId,
  symbol:'F',side:'buy',type:'limit',time_in_force:'day',
  qty:'1',limit_price:'12.99',status:'new'
 };
 for(const code of [400,401,403,409,422,429,500,502,503])
  assert.equal(classifyPaperPostResponse(code,body,valid).state,'submission_uncertain');
 for(const mutation of [
  {client_order_id:'different'},{symbol:'G'},{side:'sell'},
  {qty:'2'},{limit_price:'13.00'},{type:'market'},
  {time_in_force:'gtc'},{id:''},{legs:[{unexpected:true}]}
 ])assert.deepEqual(classifyPaperPostResponse(201,{...body,...mutation},valid).state,'submission_uncertain');
 assert.deepEqual(classifyPaperPostResponse(201,{...body,status:'surprise'},valid),
  {state:'submission_uncertain',reason:'UNKNOWN_STATUS'});
 for(const raw of [null,{},[],123,'hello'])
  assert.equal(classifyPaperPostResponse(201,raw,valid).state,'submission_uncertain');
});
test('Hard disabled runtime cannot call claim, STOP, broker or receipt methods',async()=>{
 assert.throws(()=>assertPaperWriterReleased(),e=>e instanceof PaperWriteError&&e.code==='RELEASE_OFF');
 let claims=0,gates=0,posts=0,receipts=0;
 const ports={
  claimOnce:async()=>{claims++;return good;},
  halted:async()=>{gates++;return false;},
  acknowledge:async()=>{receipts++;return true;},
  uncertain:async()=>{receipts++;}
 };
 await assert.rejects(()=>submitApprovedPaperOrderOnce(intentId,
  {keyId:'some-paper-key-id',secretKey:'some-secret-key-value'},
  ports,async()=>{posts++;throw Error('must never reach Alpaca');}),
  e=>e instanceof PaperWriteError&&e.code==='RELEASE_OFF');
 assert.deepEqual({claims,gates,posts,receipts},
  {claims:0,gates:0,posts:0,receipts:0});
});
