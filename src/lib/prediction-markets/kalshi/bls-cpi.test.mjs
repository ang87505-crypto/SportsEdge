import test from 'node:test';
import assert from 'node:assert/strict';
import {BLS_CPI_URL,fetchCpiSnapshot,normalizeCpi} from './bls-cpi.ts';
const base={status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:'CUUR0000SA0',
 data:[{year:'2026',period:'M10',value:'316.177',footnotes:[]},
  {year:'2026',period:'M09',value:'314.000',footnotes:[{code:'P',text:'preliminary'}]},
  {year:'2026',period:'M13',value:'315.000',footnotes:[]}]}]}};
const at='2026-11-13T20:00:00Z';
test('BLS public CPI snapshot is independently sourced and marked NOT historical PIT',()=>{
 const s=normalizeCpi(base,at);
 assert.equal(s.seriesId,'CUUR0000SA0');
 assert.deepEqual(s.readings.map(x=>x.month),['2026-09','2026-10']);
 assert.equal(s.readings[0].flaggedForReview,true);
 assert.equal(s.readings[1].indexValue,316.177);
 assert.equal(s.vintage,'LATEST_AVAILABLE_NOT_HISTORICAL_PIT');
 assert.equal(s.responseDigest.length,64);
 assert.equal('kalshi' in s,false);
});
test('fixed public GET only, no credentials, no dynamic series ID',async()=>{
 let n=0;const f=async(url,opts)=>{
  n++;assert.equal(url,BLS_CPI_URL);assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
  return new Response(JSON.stringify(base),{headers:{'content-type':'application/json'}});
 };
 const s=await fetchCpiSnapshot(f,()=>at);
 assert.equal(n,1);assert.equal(s.readings.length,2);
});
test('wrong series, duplicates, malformed source and invalid data rejected',()=>{
 const edit=(data)=>({status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:'CUUR0000SA0',data}]}});
 assert.throws(()=>normalizeCpi({status:'REQUEST_FAILED',Results:base.Results},at),/AMBIGUOUS/);
 assert.throws(()=>normalizeCpi({status:'REQUEST_SUCCEEDED',Results:{series:[{...base.Results.series[0],seriesID:'X'}]}},at),/WRONG_SERIES/);
 const x=base.Results.series[0].data[0];
 assert.throws(()=>normalizeCpi(edit([x,x]),at),/DUPLICATE/);
 assert.throws(()=>normalizeCpi(edit([{...x,value:'NaN'}]),at),/VALUE/);
 assert.throws(()=>normalizeCpi(edit([{...x,period:'M99'}]),at),/PERIOD/);
});
test('rate limits, invalid content and oversized data fail closed',async()=>{
 await assert.rejects(fetchCpiSnapshot(async()=>new Response('',{status:429})),/RATE_LIMITED/);
 await assert.rejects(fetchCpiSnapshot(async()=>new Response('oops',{headers:{'content-type':'text/html'}})),/NOT_JSON/);
 await assert.rejects(fetchCpiSnapshot(async()=>new Response(JSON.stringify({...base,padding:'a'.repeat(130000)}),{
  headers:{'content-type':'application/json'}})),/TOO_LARGE/);
});
