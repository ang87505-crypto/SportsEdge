import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildIndependentWeatherMemory} from './weather-memory.ts';
import {loadLatestIndependentWeather,loadLatestWeatherScorecard} from './weather-memory-view.ts';
import {scoreIndependentWeatherForward} from './weather-scorecard.ts';
const now='2026-11-13T21:00:00Z';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function record(){
 const base=Date.parse(now)+3600_000;
 const hourly=Array.from({length:48},(_,i)=>({
  startTime:new Date(base+i*3600_000).toISOString(),
  endTime:new Date(base+(i+1)*3600_000).toISOString(),
  temperatureF:45+i%6
 }));
 return buildIndependentWeatherMemory({
  source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',
  fetchedAt:now,forecastIssuedAt:'2026-11-13T19:00:00Z',
  sourceDigest:digest(hourly),
  gridForecastUrl:'https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly',hourly
 });
}
test('reads archived NOAA-only forecast and never requests Kalshi or NWS',async()=>{
 const f=record(),urls=[];
 const r=await loadLatestIndependentWeather(now,async(url)=>{
  urls.push(url);
  assert.ok(url.startsWith('https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/kalshi-independent/nyc-weather/'));
  if(url.endsWith('/forecasts/2026-11-14.json'))
   return new Response(JSON.stringify(f),{headers:{'content-type':'application/json'}});
  return new Response('',{status:404});
 });
 assert.equal(r.state,'RECORDED');
 assert.equal(r.memory.targetLocalDate,'2026-11-14');
 assert.equal(r.grade,null);
 assert.equal(urls.length,2);
});
test('missing or corrupt archived data never creates an opportunity, forecast or success rate',async()=>{
 const missing=await loadLatestIndependentWeather(now,async()=>new Response('',{status:404}));
 assert.equal(missing.state,'AWAITING_FIRST_ARCHIVE');
 const f=record(),tampered={...f,forecastHighF:f.forecastHighF+9};
 const bad=await loadLatestIndependentWeather(now,async(url)=>
  url.endsWith('/forecasts/2026-11-14.json')?new Response(JSON.stringify(tampered)):new Response('',{status:404}));
 assert.equal(bad.state,'ARCHIVE_UNAVAILABLE');
 assert.equal(bad.memory,null);
});
test('403 or oversized provider result is unavailable, never interpreted as a market quote',async()=>{
 const bad=await loadLatestIndependentWeather(now,async()=>new Response('',{status:403}));
 assert.equal(bad.state,'ARCHIVE_UNAVAILABLE');
 const oversize=await loadLatestIndependentWeather(now,async()=>
  new Response('a'.repeat(120001),{headers:{'content-length':'120001'}}));
 assert.equal(oversize.state,'ARCHIVE_UNAVAILABLE');
});

test('latest independent scorecard is loaded solely from archived NOAA data',async()=>{
 const saved=scoreIndependentWeatherForward([]),requests=[];
 const result=await loadLatestWeatherScorecard(now,async(url)=>{
  requests.push(url);
  assert.match(url,/raw\.githubusercontent\.com/);
  assert.doesNotMatch(url,/kalshi\.com/);
  return url.endsWith('/scorecards/2026-11-12.json')?
   new Response(JSON.stringify(saved)) : new Response('',{status:404});
 });
 assert.equal(result.state,'RECORDED');
 assert.equal(result.scorecard.evaluatedDays,0);
 assert.equal(requests.length,1);
});
