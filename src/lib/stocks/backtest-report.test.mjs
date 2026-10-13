import test from 'node:test';
import assert from 'node:assert/strict';
import {admitReport,validReport,BASELINE,CANDIDATE,REPORT_VERSION} from './backtest-report.ts';
// Entirely fictional schema fixture. Never published or treated as historical evidence.
const h='a'.repeat(64);
function fixture(){
 const m={netProfit:0,cagr:0,maxDrawdown:0,volatility:0,tradingCosts:0,turnover:0,exposure:0,cashWeight:1,cashDrag:null,sharpe:null};
 return {version:REPORT_VERSION,kind:'historical',status:'validated',phase:'development',
  protocolSha256:h,sourceCommit:'b'.repeat(40),datasetSha256:h,engineVersion:'SYNTHETIC-TEST',
  provenance:'SYNTHETIC TEST ONLY',benchmarkDefinition:'SYNTHETIC TEST ONLY',account:'frozen_stock_research',
  startingCapitalCents:100000,baselineVersion:BASELINE,candidateVersion:CANDIDATE,primaryCostBps:15,sensitivityBps:[25,50],
  reconciliationPassed:true,gatesPassed:true,period:{start:'2000-01-01',end:'2011-12-31'},
  metrics:{baseline:{...m},candidate:{...m}},equity:[{date:'1999-12-31',baseline:1000,candidate:1000,market:1000,balanced:1000},
  {date:'2011-12-30',baseline:1000,candidate:1000,market:1000,balanced:1000}],trades:[],
  uncertainty:{meanMonthlyDifference:0,lower:0,upper:0,seed:20261012,replicates:10000,yearBlocks:12,limitation:'SYNTHETIC'}};
}
test('Missing or unapproved data cannot produce measured results',()=>{
 for(const value of [null,{},fixture()])assert.equal(admitReport(value,h,[],h).status,'not_measured');
});
test('Explicit reviewed hash plus valid schema needed for rendering',()=>{
 assert.equal(admitReport(fixture(),h,[h],h).status,'validated');
 assert.equal(admitReport(fixture(),'c'.repeat(64),[h],h).status,'not_measured');
});
test('Synthetic, blocked, different account and wrong strategy cannot be published',()=>{
 for(const [k,v] of [['kind','synthetic'],['status','failed'],['account','alpaca'],['startingCapitalCents',1000000],['candidateVersion','tuned'],['reconciliationPassed',false],['gatesPassed',false]]){
  const r=fixture();r[k]=v;assert.equal(admitReport(r,h,[h],h).status,'not_measured');
 }
});
test('Wrong protocol, windows and cost settings fail',()=>{
 for(const change of [r=>r.protocolSha256='0'.repeat(64),r=>r.period.start='2001-01-01',r=>r.primaryCostBps=0,r=>r.sensitivityBps=[50,25],r=>r.phase='exploratory']){
  const r=fixture();change(r);assert.equal(validReport(r,h),false);
 }
});
test('Nonfinite values, invented profit, drawdown and CAGR fail',()=>{
 for(const [k,v] of [['netProfit',1],['cagr',.1],['maxDrawdown',.1],['volatility',NaN],['exposure',2],['tradingCosts',-1],['sharpe',Infinity]]){
  const r=fixture();r.metrics.baseline[k]=v;assert.equal(validReport(r,h),false);
 }
});
test('Unordered dates, changed origin and zero NAV fail',()=>{
 for(const change of [r=>r.equity.reverse(),r=>r.equity[0].baseline=999,r=>r.equity[1].candidate=0,r=>r.equity[1].date='2011-02-30']){
  const r=fixture();change(r);assert.equal(validReport(r,h),false);
 }
});
test('Statistical protocol and confidence intervals validate',()=>{
 for(const [k,v] of [['lower',1],['replicates',100],['seed',1],['yearBlocks',1],['upper',NaN]]){
  const r=fixture();r.uncertainty[k]=v;assert.equal(validReport(r,h),false);
 }
});
test('Trade ledger rejects fractions, duplicated receipts and foreign dates',()=>{
 const t={id:'test',strategy:'baseline',date:'2000-01-03',securityId:'fixture-id',symbol:'FAKE',side:'buy',shares:1,amountCents:100,feeCents:0};
 for(const entries of [[{...t,shares:.5}],[t,t],[{...t,date:'2017-01-01'}],[{...t,side:'short'}]]){
  const r=fixture();r.trades=entries;assert.equal(validReport(r,h),false);
 }
});
