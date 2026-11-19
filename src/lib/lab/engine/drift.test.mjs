import test from 'node:test';
import assert from 'node:assert/strict';
import {sportsDrift,readSportsDrift} from './drift.ts';
const now='2026-11-19T20:00:00Z';
const rows=(date,bad=false)=>Array.from({length:120},(_,i)=>({key:date+'-'+i,game:date+'-game'+i%12,date,stat:'points',modelVersion:'SYNTHETIC',
 lockAt:date+'T22:00:00Z',predictedAt:date+'T17:00:00Z',gradedAt:date+'T23:00:00Z',pMore:0.8,picked:'more',outcome:bad?'less':'more',
 games:10,minutesCv:0.2,lineGapRel:0.1}));
test('too little recent or reference evidence cannot invent a drift verdict',()=>{
 const r=sportsDrift(rows('2026-11-18'),now);assert.equal(r.status,'COLLECTING');assert.equal(r.reference.lines,0);assert.deepEqual(r.changes,[]);
 assert.equal(readSportsDrift(r),r);
});
test('game-clustered worsening asks for review, never promotes or trains; repeat input is deterministic',()=>{
 const data=[...rows('2026-11-01'),...rows('2026-11-18',true)];
 const r=sportsDrift(data,now);assert.equal(r.status,'REVIEW_REQUESTED');assert.ok(r.changes.every(c=>c.review));
 assert.deepEqual(sportsDrift([...data].reverse(),now),r);
 const copies=sportsDrift([...data,...data],now);assert.equal(copies.recent.lines,120);assert.equal(copies.reference.lines,120);
});
test('unchanged errors, future grades and duplicate copies do not create deterioration',()=>{
 const data=[...rows('2026-11-01'),...rows('2026-11-18')];assert.equal(sportsDrift(data,now).status,'NO_CLEAR_DRIFT');
 const future=rows('2026-11-18',true).map(r=>({...r,gradedAt:'2027-01-01T00:00:00Z'}));
 assert.equal(sportsDrift([...rows('2026-11-01'),...future],now).status,'COLLECTING');
 assert.throws(()=>sportsDrift(data,'bad'),/INVALID_CLOCK/);
});
