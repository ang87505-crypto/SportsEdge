import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistantRequestGate} from './request-gate.ts';

test('rapid double submit is a single active request',()=>{
 const g=new AssistantRequestGate();
 const first=g.start();
 assert.equal(first,1);
 assert.equal(g.start(),null);
 assert.equal(g.isCurrent(first),true);
 assert.equal(g.finish(first),true);
 assert.equal(g.start(),2);
});
test('reset drops a late server response and accepts a fresh question',()=>{
 const g=new AssistantRequestGate(),first=g.start();
 g.invalidate();
 assert.equal(g.isCurrent(first),false);
 assert.equal(g.finish(first),false);
 const second=g.start();
 assert.ok(second>first);
 assert.equal(g.isCurrent(second),true);
 assert.equal(g.finish(second),true);
});
test('logout invalidates pending private reply so a later response cannot display',()=>{
 const g=new AssistantRequestGate(),privateRequest=g.start();
 g.invalidate();
 assert.equal(g.isCurrent(privateRequest),false);
 assert.equal(g.finish(privateRequest),false);
 assert.ok(g.start()>privateRequest);
});
test('old failure cannot clear busy state of a subsequent question',()=>{
 const g=new AssistantRequestGate(),old=g.start();
 g.invalidate();
 const current=g.start();
 assert.equal(g.finish(old),false);
 assert.equal(g.start(),null);
 assert.equal(g.finish(current),true);
 assert.notEqual(g.start(),null);
});
test('invalid, forged and duplicate completion identifiers do not mutate gate',()=>{
 const g=new AssistantRequestGate();
 const id=g.start();
 for(const bogus of [NaN,-1,0,1.5,Infinity,id+1])assert.equal(g.finish(bogus),false);
 assert.equal(g.isCurrent(id),true);
 assert.equal(g.finish(id),true);
 assert.equal(g.finish(id),false);
});
