import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCollectionChoice,collectionTracks,validateCollectionTracks,describeCollection} from './collection-policy.ts';
test('default collection plan keeps existing two tracks',()=>{
 assert.deepEqual(collectionTracks(parseCollectionChoice(null)),['nba','soccer']);
 assert.equal(describeCollection('both').providerRequestsPlanned,2);
});
test('NBA-only and soccer-only plans avoid unnecessary provider requests',()=>{
 for(const choice of ['nba','soccer']){
  const plan=describeCollection(choice);
  assert.deepEqual(plan.tracks,[choice]);
  assert.equal(plan.providerRequestsPlanned,1);
  assert.equal(plan.providerCreditsUnknown,true);
 }
});
test('invalid choices reject without selecting a provider',()=>{
 for(const value of ['NFL','', 'BOTH', 'all', 'nfl', 'nba,soccer', 'both&collect=1'])
  assert.throws(()=>parseCollectionChoice(value));
});
test('runtime validation rejects duplicate, empty or unsupported collection arrays',()=>{
 for(const values of [[],['nba','nba'],['nfl'],['nba','soccer','nfl'],[null]])
  assert.throws(()=>validateCollectionTracks(values));
 assert.deepEqual(validateCollectionTracks(['soccer','nba']),['soccer','nba']);
});
test('a plan explicitly refuses to estimate actual provider credit cost',()=>{
 const plan=describeCollection('nba');
 assert.equal(plan.providerCreditsUnknown,true);
 assert.match(plan.note,/not the billable credits/);
});
