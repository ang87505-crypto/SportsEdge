import test from 'node:test';
import assert from 'node:assert/strict';
import {NWS_CENTRAL_PARK_POINT,readCentralParkHourlyNws,normalizeNwsHourly} from './nws.ts';
const at='2026-11-13T20:00:00Z';
const hourlyUrl='https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly';
const response={properties:{updateTime:'2026-11-13T18:00:00Z',periods:[
 {startTime:'2026-11-13T14:00:00-05:00',endTime:'2026-11-13T15:00:00-05:00',temperature:55,temperatureUnit:'F'},
 {startTime:'2026-11-13T15:00:00-05:00',endTime:'2026-11-13T16:00:00-05:00',temperature:57,temperatureUnit:'F'}
]}};
const mocks=(url,request)=>{
 if(url===NWS_CENTRAL_PARK_POINT)return new Response(JSON.stringify({properties:{forecastHourly:hourlyUrl}}),{
  headers:{'content-type':'application/geo+json'}});
 if(url===hourlyUrl)return new Response(JSON.stringify(response),{headers:{'content-type':'application/geo+json'}});
 throw Error('Unexpected network path '+url);
};
test('reads only the pinned NYC NWS point and validated hourly grid host',async()=>{
 const urls=[];
 const out=await readCentralParkHourlyNws({userAgent:'SportsEdge research https://sports-edge-eta.vercel.app',
  now:()=>at,fetcher:async(url,init)=>{urls.push(url);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
   assert.equal(init.credentials,'omit');return mocks(url,init);}});
 assert.deepEqual(urls,[NWS_CENTRAL_PARK_POINT,hourlyUrl]);
 assert.deepEqual(out.hourly.map(x=>x.temperatureF),[55,57]);
 assert.equal(out.forecastIssuedAt,'2026-11-13T18:00:00Z');
 assert.equal(out.source,'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION');
 assert.equal(out.sourceDigest.length,64);
 assert.equal('probability' in out,false);
});
test('blocks SSRF, fake providers, malformed NWS units and future data',async()=>{
 const bad=['https://evil.example/gridpoints/OKX/33,37/forecast/hourly',
  'https://api.weather.gov.evil.example/gridpoints/OKX/33,37/forecast/hourly',
  'https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly?url=evil',
  'https://api.weather.gov/markets/123'];
 for(const url of bad)await assert.rejects(readCentralParkHourlyNws({
  userAgent:'SportsEdge Research',now:()=>at,fetcher:async(path)=>path===NWS_CENTRAL_PARK_POINT?
   new Response(JSON.stringify({properties:{forecastHourly:url}})):new Response('{}')}),/URL_NOT_ALLOWED/);
 assert.throws(()=>normalizeNwsHourly({...response,properties:{...response.properties,updateTime:'2026-11-14T01:00:00Z'}},hourlyUrl,at),/FUTURE/);
 assert.throws(()=>normalizeNwsHourly({...response,properties:{...response.properties,periods:[
  {...response.properties.periods[0],temperatureUnit:'C'}]}},hourlyUrl,at),/INVALID_FORECAST/);
});
test('missing identifying User-Agent fails before first NWS network request',async()=>{
 let calls=0;await assert.rejects(readCentralParkHourlyNws({userAgent:'',fetcher:async()=>{calls++;return mocks(NWS_CENTRAL_PARK_POINT);}}),/USER_AGENT/);
 assert.equal(calls,0);
});
