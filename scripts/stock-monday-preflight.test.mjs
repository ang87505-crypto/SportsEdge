import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMondayReadiness} from './stock-monday-preflight.mjs';
const at='2026-11-14T01:50:00Z';
const manifest="export const PAPER_AUTO_RELEASE={paperOnly:true,brokerWritesEnabled:false,scheduledRunsEnabled:true,realMoneyEnabled:false} as const;";
const report=()=>({
 generatedAt:'2026-11-14T01:25:00Z',site:{ok:true,deployment:{state:'MATCHES_MAIN'}},
 jobs:['stock-decision','stock-kickoff','stock-worker'].map(id=>({
  id,status:'OK',workflowState:'active',lastSuccess:{conclusion:'success'},
  slots7d:{missed:id==='stock-worker'?5:0}
 })),
 evidence:{release:{pr:102,state:'open',draft:true,merged:false,
  stockGate:{ready:false,reason:'STOCK_SUPERVISED_EXECUTE_REQUIRED'}}},
 blockers:[{id:'stock-first-session',text:'First supervised PAPER order required'}]
});
test('clean read-only preflight reports owner actions, NOT a live trading approval',()=>{
 const r=assessMondayReadiness(report(),manifest,at);
 assert.equal(r.status,'PREPARED_FOR_OWNER_SUPERVISED_PAPER_TEST');
 assert.equal(r.blocked.length,0);
 assert.ok(r.ownerActions.includes('OWNER_FIRST_PAPER_EXECUTE_STOP_RECONCILE_START_CLOSE'));
 assert.ok(r.warnings.some(x=>x.includes('not an authenticated broker')));
});
test('missing kickoff, failed worker, stale monitor or deployment drift blocks readiness',()=>{
 const bad=report();bad.jobs[1].status='MISSED_SLOT';
 assert.equal(assessMondayReadiness(bad,manifest,at).status,'BLOCKED');
 const stale=report();stale.generatedAt='2026-11-12T01:00:00Z';
 assert.ok(assessMondayReadiness(stale,manifest,at).blocked.includes('MONITOR_RECENT_WITHIN_12_HOURS'));
 const x=report();x.site.deployment.state='DIFFERS_FROM_MAIN';
 assert.equal(assessMondayReadiness(x,manifest,at).status,'BLOCKED');
});
test('main broker writes or real money cannot be enabled during preparation',()=>{
 const reportNow=report();
 assert.equal(assessMondayReadiness(reportNow,manifest.replace('brokerWritesEnabled:false','brokerWritesEnabled:true'),at).status,'BLOCKED');
 assert.equal(assessMondayReadiness(reportNow,manifest.replace('realMoneyEnabled:false','realMoneyEnabled:true'),at).status,'BLOCKED');
});
test('release gate cannot be confused with an already approved or merged order release',()=>{
 const a=report();a.evidence.release.stockGate.ready=true;
 assert.equal(assessMondayReadiness(a,manifest,at).status,'BLOCKED');
 const b=report();b.evidence.release.merged=true;b.evidence.release.state='closed';
 assert.equal(assessMondayReadiness(b,manifest,at).status,'BLOCKED');
});
test('no fabricated success from blank or malformed monitor report',()=>{
 assert.throws(()=>assessMondayReadiness(null,manifest,at),/INVALID_MONITOR/);
 const empty=assessMondayReadiness({},manifest,at);
 assert.equal(empty.status,'BLOCKED');
 assert.ok(empty.blocked.length>=6);
});
