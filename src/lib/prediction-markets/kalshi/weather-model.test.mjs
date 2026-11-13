import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateStationTemperatureRange} from './weather-model.ts';
const at='2026-11-13T19:00:00Z';
const training=Array.from({length:35},(_,i)=>{
 const localDate=new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10);
 return {localDate,forecastHighF:60,observedHighF:60+i%5-2,
  forecastAvailableAt:localDate+'T08:00:00Z',observedAvailableAt:new Date(Date.parse(localDate+'T00:00:00Z')+36*3600_000).toISOString(),
  forecastSource:'NWS',observationSource:'OFFICIAL_CENTRAL_PARK'};
});
const base=()=>({forecastHighF:62,rangeMinF:61,rangeMaxF:63,targetLocalDate:'2026-11-14',asOf:at,training});
test('independent empirical forecast uses historical days, smoothing, no Kalshi data',()=>{
 const r=estimateStationTemperatureRange(base());
 assert.equal(r.trainingDays,35);
 assert.equal(r.probabilityPpm,Math.round(1_000_000*(21+1)/(35+2)));
 assert.equal('marketPrice' in r,false);
 assert.equal(r.modelId,'nws-empirical-error-v0-research');
});
test('minimum history, after-cutoff labels and duplicates all rejected',()=>{
 assert.throws(()=>estimateStationTemperatureRange({...base(),training:training.slice(0,29)}),/INSUFFICIENT/);
 assert.throws(()=>estimateStationTemperatureRange({...base(),training:[...training.slice(0,34),training[0]]}),/DUPLICATE/);
 assert.throws(()=>estimateStationTemperatureRange({...base(),training:[...training.slice(0,34),{...training[34],observedAvailableAt:'2026-11-15T00:00:00Z'}]}),/ASOF/);
 assert.throws(()=>estimateStationTemperatureRange({...base(),rangeMinF:70,rangeMaxF:60}),/INVALID_TARGET/);
});
test('training does not accept unverified data source or future-date observations',()=>{
 assert.throws(()=>estimateStationTemperatureRange({...base(),training:[...training.slice(0,34),{...training[34],forecastSource:'kalshi'}]}),/ASOF_OR_SOURCE/);
});
