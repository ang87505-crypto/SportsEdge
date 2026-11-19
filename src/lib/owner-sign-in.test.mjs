import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerKeyInput,ownerSignInError} from './owner-sign-in.ts';
const key='0123456789abcdef'.repeat(4);
test('pasted owner keys keep all 64 characters while surrounding whitespace is ignored',()=>{
 assert.equal(ownerKeyInput('  '+key+'\r\n'),key);
 assert.equal(ownerKeyInput(key.toUpperCase()),key.toUpperCase());
 for(const value of ['',key.slice(1),key+'0',key.slice(0,32)+' '+key.slice(32),'normal-password'])
  assert.equal(ownerKeyInput(value),null);
});
test('feedback distinguishes a rejected key from deployment configuration and origin problems',()=>{
 assert.match(ownerSignInError(401),/does not match/);
 assert.match(ownerSignInError(503,'missing'),/missing/);
 assert.match(ownerSignInError(503,'malformed'),/64 hexadecimal/);
 assert.match(ownerSignInError(403),/origin check/);
 assert.match(ownerSignInError(500),/temporarily unavailable/);
 for(const status of [401,403,503,500])assert.ok(!ownerSignInError(status).includes('Preview'));
});
