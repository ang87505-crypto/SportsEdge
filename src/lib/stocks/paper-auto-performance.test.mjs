import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardPerformance,parseDailyMarks,PAPER_AUTO_PERFORMANCE_LABELS} from './paper-auto-performance.ts';

const REGISTERED='2026-10-20T11:00:00Z';
function mark(session,equityCents,extra={}){
 return {session,capturedAt:session+'T20:29:00Z',equityCents,cashCents:equityCents,longMarketValueCents:0,
  externalFlowCents:0,feesCents:0,dividendsCents:0,benchmarkSymbol:'SPY',benchmarkClose:'580',
  benchmarkSource:'alpaca:sip:1Day:adjustment=raw',contaminated:false,cashReconciled:true,
  cashUnexplainedCents:'0',...extra};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('no marks: nothing is measured from the registration snapshot alone',()=>{
 const p=forwardPerformance(100000,REGISTERED,[]);
 assert.equal(p.verified.state,'NO_MARKS');
 assert.equal(p.verified.cumulativeReturn,null);assert.equal(p.verified.pnlCents,null);
 assert.equal(p.benchmark.state,'NEEDS_TWO_VERIFIED_CLOSES');
});

test('verified marks chain from the starting equity, with drawdown and a same-window SPY comparison',()=>{
 const p=forwardPerformance(100000,REGISTERED,[mark('2026-10-20',100000),
  mark('2026-10-21',101000,{benchmarkClose:'586'}),mark('2026-10-22',99990,{benchmarkClose:'583.1'})]);
 assert.equal(p.verified.state,'MEASURING');
 assert.equal(p.verified.throughSession,'2026-10-22');
 assert.equal(p.verified.pnlCents,-10);
 close(p.verified.cumulativeReturn,99990/100000-1);
 close(p.verified.maxDrawdown,(101000-99990)/101000);
 assert.equal(p.benchmark.state,'MEASURED');
 assert.deepEqual([p.benchmark.fromSession,p.benchmark.toSession],['2026-10-20','2026-10-22']);
 close(p.benchmark.strategyReturn,99990/100000-1);
 close(p.benchmark.benchmarkReturn,583.1/580-1);
 close(p.benchmark.excessReturn,(99990/100000-1)-(583.1/580-1));
});

test('an unreconciled mark is skipped and the chain continues through the next reconciled mark',()=>{
 const p=forwardPerformance(100000,REGISTERED,[mark('2026-10-20',100000),
  mark('2026-10-21',105000,{cashReconciled:false,cashUnexplainedCents:'5000'}),mark('2026-10-22',102000)]);
 assert.deepEqual(p.marks.map(m=>m.verdict),['VERIFIED','UNRECONCILED_SKIPPED','VERIFIED']);
 assert.equal(p.verified.skippedMarks,1);assert.equal(p.verified.verifiedMarks,2);
 close(p.verified.cumulativeReturn,0.02);
 assert.equal(p.verified.maxDrawdown,0,'the skipped 105000 never sets a peak');
});

test('contamination ends the verified chain for good, so a deposit is never shown as return',()=>{
 const p=forwardPerformance(100000,REGISTERED,[mark('2026-10-23',100600),
  mark('2026-10-26',120600,{contaminated:true,externalFlowCents:20000}),mark('2026-10-27',121000)]);
 assert.deepEqual(p.marks.map(m=>m.verdict),['VERIFIED','CONTAMINATED','AFTER_CONTAMINATION']);
 assert.equal(p.verified.state,'ENDED');assert.equal(p.verified.endedAtSession,'2026-10-26');
 assert.equal(p.verified.throughSession,'2026-10-23');assert.equal(p.verified.pnlCents,600);
 assert.equal(p.benchmark.state,'NEEDS_TWO_VERIFIED_CLOSES');
});

test('a flow on an uncontaminated mark breaks the invariant and ends the chain instead of being netted',()=>{
 const p=forwardPerformance(100000,REGISTERED,[mark('2026-10-20',100000),
  mark('2026-10-21',150000,{externalFlowCents:50000})]);
 assert.deepEqual(p.marks.map(m=>m.verdict),['VERIFIED','CONTAMINATED']);
 assert.equal(p.verified.pnlCents,0);
});

test('only verified SPY closes bound the benchmark window; a missing close is not interpolated',()=>{
 const p=forwardPerformance(100000,REGISTERED,[mark('2026-10-20',100000,{benchmarkClose:null}),
  mark('2026-10-21',101000,{benchmarkClose:'590'}),mark('2026-10-22',101500,{benchmarkClose:'600',
   cashReconciled:false,cashUnexplainedCents:'1'}),mark('2026-10-23',102000,{benchmarkClose:'595'})]);
 assert.deepEqual([p.benchmark.fromSession,p.benchmark.toSession],['2026-10-21','2026-10-23']);
 close(p.benchmark.strategyReturn,102000/101000-1);
 close(p.benchmark.benchmarkReturn,595/590-1);
 const one=forwardPerformance(100000,REGISTERED,[mark('2026-10-20',100000)]);
 assert.equal(one.benchmark.state,'NEEDS_TWO_VERIFIED_CLOSES');
 assert.equal(one.verified.cumulativeReturn,0);
});

test('ledger marks parse strictly and fail closed',()=>{
 const good=[mark('2026-10-20',100000,{cashUnexplainedCents:'-0.5'}),mark('2026-10-21',100000)];
 assert.equal(parseDailyMarks(good).length,2);
 assert.equal(parseDailyMarks(good.slice().reverse()),null,'out of order');
 assert.equal(parseDailyMarks([good[0],good[0]]),null,'duplicate session');
 for(const bad of [{equityCents:1.5},{equityCents:2**53},{cashReconciled:'true'},{contaminated:null},
  {benchmarkClose:'0'},{benchmarkClose:'5e2'},{cashUnexplainedCents:'1e3'},{session:'2026-10-2'},
  {capturedAt:'not a time'},{feesCents:-1},{benchmarkSymbol:'spy'}])
  assert.equal(parseDailyMarks([mark('2026-10-20',100000,bad)]),null,JSON.stringify(bad));
 assert.equal(parseDailyMarks({}),null);
 assert.equal(parseDailyMarks([null]),null);
 assert.throws(()=>forwardPerformance(0,REGISTERED,[]),/INVALID_EXPERIMENT/);
 assert.throws(()=>forwardPerformance(100000,'yesterday',[]),/INVALID_EXPERIMENT/);
});

test('labels state that paper fills are simulated and nothing is annualized',()=>{
 const text=PAPER_AUTO_PERFORMANCE_LABELS.join(' ');
 assert.match(text,/simulated/);assert.match(text,/not achievable real-money returns/);
 assert.match(text,/Not annualized/);assert.match(text,/without dividends/);
});
