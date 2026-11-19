import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {regrade,legOf,auditEntry,accountingIdentity} from './props-ledger-verify-lib.mjs';
import {settleEntry} from '../src/lib/props/rules.ts';

test('the ledger audit can only GET and never calls an RPC or the Odds API',()=>{
 const src=readFileSync(new URL('./props-ledger-verify.mjs',import.meta.url),'utf8');
 assert.match(src,/method:'GET'/);
 assert.doesNotMatch(src,/method:'(POST|PATCH|PUT|DELETE)'|rest\/v1\/rpc|the-odds-api|ODDS_API_KEY/);
 assert.equal([...src.matchAll(/fetch\(/g)].length,1);
});
test('re-grade uses only the box score: more/less/tie, DNP and postponed void, missing evidence stays ungraded',()=>{
 const o={stat:'rebounds',line:11.5};
 assert.deepEqual(regrade(o,{game_status:'final',did_not_play:false,rebounds:12}),{state:'graded',outcome:'more',actual:12});
 assert.deepEqual(regrade(o,{game_status:'final',did_not_play:false,rebounds:9}),{state:'graded',outcome:'less',actual:9});
 assert.deepEqual(regrade({stat:'points',line:20},{game_status:'final',did_not_play:false,points:20}),{state:'graded',outcome:'tie',actual:20});
 assert.equal(regrade(o,{game_status:'final',did_not_play:true}).outcome,'void_dnp');
 assert.equal(regrade(o,{game_status:'postponed',did_not_play:false}).outcome,'void_postponed');
 assert.deepEqual(regrade(o,null),{state:'NO_BOX_SCORE'});
 assert.equal(legOf('less','less'),'win');assert.equal(legOf('more','less'),'loss');assert.equal(legOf('more','tie'),'void');
});
test('entry audit: verified, pending, wrong stored grade, wrong payout, pick after lock',()=>{
 const leg=(id,side,outcome,actual,stored=outcome)=>({pickId:id,side,pickDecidedAt:'2026-11-11T20:12:00Z',lockAt:'2026-11-12T00:00:00Z',
  stored:{outcome:stored,actual},regrade:{state:'graded',outcome,actual}});
 const e={stake_cents:500,platform:'prizepicks',created_at:'2026-11-11T20:12:30Z',lock_at:'2026-11-12T00:00:00Z'};
 const won={outcome:'won',profit_cents:1000};
 assert.equal(auditEntry({...e,settlement:won},[leg(1,'more','more',12),leg(2,'less','less',3)],settleEntry).state,'VERIFIED');
 assert.equal(auditEntry({...e,settlement:null},[leg(1,'more','more',12),{pickId:2,side:'less',regrade:{state:'NO_BOX_SCORE'}}],settleEntry).state,'PENDING_RESULTS');
 const bad=auditEntry({...e,settlement:won},[leg(1,'more','more',12,'less'),leg(2,'less','less',3)],settleEntry);
 assert.equal(bad.state,'MISMATCH');assert.match(bad.problems[0],/stored less vs box score more/);
 const pay=auditEntry({...e,settlement:{outcome:'won',profit_cents:500}},[leg(1,'more','more',12),leg(2,'less','less',3)],settleEntry);
 assert.match(pay.problems.join(),/profit 500 vs recomputed 1000/);
 const late=auditEntry({...e,settlement:won},[{...leg(1,'more','more',12),pickDecidedAt:'2026-11-12T00:01:00Z'},leg(2,'less','less',3)],settleEntry);
 assert.match(late.problems.join(),/decided after lock/);
 assert.equal(auditEntry({...e,settlement:{outcome:'lost',profit_cents:-500}},[leg(1,'more','less',8),leg(2,'less','less',3)],settleEntry).state,'VERIFIED');
});

test('accounting identity: 3 won / 6 lost $5 Power Play nets exactly $0.00; Pick6 unknowns stay out of profit and ROI',()=>{
 const won=settleEntry('prizepicks',500,['win','win']),lost=settleEntry('prizepicks',500,['win','loss']);
 assert.equal(won.profitCents,1000);assert.equal(lost.profitCents,-500);
 const rows=[...Array(3)].map((_,i)=>({entry_id:i+1,stake_cents:500,outcome:'won',profit_cents:won.profitCents}))
  .concat([...Array(6)].map((_,i)=>({entry_id:10+i,stake_cents:500,outcome:'lost',profit_cents:lost.profitCents})));
 const x=accountingIdentity(rows);
 assert.equal(x.profitCents,0);assert.equal(x.stakedKnownCents,4500);assert.equal(x.identityHolds,true);assert.deepEqual(x.problems,[]);
 assert.deepEqual(x.terms,[{outcome:'lost',count:6,profitCents:-500},{outcome:'won',count:3,profitCents:1000}]);
 const p6=accountingIdentity([{entry_id:13,stake_cents:500,outcome:'payout_unknown',profit_cents:null}]);
 assert.equal(p6.profitCents,0);assert.equal(p6.stakedKnownCents,0);assert.equal(p6.stakedUnknownCents,500);assert.equal(p6.unknownPayout,1);
});
test('accounting identity flags impossible rows instead of hiding them',()=>{
 const x=accountingIdentity([{entry_id:1,stake_cents:500,outcome:'lost',profit_cents:0},{entry_id:2,stake_cents:500,outcome:'won',profit_cents:null},
  {entry_id:3,stake_cents:500,outcome:'won',profit_cents:-500}]);
 assert.equal(x.problems.length,3);
});
