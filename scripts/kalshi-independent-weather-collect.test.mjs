import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectIndependentWeather} from './kalshi-independent-weather-collect.ts';
import {NWS_CENTRAL_PARK_POINT} from '../src/lib/prediction-markets/kalshi/nws.ts';
import {NYC_CLI_SOURCE} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';
const fURL='https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly';
const at='2026-11-13T21:00:00Z',outcomeAt='2026-11-15T12:00:00Z';
const agent='SportsEdge NWS archive https://github.com/ang87505-crypto/SportsEdge';
const rawCli=[
 'CDUS41 KOKX 150637','CLINYC','','CLIMATE REPORT',
 'NATIONAL WEATHER SERVICE NEW YORK, NY','137 AM EST SUN NOV 15 2026','',
 '...THE CENTRAL PARK NY CLIMATE SUMMARY FOR NOVEMBER 14 2026...','',
 'CLIMATE NORMAL PERIOD 1991 TO 2020','','TEMPERATURE (F)',' TODAY',
 ' MAXIMUM         49   1200 PM  74  2001',' MINIMUM         38    923 AM  23  2019',
 'PRECIPITATION (IN)',' TODAY 0.00','$$',''].join('\n');
function fakeFetcher(counter,cli=rawCli){
 return async(url,init)=>{
  counter.push(url);
  assert.equal(init.method,'GET');
  assert.equal(init.credentials,'omit');
  assert.equal(init.redirect,'error');
  if(url===NWS_CENTRAL_PARK_POINT)return new Response(JSON.stringify({
   properties:{forecastHourly:fURL}}),{headers:{'content-type':'application/geo+json'}});
  if(url===fURL){
   const first=Date.parse(at)+3600_000;
   const periods=Array.from({length:48},(_,i)=>({
    startTime:new Date(first+i*3600_000).toISOString(),
    endTime:new Date(first+(i+1)*3600_000).toISOString(),
    temperature:46+i%5,temperatureUnit:'F'
   }));
   return new Response(JSON.stringify({properties:{updateTime:'2026-11-13T19:00:00Z',periods}}),{
    headers:{'content-type':'application/geo+json'}});
  }
  if(url===NYC_CLI_SOURCE)return new Response(cli,{headers:{'content-type':'text/plain'}});
  throw Error('Unexpected provider '+url);
 };
}
const temp=()=>mkdtempSync(join(tmpdir(),'sportsedge-nws-'));
test('two NWS GETs freeze next-day forecast and one CLI GET grades independently; repeats zero requests',async()=>{
 const root=temp(),calls=[];try{
  const fetcher=fakeFetcher(calls);
  const a=await collectIndependentWeather({phase:'forecast',root,userAgent:agent,now:()=>at,fetcher});
  assert.equal(a.status,'CREATED');assert.equal(a.date,'2026-11-14');
  assert.equal(a.historicalTrainingDays,0);
  assert.deepEqual(calls,[NWS_CENTRAL_PARK_POINT,fURL]);
  const frozen=JSON.parse(readFileSync(a.file,'utf8'));
  assert.equal(frozen.targetLocalDate,'2026-11-14');
  assert.equal(frozen.estimatedBandProbabilityPpm,null);
  const b=await collectIndependentWeather({phase:'forecast',root,userAgent:agent,now:()=>at,fetcher});
  assert.equal(b.status,'ALREADY_ARCHIVED');
  assert.equal(calls.length,2,'repeat makes zero extra NWS calls');
  const c=await collectIndependentWeather({phase:'outcome',root,userAgent:agent,now:()=>outcomeAt,fetcher});
  assert.equal(c.status,'CREATED');assert.equal(c.date,'2026-11-14');
  assert.equal(c.independentGraded,true);
  assert.equal(calls[2],NYC_CLI_SOURCE);
  const grade=JSON.parse(readFileSync(join(root,'kalshi-independent','nyc-weather',
   'independent-grades','2026-11-14.json'),'utf8'));
  assert.equal(grade.source,'NWS_CLI_PRELIMINARY_NOT_KALSHI_SETTLEMENT');
  assert.equal(grade.brier,null);
  assert.equal(grade.observedHighF,49);
  const repeat=await collectIndependentWeather({phase:'outcome',root,userAgent:agent,now:()=>outcomeAt,fetcher});
  assert.equal(repeat.status,'ALREADY_ARCHIVED');
  assert.equal(calls.length,3,'repeat makes zero extra NWS calls');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('wrong dated or interim reports refuse archival, never fabricate a correct grade',async()=>{
 const root=temp();try{
  const report=rawCli.replace('NOVEMBER 14 2026','NOVEMBER 13 2026');
  await assert.rejects(collectIndependentWeather({phase:'outcome',root,userAgent:agent,
   now:()=>outcomeAt,fetcher:fakeFetcher([],report)}),/NOT_NEXT_MORNING|NOT_EXPECTED/);
  assert.equal(existsSync(join(root,'kalshi-independent','nyc-weather','cli-daily-preliminary','2026-11-14.json')),false);
  const interim=rawCli.replace('TEMPERATURE (F)','VALID TODAY AS OF 0400 PM LOCAL TIME.\nTEMPERATURE (F)');
  await assert.rejects(collectIndependentWeather({phase:'outcome',root,userAgent:agent,
   now:()=>outcomeAt,fetcher:fakeFetcher([],interim)}),/INTERIM/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a corrupt existing prediction causes a hard failure, never overwrites or re-collects',async()=>{
 const root=temp(),calls=[];try{
  const fetcher=fakeFetcher(calls);
  const a=await collectIndependentWeather({phase:'forecast',root,userAgent:agent,now:()=>at,fetcher});
  const bad=JSON.parse(readFileSync(a.file,'utf8'));bad.forecastHighF+=8;
  writeFileSync(a.file,JSON.stringify(bad));
  await assert.rejects(collectIndependentWeather({phase:'forecast',root,userAgent:agent,
   now:()=>at,fetcher}),/INVALID_RECORD/);
  assert.equal(calls.length,2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('bad config fails before making outbound requests',async()=>{
 const root=temp(),calls=[];try{
  await assert.rejects(collectIndependentWeather({phase:'forecast',root,userAgent:'',
   now:()=>at,fetcher:fakeFetcher(calls)}),/INVALID_CONFIG/);
  assert.equal(calls.length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
