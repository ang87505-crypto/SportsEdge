import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerHintPresent,OWNER_HINT_COOKIE} from './owner-hint.ts';

test('owner hint is recognised only when set, and never stands in for the session',()=>{
 assert.equal(ownerHintPresent(''),false);
 assert.equal(ownerHintPresent(null),false);
 assert.equal(ownerHintPresent('a=1; b=2'),false);
 assert.equal(ownerHintPresent(`a=1; ${OWNER_HINT_COOKIE}=1`),true);
 assert.equal(ownerHintPresent(`${OWNER_HINT_COOKIE}=`),false);
 assert.ok(OWNER_HINT_COOKIE.startsWith('__Host-'));
});
