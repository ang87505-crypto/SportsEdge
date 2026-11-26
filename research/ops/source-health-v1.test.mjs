import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSource,readOnlyHealthSummary} from './source-health-v1.mjs';

const now='2026-11-13T18:00:00.000Z';
const base={id:'nba-props-collect',label:'NBA virtual props capture',domain:'sports',
 enabled:true,cadenceMinutes:1440,graceMinutes:120,
 lastResult:'success',lastAttemptAt:'2026-11-13T16:00:00.000Z',lastSuccessAt:'2026-11-13T16:00:00.000Z'};

test('a recent confirmed capture is fresh but never implies accurate picks',()=>{
 const x=inspectSource(base,now);
 assert.equal(x.state,'fresh');
 assert.equal(x.ageMinutes,120);
 assert.equal(x.actionable,false);
 assert.match(x.reason,/does not prove forecasts were accurate/i);
});
test('disabled sources are intentionally silent and not zero opportunities',()=>{
 const x=inspectSource({...base,enabled:false,lastSuccessAt:null,lastAttemptAt:null},now);
 assert.equal(x.state,'disabled');
 assert.equal(x.actionable,false);
 assert.equal(x.ageMinutes,null);
 assert.match(x.reason,/not zero/i);
});
test('missed schedules and failed captures are actionable, not automatic retries',()=>{
 const stale=inspectSource({...base,lastSuccessAt:'2026-11-10T18:00:00.000Z',
 lastAttemptAt:'2026-11-10T18:00:00.000Z'},now);
 assert.equal(stale.state,'stale');
 assert.equal(stale.actionable,true);
 const failed=inspectSource({...base,lastResult:'failure',lastAttemptAt:'2026-11-13T17:50:00.000Z'},now);
 assert.equal(failed.state,'failed');
 assert.equal(failed.actionable,true);
 assert.doesNotMatch(JSON.stringify(failed),/execute|dispatch|place.order|credentials/i);
});
test('unknown source receipts and clock anomalies are distinct from a verified failure',()=>{
 const none=inspectSource({...base,lastSuccessAt:null,lastAttemptAt:null,lastResult:'unknown'},now);
 assert.equal(none.state,'awaiting_first_capture');
 assert.equal(none.actionable,false);
 const firstFailed=inspectSource({...base,lastSuccessAt:null,lastResult:'failure'},now);
 assert.equal(firstFailed.state,'failed');
 const future=inspectSource({...base,lastSuccessAt:'2026-11-14T12:00:00.000Z'},now);
 assert.equal(future.state,'unverified_clock');
 const broken=inspectSource({...base,lastAttemptAt:'not a date'},now);
 assert.equal(broken.state,'unverified_clock');
});
test('cross-domain summary keeps disabled and missing evidence separate',()=>{
 const rows=[
  base,
  {...base,id:'stock-paper-marks',label:'Stock PAPER marks',domain:'stocks',lastSuccessAt:null,lastAttemptAt:null,lastResult:'unknown'},
  {...base,id:'public-noaa',label:'Public NOAA research',domain:'public_events',enabled:false,lastResult:'unknown'},
  {...base,id:'kalshi-cpi',label:'Public CPI research',domain:'public_events',lastSuccessAt:'2026-11-09T18:00:00.000Z',lastAttemptAt:'2026-11-09T18:00:00.000Z'}
 ];
 const x=readOnlyHealthSummary(rows,now);
 assert.equal(x.records,4);
 assert.equal(x.counts.fresh,1);
 assert.equal(x.counts.disabled,1);
 assert.equal(x.counts.awaiting_first_capture,1);
 assert.equal(x.counts.stale,1);
 assert.equal(x.actionable,1);
 assert.equal(x.systemState,'needs_attention');
 assert.equal(x.attention[0].id,'kalshi-cpi');
});
test('no active source is not falsely described as fully healthy',()=>{
 const x=readOnlyHealthSummary([{...base,enabled:false}],now);
 assert.equal(x.systemState,'not_observed');
 assert.equal(x.operating,0);
 const incomplete=readOnlyHealthSummary([{...base,lastSuccessAt:null,lastAttemptAt:null,lastResult:'unknown'}],now);
 assert.equal(incomplete.systemState,'incomplete');
 assert.equal(incomplete.counts.awaiting_first_capture,1);
});
test('invalid inputs, duplicates, domains and huge source lists fail closed',()=>{
 assert.throws(()=>readOnlyHealthSummary([base,base],now),/DUPLICATE/);
 assert.throws(()=>readOnlyHealthSummary(Array(51).fill(base),now),/BAD_LIST/);
 assert.throws(()=>inspectSource({...base,domain:'kalshi-orders'},now),/BAD_SOURCE/);
 assert.throws(()=>inspectSource({...base,cadenceMinutes:0},now),/BAD_SOURCE/);
 assert.throws(()=>inspectSource(base,'bad date'),/INVALID_NOW/);
});
