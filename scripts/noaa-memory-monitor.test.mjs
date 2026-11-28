// SYNTHETIC government-format fixtures; no real observations, forecast performance or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readNoaaMemory,applyNoaaMemory,OUTCOME_DEADLINE_UTC_MINUTES} from './noaa-memory-monitor.mjs';
import {rollUp,workflowCrons} from './ops-monitor-lib.mjs';
import {buildIndependentWeatherMemory} from '../src/lib/prediction-markets/kalshi/weather-memory.ts';
import {parseCentralParkCli,gradeIndependentWeather} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';
import {scoreIndependentWeatherForward} from '../src/lib/prediction-markets/kalshi/weather-scorecard.ts';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const shift=(date,n)=>new Date(Date.parse(date+'T00:00Z')+n*86_400_000).toISOString().slice(0,10);
const now=Date.parse('2026-11-27T18:00Z');
const url=(section,date)=>`https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/kalshi-independent/nyc-weather/${section}/${date}.json`;
function forecast(date){
 const cap=shift(date,-1)+'T09:00:00Z',start=Date.parse(cap)+3600_000;
 const hourly=Array.from({length:48},(_,i)=>({startTime:new Date(start+i*3600_000).toISOString(),
  endTime:new Date(start+(i+1)*3600_000).toISOString(),temperatureF:45+i%7}));
 return buildIndependentWeatherMemory({source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',
  fetchedAt:cap,forecastIssuedAt:shift(date,-1)+'T08:00:00Z',sourceDigest:hash(hourly),hourly});
}
function fixture(outcome='2026-11-26',today='2026-11-27'){
 const following=shift(outcome,1),months=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
 const reportMonth=months[Number(outcome.slice(5,7))-1],issueMonth=months[Number(following.slice(5,7))-1];
 const raw=['CDUS41 KOKX 270637','CLINYC','','CLIMATE REPORT','NATIONAL WEATHER SERVICE NEW YORK, NY',
  `137 AM EST FRI ${issueMonth.slice(0,3)} ${Number(following.slice(8))} ${following.slice(0,4)}`,'',
  `...THE CENTRAL PARK NY CLIMATE SUMMARY FOR ${reportMonth} ${Number(outcome.slice(8))} ${outcome.slice(0,4)}...`,'',
  'CLIMATE NORMAL PERIOD 1991 TO 2020','','TEMPERATURE (F)',' TODAY',' MAXIMUM         49   1200 PM  74  2001','$$',''].join('\n');
 const f=forecast(outcome),cli=parseCentralParkCli(raw,following+'T09:00:00Z'),grade=gradeIndependentWeather(f,cli);
 const map=new Map([[url('forecasts',today),forecast(today)],[url('forecasts',shift(today,1)),forecast(shift(today,1))],
  [url('forecasts',outcome),f],[url('cli-daily-preliminary',outcome),cli],[url('independent-grades',outcome),grade],
  [url('scorecards',outcome),scoreIndependentWeatherForward([{forecast:f,cli,grade}])]]);
 return map;
}
function transport(map,calls=[]){return async(u,opts)=>{
 calls.push(u);assert.match(u,/^https:\/\/raw\.githubusercontent\.com\/ang87505-crypto\/SportsEdge\/research-data\/kalshi-independent\/nyc-weather\//);
 assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
 const value=map.get(u);if(value instanceof Error)throw value;
 return value instanceof Response?value:new Response(map.has(u)?JSON.stringify(value):null,{status:map.has(u)?200:404});
};}
test('six public GETs verify dates, before-lock forecasts, CLI text, exact grade and scorecard',async()=>{
 const calls=[],r=await readNoaaMemory({fetcher:transport(fixture(),calls),now:()=>now});
 assert.equal(r.state,'OK');assert.deepEqual(r.issues,[]);assert.equal(calls.length,6);
 assert.equal(r.requiredForecastDate,'2026-11-27');assert.equal(r.requiredOutcomeDate,'2026-11-26');
 assert.equal(r.nextForecast.capturedAt,'2026-11-27T09:00:00Z');assert.equal(r.forecast.hoursBeforeDay,20);
 assert.equal(r.outcome.gradeId.length,64);
});
test('a missed backup cannot erase verified daily work or its original missed-slot history',async()=>{
 const evidence=await readNoaaMemory({fetcher:transport(fixture()),now:()=>now});
 const job={id:'kalshi-weather',required:true,status:'MISSED_SLOT',slots7d:{due:28,missed:19},lastSuccess:{id:42}};
 const r=applyNoaaMemory(job,evidence);assert.equal(r.status,'RAN_LATE');assert.equal(r.workflowStatus,'MISSED_SLOT');
 assert.deepEqual(r.slots7d,job.slots7d);assert.deepEqual(r.lastSuccess,job.lastSuccess);assert.match(r.detail,/late\/missed/);
 assert.deepEqual(rollUp([r]),{state:'OK',attention:[]});
});
test('every required missing file causes attention; the next pre-day forecast is optional until lock',async()=>{
 for(const section of ['forecasts','cli-daily-preliminary','independent-grades','scorecards']){
  const map=fixture();map.delete(url(section,'2026-11-26'));
  const r=await readNoaaMemory({fetcher:transport(map),now:()=>now});assert.equal(r.state,'ATTENTION',section);
  assert.equal(applyNoaaMemory({status:'OK'},r).status,'FAILING');
 }
 const missingToday=fixture();missingToday.delete(url('forecasts','2026-11-27'));
 const bad=await readNoaaMemory({fetcher:transport(missingToday),now:()=>now});assert.ok(bad.issues.includes('CURRENT_FORECAST_MISSING'));
 const optional=fixture();optional.delete(url('forecasts','2026-11-28'));
 assert.equal((await readNoaaMemory({fetcher:transport(optional),now:()=>now})).state,'OK');
});
test('changed forecast, wrong CLI text, conflicting grade and wrong scorecard date fail independently',async()=>{
 const changes=[['forecasts',x=>{x.forecastHighF+=1;}],['cli-daily-preliminary',x=>{x.observedHighF+=1;}],
  ['independent-grades',x=>{x.forecastId='0'.repeat(64);}],['scorecards',x=>{x.lastDate='2026-11-25';const base={...x};delete base.id;x.id=hash(base);}]];
 for(const [section,change] of changes){const map=fixture();change(map.get(url(section,'2026-11-26')));
  const r=await readNoaaMemory({fetcher:transport(map),now:()=>now});assert.equal(r.state,'ATTENTION',section);}
});
test('HTTP errors, invalid JSON, null JSON, oversized streams and exceptions cannot become green or retry',async()=>{
 for(const value of [new Response('denied',{status:403}),new Response('{'),null,
  new Response('x'.repeat(120001)),new Error('PRIVATE_PROVIDER_BODY')]){
  const map=fixture(),calls=[];map.set(url('forecasts','2026-11-27'),value);
  const r=await readNoaaMemory({fetcher:transport(map,calls),now:()=>now});
  assert.notEqual(r.state,'OK');assert.equal(calls.length,6);assert.equal(JSON.stringify(r).includes('PRIVATE_PROVIDER_BODY'),false);
 }
});
test('future optional captures are rejected even with self-consistent archive hashes',async()=>{
 const r=await readNoaaMemory({fetcher:transport(fixture('2026-11-25')),now:()=>Date.parse('2026-11-27T08:00Z')});
 assert.ok(r.issues.includes('NEXT_FORECAST_INVALID'));
});
test('existing outcome backup/grace controls reporting deadline; forecasts remain on fixed EST days',async()=>{
 const job=JSON.parse(readFileSync(new URL('../config/ops/jobs.json',import.meta.url))).jobs.find(j=>j.id==='kalshi-weather');
 const cron=workflowCrons(readFileSync(new URL('../.github/workflows/kalshi-independent-weather-memory.yml',import.meta.url),'utf8'));
 assert.deepEqual(cron,['11 1,3 * * *','17 9,11 * * *']);
 assert.equal(OUTCOME_DEADLINE_UTC_MINUTES,11*60+17+job.graceMinutes);
 const early=await readNoaaMemory({fetcher:transport(fixture('2026-11-25')),now:()=>Date.parse('2026-11-27T14:16Z')});
 assert.equal(early.state,'OK');assert.equal(early.requiredOutcomeDate,'2026-11-25');
 const due=await readNoaaMemory({fetcher:transport(fixture()),now:()=>Date.parse('2026-11-27T14:17Z')});
 assert.equal(due.state,'OK');assert.equal(due.requiredOutcomeDate,'2026-11-26');
 const summer=await readNoaaMemory({fetcher:transport(fixture('2026-07-02','2026-07-03')),now:()=>Date.parse('2026-07-04T04:20Z')});
 assert.equal(summer.state,'OK');assert.equal(summer.requiredForecastDate,'2026-07-03');
});
test('day/deadline rollover during reads refuses a mixed-date health check',async()=>{
 const times=[Date.parse('2026-11-27T14:16Z'),Date.parse('2026-11-27T14:17Z')];
 const r=await readNoaaMemory({fetcher:transport(fixture('2026-11-25')),now:()=>times.shift()});
 assert.equal(r.state,'UNAVAILABLE');assert.deepEqual(r.issues,['MONITOR_CLOCK_BOUNDARY']);
});
test('verified records never hide workflow failure, disablement, stale execution or unknown state',()=>{
 for(const status of ['FAILING','DISABLED','STALE','UNKNOWN','RETIRED','EXPIRED'])
  assert.equal(applyNoaaMemory({status},{state:'OK'}).status,status);
 assert.equal(applyNoaaMemory({status:'PENDING_FIRST_RUN'},{state:'OK'}).status,'PENDING_FIRST_RUN');
});
