import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMiss,weeklyReview,MINUTES_COLLAPSE,MATCHUP_SD} from './review.ts';

const miss={expMinutes:32,actualMinutes:31,side:'more',outcome:'less',booksSide:null,oppAllowedRatio:1,overconfidentBand:false,stat:'points'};

test('constants',()=>{assert.equal(MINUTES_COLLAPSE,0.6);assert.equal(MATCHUP_SD,0.08);});

test('each cause, in precedence order',()=>{
 assert.equal(classifyMiss({...miss,actualMinutes:15}),'minutes_collapse');
 assert.equal(classifyMiss({...miss,booksSide:'less'}),'books_were_right');
 assert.equal(classifyMiss({...miss,oppAllowedRatio:0.9}),'matchup');
 assert.equal(classifyMiss({...miss,side:'less',outcome:'more',oppAllowedRatio:1.1}),'matchup');
 assert.equal(classifyMiss({...miss,overconfidentBand:true}),'overconfidence');
 assert.equal(classifyMiss(miss),'other');
 // A minutes collapse wins even when the books were also right.
 assert.equal(classifyMiss({...miss,actualMinutes:15,booksSide:'less',oppAllowedRatio:0.8}),'minutes_collapse');
 // Books agreeing with the pick are not "books were right".
 assert.equal(classifyMiss({...miss,booksSide:'more'}),'other');
});

const P=(more)=>({pMore:more,pLess:1-more,pTie:0});
function line(i,o={}){return {key:'k'+i,eventId:'g'+(i%5),date:'2026-11-10',stat:'points',outcome:'more',layer1:P(0.62),active:P(0.66),
 books:0.55,challengers:{'props-learn-v2':P(0.6)},recorded:true,side:'more',expMinutes:30,actualMinutes:30,oppAllowedRatio:1,...o};}

test('weekly review counts misses by cause, excludes voids, and scores each layer',()=>{
 const lines=[
  ...Array.from({length:6},(_,i)=>line(i)),                                    // hits
  line(10,{outcome:'less',actualMinutes:10}),                                   // minutes collapse
  line(11,{outcome:'less',books:0.4}),                                          // books were right
  line(12,{outcome:'void'}),line(13,{outcome:'void',recorded:false,side:null}), // voids
  line(14,{outcome:'less',date:'2026-10-01'}),                                  // outside the period
 ];
 const r=weeklyReview(lines,{from:'2026-11-09',to:'2026-11-15'});
 assert.deepEqual(r.misses,{minutes_collapse:1,books_were_right:1,matchup:0,overconfidence:0,other:0});
 assert.equal(r.voidsExcluded,1);
 assert.equal(r.scorecards.active.n,8);
 assert.equal(r.scorecards.layer1.n,8);
 assert.equal(r.scorecards.books.n,8);
 assert.equal(r.scorecards.challengers['props-learn-v2'].n,8);
 assert.deepEqual(r.period,{from:'2026-11-09',to:'2026-11-15'});
});

test('an overconfident band is flagged and its misses charged to it',()=>{
 // 40 picks at 75% that hit only 50%: more than 2 standard errors below.
 const lines=Array.from({length:40},(_,i)=>line(i,{active:P(0.75),outcome:i%2?'more':'less'}));
 const r=weeklyReview(lines,{from:'2026-11-09',to:'2026-11-15'});
 assert.deepEqual(r.overconfidentBands,['0.70-0.80']);
 assert.equal(r.misses.overconfidence,20);
 assert.equal(weeklyReview(lines.slice(0,10),{from:'2026-11-09',to:'2026-11-15'}).overconfidentBands.length,0);
});

test('no book data gives no books scorecard',()=>{
 const r=weeklyReview([line(1,{books:null})],{from:'2026-11-09',to:'2026-11-15'});
 assert.equal(r.scorecards.books,null);
});
