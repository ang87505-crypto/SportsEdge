import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY, INITIAL_CENTS, ticker, cents, openTrade, closeTrade, totals, parseJournal} from './journal.ts';
const OPENED='2026-10-09T00:00:00.000Z';
const CLOSED='2026-10-09T01:00:00.000Z';
const trade=(id,entryCents=5000,shares=10)=>({id,symbol:'AAPL',entryCents,shares,openedAt:OPENED,note:'Manual quote for research only'});

test('Stock ticker normalization is strict and predictable',()=>{
  assert.equal(ticker(' aapl '),'AAPL');
  assert.equal(ticker('brk.b'),'BRK.B');
  assert.equal(ticker('rds-a'),'RDS-A');
  for(const bad of ['', '1AAPL', 'GOO GL', 'USD$', '.ABC', 'TOOLONGSYMBOL', 'A/B'])assert.throws(()=>ticker(bad));
});
test('Decimal prices are converted into exact integer cents',()=>{
  assert.equal(cents('0.01'),1);
  assert.equal(cents('1.29'),129);
  assert.equal(cents('1000000'),100000000);
  assert.equal(cents(' 25.75 '),2575);
  for(const bad of ['0','0.00','1.005','1e3','+5','-5','1000000.01','NaN',''])assert.throws(()=>cents(bad));
});
test('Buying and selling updates cash, cost and realized P&L without mutating prior snapshots',()=>{
  const j1=openTrade(EMPTY,trade('a'));
  const j2=closeTrade(j1,'a',5500,CLOSED);
  assert.deepEqual(totals(j1),{cash:INITIAL_CENTS-50000,realized:0,cost:50000,open:1,closed:0});
  assert.deepEqual(totals(j2),{cash:INITIAL_CENTS+5000,realized:5000,cost:0,open:0,closed:1});
  assert.equal(j1.trades[0].exitCents,undefined);
  assert.equal(totals(EMPTY).cash,INITIAL_CENTS);
  assert.throws(()=>closeTrade(j2,'a',6000,CLOSED));
});
test('Losses and concurrent open exposure are counted at manually entered cost, not invented market prices',()=>{
  let j=openTrade(EMPTY,trade('a',12000,10));
  j=openTrade(j,trade('b',4000,5));
  assert.equal(totals(j).cash,INITIAL_CENTS-140000);
  assert.equal(totals(j).cost,140000);
  j=closeTrade(j,'a',11000,CLOSED);
  assert.equal(totals(j).realized,-10000);
  assert.equal(totals(j).cost,20000);
  assert.equal(totals(j).cash,INITIAL_CENTS-140000+110000);
});
test('All-cash exposure cannot be exceeded, with no borrowing or short shares',()=>{
  const j=openTrade(EMPTY,trade('a',100000,10));
  assert.equal(totals(j).cash,0);
  assert.throws(()=>openTrade(j,trade('b',1,1)));
  for(const shares of [0,-1,1.25,100001,NaN]) assert.throws(()=>openTrade(EMPTY,trade('bad',100,shares)));
});
test('Saved journal rejects duplicates, overlong notes, malformed dates, and negative balances',()=>{
  const j=openTrade(EMPTY,trade('a'));
  assert.deepEqual(parseJournal(JSON.stringify(j)),j);
  assert.throws(()=>parseJournal('{not json'));
  assert.throws(()=>parseJournal(JSON.stringify({...j,version:2})));
  assert.throws(()=>parseJournal(JSON.stringify({...j,trades:[j.trades[0],j.trades[0]]})));
  assert.throws(()=>parseJournal(JSON.stringify({...j,trades:[{...j.trades[0],note:'x'.repeat(501)}]})));
  assert.throws(()=>parseJournal(JSON.stringify({...j,trades:[{...j.trades[0],openedAt:'invalid'}]})));
  assert.throws(()=>parseJournal(JSON.stringify({...j,trades:[{...j.trades[0],shares:100000}]})));
  const closed=closeTrade(j,'a',4000,CLOSED);
  assert.throws(()=>parseJournal(JSON.stringify({...closed,trades:[{...closed.trades[0],closedAt:'2026-10-08T23:59:59.000Z'}]})));
});
test('Journal enforces position and watchlist caps',()=>{
  let j=EMPTY;
  for(let i=0;i<500;i++)j=openTrade(j,trade(String(i),1,1));
  assert.equal(j.trades.length,500);
  assert.throws(()=>openTrade(j,trade('501',1,1)));
  assert.deepEqual(parseJournal(JSON.stringify(j)),j);
  assert.throws(()=>parseJournal(JSON.stringify({...j,trades:[...j.trades,j.trades[0]]})));
  assert.throws(()=>parseJournal(JSON.stringify({...j,watchlist:Array.from({length:101},(_,i)=>'T'+i)})));
});
