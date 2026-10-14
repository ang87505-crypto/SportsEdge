import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOneNbaPaperCandidate,NBA_MODEL_VERSION} from './nba-paper-run-contract.ts';
const now='2026-10-14T21:00:00Z';
const f={id:1,game_id:2,model_version:NBA_MODEL_VERSION,home_probability:0.7,
 published_at:'2026-10-13T10:00:00Z',starts_at:'2026-10-20T23:00:00Z',
 games:{id:2,starts_at:'2026-10-20T23:00:00Z',status:'scheduled',
 home:{name:'Test Home'},away:{name:'Test Away'},leagues:{sport_code:'nba'}}};
const pair=[
 {id:11,game_id:2,sportsbook:'example-book',provider:'sports-provider',
 selection:'Test Home',american_odds:-110,observed_at:'2026-10-14T20:59:00Z',ingested_at:'2026-10-14T20:59:10Z'},
 {id:12,game_id:2,sportsbook:'example-book',provider:'sports-provider',
 selection:'Test Away',american_odds:-110,observed_at:'2026-10-14T20:59:00Z',ingested_at:'2026-10-14T20:59:12Z'}
];
const plan=(over={})=>selectOneNbaPaperCandidate({
 forecasts:[f],quotes:pair,recordedForecastIds:[],now,...over});
test('Only model-priced complete recent NBA markets produce one candidate',()=>{
 const r=plan();
 assert.equal(r.eligibleMarkets,1);
 assert.equal(r.candidate?.quoteId,11);
 assert.equal(r.candidate?.selection,'Test Home');
 assert.ok((r.candidate?.expectedValue??0)>=.02);
 assert.equal(r.candidate?.opponent,'Test Away');
});
test('Incomplete markets, stale/after-tipoff prices and retroactive publication cannot qualify',()=>{
 for(const change of [
  {quotes:pair.slice(0,1)},
  {quotes:pair.map(q=>({...q,observed_at:'2026-10-14T15:00:00Z',ingested_at:'2026-10-14T15:00:01Z'}))},
  {quotes:pair.map(q=>({...q,ingested_at:'2026-10-14T21:00:01Z'}))},
  {quotes:pair.map(q=>({...q,observed_at:'2026-10-14T20:59:20Z'}))},
  {quotes:pair.map(q=>({...q,selection:'Test Home'}))},
  {quotes:pair.map(q=>({...q,sportsbook:q.id===11?'book-1':'book-2'}))},
  {quotes:pair.map(q=>({...q,provider:q.id===11?'provider-1':'provider-2'}))},
  {forecasts:[{...f,published_at:'2026-10-21T23:00:00Z'}]},
  {forecasts:[{...f,games:{...f.games,status:'final'}}]},
  {forecasts:[{...f,model_version:'future-unreviewed-model'}]},
  {forecasts:[{...f,games:{...f.games,leagues:{sport_code:'soccer'}}}]},
  {recordedForecastIds:[1]}
 ]){
  assert.equal(plan(change).candidate,null);
 }
});
test('No quote 2026-10-08 is recycled as a paper-bet price today',()=>{
 assert.equal(plan({quotes:pair.map(q=>({...q,observed_at:'2026-10-08T22:52:38Z',ingested_at:'2026-10-08T22:52:40Z'}))}).candidate,null);
});
test('Extreme, malformed, multi-side, duplicate or invalid market cannot pass',()=>{
 for(const change of [
  {quotes:[...pair,pair[0]]},
  {quotes:pair.map(q=>({...q,american_odds:99}))},
  {quotes:pair.map(q=>({...q,american_odds:NaN}))},
  {quotes:pair.map(q=>({...q,game_id:3}))},
  {forecasts:[{...f,home_probability:1.25}]},
  {forecasts:[{...f,games:{...f.games,home:{name:'Test Away'}}}]}
 ])assert.equal(plan(change).candidate,null);
});
test('Previously recorded shared-ledger positions are excluded',()=>{
 assert.equal(plan({recordedForecastIds:[1]}).candidate,null);
});
test('Deterministic quote tie-break and malformed input fail closed',()=>{
 const extra=pair.map(q=>({...q,id:q.id+20,sportsbook:'book-b'}));
 assert.equal(plan({quotes:[...extra,...pair]}).candidate?.quoteId,11);
 for(const input of [{forecasts:null},{quotes:null},{now:'not-a-time'},
   {recordedForecastIds:[-1]},{quotes:Array(1000).fill(pair[0])}])
   assert.throws(()=>plan(input));
});
