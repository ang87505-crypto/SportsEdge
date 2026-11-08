// Learning worker: pure planning helpers and the safety-brake wiring. Synthetic TEST-ONLY data, fake store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nextVersion,retireVersions,trainDecision,forwardTrainingRows,evaluationRows,reviewLines,brakePicks,applySafetyBrake}
 from './props-learn-worker.ts';
import {FEATURES,MARKET_FEATURES} from '../props/learn.ts';

test('versions count up from the highest existing one',()=>{
 assert.equal(nextVersion([]),'props-learn-v1');
 assert.equal(nextVersion(['props-learn-v2','props-learn-v10','props-learn-v3']),'props-learn-v11');
});

test('only the newest three shadowing challengers are kept',()=>{
 const ev=(version,event,id)=>({id,version,event});
 const events=[ev('props-learn-v1','shadow_start',1),ev('props-learn-v2','shadow_start',2),ev('props-learn-v3','shadow_start',3),
  ev('props-learn-v3','eligible',4),ev('props-learn-v4','shadow_start',5),ev('props-learn-v5','shadow_start',6),ev('props-learn-v5','dropped',7)];
 assert.deepEqual(retireVersions(events,'props-nb-minutes-rate-v1'),['props-learn-v1']);
 assert.deepEqual(retireVersions(events,'props-learn-v4'),[]);
});

test('a challenger that is worse on held-out data is dropped',()=>{
 assert.equal(trainDecision(0.24,0.25),'shadow');
 assert.equal(trainDecision(0.25,0.25),'shadow');
 assert.equal(trainDecision(0.2501,0.25),'drop');
});

const P=(more,tie=0)=>({pMore:more,pLess:1-more-tie,pTie:tie});
const L1='props-nb-minutes-rate-v1';
function line(i,o={}){return {observationId:i,platform:'prizepicks',eventId:'evtTEST00000'+(i%3),playerName:'Player '+i,stat:'points',line:20.5,
 lockAt:'2026-11-08T00:00:00.000Z',ingestedAt:'2026-11-07T19:00:00.000Z',homeTeam:'Boston Celtics',awayTeam:'New York Knicks',date:'2026-11-07',
 key:'k'+i,outcome:'more',gradedAt:'2026-11-08T09:20:00.000Z',actualMinutes:30,athleteId:'9'+i,team:'BOS',
 predictions:{[L1]:{id:i,probs:P(0.66),inputs:{expMinutes:32}}},market:null,picks:[{selectionVersion:'props-select-v1',modelVersion:L1,status:'recorded',side:'more'}],...o};}

test('forward training rows: graded more/less only, market terms only with books, recency weights',()=>{
 const lines=[line(1),line(2,{outcome:'less',market:{booksAtSameLine:1,pMoreBooks:0.6,lineGap:0,nearestBookLine:20.5,flags:[]}}),
  line(3,{outcome:'tie'}),line(4,{outcome:'void'}),line(5,{outcome:null}),line(6,{predictions:{}}),line(7,{team:null})];
 const r=forwardTrainingRows(lines,[],'2026-11-08T12:00:00.000Z');
 assert.equal(r.rows.points.length,2);
 assert.deepEqual(r.counts.points,{forward:2,forwardWithBooks:1});
 const [a,b]=r.rows.points;
 assert.equal(a.y,1);assert.equal(b.y,0);
 assert.equal(a.x.length,FEATURES.length);
 assert.deepEqual(MARKET_FEATURES.map(k=>a.x[k]),[0,0,0]);
 assert.equal(b.x[3],1);
 assert.ok(a.w>0.99&&a.w<=1);
 const old=forwardTrainingRows([line(1,{lockAt:'2026-09-09T00:00:00.000Z',ingestedAt:'2026-09-08T19:00:00.000Z'})],[],'2026-11-08T00:00:00.000Z');
 assert.ok(Math.abs(old.rows.points[0].w-0.5)<0.01,'60 days old weighs half');
});

test('evaluation rows pair the active model with a challenger on the same graded lines, deduped later by key',()=>{
 const ch='props-learn-v2';
 const lines=[line(1,{predictions:{[L1]:{id:1,probs:P(0.6),inputs:{}},[ch]:{id:11,probs:P(0.7),inputs:{}}}}),
  line(2,{predictions:{[L1]:{id:2,probs:P(0.6),inputs:{}}}}),line(3,{outcome:'void',predictions:{[L1]:{id:3,probs:P(0.6),inputs:{}},[ch]:{id:13,probs:P(0.7),inputs:{}}}})];
 const rows=evaluationRows(lines,L1,ch);
 assert.equal(rows.length,1);
 assert.deepEqual([rows[0].key,rows[0].outcome,rows[0].baseline.pMore,rows[0].candidate.pMore,rows[0].eventId,rows[0].date],
  ['k1','more',0.6,0.7,'evtTEST000001','2026-11-07']);
});

test('review lines carry the active model, books, challengers, minutes and the recorded side',()=>{
 const ch='props-learn-v2';
 const lines=[line(1,{outcome:'less',actualMinutes:12,market:{booksAtSameLine:1,pMoreBooks:0.4,lineGap:0,nearestBookLine:20.5,flags:[]},
  predictions:{[L1]:{id:1,probs:P(0.66),inputs:{expMinutes:32}},[ch]:{id:11,probs:P(0.6),inputs:{matchup:{oppAllowedRatio:0.9}}}}}),line(2,{outcome:null})];
 const r=reviewLines(lines,L1,'props-select-v1');
 assert.equal(r.length,1);
 assert.deepEqual([r[0].recorded,r[0].side,r[0].books,r[0].expMinutes,r[0].actualMinutes,r[0].oppAllowedRatio,Object.keys(r[0].challengers)],
  [true,'more',0.4,32,12,0.9,[ch]]);
});

test('brake picks are the active model\'s graded recorded picks',()=>{
 const lines=[line(1),line(2,{outcome:'less'}),line(3,{outcome:'void'}),line(4,{picks:[{selectionVersion:'props-select-v1',modelVersion:L1,status:'skipped',side:null}]})];
 assert.deepEqual(brakePicks(lines,L1,'props-select-v1').map(p=>[p.key,p.correct]),[['k1',true],['k2',false]]);
});

test('the brake pauses a RUNNING control once and never touches a stopped one',async()=>{
 const calls=[];const store={rpc:async(fn,p)=>{calls.push({fn,p});return {};}};
 const losing=Array.from({length:50},(_,i)=>({key:'k'+i,correct:i<20,gradedAt:new Date(Date.UTC(2026,10,1)+i*3600_000).toISOString()}));
 const r=await applySafetyBrake(store,losing,'RUNNING');
 assert.equal(r.trip,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].fn,'props_set_control');
 assert.equal(calls[0].p.p_state,'PAUSED');
 assert.equal(calls[0].p.p_actor,'system:safety-brake');
 assert.match(calls[0].p.p_reason,/^SAFETY_BRAKE: last 50 picks hit 40\.0%/);
 assert.equal((await applySafetyBrake(store,losing,'STOPPED')).trip,false);
 assert.equal(calls.length,1);
});
