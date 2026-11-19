import test from 'node:test';
import assert from 'node:assert/strict';
import {wilsonUpper,safetyBrake,BRAKE_WINDOW,BRAKE_MIN,BREAK_EVEN} from './brake.ts';

// Synthetic graded picks, newest last; each has a unique key unless a test says otherwise.
const picks=(correct,total,{start=0,key=i=>'k'+(start+i)}={})=>Array.from({length:total},(_,i)=>({key:key(i),correct:i<correct,
 gradedAt:new Date(Date.UTC(2026,10,1)+(start+i)*3600_000).toISOString()}));

test('constants match the spec',()=>{
 assert.deepEqual([BRAKE_WINDOW,BRAKE_MIN,BREAK_EVEN],[150,50,0.577]);
});

test('Wilson upper bound',()=>{
 assert.ok(Math.abs(wilsonUpper(20,50)-0.53819)<1e-4);
 assert.ok(Math.abs(wilsonUpper(80,150)-0.61134)<1e-4);
});

test('trips when the recent hit rate is confidently below break-even',()=>{
 const r=safetyBrake(picks(20,50),'RUNNING');
 assert.equal(r.trip,true);
 assert.equal(r.n,50);
 assert.equal(r.hitRate,0.4);
 assert.ok(r.upper<BREAK_EVEN);
});

test('does not trip on a merely unlucky stretch',()=>{
 assert.equal(safetyBrake(picks(80,150),'RUNNING').trip,false);
});

test('needs at least 50 graded picks',()=>{
 const r=safetyBrake(picks(10,49),'RUNNING');
 assert.deepEqual([r.trip,r.n],[false,49]);
});

test('uses only the newest 150 picks',()=>{
 // 150 recent picks at 80/150 (no trip) plus 100 older straight losses that must be ignored.
 const old=picks(0,100,{start:0});
 const recent=picks(80,150,{start:100});
 const r=safetyBrake([...recent,...old],'RUNNING');
 assert.deepEqual([r.n,r.trip],[150,false]);
});

test('the same line on two platforms counts once',()=>{
 const twice=picks(20,50).flatMap(p=>[p,{...p}]);
 assert.equal(safetyBrake(twice,'RUNNING').n,50);
});

test('never acts on a control that is not RUNNING',()=>{
 for(const control of ['STOPPED','PAUSED',null])assert.equal(safetyBrake(picks(20,50),control).trip,false);
});
