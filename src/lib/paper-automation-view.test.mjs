import test from 'node:test';
import assert from 'node:assert/strict';
import {propsAutomationStatus,mountainTime} from './paper-automation-view.ts';

const run={id:1,kind:'collect',slot_key:'collect-manual-123',status:'completed',outcome:'COMPLETED',
 started_at:'2026-11-07T19:10:00Z',finished_at:'2026-11-07T19:11:00Z',summary:{}};
const raw={control:{state:'RUNNING'},nowIso:'2026-11-08T08:00:00Z',providerRemaining:491,runs:[run]};

test('an enabled database control does not claim the unreleased schedule is automatic',()=>{
 assert.equal(propsAutomationStatus(raw,false).label,'Waiting for release');
 assert.equal(propsAutomationStatus(raw,true).label,'Waiting for first run','manual success is not scheduled evidence');
 for(const state of ['PAUSED','STOPPED'])assert.equal(propsAutomationStatus({...raw,control:{state}},true).label,
  state==='PAUSED'?'Paused':'Stopped');
 assert.equal(propsAutomationStatus({...raw,control:null},true).label,'Status unavailable');
});

test('failed, overdue and credit-blocked runs stay visible; resuming does not fabricate fresh evidence',()=>{
 const scheduled={...run,slot_key:'collect-2026-11-07T19'};
 assert.equal(propsAutomationStatus({...raw,runs:[scheduled]},true).label,'Automatic');
 assert.equal(propsAutomationStatus({...raw,runs:[{...scheduled,status:'failed'}]},true).label,'Needs attention');
 assert.equal(propsAutomationStatus({...raw,providerRemaining:59,runs:[scheduled]},true).label,'Data budget paused');
 assert.equal(propsAutomationStatus({...raw,nowIso:'2026-11-10T08:00:00Z',runs:[scheduled]},true).label,'Collection overdue');
 assert.equal(propsAutomationStatus({...raw,runs:[{...scheduled,outcome:'BUDGET_EXHAUSTED'}]},true).label,'Waiting for first run');
});

test('Mountain times show the correct local date and daylight-saving offset',()=>{
 assert.match(mountainTime('2026-11-08T15:20:00Z'),/8:20 AM MST/);
 assert.match(mountainTime('2026-07-08T15:20:00Z'),/9:20 AM MDT/);
 assert.equal(mountainTime(null),'None yet');
});
