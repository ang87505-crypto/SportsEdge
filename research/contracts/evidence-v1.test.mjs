import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAtDecision,auditFrozenForecast,summarizeReadOnlyAudit} from './evidence-v1.mjs';
const clone=x=>structuredClone(x);
const sha='a'.repeat(64);
const src=(domain='sports')=>({domain,sourceId:'public.example.game',payloadSha256:sha,
 attribution:'Source and rights checked',permissionState:'approved',
 availableAt:'2026-11-13T13:00:00.000Z',observedAt:'2026-11-13T13:30:00.000Z'});
const f=(domain='sports',decision='candidate_only')=>({domain,decision,forecastId:'f-100',eventId:'event-100',modelVersion:'lab-v1',
 featureCutoff:'2026-11-13T14:00:00.000Z',createdAt:'2026-11-13T14:02:00.000Z',
 lockAt:'2026-11-13T15:00:00.000Z',probability:0.62});
const o={eventId:'event-100',state:'verified',correct:true,verifiedAt:'2026-11-13T18:00:00.000Z'};
test('sports candidate may be graded but never infers virtual payout',()=>{
 const a=auditFrozenForecast(f(),[src()],o);
 assert.equal(a.eligibleForForwardEvaluation,true);
 assert.equal(a.gradeState,'graded');
 assert.equal(a.correct,true);
 assert.equal(a.netVirtualCents,null);
 const summary=summarizeReadOnlyAudit([a]);
 assert.equal(summary.accuracy,1);
 assert.equal(summary.paperNetVirtualCents,null);
});
test('stocks PAPER needs a later verified outcome AND a settled receipt',()=>{
 const forecast=f('stocks','paper_entry'),source=src('stocks');
 const before=auditFrozenForecast(forecast,[source],{...o,verifiedAt:'2026-11-13T14:30:00.000Z'});
 assert.equal(before.gradeState,'pending');
 assert.equal(before.netVirtualCents,null);
 const graded=auditFrozenForecast(forecast,[source],o);
 assert.equal(graded.gradeState,'graded');
 assert.equal(graded.netVirtualCents,null);
 const receipt={entryId:'entry-12',forecastId:'f-100',state:'settled',
  recordedAt:'2026-11-13T14:08:00.000Z',verifiedAt:'2026-11-13T18:05:00.000Z',netVirtualCents:-75};
 const settled=auditFrozenForecast(forecast,[source],o,receipt);
 assert.equal(settled.netVirtualCents,-75);
 assert.equal(summarizeReadOnlyAudit([settled]).paperNetVirtualCents,-75);
 assert.equal(auditFrozenForecast(forecast,[source],o,{...receipt,recordedAt:'2026-11-13T15:01:00.000Z'}).netVirtualCents,null);
 assert.equal(auditFrozenForecast(forecast,[source],o,{...receipt,forecastId:'another-forecast'}).netVirtualCents,null);
});
test('unknown outcomes and absence of paper receipts are not zero returns',()=>{
 const a=auditFrozenForecast(f(),[src()]);
 const summary=summarizeReadOnlyAudit([a]);
 assert.equal(a.gradeState,'pending');
 assert.equal(summary.graded,0);
 assert.equal(summary.accuracy,null);
 assert.equal(summary.paperSettled,0);
 assert.equal(summary.paperNetVirtualCents,null);
});
test('public events require source availability strictly before cutoff',()=>{
 const forecast=f('public_events'),source=src('public_events');
 assert.equal(auditFrozenForecast(forecast,[source],o).gradeState,'graded');
 for(const change of [
  {availableAt:null},
  {availableAt:'2026-11-13T14:00:00.000Z'},
  {observedAt:'2026-11-13T14:00:01.000Z'},
  {permissionState:'review_required'},
  {payloadSha256:'not-a-hash'}
 ]){
  const result=auditFrozenForecast(forecast,[{...source,...change}],o);
  assert.equal(result.gradeState,'excluded');
  assert.equal(result.correct,null);
 }
});
test('cross-domain evidence and bad timelines fail closed',()=>{
 assert.ok(auditFrozenForecast(f('sports'),[src('stocks')]).exclusions.includes('CROSS_DOMAIN_SOURCE'));
 const late=clone(f());late.createdAt=late.lockAt;
 assert.ok(auditFrozenForecast(late,[src()]).exclusions.includes('INVALID_FORECAST_TIMELINE'));
 const invalid=clone(f());invalid.probability=1.01;
 assert.ok(auditFrozenForecast(invalid,[src()]).exclusions.includes('INVALID_PROBABILITY'));
 const noSource=auditFrozenForecast(f(),[]);
 assert.ok(noSource.exclusions.includes('NO_SOURCE_EVIDENCE'));
});
test('unavailable source distinctly fails without inventing data',()=>{
 assert.deepEqual(sourceAtDecision(null,'2026-11-13T14:00:00.000Z'),{usable:false,reason:'SOURCE_UNAVAILABLE'});
 assert.equal(sourceAtDecision(src(),'2026-11-13T14:00:00.000Z').usable,true);
 assert.equal(sourceAtDecision(src(),'bad date').reason,'BAD_CUTOFF');
});
test('a verified losing forecast is not silently omitted from measured accuracy',()=>{
 const correct=auditFrozenForecast(f(),[src()],o);
 const missed=auditFrozenForecast({...f(),forecastId:'f-101'},[src()],{...o,correct:false});
 const summary=summarizeReadOnlyAudit([correct,missed]);
 assert.equal(summary.graded,2);
 assert.equal(summary.correct,1);
 assert.equal(summary.accuracy,0.5);
});
