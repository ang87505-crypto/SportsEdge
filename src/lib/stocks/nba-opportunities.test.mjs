import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeNbaGames,NBA_MODEL_VERSION} from '../nba-opportunities.ts';

const at=Date.parse('2026-10-11T20:00:30Z');
const stamp=offset=>new Date(at-offset*1000).toISOString();
const game=(bookmakers=[])=>({id:'42',home:'Home',away:'Away',
  startsAt:'2026-10-12T20:00:00Z',bookmakers});
const forecast=(extra={})=>({id:1,game_id:42,starts_at:'2026-10-12T20:00:00Z',
  published_at:'2026-10-11T19:00:00Z',home_probability:0.58,
  model_version:NBA_MODEL_VERSION,games:{home:{name:'Home'},away:{name:'Away'}},...extra});
function quotes(odds=[-110,-110],age=10,extra={}) {
  const decimal=o=>o>0?1+o/100:1+100/-o;
  const raw=odds.map(o=>1/decimal(o)),vig=raw[0]+raw[1];
  return ['Home','Away'].map((selection,i)=>({
    sportsbook:'Book One',provider:'source-one',selection,americanOdds:odds[i],
    updatedAt:stamp(age),ingestedAt:stamp(Math.max(0,age-1)),completeMarket:true,
    noVigProbability:raw[i]/vig,freshness:'fresh',...extra
  }));
}
function evaluate(bars=quotes(),model=forecast(),clock=at) {
  return analyzeNbaGames([game(bars)],model===null?[]:[model],clock)[0];
}
test('pre-published model and complete fresh quotes yield a screening candidate',()=>{
  const x=evaluate();
  assert.equal(x.status,'screened');assert.equal(x.best.selection,'Home');
  assert.equal(x.best.americanOdds,-110);
  assert.ok(Math.abs(x.best.estimatedEv-(.58*(1+100/110)-1))<1e-12);
  assert.equal(x.completeMarketCount,1);assert.equal(x.freshMarketCount,1);
});
test('fresh market without estimated edge is never screened',()=>{
  const x=evaluate(quotes([-150,130]));
  assert.equal(x.status,'no_edge');assert.equal(x.freshMarketCount,1);
});
test('60 second cutoff is enforced based on source timestamp, not claimed freshness label',()=>{
  const x=evaluate(quotes([-110,-110],61));
  assert.equal(x.status,'stale');assert.equal(x.best.fresh,false);
});
test('future and reversed timestamps cannot create a screened candidate',()=>{
  for(const patch of [{updatedAt:stamp(-2),ingestedAt:stamp(0)},
    {updatedAt:stamp(10),ingestedAt:stamp(20)},
    {updatedAt:'not-a-time'},{ingestedAt:stamp(-5)}]) {
    const x=evaluate(quotes().map(q=>({...q,...patch})));
    assert.notEqual(x.status,'screened');
  }
});
test('superceded favorable historical snapshot never becomes an actionable price',()=>{
  const old=quotes([150,-165],45);
  const current=quotes([-220,180],10);
  // The public odds API normally returns only newest rows. If mixed records leak
  // through, fail closed rather than select an old favorable price.
  const mixed=evaluate([...old,...current]);
  assert.equal(mixed.status,'incomplete');
  const latest=evaluate(current);
  assert.equal(latest.status,'no_edge');
});
test('different sportsbooks or provider sources cannot form one market',()=>{
  for(const patch of [{sportsbook:'Other'}, {provider:'Other'}]){
    const values=quotes();values[1]={...values[1],...patch};
    assert.equal(evaluate(values).status,'incomplete');
  }
});
test('unmatched published timestamps, team mapping, or model version cannot qualify',()=>{
  const cases=[
    {published_at:'2026-10-12T20:01:00Z'},
    {published_at:'2026-10-11T20:01:00Z'},
    {starts_at:'2026-10-13T20:00:00Z'},
    {model_version:'research-experiment'},
    {home_probability:1},{home_probability:NaN},
    {games:{home:{name:'Wrong'},away:{name:'Away'}}}
  ];
  for(const change of cases)assert.equal(evaluate(quotes(),forecast(change)).status,'no_forecast');
});
test('incomplete latest bookmaker market and invalid fair market cannot qualify',()=>{
  assert.equal(evaluate(quotes().slice(0,1)).status,'incomplete');
  assert.equal(evaluate(quotes().map(q=>({...q,completeMarket:false}))).status,'incomplete');
  assert.equal(evaluate(quotes().map(q=>({...q,noVigProbability:0.99}))).status,'incomplete');
  assert.equal(evaluate(quotes([0,-110])).status,'incomplete');
});
test('stale previous display does not remain actionable as time moves forward',()=>{
  assert.equal(evaluate(quotes()).status,'screened');
  assert.equal(evaluate(quotes(),forecast(),at+61_000).status,'stale');
});
test('cannot screen a started game or use a non-sensical freshness policy',()=>{
  const started=game(quotes());started.startsAt='2026-10-11T19:59:00Z';
  assert.deepEqual(analyzeNbaGames([started],[forecast()],at),[]);
  for(const limit of [0,100,61000,NaN])assert.throws(()=>analyzeNbaGames([game(quotes())],[forecast()],at,limit));
});
test('pre-screening never creates a bet or mutates market inputs',()=>{
  const g=game(quotes()),f=forecast();
  const original=JSON.stringify({g,f});
  const rows=analyzeNbaGames([g],[f],at);
  assert.equal(JSON.stringify({g,f}),original);
  assert.equal(rows.length,1);
  assert.equal(Object.hasOwn(rows[0],'stake_cents'),false);
  assert.equal(Object.hasOwn(rows[0],'position_id'),false);
});
