import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperReceipt,advancePaperReceipt,locksFurtherOrders} from './paper-automation-receipts.ts';

const id='preview-'+'a'.repeat(32);
const at='2026-10-14T12:10:00Z';
function progress(r,event,fields={}){return advancePaperReceipt(r,{event,expectedVersion:r.version,at,...fields});}
test('Owner approval alone never submits orders; receipt transitions are explicit',()=>{
 const a=createPaperReceipt(id);
 assert.equal(a.state,'planned');
 assert.equal(a.accountKind,'paper');
 assert.equal(a.brokerOrderId,null);
 assert.equal(locksFurtherOrders(a),false);
 assert.throws(()=>progress(a,'start_submission'));
 assert.throws(()=>progress(a,'approve'));
 const b=progress(a,'approve',{ownerId:'verified-owner'});
 assert.equal(b.state,'owner_approved');
 assert.equal(b.approvedBy,'verified-owner');
 assert.equal(locksFurtherOrders(b),true);
 assert.equal(a.state,'planned');
 assert.throws(()=>advancePaperReceipt(b,{event:'start_submission',expectedVersion:0,at}),/version/);
 const c=progress(b,'start_submission');
 const d=progress(c,'acknowledge',{brokerOrderId:'alpaca-paper-order-01'});
 const e=progress(d,'fill');
 assert.equal(e.state,'broker_filled');
 assert.equal(e.history.length,4);
 assert.equal(e.brokerOrderId,'alpaca-paper-order-01');
 assert.equal(locksFurtherOrders(e),false);
 assert.throws(()=>progress(e,'start_submission'));
});
test('Unknown broker response stays locked; no automatic rejection or retry',()=>{
 const approved=progress(createPaperReceipt(id),'approve',{ownerId:'owner'});
 const submitting=progress(approved,'start_submission');
 const unknown=progress(submitting,'unknown_response');
 assert.equal(unknown.state,'submission_uncertain');
 assert.ok(locksFurtherOrders(unknown));
 assert.throws(()=>progress(unknown,'start_submission'));
 assert.throws(()=>progress(unknown,'reconcile_acknowledged'));
 const reconciled=progress(unknown,'reconcile_acknowledged',{brokerOrderId:'actual-paper-id'});
 assert.equal(reconciled.state,'broker_acknowledged');
 assert.equal(reconciled.brokerOrderId,'actual-paper-id');
 assert.throws(()=>progress(reconciled,'cancel',{brokerOrderId:'different-id'}));
});
test('Emergency stop before submit stops; after begin remains uncertain and locked',()=>{
 const r=createPaperReceipt(id);
 assert.equal(progress(r,'emergency_stop').state,'stopped');
 const q=progress(r,'approve',{ownerId:'owner'});
 assert.equal(progress(q,'emergency_stop').state,'stopped');
 const submitted=progress(q,'start_submission');
 const stopped=progress(submitted,'emergency_stop');
 assert.equal(stopped.state,'submission_uncertain');
 assert.ok(locksFurtherOrders(stopped));
 assert.throws(()=>progress(stopped,'emergency_stop'));
});
test('Receipt ID, clock, broker identity and state validation fail closed',()=>{
 assert.throws(()=>createPaperReceipt('invalid'));
 let r=createPaperReceipt(id);
 assert.throws(()=>progress(r,'approve',{ownerId:'owner',at:'invalid'}));
 r=progress(r,'approve',{ownerId:'owner'});
 assert.throws(()=>progress(r,'start_submission',{at:'2026-10-14T12:09:59Z'}));
 r=progress(r,'start_submission');
 assert.throws(()=>progress(r,'acknowledge',{brokerOrderId:''}));
 const ack=progress(r,'acknowledge',{brokerOrderId:'paper-1'});
 assert.throws(()=>progress(ack,'fill',{brokerOrderId:'paper-2'}));
});
