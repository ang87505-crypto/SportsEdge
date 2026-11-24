import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateWeatherArchive} from './kalshi-weather-contract-eval.ts';
import {collectIndependentWeather} from './kalshi-independent-weather-collect.ts';
import {NWS_CENTRAL_PARK_POINT} from '../src/lib/prediction-markets/kalshi/nws.ts';
import {NYC_CLI_SOURCE} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';

const fURL='https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly';
const at='2026-11-13T21:00:00Z',outcomeAt='2026-11-15T12:00:00Z';
const agent='SportsEdge NWS archive https://github.com/ang87505-crypto/SportsEdge';
const rawCli=['CDUS41 KOKX 150637','CLINYC','','CLIMATE REPORT','NATIONAL WEATHER SERVICE NEW YORK, NY',
 '137 AM EST SUN NOV 15 2026','','...THE CENTRAL PARK NY CLIMATE SUMMARY FOR NOVEMBER 14 2026...','',
 'CLIMATE NORMAL PERIOD 1991 TO 2020','','TEMPERATURE (F)',' YESTERDAY',' MAXIMUM         49   1200 PM  74  2001',
 ' MINIMUM         38    923 AM  23  2019','PRECIPITATION (IN)',' YESTERDAY 0.00','$$',''].join('\n');
const fetcher=async(url)=>{
 if(url===NWS_CENTRAL_PARK_POINT)return new Response(JSON.stringify({properties:{forecastHourly:fURL}}));
 if(url===fURL){
  const first=Date.parse(at)+3600_000;
  const periods=Array.from({length:48},(_,i)=>({startTime:new Date(first+i*3600_000).toISOString(),
   endTime:new Date(first+(i+1)*3600_000).toISOString(),temperature:46+i%5,temperatureUnit:'F'}));
  return new Response(JSON.stringify({properties:{updateTime:'2026-11-13T19:00:00Z',periods}}));
 }
 if(url===NYC_CLI_SOURCE)return new Response(rawCli);
 throw Error('unexpected '+url);
};

test('archive evaluation is offline, reproducible, as-of bounded and reports blockers',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sportsedge-eval-'));
 try{
  await collectIndependentWeather({phase:'forecast',root,userAgent:agent,now:()=>at,fetcher});
  const before=evaluateWeatherArchive({root,asOf:'2026-11-15T00:00:00Z',archiveRef:'fixture'});
  await collectIndependentWeather({phase:'outcome',root,userAgent:agent,now:()=>outcomeAt,fetcher});
  const realFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('network forbidden');};
  try{
   const a=evaluateWeatherArchive({root,asOf:'2026-11-16T00:00:00Z',archiveRef:'fixture'});
   const b=evaluateWeatherArchive({root,asOf:'2026-11-16T00:00:00Z',archiveRef:'fixture'});
   assert.deepEqual(a,b);
   assert.equal(a.networkRequests,0);
   assert.equal(a.kalshiDataUsed,false);
   assert.equal(a.forecasts.length,1);
   assert.equal(a.forecasts[0].observedHighF,49);
   assert.equal(a.evaluation.status,'BLOCKED_INSUFFICIENT_HISTORY');
   assert.equal(a.blockers.trainingShortfall,29);
   assert.equal(a.latestContractForecast.status,'AWAITING_VERIFIED_HISTORY');
   assert.match(a.archive.aggregateSha256,/^[a-f0-9]{64}$/);
   assert.equal(a.archive.files.length,2);
   // Before the outcome was fetched, the report must not see it.
   const early=evaluateWeatherArchive({root,asOf:'2026-11-15T00:00:00Z',archiveRef:'fixture'});
   assert.deepEqual(early,before,'later valid receipts must not change earlier report content or digest');
   assert.equal(early.archive.files.length,1);
   assert.equal(early.archive.files[0].path,'kalshi-independent/nyc-weather/forecasts/2026-11-14.json');
   assert.notEqual(early.archive.aggregateSha256,a.archive.aggregateSha256);
   assert.equal(early.forecasts[0].observedHighF,null);
   assert.deepEqual(early.blockers.outcomesPending,['2026-11-14']);
  }finally{globalThis.fetch=realFetch;}
  assert.throws(()=>evaluateWeatherArchive({root,asOf:'nope',archiveRef:'x'}),/WEATHER_EVAL_INVALID_ARGS/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('oversized local archive records fail closed before evaluation',()=>{
 const root=mkdtempSync(join(tmpdir(),'sportsedge-eval-limit-'));
 try{
  const dir=join(root,'kalshi-independent','nyc-weather','forecasts');mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'2026-11-14.json'),' '.repeat(120001));
  assert.throws(()=>evaluateWeatherArchive({root,asOf:'2026-11-16T00:00:00Z',archiveRef:'fixture'}),/WEATHER_EVAL_RECORD_TOO_LARGE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
