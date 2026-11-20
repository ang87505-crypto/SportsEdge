import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardStudyReadiness,FORWARD_TABLES} from './forward-study-readiness.ts';
import {PropsStoreError} from './props-store.ts';
test('schema checks require every lab and penny contract; missing and inaccessible are distinct',async()=>{
 const calls=[];const store={async select(t,q){calls.push([t,q]);return [];}};
 assert.equal((await forwardStudyReadiness(store)).state,'READY');assert.equal(calls.length,Object.values(FORWARD_TABLES).reduce((n,t)=>n+Object.keys(t).length,0));
 const missing=await forwardStudyReadiness({async select(t){if(t==='props_lab_predictions')throw new PropsStoreError('DB_42P01',true);return [];}});
 assert.equal(missing.state,'NOT_MIGRATED');
 const bad=await forwardStudyReadiness({async select(){throw new PropsStoreError('STORE_HTTP_401',true);}});assert.equal(bad.state,'UNAVAILABLE');
});
