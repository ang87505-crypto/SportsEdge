import test from 'node:test';
import assert from 'node:assert/strict';
import {moneylineJob} from './moneyline-monitor.mjs';
import {moneylineHealth} from '../src/lib/moneyline-health.ts';
import {moneylineReceiptFixture as receipt} from '../src/lib/moneyline-health-fixture.mjs';
const NOW='2026-11-28T13:00:00.000Z',now=Date.parse(NOW),job={id:'moneyline-refresh',label:'Moneyline',area:'sports',crons:['0 11 * * *']};
const health=()=>{const x=receipt();return moneylineHealth(NOW,true,x.slots,x.runs);};
test('reviewed OFF state is authoritative and is not treated as a broken or active job',()=>{
 const j=moneylineJob(job,null,now,false);assert.equal(j.status,'RELEASED_OFF');assert.equal(j.required,false);assert.equal(j.lastRun,null);
});
test('a completed receipt reports the database run without inventing a GitHub execution',()=>{
 const j=moneylineJob(job,health(),now,true);assert.equal(j.status,'OK');assert.equal(j.required,true);assert.equal(j.lastRun,null);
 assert.match(j.detail,/research run #42/);assert.match(j.detail,/NBA saved, EPL saved/);
});
test('pending, missed and failed receipts are visible as distinct operator states',()=>{
 const pending=moneylineHealth('2026-11-28T10:00:00Z',true,[],[]);
 assert.equal(moneylineJob(job,pending,Date.parse(pending.checkedAt),true).status,'PENDING_FIRST_RUN');
 const missed=moneylineHealth(NOW,true,[],[]);assert.equal(moneylineJob(job,missed,now,true).status,'MISSED_SLOT');
 const bad=health();bad.state='ATTENTION';bad.issues=['SOCCER_NO_PRICES'];assert.equal(moneylineJob(job,bad,now,true).status,'FAILING');
});
test('unavailable, stale, future, contradictory and release-mismatched health is never green',()=>{
 for(const h of [null,{...health(),checkedAt:'2026-11-28T12:49:00Z'},{...health(),checkedAt:'2026-11-28T13:00:01Z'},
  {...health(),run:null},{...health(),enabled:false},{...health(),issues:['MISSING_SLOT']},{...health(),issues:['UNKNOWN_CODE']}])
  assert.equal(moneylineJob(job,h,now,true).status,'STALE');
});
