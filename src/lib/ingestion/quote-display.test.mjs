import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteDisplayStatus,quoteStatusLabels} from './quote-display.ts';
const now=Date.parse('2026-10-11T20:00:00Z');
const q=(age=10)=>({updatedAt:new Date(now-age*1000).toISOString(),
 ingestedAt:new Date(now-1000).toISOString(),freshness:'fresh',
 completeMarket:true,americanOdds:-110});
test('a verified complete market with a recent source timestamp is fresh',()=>{
 assert.equal(quoteDisplayStatus(q(),now),'fresh');
 assert.equal(quoteStatusLabels.fresh,'Fresh');
});
test('source quote becomes aging then stale as time passes on the page',()=>{
 const value=q();
 assert.equal(quoteDisplayStatus(value,now+25_000),'aging');
 assert.equal(quoteDisplayStatus(value,now+51_000),'stale');
});
test('server aging/stale state can only restrict client label',()=>{
 assert.equal(quoteDisplayStatus({...q(),freshness:'aging'},now),'aging');
 assert.equal(quoteDisplayStatus({...q(),freshness:'stale'},now),'stale');
});
test('same timestamp as local time or future provider timestamps cannot fake freshness',()=>{
 for(const value of [
  {...q(),updatedAt:new Date(now+1).toISOString()},
  {...q(),ingestedAt:new Date(now+1).toISOString()},
  {...q(),updatedAt:'broken'},
  {...q(),ingestedAt:'broken'},
  {...q(),ingestedAt:undefined},
  {...q(),updatedAt:new Date(now-1000).toISOString(),ingestedAt:new Date(now-2000).toISOString()}
 ])assert.equal(quoteDisplayStatus(value,now),'stale');
});
test('a market without both outcomes or with invalid odds is marked incomplete',()=>{
 assert.equal(quoteDisplayStatus({...q(),completeMarket:false},now),'incomplete');
 assert.equal(quoteDisplayStatus({...q(),americanOdds:0},now),'incomplete');
});
test('absent server status never becomes fresh just because it has a timestamp',()=>{
 assert.equal(quoteDisplayStatus({...q(),freshness:undefined},now),'stale');
});
test('invalid client time or less strict quote lifetime fails safely',()=>{
 assert.equal(quoteDisplayStatus(q(),NaN),'incomplete');
 assert.equal(quoteDisplayStatus(q(),now,120_000),'incomplete');
});
