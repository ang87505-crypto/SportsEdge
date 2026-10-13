import test from 'node:test';
import assert from 'node:assert/strict';
import {isResearchSnapshot} from '../dashboard-snapshot.ts';

test('valid saved paper snapshot is accepted',()=>{
 assert.equal(isResearchSnapshot({predictions:[],paper:{pending_bets:3,settled_bets:2,win_rate:0.5}}),true);
 assert.equal(isResearchSnapshot({predictions:[{}],paper:{pending_bets:0,settled_bets:0,win_rate:null}}),true);
});
test('failed or malformed backend responses never qualify as account data',()=>{
 for(const value of [null,undefined,{},[],{status:'unavailable'},{predictions:[],paper:null},{predictions:[],paper:{}},{predictions:[],paper:{pending_bets:'3',settled_bets:0,win_rate:null}},{predictions:[],paper:{pending_bets:-1,settled_bets:1,win_rate:1}},{predictions:[],paper:{pending_bets:0,settled_bets:NaN,win_rate:null}},{predictions:[],paper:{pending_bets:0,settled_bets:0,win_rate:Infinity}},{predictions:[],paper:{pending_bets:0,settled_bets:0,win_rate:1.5}}]){
  assert.equal(isResearchSnapshot(value),false,JSON.stringify(value));
 }
});
