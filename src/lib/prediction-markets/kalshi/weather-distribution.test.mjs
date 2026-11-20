import test from 'node:test';
import assert from 'node:assert/strict';
import {
 PMF_MODEL_ID,PMF_SUPPORT_RADIUS_F,forecastLeadHours,forecastHighPmf,
 contractProbabilityPpm,eventProbabilitiesPpm,buildWeatherContractForecast,forecastInputFromMemory,
} from './weather-distribution.ts';
import {estimateStationTemperatureRange} from './weather-model.ts';

const DAY=86_400_000;
const iso=(t)=>new Date(t).toISOString();
/** Synthetic rows only: captured 08:30Z the day before, CLI fetched 12:00Z the day after. */
function rows(n,residual=(i)=>(i%5)-2,start=Date.UTC(2026,8,1)){
 return Array.from({length:n},(_,i)=>{
  const d=start+i*DAY,localDate=iso(d).slice(0,10);
  return {localDate,forecastHighF:60,observedHighF:60+residual(i),
   forecastAvailableAt:iso(d-DAY+8.5*3600_000),observedAvailableAt:iso(d+DAY+12*3600_000),
   forecastSource:'NWS',observationSource:'NWS_CLI_PRELIMINARY_CENTRAL_PARK'};
 });
}
const target={forecastHighF:62,targetLocalDate:'2026-11-14',asOf:'2026-11-13T08:30:00Z',
 forecastAvailableAt:'2026-11-13T08:30:00Z'};
const ladder=(f)=>[{kind:'below',thresholdF:f-4},{kind:'between',lowerF:f-4,upperF:f-3},
 {kind:'between',lowerF:f-2,upperF:f-1},{kind:'between',lowerF:f,upperF:f+1},
 {kind:'between',lowerF:f+2,upperF:f+3},{kind:'above',thresholdF:f+3}];

test('lead time is measured to the start of the standard-time climate day',()=>{
 assert.equal(forecastLeadHours('2026-11-13T08:30:00Z','2026-11-14'),20.5);
 assert.equal(forecastLeadHours('2026-11-14T05:00:00Z','2026-11-14'),0);
 assert.throws(()=>forecastLeadHours('nope','2026-11-14'),/WEATHER_INVALID_TIME/);
});

test('pmf is a coherent integer distribution centered on forecast plus empirical error',()=>{
 const pmf=forecastHighPmf({...target,training:rows(40)});
 assert.equal(pmf.modelId,PMF_MODEL_ID);
 assert.equal(pmf.trainingDays,40);
 assert.equal(pmf.horizonMatchedDays,40);
 assert.equal(pmf.supportMinF,62-PMF_SUPPORT_RADIUS_F);
 assert.equal(pmf.supportMaxF,62+PMF_SUPPORT_RADIUS_F);
 assert.equal(pmf.pmfPpm.length,2*PMF_SUPPORT_RADIUS_F+1);
 assert.equal(pmf.pmfPpm.reduce((a,b)=>a+b,0),1_000_000);
 assert.ok(pmf.pmfPpm.every(p=>Number.isSafeInteger(p)&&p>=1),'smoothing leaves no zero-probability whole degree');
 // Residuals are uniform on -2..2, so 60..64 hold nearly all mass and are near-symmetric.
 const mass=(lo,hi)=>pmf.pmfPpm.slice(lo-pmf.supportMinF,hi-pmf.supportMinF+1).reduce((a,b)=>a+b,0);
 assert.ok(mass(60,64)>900_000);
 assert.ok(Math.abs(mass(60,60)-mass(64,64))<1_000);
 assert.match(pmf.trainingDigest,/^[a-f0-9]{64}$/);
 assert.equal('marketPrice' in pmf,false);
});

