import test from 'node:test';
import assert from 'node:assert/strict';
import {walkForwardNwsTemperature} from './weather-replay.ts';

const day=(i)=>{
 const date=new Date(Date.UTC(2026,0,1+i));
 const localDate=date.toISOString().slice(0,10);
 const forecastAvailableAt=new Date(date.getTime()-12*3600_000).toISOString();
 const observedAvailableAt=new Date(date.getTime()+36*3600_000).toISOString();
 return {localDate,forecastHighF:50+(i%6)*3,observedHighF:50+(i%6)*3+(i%5-2),
  forecastAvailableAt,observedAvailableAt,forecastSource:'NWS',
  observationSource:'OFFICIAL_CENTRAL_PARK'};
};
const records=()=>Array.from({length:95},(_,i)=>day(i));
test('replay is deterministic, scores forward-only using independent date-specific ranges',()=>{
 const a=walkForwardNwsTemperature(records());
 const b=walkForwardNwsTemperature([...records()].reverse());
 assert.deepEqual(a,b);
 assert.equal(a.inputDays,95);
 assert.ok(a.resolvedHoldoutDays>50);
 assert.equal(a.status,'RESEARCH_ONLY_NOT_PROVEN');
 assert.ok(a.rows.every(r=>r.trainDays>=30&&r.asOf.slice(0,10)<r.date));
 assert.ok(a.meanModelBrier>=0&&a.meanModelBrier<=1);
 assert.ok(a.meanClimatologyBrier>=0&&a.meanClimatologyBrier<=1);
 assert.equal('kalshiPrice' in a,false);
});
test('all rows observed after forecast as-of; changing later results cannot affect older predictions',()=>{
 const data=records(),a=walkForwardNwsTemperature(data);
 const changed=data.map((d,i)=>i>80?{...d,observedHighF:d.observedHighF+12}:d);
 const b=walkForwardNwsTemperature(changed);
 assert.deepEqual(a.rows.filter(x=>x.date<changed[81].localDate),
  b.rows.filter(x=>x.date<changed[81].localDate));
});
test('future labeled outcomes are not used; rows require actual as-of availability',()=>{
 const d=records();const next=d.map((x,i)=>i===35?{
  ...x,observedAvailableAt:'2026-06-01T12:00:00Z'}:x);
 const a=walkForwardNwsTemperature(d),b=walkForwardNwsTemperature(next);
 const x=a.rows.find(x=>x.date===d[45].localDate),y=b.rows.find(x=>x.date===d[45].localDate);
 assert.ok(x&&y);assert.equal(y.trainDays,x.trainDays-1);
});
test('duplicated, impossible, mismatched and future-provider inputs reject outright',()=>{
 assert.throws(()=>walkForwardNwsTemperature([...records(),records()[0]]),/DUPLICATE/);
 assert.throws(()=>walkForwardNwsTemperature([{...day(0),forecastSource:'kalshi'}]),/INVALID_SOURCE/);
 assert.throws(()=>walkForwardNwsTemperature([{...day(0),forecastAvailableAt:'2099-01-01T00:00:00Z'}]),/BAD_PROVENANCE/);
 assert.throws(()=>walkForwardNwsTemperature([{...day(0),forecastHighF:NaN}]),/INVALID_SOURCE/);
});
test('insufficient holdout produces null scores, never fabricated accuracy',()=>{
 const a=walkForwardNwsTemperature(records().slice(0,20));
 assert.equal(a.resolvedHoldoutDays,0);
 assert.equal(a.meanModelBrier,null);assert.equal(a.modelLogLoss,null);
 assert.equal(a.status,'INSUFFICIENT_EVIDENCE');
});
