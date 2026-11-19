import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildIndependentWeatherMemory} from './weather-memory.ts';
import {gradeIndependentWeather} from './nws-cli.ts';
import {scoreIndependentWeatherForward} from './weather-scorecard.ts';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function item(asOf='2026-11-13T21:00:00Z'){
 const t=Date.parse(asOf)+3600_000;
 const hourly=Array.from({length:48},(_,i)=>({
  startTime:new Date(t+i*3600_000).toISOString(),
  endTime:new Date(t+(i+1)*3600_000).toISOString(),temperatureF:48+i%5
 }));
 const forecast=buildIndependentWeatherMemory({source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',
  forecastIssuedAt:new Date(Date.parse(asOf)-3600_000).toISOString(),fetchedAt:asOf,
  sourceDigest:sha(hourly),gridForecastUrl:'https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly',hourly});
 const cli={schemaVersion:'nws-central-park-cli-preliminary-v1',
  id:'a'.repeat(64),source:'NWS_CLINYC_NEXT_MORNING_PRELIMINARY',
  station:'KNYC_CENTRAL_PARK',reportDate:forecast.targetLocalDate,
  issuedAt:new Date(Date.parse(forecast.targetLocalDate+'T00:00:00Z')+31*3600_000).toISOString(),
  fetchedAt:new Date(Date.parse(forecast.targetLocalDate+'T00:00:00Z')+36*3600_000).toISOString(),
  observedHighF:50,sourceDigest:'f'.repeat(64),
  sourceUrl:'https://tgftp.nws.noaa.gov/data/raw/cd/cdus41.kokx.cli.nyc.txt',
  dayDefinition:'LOCAL_STANDARD_TIME_UTC_MINUS_5',
  status:'PRELIMINARY_NWS_DAILY_NOT_NCEI_CERTIFIED_NOT_KALSHI_SETTLEMENT',rawProductText:'synthetic fixture'};
 return {forecast,cli,grade:gradeIndependentWeather(forecast,cli)};
}
test('one prelim climate outcome is independent evidence, not a market or bet win rate',()=>{
 const a=scoreIndependentWeatherForward([item()]);
 assert.equal(a.evaluatedDays,1);
 assert.equal(a.modelScoredDays,0);
 assert.equal(a.modelBrier,null);
 assert.ok(a.meanAbsoluteErrorF>=0);
 assert.equal(a.status,'INSUFFICIENT_HISTORY');
 assert.ok(a.warning.includes('NOT a bet win'));
 assert.equal('kalshiRoi' in a,false);
 assert.equal(a.id.length,64);
});
test('data copies do not inflate scorecard; grade changes cannot fabricate winners',()=>{
 const one=item();
 assert.throws(()=>scoreIndependentWeatherForward([one,one]),/DUPLICATE/);
 assert.throws(()=>scoreIndependentWeatherForward([{...one,grade:{...one.grade,hitIndependentBand:false}}]),/CONFLICT/);
});
test('empty observation archive reports empty, not zero-quality or profit',()=>{
 const a=scoreIndependentWeatherForward([]);
 assert.equal(a.evaluatedDays,0);
 assert.equal(a.meanAbsoluteErrorF,null);
 assert.equal(a.independentBandHitRate,null);
 assert.equal(a.firstDate,null);
});