test('the registered 30-day minimum and as-of gate are preserved',()=>{
 assert.throws(()=>forecastHighPmf({...target,training:rows(29)}),/WEATHER_INSUFFICIENT_DAYS/);
 const late=rows(40);late[39]={...late[39],observedAvailableAt:'2026-11-13T09:00:00Z'};
 assert.throws(()=>forecastHighPmf({...target,training:late}),/WEATHER_ASOF_OR_SOURCE_VIOLATION/);
 const dup=rows(40);dup[39]={...dup[0]};
 assert.throws(()=>forecastHighPmf({...target,training:dup}),/WEATHER_DUPLICATE_DAY/);
 assert.throws(()=>forecastHighPmf({...target,asOf:'2026-11-14T06:00:00Z',forecastAvailableAt:'2026-11-14T06:00:00Z',training:rows(40)}),/WEATHER_TARGET_NOT_FUTURE/);
 assert.throws(()=>forecastHighPmf({...target,forecastAvailableAt:'2026-11-13T09:00:00Z',training:rows(40)}),/WEATHER_FORECAST_AFTER_ASOF/);
 assert.throws(()=>forecastHighPmf({...target,forecastHighF:62.4,training:rows(40)}),/WEATHER_INVALID_TARGET/);
});

test('training must match the forecast horizon, so 30 same-horizon days are required',()=>{
 // 20 rows captured 3 days early (lead ~68h) do not count toward a ~20h forecast.
 const mixed=rows(40).map((r,i)=>i<20?{...r,forecastAvailableAt:iso(Date.parse(r.localDate+'T05:00:00Z')-68*3600_000)}:r);
 assert.throws(()=>forecastHighPmf({...target,training:mixed}),/WEATHER_INSUFFICIENT_HORIZON_MATCHED_DAYS/);
 const ok=forecastHighPmf({...target,training:[...mixed,...rows(10,undefined,Date.UTC(2026,9,15))]});
 assert.equal(ok.trainingDays,50);
 assert.equal(ok.horizonMatchedDays,30);
});

test('contract probabilities over an event ladder sum to exactly one',()=>{
 const pmf=forecastHighPmf({...target,training:rows(40)});
 const probs=eventProbabilitiesPpm(pmf,ladder(62));
 assert.equal(probs.reduce((a,b)=>a+b,0),1_000_000);
 assert.equal(probs.length,6);
 // [60,61] and [62,63] carry the -2..1 residual mass; the >65 tail is nearly empty.
 assert.ok(probs[2]+probs[3]+probs[4]>950_000);
 assert.ok(probs[5]<20_000);
 assert.throws(()=>eventProbabilitiesPpm(pmf,ladder(62).slice(1)),/KALSHI_STRIKES_NOT_PARTITION/);
});

test('strikes that split a lumped support tail are refused rather than guessed',()=>{
 const pmf=forecastHighPmf({...target,training:rows(40)});
 const edge=pmf.supportMinF;
 assert.throws(()=>contractProbabilityPpm(pmf,{kind:'between',lowerF:edge,upperF:edge+1}),/WEATHER_STRIKE_OUTSIDE_MODEL_SUPPORT/);
 assert.throws(()=>contractProbabilityPpm(pmf,{kind:'above',thresholdF:pmf.supportMaxF+3}),/WEATHER_STRIKE_OUTSIDE_MODEL_SUPPORT/);
 assert.equal(contractProbabilityPpm(pmf,{kind:'below',thresholdF:edge+1}),pmf.pmfPpm[0]);
});

test('heavier observed errors widen the distribution instead of keeping a fixed width',()=>{
 const narrow=forecastHighPmf({...target,training:rows(40,()=>0)});
 const wide=forecastHighPmf({...target,training:rows(40,(i)=>(i%9)-4)});
 const center=(p)=>p.pmfPpm[PMF_SUPPORT_RADIUS_F];
 assert.ok(center(narrow)>center(wide));
 assert.ok(center(narrow)<1_000_000,'a perfect record still leaves smoothed uncertainty');
});

