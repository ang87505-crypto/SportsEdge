// Pre-registered research challenger props-gap-shrink-v1: frozen rule, prospective-only scoring, never promotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gapShrink,evaluateGapChallenger} from './research.ts';

const spec=JSON.parse(readFileSync(new URL('../../data/props/challenger_gap_shrink_v1.json',import.meta.url),'utf8'));
const rule=spec.rule;

test('frozen spec: forward start after registration, same strict review gate as the registered calibration study',()=>{
 assert.equal(spec.version,'props-gap-shrink-v1');
 assert.ok(Date.parse(spec.forwardStartsAt)>Date.parse(spec.registeredAt));
 assert.deepEqual(rule,{noShrinkBelow:0.10,fullShrinkAt:0.30,minKeep:0.25});
 assert.equal(spec.reviewGate.minGradedLines,500);assert.equal(spec.reviewGate.minDates,14);
});
test('gap shrink: unchanged near the line, shrinks toward 50% as the model departs from it, ties preserved',()=>{
 const p={pMore:0.72,pLess:0.28,pTie:0};
 assert.deepEqual(gapShrink(p,10.5,10.5,rule),p);                       // no gap
 const near=gapShrink(p,11.4,10.5,rule);assert.ok(Math.abs(near.pMore-0.72)<1e-12); // 8.6% gap: unchanged
 const mid=gapShrink(p,12.6,10.5,rule);                                    // 20% gap: keep half the edge
 assert.ok(Math.abs(mid.pMore-0.61)<1e-9);
 const far=gapShrink(p,15,10.5,rule);                                      // 42.9% gap: floor at 25% of the edge
 assert.ok(Math.abs(far.pMore-(0.5+0.22*0.25))<1e-9);
 const tie=gapShrink({pMore:0.6,pLess:0.3,pTie:0.1},14,10,rule);
 assert.ok(Math.abs(tie.pTie-0.1)<1e-12&&Math.abs(tie.pMore+tie.pLess+tie.pTie-1)<1e-12);
 assert.throws(()=>gapShrink({pMore:NaN,pLess:0.5,pTie:0},10,10,rule));
});
test('scoring is prospective only: lines ingested before the forward start are excluded; no promotion, no profit claim',()=>{
 const obs=(id,ingested,line=10.5)=>({id,platform:'prizepicks',provider_event_id:'evt'+id,home_team:'H',away_team:'A',lock_at:'2026-11-13T00:10:00Z',
  player_name:'P'+id,stat:'points',line,provider_last_update:ingested,ingested_at:ingested,recorded_at:ingested});
 const pred=(id,mean)=>({id,observation_id:id,model_version:'props-nb-minutes-rate-v1',status:'scored',athlete_id:String(id),
  p_more:0.3,p_less:0.7,p_tie:0,data_cutoff:'2026-11-12T00:00:00Z',predicted_at:'2026-11-12T20:00:01Z',mean});
 const r={nowIso:'2026-11-13T12:00:00Z',windowStart:'2026-11-01T00:00:00Z',control:{state:'RUNNING',reason:''},
  observations:[obs(1,'2026-11-12T11:00:00Z'),{...obs(2,'2026-11-12T20:00:00Z')},{...obs(3,'2026-11-12T20:00:00Z')}],
  predictions:[pred(1,8),pred(2,8),pred(3,null)],picks:[],entryLegs:[],
  results:[1,2,3].map(id=>({observation_id:id,revision:1,outcome:'more',actual:12,graded_at:'2026-11-13T09:00:00Z'}))};
 const v=evaluateGapChallenger(r,spec);
 assert.equal(v.progress.preRegistration,1);
 assert.equal(v.baseline.n,2);assert.equal(v.progress.missingMean,1);
 assert.ok(v.candidate.brier<v.baseline.brier,'shrinking a confident wrong forecast lowers its Brier');
 assert.equal(v.status,'collecting');assert.equal(v.promotionEnabled,false);assert.equal(v.profitabilityDemonstrated,false);
});
