import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activePolicy,creditUse,entryCapBreaches,duplicates,verdict,missingRelation,missingColumn} from './props-activation-preflight-lib.mjs';

const T=s=>Date.parse(s);
test('the preflight script can only issue GET requests and never calls an RPC or the Odds API',()=>{
 const src=readFileSync(new URL('./props-activation-preflight.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/method:'(POST|PATCH|PUT|DELETE)'[^\n]*rest\/v1/);
 assert.doesNotMatch(src,/rest\/v1\/rpc|the-odds-api|ODDS_API_KEY/);
 const restCalls=[...src.matchAll(/fetch\(`https:\/\/\$\{host\}\/rest\/v1/g)].length;
 assert.equal(restCalls,1,'one REST call site, the GET helper');
 assert.match(src,/method:'GET'/);
});
test('active policy is the latest row already in force',()=>{
 const rows=[{version:'v1',active_from:'2026-11-01T00:00:00Z'},{version:'v2',active_from:'2026-11-07T00:00:00Z'},{version:'v3',active_from:'2026-12-01T00:00:00Z'}];
 assert.equal(activePolicy(rows,T('2026-11-12T00:00:00Z')).version,'v2');
 assert.equal(activePolicy(rows,T('2026-10-01T00:00:00Z')),null);
});
test('credit use: reservations in full unless actuals are counted; unknown charges stay in full; worst window found',()=>{
 const now=T('2026-11-12T00:00:00Z');
 const rows=[{id:1,credits:1,reserved_at:'2026-11-11T20:11:00Z'},{id:2,credits:3,reserved_at:'2026-11-11T20:11:05Z'},{id:3,credits:3,reserved_at:'2026-11-11T20:11:10Z'},
  {id:4,credits:1,reserved_at:'2026-11-09T19:00:00Z'},{id:5,credits:3,reserved_at:'2026-11-09T19:00:10Z'}];
 const charged=new Map([[1,0],[2,3]]);
 const full=creditUse(rows,charged,false,now);
 assert.deepEqual([full.used24h,full.used30d,full.worstRolling24h],[7,11,7]);
 const actual=creditUse(rows,charged,true,now);
 assert.deepEqual([actual.used24h,actual.used30d],[6,10]); // id 3 has no receipt: counted in full
 assert.equal(actual.unknownCharges,3);
});
test('entry caps by New York day, duplicates, missing-relation codes',()=>{
 const accounts=[{id:1,max_entries_per_day:3}];
 const e=d=>({account_id:1,created_at:d});
 assert.deepEqual(entryCapBreaches([e('2026-11-11T15:00Z'),e('2026-11-11T16:00Z'),e('2026-11-11T17:00Z')],accounts),[]);
 // 03:00 UTC on the 12th is still the 11th in New York: four entries that day breach a cap of three.
 assert.equal(entryCapBreaches([e('2026-11-11T15:00Z'),e('2026-11-11T16:00Z'),e('2026-11-11T17:00Z'),e('2026-11-12T03:00Z')],accounts).length,1);
 assert.deepEqual(duplicates([{k:'a'},{k:'b'},{k:'a'}],r=>r.k),[{key:'a',count:2}]);
 assert.ok(missingRelation('PGRST205')&&missingRelation('42P01')&&!missingRelation('42501'));
 assert.ok(missingColumn('42703')&&!missingColumn('PGRST205'));
});
test('verdict: schema states and limit checks; a different limit is a FAIL, not a pass',()=>{
 const base={project:'vfyzbliksooljxrlfadp',nowMs:T('2026-11-12T00:00:00Z'),activePolicy:{version:'props-budget-v2',daily_credits:7,monthly_credits:200,provider_floor:60},
  credits:{worstRolling24h:7},providerRemaining:400,duplicateRuns:[],entryCapBreaches:[],lastCompletedSettleAt:'2026-11-11T16:29:00Z',
  captureTables:{props_capture_plans:'MISSING',props_captures:'MISSING',props_capture_outcomes:'MISSING'},v3Column:'MISSING'};
 const v=Object.fromEntries(verdict(base).map(x=>[x.id,x.state]));
 assert.deepEqual(v,{target:'PASS',limits:'PASS','cap-held':'PASS','provider-floor':'PASS','no-duplicate-runs':'PASS','entry-caps-held':'PASS',
  'settlement-running':'PASS','capture-schema':'NOT_APPLIED','v3-accounting':'NOT_APPLIED'});
 const raised=Object.fromEntries(verdict({...base,activePolicy:{...base.activePolicy,daily_credits:13},credits:{worstRolling24h:8}}).map(x=>[x.id,x.state]));
 assert.equal(raised.limits,'FAIL');assert.equal(raised['cap-held'],'FAIL');
 const partial=Object.fromEntries(verdict({...base,captureTables:{props_capture_plans:'PRESENT',props_captures:'MISSING',props_capture_outcomes:'MISSING'}}).map(x=>[x.id,x.state]));
 assert.equal(partial['capture-schema'],'UNKNOWN');
 assert.equal(Object.fromEntries(verdict({...base,project:'other'}).map(x=>[x.id,x.state])).target,'FAIL');
});