test('contract forecast output: awaiting history is a status, not an exception',()=>{
 const input={schemaVersion:'kalshi-weather-forecast-input-v1',station:'KNYC_CENTRAL_PARK',
  targetLocalDate:'2026-11-14',forecastHighF:62,forecastIssuedAt:'2026-11-13T06:30:00Z',
  forecastAvailableAt:'2026-11-13T08:30:00Z',forecastSource:'NWS_HOURLY_GRID',sourceDigest:'a'.repeat(64)};
 const waiting=buildWeatherContractForecast({input,training:rows(2),strikes:ladder(62),asOf:'2026-11-13T08:30:00Z'});
 assert.equal(waiting.status,'AWAITING_VERIFIED_HISTORY');
 assert.equal(waiting.distribution,null);
 assert.deepEqual(waiting.contracts.map(c=>c.probabilityYesPpm),[null,null,null,null,null,null]);
 assert.equal(waiting.blocker,'WEATHER_INSUFFICIENT_DAYS');
 assert.equal(waiting.marketDataUsed,false);
 const ready=buildWeatherContractForecast({input,training:rows(40),strikes:ladder(62),asOf:'2026-11-13T08:30:00Z'});
 assert.equal(ready.status,'UNCALIBRATED_EXPERIMENTAL_MODEL');
 assert.equal(ready.contracts.reduce((a,c)=>a+c.probabilityYesPpm,0),1_000_000);
 assert.deepEqual(ready.contracts[0].range,{minF:null,maxF:57});
 assert.match(ready.id,/^[a-f0-9]{64}$/);
 // Same inputs -> same id; integrity violations still throw.
 assert.equal(buildWeatherContractForecast({input,training:rows(40),strikes:ladder(62),asOf:'2026-11-13T08:30:00Z'}).id,ready.id);
 assert.throws(()=>buildWeatherContractForecast({input:{...input,station:'KLGA'},training:rows(40),strikes:ladder(62),asOf:'2026-11-13T08:30:00Z'}),/WEATHER_INPUT_CONTRACT_VIOLATION/);
 assert.throws(()=>buildWeatherContractForecast({input,training:rows(40),strikes:ladder(62).slice(1),asOf:'2026-11-13T08:30:00Z'}),/KALSHI_STRIKES_NOT_PARTITION/);
});

test('adapter reads the existing frozen memory without changing its shape',()=>{
 const memory={targetLocalDate:'2026-11-21',forecastHighF:60,forecastIssuedAt:'2026-11-20T06:32:09+00:00',
  capturedAt:'2026-11-20T08:30:48.176Z',sourceDigest:'b'.repeat(64),
  dayDefinition:'CENTRAL_PARK_LOCAL_STANDARD_TIME_UTC_MINUS_5',source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION'};
 assert.deepEqual(forecastInputFromMemory(memory),{schemaVersion:'kalshi-weather-forecast-input-v1',
  station:'KNYC_CENTRAL_PARK',targetLocalDate:'2026-11-21',forecastHighF:60,
  forecastIssuedAt:'2026-11-20T06:32:09+00:00',forecastAvailableAt:'2026-11-20T08:30:48.176Z',
  forecastSource:'NWS_HOURLY_GRID',sourceDigest:'b'.repeat(64)});
 assert.throws(()=>forecastInputFromMemory({...memory,dayDefinition:'CIVIL'}),/WEATHER_INPUT_CONTRACT_VIOLATION/);
});

test('v0 band model is unchanged by the shared gate extraction',()=>{
 const r=estimateStationTemperatureRange({forecastHighF:62,rangeMinF:61,rangeMaxF:63,
  targetLocalDate:'2026-11-14',asOf:'2026-11-13T19:00:00Z',training:rows(35)});
 assert.equal(r.trainingDays,35);
 assert.equal(r.modelId,'nws-empirical-error-v0-research');
});
