import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trackProductionShadows} from './production-shadows.ts';
import {FEATURES,artifactSha256} from '../../props/learn.ts';
import {MODEL_VERSION,STATS} from '../../props/contract.ts';
import {pair} from './forward.ts';

const now='2026-11-19T17:00:00Z';
const seed=()=>JSON.parse(readFileSync(new URL('../../../../research/engine/registry.json',import.meta.url),'utf8'));
function artifact(){
 const a={modelVersion:'props-learn-v999',baseModelVersion:MODEL_VERSION,trainedAt:'2026-11-18T10:00:00Z',dataCutoff:'2026-11-17T00:00:00Z',
  features:[...FEATURES],weights:Object.fromEntries(STATS.map(s=>[s,FEATURES.map(()=>0)])),counts:{}};
 return {version:a.modelVersion,sha256:artifactSha256(a),artifact:a,created_at:'2026-11-18T10:01:00Z'};
}
test('new verified production shadows are tracked once under the existing gate without creating a model',()=>{
 const row=artifact(),a=trackProductionShadows(seed(),[row],now);
 assert.deepEqual(a.added,['props-learn-v999-shadow']);const e=a.registry.experiments.at(-1);
 assert.equal(e.baseline,MODEL_VERSION);assert.equal(e.sampleRequirements.minObservations,500);assert.equal(e.forward.notBefore,row.created_at);
 const b=trackProductionShadows(a.registry,[row],now);assert.deepEqual(b.added,[]);assert.deepEqual(b.registry,a.registry);
 const rejected=structuredClone(a.registry);rejected.experiments.at(-1).status='REJECTED';
 assert.deepEqual(trackProductionShadows(rejected,[row],now).registry,rejected);
});
test('tampered or future artifacts cannot become an experiment, and forecasts predating registration are excluded',()=>{
 const a=artifact();
 for(const row of [{...a,sha256:'0'.repeat(64)},{...a,created_at:'2027-01-01T00:00:00Z'}])assert.deepEqual(trackProductionShadows(seed(),[row],now).added,[]);
 const e=trackProductionShadows(seed(),[a],now).registry.experiments.at(-1);
 const p={key:'SYNTHETIC',eventId:'SYNTHETIC',date:'2026-11-18',stat:'points',predictedAt:'2026-11-18T10:00:00Z',recordedAt:'2026-11-18T09:59:00Z',dataCutoff:'2026-11-17T00:00:00Z',lockAt:'2026-11-18T23:00:00Z',p:{pMore:0.6,pLess:0.4,pTie:0}};
 const r=pair(e.forward,[{...p,model:a.version},{...p,model:MODEL_VERSION}],[{key:p.key,outcome:'more',gradedAt:'2026-11-19T02:00:00Z'}],now);
 assert.equal(r.rows.length,0);
});
