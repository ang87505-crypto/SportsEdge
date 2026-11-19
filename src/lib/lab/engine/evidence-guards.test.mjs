import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './forward.ts';
import {meetsSample} from './evaluate.ts';
import {sportsQuality} from './diagnostics.ts';

const spec={kind:'ledger-models',candidate:'candidate',baseline:'base',maxStaleDays:7};
const at='2026-11-19T17:00:00Z';
const base={key:'SYNTHETIC',eventId:'SYNTHETIC-game',date:'2026-11-18',stat:'points',model:'base',p:{pMore:0.6,pLess:0.4,pTie:0},
 recordedAt:'2026-11-18T15:00:00Z',dataCutoff:'2026-11-18T14:00:00Z',predictedAt:'2026-11-18T16:00:00Z',lockAt:'2026-11-18T23:00:00Z'};
const candidate={...base,model:'candidate'};
const grade={key:base.key,outcome:'more',gradedAt:'2026-11-19T02:00:00Z'};

test('pairing excludes unknown/future/after-lock evidence and mismatched games instead of fabricating pairs',()=>{
 assert.equal(pair(spec,[base,candidate],[grade],at).rows.length,1);
 for(const change of [{predictedAt:'bad'},{predictedAt:'2026-11-20T16:00:00Z'},
  {dataCutoff:'2026-11-18T17:00:00Z'},{recordedAt:'2026-11-18T17:00:00Z'},{p:{pMore:0.8,pLess:0.8,pTie:0}}]){
  const r=pair(spec,[base,{...candidate,...change}],[grade],at);assert.equal(r.rows.length,0);assert.equal(r.invalidPredictions,1);
 }
 for(const change of [{gradedAt:'bad'},{gradedAt:'2026-11-20T02:00:00Z'},{gradedAt:'2026-11-18T21:00:00Z'}]){
  const r=pair(spec,[base,candidate],[{...grade,...change}],at);assert.equal(r.rows.length,0);assert.equal(r.invalidGrades,1);
 }
 const r=pair(spec,[base,{...candidate,eventId:'OTHER_SYNTHETIC'}],[grade],at);assert.equal(r.rows.length,0);assert.equal(r.metadataConflicts,1);
 assert.throws(()=>pair(spec,[base,candidate],[grade],'bad'),/ENGINE_BAD_CLOCK/);
});

test('invalid sample sizes cannot qualify, and malformed or premature grades cannot enter diagnostics',()=>{
 for(const observations of [NaN,Infinity,-1,0.5])assert.equal(meetsSample({observations,evidence:'forward',disposition:'PROMISING',reason:''},{minObservations:1}).ok,false);
 const row={key:'SYNTHETIC',game:'g',pMore:0.6,predictedAt:base.predictedAt,lockAt:base.lockAt,gradedAt:'bad'};
 assert.equal(sportsQuality([row],at).issues[0].code,'INVALID_TIMESTAMP');
 assert.equal(sportsQuality([{...row,gradedAt:'2026-11-18T20:00:00Z'}],at).issues[0].code,'GRADE_BEFORE_LOCK');
});

test('valid predictions before a challenger registration are excluded without being called corrupt',()=>{
 const r=pair({...spec,notBefore:'2026-11-18T17:00:00Z'},[base,candidate],[grade],at);
 assert.equal(r.rows.length,0);assert.equal(r.excludedBeforeRegistration,2);assert.equal(r.invalidPredictions,0);
});
