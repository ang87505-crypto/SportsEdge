import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateChallenger,REVIEW_GATE} from './promotion.ts';

// Synthetic TEST-ONLY evaluation rows. 70% of lines go over; the candidate says 70% More, the baseline 50%.
function rows({lines=600,games=60,dates=20,candidate=()=>({pMore:0.7,pLess:0.3,pTie:0}),over=i=>Math.floor(i/games)%10<7}={}){
 return Array.from({length:lines},(_,i)=>({key:'k'+i,eventId:'g'+(i%games),date:`2026-11-${String(1+(i%games)%dates).padStart(2,'0')}`,
  stat:'points',baseline:{pMore:0.5,pLess:0.5,pTie:0},candidate:candidate(i),outcome:over(i)?'more':'less'}));
}

test('the gate is the registered one',()=>{
 assert.deepEqual(REVIEW_GATE,{minGradedLines:500,minDates:14,minGames:50,minCandidateDecisions:100,maxBrierDifferenceUpper95:-0.002,
  bootstrapReplicates:1000,bootstrapSeed:20261108,requireNoWorseLogLoss:true});
 const registered=JSON.parse(readFileSync(new URL('../../data/props/research_v2.json',import.meta.url),'utf8')).reviewGate;
 assert.deepEqual(REVIEW_GATE,registered);
});

test('a clearly better challenger meeting every count is eligible',()=>{
 const r=evaluateChallenger(rows(),REVIEW_GATE);
 assert.deepEqual(r.failed,[]);
 assert.equal(r.eligible,true);
 assert.deepEqual([r.dates,r.games],[20,60]);
 assert.ok(r.interval.upper95<-0.002);
});

test('each broken threshold is named',()=>{
 assert.ok(evaluateChallenger(rows({lines:400}),REVIEW_GATE).failed.includes('min_lines'));
 assert.ok(evaluateChallenger(rows({dates:10}),REVIEW_GATE).failed.includes('min_dates'));
 assert.ok(evaluateChallenger(rows({games:40}),REVIEW_GATE).failed.includes('min_games'));
 assert.ok(evaluateChallenger(rows({candidate:()=>({pMore:0.85,pLess:0.15,pTie:0})}),REVIEW_GATE).failed.includes('min_decisions'));
 assert.ok(evaluateChallenger(rows({candidate:()=>({pMore:0.5,pLess:0.5,pTie:0})}),REVIEW_GATE).failed.includes('brier_interval'));
 // Near-certain and wrong 4% of the time: better Brier, much worse log loss.
 const r=evaluateChallenger(rows({candidate:()=>({pMore:1,pLess:0,pTie:0}),over:i=>i%25!==0}),REVIEW_GATE);
 assert.ok(r.failed.includes('log_loss'));
 assert.equal(r.eligible,false);
});

test('the same line on two platforms counts once',()=>{
 const base=rows({lines:300});
 const r=evaluateChallenger([...base,...base.map(x=>({...x}))],REVIEW_GATE);
 assert.equal(r.candidate.n,300);
 assert.ok(r.failed.includes('min_lines'));
});
