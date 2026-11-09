// Active model and shadow challengers: fake store and synthetic TEST-ONLY artifacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadActiveModel,LAYER1_VERSION,MAX_SHADOWING} from './props-active-model.ts';
import {artifactSha256,FEATURES} from '../props/learn.ts';
import {PropsStoreError} from './props-store.ts';

const w=[0,1,0,0,0,0,0,0,0];
const art=v=>({modelVersion:v,baseModelVersion:'props-nb-minutes-rate-v1',trainedAt:'2026-11-08T10:00:00Z',dataCutoff:'2026-11-08T09:00:00Z',
 features:[...FEATURES],weights:{points:w,rebounds:w,assists:w},lambda:{points:1,rebounds:1,assists:1},marketWeightsActive:false,
 counts:{points:{historical:1,forward:0,forwardWithBooks:0},rebounds:{historical:1,forward:0,forwardWithBooks:0},assists:{historical:1,forward:0,forwardWithBooks:0}}});
const row=(v,o={})=>({version:v,sha256:artifactSha256(art(v)),artifact:art(v),...o});
function store({control={active_model_version:LAYER1_VERSION,learning_enabled:true,auto_switch_enabled:true},artifacts=[],events=[],fail=false}={}){
 return {async select(table){
  if(fail)throw new PropsStoreError('STORE_HTTP_404',true);
  if(table==='props_model_control')return control?[control]:[];
  if(table==='props_model_artifacts')return artifacts;
  if(table==='props_model_events')return events;
  return [];
 },async rpc(){throw Error('no')},async insert(){throw Error('no')}};
}
const ev=(version,event,id)=>({id,version,event});

test('constants',()=>{assert.equal(LAYER1_VERSION,'props-nb-minutes-rate-v1');assert.equal(MAX_SHADOWING,3);});

test('learning tables not migrated yet: layer 1, no fallback flag, control unavailable',async()=>{
 const m=await loadActiveModel(store({fail:true}));
 assert.deepEqual(m,{version:LAYER1_VERSION,artifact:null,fallback:false,controlAvailable:false,shadows:[],learningEnabled:false,autoSwitchEnabled:false});
});

test('a verified learn artifact becomes the active model',async()=>{
 const m=await loadActiveModel(store({control:{active_model_version:'props-learn-v1',learning_enabled:true,auto_switch_enabled:false},artifacts:[row('props-learn-v1')]}));
 assert.equal(m.version,'props-learn-v1');
 assert.equal(m.fallback,false);
 assert.equal(m.artifact.modelVersion,'props-learn-v1');
 assert.equal(m.autoSwitchEnabled,false);
});

test('a hash mismatch or malformed artifact falls back to layer 1 and says so',async()=>{
 const control={active_model_version:'props-learn-v1',learning_enabled:true,auto_switch_enabled:true};
 const bad=await loadActiveModel(store({control,artifacts:[row('props-learn-v1',{sha256:'0'.repeat(64)})]}));
 assert.deepEqual([bad.version,bad.fallback,bad.artifact],[LAYER1_VERSION,true,null]);
 const broken=art('props-learn-v1');broken.weights.points=[0,1];
 const shape=await loadActiveModel(store({control,artifacts:[{version:'props-learn-v1',sha256:artifactSha256(broken),artifact:broken}]}));
 assert.deepEqual([shape.version,shape.fallback],[LAYER1_VERSION,true]);
 const missing=await loadActiveModel(store({control,artifacts:[]}));
 assert.deepEqual([missing.version,missing.fallback],[LAYER1_VERSION,true]);
});

test('shadows are versions whose latest event is shadow_start or eligible, newest first, at most 3, excluding the active one',async()=>{
 const versions=['props-learn-v1','props-learn-v2','props-learn-v3','props-learn-v4','props-learn-v5','props-learn-v6'];
 const events=[ev('props-learn-v1','shadow_start',1),ev('props-learn-v1','retired',2),ev('props-learn-v2','shadow_start',3),
  ev('props-learn-v3','shadow_start',4),ev('props-learn-v3','dropped',5),ev('props-learn-v4','shadow_start',6),ev('props-learn-v5','shadow_start',7),
  ev('props-learn-v6','shadow_start',8),ev('props-learn-v6','eligible',9)];
 const m=await loadActiveModel(store({artifacts:versions.map(v=>row(v)),events}));
 assert.deepEqual(m.shadows.map(s=>s.version),['props-learn-v6','props-learn-v5','props-learn-v4']);
});

test('a shadow with a bad hash is skipped, not used',async()=>{
 const m=await loadActiveModel(store({artifacts:[row('props-learn-v2',{sha256:'1'.repeat(64)})],events:[ev('props-learn-v2','shadow_start',1)]}));
 assert.deepEqual(m.shadows,[]);
});
