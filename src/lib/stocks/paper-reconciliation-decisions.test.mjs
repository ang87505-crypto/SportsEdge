import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePaperReceipts} from './paper-reconciliation-decisions.ts';
const key='preview-'+'a'.repeat(32);
const order=(clientOrderId='se_paper_1',status='new')=>({
 id:'real-broker-order-1',clientOrderId,symbol:'AAPL',side:'buy',
 status,submittedAt:'2026-10-14T12:00:00Z',qty:'2',filledQty:'0'
});
const inventory=(orders=[order()])=>({
 source:'alpaca_paper_order_history',pageCount:1,
 checkedAt:'2026-10-14T12:05:00Z',historyComplete:true,openOrdersComplete:true,
 totalOrders:orders.length,allOrders:orders,openOrders:orders.filter(x=>x.status==='new'),
 safeForExecution:false
});
const receipt=(state='broker_acknowledged')=>({
 intentId:key,accountKind:'paper',state,version:3,brokerOrderId:'real-broker-order-1',
 approvedBy:'owner',history:[],clientOrderId:'se_paper_1'
});
test('Bound approved broker order agrees with stored client and broker ids without enabling orders',()=>{
 const r=reconcilePaperReceipts(inventory(),[receipt()]);
 assert.equal(r.verifiedHistory,true);
 assert.equal(r.unresolvedCount,0);
 assert.equal(r.allClearForOrders,false);
 assert.deepEqual(r.findings[0].state,'observed_consistent');
 assert.equal(r.findings[0].mayResubmit,false);
});
test('Missing broker order after uncertain submission stays locked and cannot retry',()=>{
 const r=reconcilePaperReceipts(inventory([]),[receipt('submission_uncertain')]);
 assert.equal(r.unresolvedCount,1);
 assert.equal(r.findings[0].state,'not_observed_do_not_retry');
 assert.equal(r.findings[0].mayResubmit,false);
});
test('Found uncertain order still needs operator receipt transition',()=>{
 const r=reconcilePaperReceipts(inventory(),[receipt('submission_uncertain')]);
 assert.equal(r.findings[0].state,'unresolved_pending');
 assert.equal(r.findings[0].mayResubmit,false);
});
test('Broker ID or terminal-status disagreements are conflicts',()=>{
 const mismatch={...receipt(),brokerOrderId:'wrong-order'};
 assert.equal(reconcilePaperReceipts(inventory(),[mismatch]).findings[0].state,'observed_conflict');
 const filled={...receipt('broker_filled')};
 assert.equal(reconcilePaperReceipts(inventory(),[filled]).findings[0].state,'observed_conflict');
 assert.equal(reconcilePaperReceipts(inventory([order('se_paper_1','filled')]),[filled]).findings[0].state,'observed_consistent');
});
test('Incomplete or inconsistent broker inventory is rejected',()=>{
 assert.throws(()=>reconcilePaperReceipts({...inventory(),historyComplete:false},[receipt()]));
 assert.throws(()=>reconcilePaperReceipts({...inventory(),totalOrders:50},[receipt()]));
 assert.throws(()=>reconcilePaperReceipts({...inventory(),safeForExecution:true},[receipt()]));
 assert.throws(()=>reconcilePaperReceipts(inventory([order(),order()]),[receipt()]));
 assert.throws(()=>reconcilePaperReceipts(inventory(),[receipt(),receipt()]));
});
