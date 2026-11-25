import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 collectIndependentCpi,cpiArchivePath,verifyCpiPublicMemory
} from './kalshi-independent-cpi-collect.ts';
import {BLS_CPI_URL} from '../src/lib/prediction-markets/kalshi/bls-cpi.ts';

const at='2026-11-13T21:20:00.000Z';
const root=()=>mkdtempSync(join(tmpdir(),'sportsedge-public-cpi-'));
function bls(){
 return {
  status:'REQUEST_SUCCEEDED',
  Results:{series:[{seriesID:'CUUR0000SA0',data:[
   {year:'2026',period:'M10',value:'337.500',footnotes:[]},
   {year:'2026',period:'M09',value:'336.100',footnotes:[]},
   {year:'2025',period:'M10',value:'324.600',footnotes:[]}
  ]}]}
 };
}
function mock(calls,payload=bls()){
 return async(url,req)=>{
  calls.push(url);
  assert.equal(url,BLS_CPI_URL);
  assert.equal(req.method,'GET');
  assert.equal(req.credentials,'omit');
  assert.equal(req.redirect,'error');
  return new Response(JSON.stringify(payload),{
   status:200,headers:{'content-type':'application/json'}
  });
 };
}
test('archives exactly one public BLS GET per UTC date; repeats reuse bytes without network',async()=>{
 const dir=root(),calls=[];try{
  const fetcher=mock(calls);
  const first=await collectIndependentCpi({root:dir,now:()=>at,fetcher});
  assert.equal(first.status,'ARCHIVED');
  assert.equal(first.providerCalls,1);
  assert.equal(first.monthsStored,3);
  assert.equal(first.latestPublishedMonth,'2026-10');
  assert.deepEqual(calls,[BLS_CPI_URL]);
  const saved=JSON.parse(readFileSync(first.path,'utf8'));
  assert.equal(saved.source,'BLS_PUBLIC_V1_NO_KEY');
  assert.equal(saved.status,'POST_PUBLICATION_SERIES_AS_SEEN_NOT_EVENT_TIME_VINTAGE');
  assert.equal(saved.observationDate,'2026-11-13');
  assert.equal(saved.firstMonth,'2025-10');
  assert.equal(saved.lastMonth,'2026-10');
  assert.equal(saved.sourceResponseDigest.length,64);
  assert.equal(saved.id.length,64);
  assert.equal('kalshi' in saved,false);
  assert.equal('marketPrice' in saved,false);
  assert.equal('prediction' in saved,false);
  assert.deepEqual(verifyCpiPublicMemory(saved),saved);
  const second=await collectIndependentCpi({root:dir,now:()=>at,fetcher});
  assert.equal(second.status,'ALREADY_ARCHIVED');
  assert.equal(second.providerCalls,0);
  assert.equal(calls.length,1);
  assert.equal(second.path,first.path);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('wrong CPI series refuses archive and does not synthesize an economic event forecast',async()=>{
 const dir=root(),calls=[];
 try{
  const p=bls();p.Results.series[0].seriesID='BAD';
  await assert.rejects(collectIndependentCpi({root:dir,now:()=>at,
   fetcher:mock(calls,p)}),/BLS_WRONG_SERIES/);
  assert.equal(existsSync(cpiArchivePath(dir,'2026-11-13')),false);
  assert.equal(calls.length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('tampering in a previous saved day fails closed and does not re-fetch or overwrite',async()=>{
 const dir=root(),calls=[];
 try{
  const fetcher=mock(calls);
  const r=await collectIndependentCpi({root:dir,now:()=>at,fetcher});
  const item=JSON.parse(readFileSync(r.path,'utf8'));
  item.readings[0].indexValue=999;
  writeFileSync(r.path,JSON.stringify(item));
  await assert.rejects(collectIndependentCpi({root:dir,now:()=>at,fetcher}),/INVALID_MEMORY/);
  assert.equal(calls.length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('distinct collection dates retain different point-in-time snapshots; older stays immutable',async()=>{
 const dir=root(),calls=[];
 try{
  const r1=await collectIndependentCpi({root:dir,now:()=>at,fetcher:mock(calls)});
  const firstBytes=readFileSync(r1.path,'utf8');
  const newer=bls();newer.Results.series[0].data[0].value='337.700';
  const r2=await collectIndependentCpi({root:dir,now:()=> '2026-11-20T21:20:00.000Z',
   fetcher:mock(calls,newer)});
  assert.equal(r2.providerCalls,1);
  assert.notEqual(r1.path,r2.path);
  assert.notEqual(JSON.parse(readFileSync(r1.path)).readings.at(-1).indexValue,
   JSON.parse(readFileSync(r2.path)).readings.at(-1).indexValue);
  assert.equal(readFileSync(r1.path,'utf8'),firstBytes);
  assert.equal(calls.length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid UTC clock/configuration cannot produce a record',async()=>{
 const dir=root();try{
  await assert.rejects(collectIndependentCpi({root:dir,now:()=> 'not-a-time',
   fetcher:async()=>{throw Error('should not fetch');}}),/BAD_CLOCK/);
  await assert.rejects(collectIndependentCpi({root:'',now:()=>at,
   fetcher:async()=>{throw Error('should not fetch');}}),/BAD_PATH/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('public API failure and oversized response produce no archive',async()=>{
 const dir=root();
 try{
  await assert.rejects(collectIndependentCpi({root:dir,now:()=>at,
   fetcher:async()=>new Response('',{status:429})}),/RATE_LIMITED/);
  await assert.rejects(collectIndependentCpi({root:dir,now:()=>at,
   fetcher:async()=>new Response('a'.repeat(120001),{
    headers:{'content-type':'application/json','content-length':'120001'}
   })}),/TOO_LARGE/);
  assert.equal(existsSync(cpiArchivePath(dir,'2026-11-13')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
