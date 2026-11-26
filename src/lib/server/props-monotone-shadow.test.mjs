import test from 'node:test';
import assert from 'node:assert/strict';
import model from '../../data/props/model_v1.json' with {type:'json'};
import fit from '../../../research/props_monotone_cal_v1_20261120/fit.json' with {type:'json'};
import {MONOTONE_SHADOW,verifiedMonotoneCalibration,monotoneShadowProbability,modelDigest} from '../props/monotone-shadow.ts';
import {recordMonotoneShadows} from './props-monotone-shadow.ts';
import {PropsStoreError} from './props-store.ts';
import {trackMonotoneShadow} from '../lab/engine/monotone-shadow.ts';
import {pair,forwardResult} from '../lab/engine/forward.ts';
import {MODEL_VERSION} from '../props/contract.ts';

const at='2026-11-23T20:00:00Z',lock='2026-11-24T02:00:00Z';
const baseline=(id=1)=>({id,observationId:id,status:'scored',athleteId:'123',pMore:.72,pLess:.18,pTie:.1,mean:23,dataCutoff:at});
const obs=id=>({id,stat:'points',lockAt:lock});
const deps=(insert=async(_t,rows)=>rows.map((_,i)=>({id:i+100})))=>({store:{insert},now:()=>at,model});

test('the exact reviewed forward map and production artifact are pinned; tampering cannot verify',()=>{
 assert.equal(modelDigest(model),MONOTONE_SHADOW.baselineDigest);
 assert.equal(verifiedMonotoneCalibration().challenger,MONOTONE_SHADOW.model);
 const bad=structuredClone(fit);bad.forward.monotone.byStat.points.knots[0].y+=.01;
 assert.throws(()=>verifiedMonotoneCalibration(bad),/ARTIFACT_MISMATCH/);
 bad.forward.digest='0'.repeat(64);assert.throws(()=>verifiedMonotoneCalibration(bad),/ARTIFACT_MISMATCH/);
});

test('integer-line tie mass is conserved; half-point and all-tie forecasts remain valid',()=>{
 for(const p of [{pMore:.72,pLess:.18,pTie:.1},{pMore:.8,pLess:.2,pTie:0},{pMore:0,pLess:0,pTie:1}]){
  const a=monotoneShadowProbability('points',p);
  assert.equal(a.pTie,p.pTie);assert.ok(Math.abs(a.pMore+a.pLess+a.pTie-1)<1e-12);
 }
 assert.throws(()=>monotoneShadowProbability('points',{pMore:NaN,pLess:.2,pTie:0}),/INVALID_PROBABILITIES/);
});

test('only a separate shadow prediction is appended, preserving source identity and actual database receipt time',async()=>{
 const calls=[],d=deps(async(t,rows,opts)=>{calls.push({t,rows,opts});return [{id:99}];});
 const original=baseline(),before=structuredClone(original),r=await recordMonotoneShadows(d,7,[original],[obs(1)]);
 assert.equal(r.status,'OK');assert.equal(r.written,1);assert.deepEqual(original,before);
 assert.equal(calls.length,1);assert.equal(calls[0].t,'props_predictions');
 const row=calls[0].rows[0];assert.equal(row.model_version,MONOTONE_SHADOW.model);
 assert.equal(row.inputs.baselinePredictionId,1);assert.equal(row.inputs.calibratorDigest,MONOTONE_SHADOW.digest);
 assert.equal(row.p_tie,.1);assert.equal(row.predicted_at,undefined);
 assert.equal(calls[0].opts.onConflict,'observation_id,model_version');
 const duplicate=await recordMonotoneShadows(deps(async()=>[]),7,[baseline()],[obs(1)]);
 assert.equal(duplicate.written,0);
});

test('old, locked, unscored and future-input rows never become forward evidence; baseline drift blocks all writes',async()=>{
 const d=deps(async()=>{throw Error('must not write');});
 const rows=[{...baseline(1),dataCutoff:'2026-11-19T20:00:00Z'},baseline(2),{...baseline(3),status:'unscorable'},
  {...baseline(4),dataCutoff:'2026-11-24T20:00:00Z'}];
 const r=await recordMonotoneShadows(d,7,rows,[obs(1),{...obs(2),lockAt:at},obs(3),obs(4)]);
 assert.equal(r.skipped,4);assert.equal(r.written,0);
 const changed=await recordMonotoneShadows({...d,model:{...model,modelVersion:'other'}},7,[baseline()],[obs(1)]);
 assert.equal(changed.status,'BLOCKED');assert.equal(changed.code,'MONOTONE_SHADOW_BASELINE_MISMATCH');
 const old=await recordMonotoneShadows({...d,now:()=> '2026-11-20T20:00:00Z'},7,[baseline()],[obs(1)]);
 assert.equal(old.status,'NOT_STARTED');
});

