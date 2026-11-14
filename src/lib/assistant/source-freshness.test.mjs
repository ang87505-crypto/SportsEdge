import test from 'node:test';
import assert from 'node:assert/strict';
import {isFreshnessQuestion,freshnessAnswer} from './source-freshness.ts';

const now='2026-11-13T22:00:00.000Z';
const run={id:42,url:'https://github.com/ang87505-crypto/SportsEdge/actions/runs/42',
 event:'schedule',status:'completed',conclusion:'success',
 startedAt:'2026-11-13T20:00:00.000Z',finishedAt:'2026-11-13T20:01:00.000Z'};
const makeJob=(area,id,historyUrl)=>({
 id,label:area+' '+id,area,required:true,status:'OK',detail:'confirmed',
 historyUrl:historyUrl??'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/'+id+'.yml',
 lastSuccess:run,lastRun:run,lastFailure:null,running:null,
 slots7d:{due:1,missed:0,lastMissedAt:null},nextPlanned:['2026-11-14T20:00:00.000Z'],note:null
});
const jobs=[
 makeJob('sports','props-tick'),
 makeJob('stocks','stock-worker'),
 makeJob('research','research-collect'),
 makeJob('sports','evil','https://untrusted.invalid/forged-link')
];
const view=(monitorStale=false,items=jobs)=>({
 mode:'live',checkedAt:now,monitorStale,status:{
  schemaVersion:'ops-status-v1',generatedAt:now,jobs:items,blockers:[],
  overall:{state:'OK',attention:[]},site:{ok:true,checkedAt:now,url:'x',checks:[]},
  evidence:{},credentials:[],monitorRun:null
 }
});
const q=domain=>({domain,topic:'automation'});
const hrefs=r=>r.cards.flatMap(c=>c.kind==='links'?c.items.map(x=>x.href):[]);

test('freshness intent does not steal backfill, model training or owner commands',()=>{
 for(const message of [
  'are NBA picks up to date?','when was stock data last updated?',
  'why are my picks not updating?','is the research feed stale',
  'how old are our sports scores','latest data for Kalshi weather'
 ])assert.equal(isFreshnessQuestion(message),true,message);
 for(const message of [
  'backfill the stale lines','refresh NOAA data now',
  'please stop the stock bot','can you retrain the NBA model',
  'is the stock model profitable','did the system make any picks'
 ])assert.equal(isFreshnessQuestion(message),false,message);
});
test('sports workflow receipts explain their own limits rather than claiming data completeness',()=>{
 const r=freshnessAnswer(q('sports'),view());
 assert.match(r.text,/sports props-tick/);
 assert.doesNotMatch(r.text,/stocks stock-worker/);
 assert.match(r.text,/workflow success proves only/i);
 assert.match(r.text,/next planned .*\(not yet a run\)/);
 assert.ok(hrefs(r).includes('/paper-betting/props'));
 assert.ok(hrefs(r).includes('https://github.com/ang87505-crypto/SportsEdge/actions/workflows/props-tick.yml'));
 assert.ok(hrefs(r).every(h=>!h.includes('untrusted.invalid')));
 assert.equal(r.cards.some(c=>c.kind==='action'),false);
});
test('stocks metadata remains public without exposing owner positions or account balance',()=>{
 const r=freshnessAnswer(q('stocks'),view());
 assert.match(r.text,/stocks stock-worker/);
 assert.doesNotMatch(r.text,/sports props-tick|broker account|balance \$|\bOXY\b/i);
 assert.ok(hrefs(r).includes('/stocks/paper-auto'));
 assert.equal(r.context.domain,'stocks');
});
test('Kalshi public data has no dedicated monitor job and makes no market-price claim',()=>{
 const r=freshnessAnswer(q('kalshi'),view());
 assert.match(r.text,/No dedicated workflow/i);
 assert.match(r.text,/cannot establish a Kalshi market price/i);
 assert.ok(hrefs(r).includes('/prediction-markets/kalshi'));
 assert.ok(hrefs(r).every(h=>!h.includes('stock-worker')));
});
test('missing and stale monitor snapshots are unknown, not zero results',()=>{
 const missing=freshnessAnswer(q('sports'),null);
 assert.match(missing.text,/cannot say whether the records are fresh/i);
 assert.doesNotMatch(missing.text,/0 wins|0 bets|no picks made/i);
 const stale=freshnessAnswer(q('sports'),view(true));
 assert.match(stale.text,/monitor itself is stale/i);
 assert.doesNotMatch(stale.text,/definitely current|all records complete/i);
});
test('unverified, absent successes never become recorded victories or guaranteed fresh data',()=>{
 const noSuccess={...makeJob('sports','props-tick'),status:'UNKNOWN',lastRun:null,lastSuccess:null,nextPlanned:[]};
 const r=freshnessAnswer(q('sports'),view(false,[noSuccess]));
 assert.match(r.text,/no successful workflow recorded/i);
 assert.doesNotMatch(r.text,/successfully archived all data|0 losses|100%/);
});
