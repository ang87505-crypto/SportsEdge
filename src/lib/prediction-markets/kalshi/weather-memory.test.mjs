import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildIndependentWeatherMemory,verifyIndependentWeatherMemory,nextNewYorkDate} from './weather-memory.ts';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function mock(asOf='2026-11-13T21:00:00Z',issued='2026-11-13T19:00:00Z',hourCount=48){
 const start=Date.parse(asOf)+3600_000;
 const hourly=Array.from({length:hourCount},(_,i)=>({
  startTime:new Date(start+i*3600_000).toISOString(),
  endTime:new Date(start+(i+1)*3600_000).toISOString(),
  temperatureF:45+(i%7)
 }));
 return {source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',forecastIssuedAt:issued,
  fetchedAt:asOf,sourceDigest:digest(hourly),
  gridForecastUrl:'https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly',hourly};
}
const day=(i)=>{
 const d=new Date(Date.UTC(2026,9,1+i)),localDate=d.toISOString().slice(0,10);
 return {localDate,forecastHighF:55+(i%4),observedHighF:53+(i%7),
 forecastAvailableAt:new Date(d.getTime()-12*3600_000).toISOString(),
 observedAvailableAt:new Date(d.getTime()+36*3600_000).toISOString(),
 forecastSource:'NWS',observationSource:'OFFICIAL_CENTRAL_PARK'};
};
test('no historical labels: freeze a genuine point forecast without inventing a win probability',()=>{
 const a=buildIndependentWeatherMemory(mock());
 assert.equal(a.targetLocalDate,'2026-11-14');
 assert.equal(a.locale,'America/New_York');
 assert.equal(a.status,'AWAITING_VERIFIED_HISTORY');
 assert.equal(a.estimatedBandProbabilityPpm,null);
 assert.equal(a.forecastHighF,51);
 assert.equal(a.bandHighF-a.bandLowF,4);
 assert.equal(a.sourceSnapshot.hourly.length,48);
 assert.equal(a.id.length,64);
 assert.deepEqual(verifyIndependentWeatherMemory(JSON.parse(JSON.stringify(a))),a);
 assert.equal('kalshiMarket' in a,false);
});
test('even a thirty-day independent model is marked uncalibrated and keeps source training hash',()=>{
 const history=Array.from({length:35},(_,i)=>day(i));
 const r=buildIndependentWeatherMemory(mock(),history);
 assert.equal(r.status,'UNCALIBRATED_EXPERIMENTAL_MODEL');
 assert.equal(r.historicalTrainingDays,35);
 assert.equal(r.modelId,'nws-empirical-error-v0-research');
 assert.ok(r.estimatedBandProbabilityPpm>0&&r.estimatedBandProbabilityPpm<1e6);
 assert.equal(r.historicalTrainingDigest.length,64);
 const newer=history.map((d,i)=>i===0?{...d,observedHighF:120}:d);
 const b=buildIndependentWeatherMemory(mock(),newer);
 assert.notEqual(r.id,b.id,'training changes are preserved in the hash');
});
test('Central Park report day stays on fixed EST even when civil NYC uses EDT',()=>{
 assert.equal(nextNewYorkDate('2026-11-14T03:20:00Z'),'2026-11-14');
 assert.equal(nextNewYorkDate('2026-11-14T05:20:00Z'),'2026-11-15');
 assert.equal(nextNewYorkDate('2026-07-04T04:20:00Z'),'2026-07-04','00:20 EDT is still the previous Central Park EST day');
 assert.equal(nextNewYorkDate('2026-07-04T05:20:00Z'),'2026-07-05','00:20 EST starts the new Central Park climate day');
 for(const [at,expected] of [
  ['2026-03-07T22:00:00Z','2026-03-08'],
  ['2026-10-31T21:00:00Z','2026-11-01']
 ]){
  const r=buildIndependentWeatherMemory(mock(at,new Date(Date.parse(at)-3600_000).toISOString()));
  assert.equal(r.targetLocalDate,expected);
  assert.equal(r.sourceSnapshot.hourly.length,48);
 }
});
test('partial dates, stale issuances, gaps and bad forecast units never become frozen predictions',()=>{
 const stale=mock();stale.forecastIssuedAt='2026-11-12T01:00:00Z';
 assert.throws(()=>buildIndependentWeatherMemory(stale),/STALE/);
 const partial=mock('2026-11-13T21:00:00Z','2026-11-13T19:00:00Z',24);
 assert.throws(()=>buildIndependentWeatherMemory(partial),/DAY_NOT_FULLY_COVERED/);
 const gap=mock();gap.hourly[12]={...gap.hourly[12],endTime:new Date(Date.parse(gap.hourly[12].endTime)+3600_000).toISOString()};
 assert.throws(()=>buildIndependentWeatherMemory(gap),/GAP_OR_FORECAST/);
 const after=mock();after.hourly[15]={...after.hourly[15],temperatureF:NaN};
 assert.throws(()=>buildIndependentWeatherMemory(after),/GAP_OR_FORECAST/);
});
test('tampering with daily high, target date, source data or hash fails read-time validation',()=>{
 const r=buildIndependentWeatherMemory(mock());
 for(const modified of [
  {...r,forecastHighF:r.forecastHighF+1},
  {...r,targetLocalDate:'2026-11-15'},
  {...r,sourceSnapshot:{...r.sourceSnapshot,fetchedAt:'2026-11-15T00:00:00Z'}},
  {...r,id:'a'.repeat(64)}
 ])assert.throws(()=>verifyIndependentWeatherMemory(modified),/INVALID_RECORD/);
});
test('future observed labels never enter the probability model',()=>{
 const training=Array.from({length:34},(_,i)=>day(i));
 const all=training.concat([{...day(34),observedAvailableAt:'2026-11-25T10:00:00Z'}]);
 const a=buildIndependentWeatherMemory(mock(),training);
 const b=buildIndependentWeatherMemory(mock(),all);
 assert.equal(a.id,b.id);
 assert.equal(b.historicalTrainingDays,34);
});
