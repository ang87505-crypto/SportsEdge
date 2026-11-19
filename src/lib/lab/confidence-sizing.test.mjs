import test from 'node:test';
import assert from 'node:assert/strict';
import {pennySizing,PENNY_EXAMPLES} from './confidence-sizing.ts';
test('one cent per full percentage point above 50% is exact and monotone at even-money reference',()=>{
 assert.deepEqual(PENNY_EXAMPLES.map(r=>[r.percent,r.stakeCents]),[[50,0],[55,5],[60,10],[65,15],[70,20],[75,25],[80,30],[90,40],[100,50]]);
 assert.equal(pennySizing(509999).stakeCents,0);assert.equal(pennySizing(510000).stakeCents,1);
 let previous=0;for(let p=0;p<=1_000_000;p+=997){const next=pennySizing(p).stakeCents;assert.ok(next>=previous);previous=next;}
});
test('actual gross payout changes break-even; a multi-leg chance is distinct from leg confidence',()=>{
 assert.equal(pennySizing(422500,3000).stakeCents,8,'65% x 65% is 42.25%; 3x gross breaks even at 1/3');
 assert.equal(pennySizing(422500,2000).stakeCents,0);assert.equal(pennySizing(900000,null).reason,'PAYOUT_UNKNOWN');
});
test('integer room, maximum stake and daily cap apply; malformed values cannot size money',()=>{
 assert.equal(pennySizing(900000,2000,7).stakeCents,7);assert.equal(pennySizing(900000,2000,500,1497).stakeCents,3);
 assert.equal(pennySizing(900000,2000,500,1500).stakeCents,0);
 assert.equal(pennySizing(1_000_000,100_000).stakeCents,50);
 for(const p of [NaN,Infinity,-1,1_000_001,0.5])assert.throws(()=>pennySizing(p));
 for(const m of [0,1000,1000.5,Infinity])assert.throws(()=>pennySizing(650000,m));
});
