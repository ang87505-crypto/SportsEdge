import test from 'node:test';
import assert from 'node:assert/strict';
import {storedOddsAvailable,parseOwnerStatus} from '../connection-readiness.ts';
test('stored odds reachability is not equated with fresh executable prices',()=>{
 assert.equal(storedOddsAvailable({status:'stored',games:[]}),true);
 for(const x of [null,{}, {status:'unavailable',games:[]},{status:'stored',games:null},{status:'stored'}]) assert.equal(storedOddsAvailable(x),false);
});
test('owner control check rejects malformed or partial API responses',()=>{
 const good={configured:true,owner:false,enabled:false,stocksReady:false};
 assert.deepEqual(parseOwnerStatus(good),good);
 for(const x of [{},{owner:true},{...good,enabled:'false'},{...good,stocksReady:null},null])assert.equal(parseOwnerStatus(x),null);
});
