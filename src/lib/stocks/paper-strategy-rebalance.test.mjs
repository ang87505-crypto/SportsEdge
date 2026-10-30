import test from 'node:test';
import assert from 'node:assert/strict';
import {planStrategyRebalance as plan} from './paper-strategy-rebalance.ts';

// Fictional securities, account and quotes. Never submitted to a broker.
function fixture(){return {
 experimentId:'synthetic-study',modelVersion:'stock-mom252-skip21-trend200-v1',
 decisionId:'synthetic-decision',decisionAt:'2026-11-02T13:00:00Z',
 now:'2026-11-02T14:35:00Z',sessionOpenAt:'2026-11-02T14:30:00Z',
 sessionCloseAt:'2026-11-02T21:00:00Z',accountType:'paper',accountId:'synthetic-account',
 accountSnapshotAt:'2026-11-02T14:34:50Z',equityCents:100000,settledCashCents:100000,
 positionsComplete:true,ordersComplete:true,openOrderCount:0,unresolvedReceiptCount:0,
 targets:[{securityId:'id-A',symbol:'AAA',sector:'sector-A'},
  {securityId:'id-B',symbol:'BBB',sector:'sector-B'}],positions:[],
 quotes:['A','B'].map(v=>({securityId:'id-'+v,symbol:v.repeat(3),bidCents:1990,
  askCents:2000,observedAt:'2026-11-02T14:34:55Z',priorAdv20Shares:100000})),
 feeReserveCentsPerOrder:0};}
