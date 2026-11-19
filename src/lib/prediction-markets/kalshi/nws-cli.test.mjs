import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NYC_CLI_SOURCE,parseCentralParkCli,readCentralParkCli,verifyCentralParkCli,
 independentTrainingDay,gradeIndependentWeather} from './nws-cli.ts';
import {buildIndependentWeatherMemory} from './weather-memory.ts';
const at='2026-11-14T12:00:00Z';
const text=[
 'CDUS41 KOKX 140637','CLINYC','','CLIMATE REPORT',
 'NATIONAL WEATHER SERVICE NEW YORK, NY','137 AM EST SAT NOV 14 2026','',
 '...................................','',
 '...THE CENTRAL PARK NY CLIMATE SUMMARY FOR NOVEMBER 13 2026...','',
 'CLIMATE NORMAL PERIOD 1991 TO 2020','','WEATHER ITEM OBSERVED TIME RECORD YEAR NORMAL',
 'TEMPERATURE (F)',' TODAY','   MAXIMUM         52   1211 AM  73  1931',
 '   MINIMUM         38    923 AM  23  2019','   AVERAGE         45',
 'PRECIPITATION (IN)',' TODAY            0.26',
 'THE CENTRAL PARK NY CLIMATE NORMALS FOR TOMORROW',
 'MAXIMUM TEMPERATURE (F)  55','$$',''].join('\n');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function forecast(){
 const asOf='2026-11-12T21:00:00Z',first=Date.parse(asOf)+3600_000;
 const hourly=Array.from({length:48},(_,i)=>({startTime:new Date(first+i*3600_000).toISOString(),
  endTime:new Date(first+(i+1)*3600_000).toISOString(),temperatureF:45+i%7}));
 return buildIndependentWeatherMemory({source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',
  fetchedAt:asOf,forecastIssuedAt:'2026-11-12T19:00:00Z',
  gridForecastUrl:'https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly',
  sourceDigest:digest(hourly),hourly});
}
test('next-day NWS CLI full report is preliminary station evidence, never market settlement',()=>{
 const c=parseCentralParkCli(text,at);
 assert.equal(c.reportDate,'2026-11-13');
 assert.equal(c.observedHighF,52);
 assert.equal(c.issuedAt,'2026-11-14T06:37:00.000Z');
 assert.equal(c.station,'KNYC_CENTRAL_PARK');
 assert.match(c.status,/PRELIMINARY/);
 assert.equal(c.id.length,64);
 assert.deepEqual(verifyCentralParkCli(JSON.parse(JSON.stringify(c))),c);
 const f=forecast();
 const row=independentTrainingDay(f,c);
 assert.equal(row.localDate,'2026-11-13');
 assert.equal(row.observationSource,'NWS_CLI_PRELIMINARY_CENTRAL_PARK');
 assert.equal(row.observedAvailableAt,at);
 const g=gradeIndependentWeather(f,c);
 assert.equal(g.source,'NWS_CLI_PRELIMINARY_NOT_KALSHI_SETTLEMENT');
 assert.equal(g.brier,null,'no trained probability, no invented Brier');
 assert.equal(g.forecastId,f.id);
});
test('real fixed NWS URL only, no Kalshi data sources',async()=>{
 let calls=0;
 const r=await readCentralParkCli({
  userAgent:'SportsEdge read-only NWS study https://github.com/ang87505-crypto/SportsEdge',
  now:()=>at,
  fetcher:async(url,opts)=>{
   calls++;
   assert.equal(url,NYC_CLI_SOURCE);
   assert.equal(opts.method,'GET');
   assert.equal(opts.credentials,'omit');
   assert.equal(opts.redirect,'error');
   return new Response(text,{headers:{'content-type':'text/plain'}});
  }
 });
 assert.equal(calls,1);assert.equal(r.observedHighF,52);
});
test('rejects incomplete 4:30 PM report, malformed station/date, future and stale releases',()=>{
 assert.throws(()=>parseCentralParkCli(text.replace('CLIMATE NORMAL PERIOD','VALID TODAY AS OF 0400 PM LOCAL TIME.\nCLIMATE NORMAL PERIOD'),at),/INTERIM/);
 assert.throws(()=>parseCentralParkCli(text.replace('CENTRAL PARK','LAGUARDIA'),at),/WRONG_STATION/);
 assert.throws(()=>parseCentralParkCli(text.replace('MAXIMUM         52','MAXIMUM         MM'),at),/MISSING_HIGH/);
 assert.throws(()=>parseCentralParkCli(text,'2026-11-14T04:00:00Z'),/BAD_AVAILABILITY/);
 assert.throws(()=>parseCentralParkCli(text,'2026-11-17T12:00:00Z'),/BAD_AVAILABILITY/);
 assert.throws(()=>parseCentralParkCli(text.replace('NOVEMBER 13 2026','NOVEMBER 14 2026'),at),/NOT_NEXT_MORNING/);
});
test('fetched day and archived station report may never be joined across dates',()=>{
 const o=parseCentralParkCli(text,at);
 const f=forecast();
 assert.throws(()=>independentTrainingDay({...f,targetLocalDate:'2026-11-12'},o),/MISMATCH/);
 assert.throws(()=>gradeIndependentWeather(f,{...o,reportDate:'2026-11-12'}),/MISMATCH/);
 assert.throws(()=>verifyCentralParkCli({...o,observedHighF:100}),/INVALID_MEMORY/);
});
test('no unnecessary requests without valid identification; size and HTTP limits fail closed',async()=>{
 let calls=0;
 await assert.rejects(readCentralParkCli({userAgent:'',fetcher:async()=>{calls++;return new Response(text);}}),/USER_AGENT/);
 assert.equal(calls,0);
 await assert.rejects(readCentralParkCli({userAgent:'SportsEdge research repo URL',
  fetcher:async()=>new Response('',{status:429})}),/RATE_LIMITED/);
 await assert.rejects(readCentralParkCli({userAgent:'SportsEdge research repo URL',
  fetcher:async()=>new Response('a'.repeat(20001))}),/TOO_LARGE/);
});