test('after-lock refusals are reported and uncertain writes are never retried',async()=>{
 const refused=await recordMonotoneShadows(deps(async()=>{throw new PropsStoreError('PROPS_PREDICTION_AFTER_LOCK',true);}),7,[baseline()],[obs(1)]);
 assert.equal(refused.status,'ATTENTION');assert.equal(refused.refused,1);
 let calls=0;
 const unknown=await recordMonotoneShadows(deps(async()=>{calls++;throw new PropsStoreError('STORE_OUTCOME_UNKNOWN',false);}),7,
  [baseline(1),baseline(2)],[obs(1),obs(2)]);
 assert.equal(calls,1);assert.equal(unknown.unknown,2);assert.equal(unknown.status,'ATTENTION');
});

test('a rolled-back lock-crossing batch preserves open rows with bounded batches',async()=>{
 const calls=[],d=deps(async(_table,rows)=>{
  calls.push(rows.length);
  if(rows.length>1||rows[0].observation_id===1)throw new PropsStoreError('PROPS_PREDICTION_AFTER_LOCK',true);
  return [{id:22}];
 });
 const r=await recordMonotoneShadows(d,7,[baseline(1),baseline(2)],[obs(1),obs(2)]);
 assert.deepEqual(calls,[2,1,1]);assert.equal(r.written,1);assert.equal(r.refused,1);
});

function frozen(){
 const b={key:'TEST|player|points|22',eventId:'TEST',date:'2026-11-23',stat:'points',model:MODEL_VERSION,
  predictedAt:at,lockAt:lock,recordedAt:at,dataCutoff:at,p:{pMore:.72,pLess:.18,pTie:.1},predictionId:1,observationId:1};
 const c={...b,model:MONOTONE_SHADOW.model,predictionId:2,baselinePredictionId:1,
  predictedAt:'2026-11-23T20:00:01Z',artifactSha256:MONOTONE_SHADOW.digest,baselineArtifactSha256:MONOTONE_SHADOW.baselineDigest,
  p:monotoneShadowProbability('points',b.p)};
 return {b,c};
}
const registry=()=>({schema:'sportsedge-learning-registry-v1',experiments:[]});
test('registration waits for a verified real-line receipt, uses the unchanged gate and is idempotent',()=>{
 const {b,c}=frozen(),now='2026-11-24T04:00:00Z';
 assert.deepEqual(trackMonotoneShadow(registry(),[],now).added,[]);
 const r=trackMonotoneShadow(registry(),[b,c],now),e=r.registry.experiments[0];
 assert.equal(r.added.length,1);assert.equal(e.sampleRequirements.minObservations,500);assert.equal(e.sampleRequirements.minDates,14);
 assert.equal(e.sampleRequirements.minClusters,50);assert.equal(e.status,'RUNNING');
 assert.deepEqual(trackMonotoneShadow(r.registry,[b,c],now).added,[]);
 for(const changed of [{...c,artifactSha256:'bad'},{...c,p:{pMore:.1,pLess:.8,pTie:.1}},
  {...c,baselinePredictionId:999},{...c,predictedAt:lock},{...c,observationId:2}]){
  assert.deepEqual(trackMonotoneShadow(registry(),[b,changed],now).added,[]);
 }
});

test('paired evaluation uses the exact source forecast and keeps collecting below the real-line gate',()=>{
 const {b,c}=frozen(),now='2026-11-24T04:00:00Z';
 const e=trackMonotoneShadow(registry(),[b,c],now).registry.experiments[0];
 const old={...b,predictionId:3,observationId:3,p:{pMore:.1,pLess:.8,pTie:.1}};
 const r=pair(e.forward,[old,b,c],[{key:b.key,outcome:'more',gradedAt:'2026-11-24T03:00:00Z'}],now);
 assert.equal(r.rows.length,1);assert.deepEqual(r.rows[0].baseline,b.p);
 assert.equal(forwardResult(e.forward,r,now).disposition,'NO_CLEAR_EFFECT');
 assert.equal(pair(e.forward,[old,c],[],now).metadataConflicts,1);
});