test('two targets, actual integer shares, independent cash/exposure check',()=>{
 const f=fixture(),r=plan(f);assert.equal(r.phase,'BUY');
 assert.deepEqual(r.legs.map(x=>x.shares),[5,5]);
 const debit=r.legs.reduce((n,l)=>n+l.shares*l.limitCents+l.feeReserveCents,0);
 assert.equal(r.unusedCashCents+debit,f.settledCashCents);
 assert.ok(r.legs.every(l=>l.shares*l.limitCents<=f.equityCents/10));
 assert.equal(r.executionPermitted,false);assert.equal(r.performance,null);
});
test('complete rotation sells first; cannot spend hypothetical sale proceeds',()=>{
 const f=fixture();f.settledCashCents=0;
 f.positions=[{securityId:'old',symbol:'OLD',shares:50}];
 f.quotes.push({...f.quotes[0],securityId:'old',symbol:'OLD'});
 const r=plan(f);assert.equal(r.phase,'SELL');assert.equal(r.legs.length,1);
 assert.equal(r.legs[0].shares,50);assert.equal(r.unusedCashCents,0);
 f.positions=[];f.quotes.pop();assert.throws(()=>plan(f),/SETTLED_CASH_REQUIRED/);
 f.settledCashCents=99500;assert.equal(plan(f).phase,'BUY');
});
test('drift trim emits only sells, even with other missing targets',()=>{
 const f=fixture();f.positions=[{securityId:'id-A',symbol:'AAA',shares:8}];
 f.settledCashCents=84000;
 assert.deepEqual(plan(f).legs.map(l=>[l.side,l.shares]),[['sell',3]]);
});
test('settled trim then replanning uses remaining actual positions',()=>{
 const f=fixture();f.positions=[{securityId:'id-A',symbol:'AAA',shares:5}];
 f.settledCashCents=90000;const r=plan(f);
 assert.deepEqual(r.legs.map(l=>l.symbol),['BBB']);assert.equal(r.unusedCashCents,80000);
});
test('fee reserve is charged once per order and kept within budget',()=>{
 const f=fixture();f.feeReserveCentsPerOrder=100;const r=plan(f);
 assert.deepEqual(r.legs.map(l=>l.shares),[4,4]);assert.equal(r.unusedCashCents,83800);
});
test('sell fees require existing settled cash',()=>{
 const f=fixture();f.targets=[];f.positions=[{securityId:'id-A',symbol:'AAA',shares:1}];
 f.quotes.pop();f.settledCashCents=0;f.feeReserveCentsPerOrder=100;
 assert.throws(()=>plan(f),/SELL_FEE_CASH_REQUIRED/);
});
test('unaffordable whole shares are explicit, not fractional orders',()=>{
 const f=fixture();for(const q of f.quotes){q.bidCents=19999;q.askCents=20000;}
 const r=plan(f);assert.equal(r.phase,'HOLD');assert.equal(r.diagnostics.length,2);
});
test('no targets means exit every held security',()=>{
 const f=fixture();f.targets=[];f.positions=[{securityId:'id-A',symbol:'AAA',shares:4}];
 f.quotes.pop();assert.equal(plan(f).legs[0].shares,4);
});
test('empty account and empty targets is a truthful hold',()=>{
 const f=fixture();f.targets=[];f.quotes=[];assert.equal(plan(f).phase,'HOLD');
});
test('permutation invariant, input immutable, deterministic repeat',()=>{
 const f=fixture(),before=structuredClone(f),a=plan(f);assert.deepEqual(f,before);
 f.targets.reverse();f.quotes.reverse();assert.deepEqual(plan(f),a);
 assert.deepEqual(plan(f),a);
});
test('account and strategy identities bind plan hash',()=>{
 const f=fixture(),id=plan(f).planId;
 f.accountId='second-account';assert.notEqual(plan(f).planId,id);
 f.accountId='synthetic-account';f.modelVersion='stock-mom252-skip21-trend200-holdrank10-v1';
 assert.notEqual(plan(f).planId,id);
});
test('uncertain, open, incomplete and live accounts block',()=>{
 for(const [key,value] of Object.entries({accountType:'live',openOrderCount:1,
  unresolvedReceiptCount:1,ordersComplete:false,positionsComplete:false})){
  const f=fixture();f[key]=value;assert.throws(()=>plan(f));
 }
});
test('future/stale quotes, missing quotes, reversed spread block',()=>{
 for(const change of [f=>f.quotes[0].observedAt='2026-11-02T14:35:01Z',
  f=>f.quotes[0].observedAt='2026-11-02T14:33:59Z',f=>f.quotes.pop(),
  f=>f.quotes[0].bidCents=2001]){
  const f=fixture();change(f);assert.throws(()=>plan(f));
 }
});
test('missing held security quote is never a zero-value liquidation',()=>{
 const f=fixture();f.positions=[{securityId:'old',symbol:'OLD',shares:1}];
 assert.throws(()=>plan(f),/MISSING_QUOTE/);
});
test('rename, ticker reuse, duplicates and fractional positions block',()=>{
 for(const change of [f=>f.targets[1].symbol='AAA',
  f=>f.targets.push({...f.targets[0]}),f=>f.quotes.push({...f.quotes[0]}),
  f=>f.positions=[{securityId:'id-A',symbol:'OTHER',shares:1}],
  f=>f.positions=[{securityId:'id-A',symbol:'AAA',shares:0.5}]]){
  const f=fixture();change(f);assert.throws(()=>plan(f));
 }
});
test('three same-sector or six total targets block',()=>{
 for(const count of [3,6]){
  const f=fixture();f.targets=Array.from({length:count},(_,i)=>({
   securityId:'id-'+i,symbol:'A'+i,sector:count===3?'one':'sector-'+i}));
  assert.throws(()=>plan(f),count===3?/SECTOR_CAP/:/INVALID_BASKET/);
 }
});
test('liquidity cap applies to buys and exits',()=>{
 const f=fixture();f.quotes[0].priorAdv20Shares=100;
 assert.throws(()=>plan(f),/LIQUIDITY_CAP/);
 f.targets=[];f.positions=[{securityId:'id-A',symbol:'AAA',shares:5}];f.quotes.pop();
 assert.throws(()=>plan(f),/LIQUIDITY_CAP/);
});
test('cash shortfall blocks full basket instead of cherry-picking',()=>{
 const f=fixture();f.settledCashCents=15000;
 assert.throws(()=>plan(f),/SETTLED_CASH_REQUIRED/);
});
test('session boundary, stale snapshot and incorrect decision time block',()=>{
 for(const [key,value] of Object.entries({now:'2026-11-02T20:40:00Z',
  accountSnapshotAt:'2026-11-02T14:33:00Z',decisionAt:'2026-11-02T13:01:00Z',
  sessionCloseAt:'2026-11-03T21:00:00Z'})){
  const f=fixture();f[key]=value;assert.throws(()=>plan(f));
 }
});
test('five names respect independent aggregate fifty-percent calculation',()=>{
 const f=fixture();f.targets=Array.from({length:5},(_,i)=>({
  securityId:'id-'+i,symbol:'A'+i,sector:'sector-'+Math.floor(i/2)}));
 f.quotes=f.targets.map(t=>({...f.quotes[0],securityId:t.securityId,symbol:t.symbol}));
 const r=plan(f);assert.equal(r.legs.reduce((n,l)=>n+l.shares*l.limitCents,0),50000);
 assert.equal(r.unusedCashCents,50000);
});
