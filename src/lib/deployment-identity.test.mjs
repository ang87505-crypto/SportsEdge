import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentIdentity,compareDeployment} from './deployment-identity.ts';

const A='a'.repeat(40),B='b'.repeat(40);
test('identity exposes only validated public Git fields, never other environment values',()=>{
 const id=deploymentIdentity({VERCEL_GIT_COMMIT_SHA:A,VERCEL_GIT_COMMIT_REF:'main',VERCEL_ENV:'production',CRON_SECRET:'s3cret',SUPABASE_SERVICE_ROLE_KEY:'k'});
 assert.deepEqual(id,{schemaVersion:'deployment-identity-v1',commitSha:A,commitRef:'main',environment:'production'});
 assert.doesNotMatch(JSON.stringify(id),/s3cret|"k"/);
 assert.deepEqual(deploymentIdentity({VERCEL_GIT_COMMIT_SHA:'nope',VERCEL_GIT_COMMIT_REF:'a b',VERCEL_ENV:'x'}),
  {schemaVersion:'deployment-identity-v1',commitSha:null,commitRef:null,environment:null});
});
test('deployment comparison: match, rolling out, behind, wrong branch, unknown',()=>{
 const now=Date.parse('2026-11-12T01:00:00Z');
 const prod={schemaVersion:'deployment-identity-v1',commitSha:A,commitRef:'main',environment:'production'};
 assert.equal(compareDeployment(prod,{sha:A,committedAt:'2026-11-11T00:00:00Z'},now).state,'MATCHES_MAIN');
 assert.equal(compareDeployment(prod,{sha:B,committedAt:'2026-11-12T00:40:00Z'},now).state,'DEPLOYING');
 assert.equal(compareDeployment(prod,{sha:B,committedAt:'2026-11-11T20:00:00Z'},now).state,'BEHIND_MAIN');
 assert.equal(compareDeployment({...prod,commitRef:'ops-status'},{sha:A,committedAt:'2026-11-11T00:00:00Z'},now).state,'WRONG_BRANCH');
 assert.equal(compareDeployment(null,{sha:A,committedAt:'2026-11-11T00:00:00Z'},now).state,'UNKNOWN');
});
