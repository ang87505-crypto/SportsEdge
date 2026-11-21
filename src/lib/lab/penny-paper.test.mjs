import test from 'node:test';
import assert from 'node:assert/strict';
import {pennyJointPpm,pennyEntrySizing,pennyReturnCents,pennySummary} from './penny-paper.ts';
test('two-leg whole-entry estimate and actual 3x payout size integer cents monotonically',()=>{
 assert.equal(pennyJointPpm(650000,650000),414050);
 assert.equal(pennyEntrySizing(650000,650000).stakeCents,8);
 assert.equal(pennyEntrySizing(750000,750000).stakeCents,21);
 assert.equal(pennyEntrySizing(600000,600000).stakeCents,1);
 let prev=0;for(let p=500000;p<=1000000;p+=1000){const s=pennyEntrySizing(p,p).stakeCents;assert.ok(s>=prev);prev=s;}
 assert.equal(pennyEntrySizing(900000,900000,2).stakeCents,2);
 assert.equal(pennyEntrySizing(900000,900000,500,1500).stakeCents,0);
});
test('explicit virtual rounding handles odd-cent void payouts without inventing a fractional cent',()=>{
 assert.equal(pennyReturnCents(1,1500),1);assert.equal(pennyReturnCents(3,1500),4);
 assert.equal(pennyReturnCents(8,3000),24);assert.equal(pennyReturnCents(8,0),0);assert.equal(pennyReturnCents(8,1000),8);
 for(const n of [NaN,-1,0.5,51])assert.throws(()=>pennyReturnCents(n,3000));
});
test('forward account uses only known grades, latest corrections, open reserves and separate flat comparison',()=>{
 const entries=[{id:1,source_entry_id:7,probability_ppm:414050,stake_cents:8,reference_stake_cents:10,reason:'SIZED',recorded_at:'2026-11-20T18:00:00Z',lock_at:'2026-11-21T00:00:00Z',record_sha256:'a'.repeat(64)}];
 const original={penny_entry_id:1,revision:1,grade_ids:[11,12],outcome:'won',return_cents:24,profit_cents:16,reference_return_cents:30,reference_profit_cents:20,recorded_at:'2026-11-21T04:00:00Z'};
 const corrected={...original,revision:2,grade_ids:[11,13],outcome:'lost',return_cents:0,profit_cents:-8,reference_return_cents:0,reference_profit_cents:-10,recorded_at:'2026-11-22T04:00:00Z'};
 assert.equal(pennySummary(entries,[original,corrected],'2026-11-20T20:00:00Z').variable.availableCents,49992);
 const a=pennySummary(entries,[original,corrected],'2026-11-21T05:00:00Z');assert.equal(a.variable.realizedProfitCents,16);assert.equal(a.reference.realizedProfitCents,20);
 const b=pennySummary(entries,[original,corrected],'2026-11-22T05:00:00Z');assert.equal(b.variable.realizedProfitCents,-8);assert.equal(b.settled,1);assert.equal(b.variable.openStakeCents,0);
 assert.throws(()=>pennySummary([...entries,...entries],[],'2026-11-21T05:00:00Z'),/DUPLICATE/);
});
