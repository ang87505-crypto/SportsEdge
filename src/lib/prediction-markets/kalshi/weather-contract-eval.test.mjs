import test from 'node:test';
import assert from 'node:assert/strict';
import {independentLadder,walkForwardContractEvaluation,weatherEvidenceBlockers} from './weather-contract-eval.ts';
import {validateStrikePartition} from './contract-math.ts';

const DAY=86_400_000;
const iso=(t)=>new Date(t).toISOString();
/** Deterministic synthetic fixture, NOT evidence: residual cycles through -3..3. */
function rows(n,residual=(i)=>((i*3)%7)-3,start=Date.UTC(2026,0,1)){
 return Array.from({length:n},(_,i)=>{
  const d=start+i*DAY,localDate=iso(d).slice(0,10),f=50+(i%11);
  return {localDate,forecastHighF:f,observedHighF:f+residual(i),
   forecastAvailableAt:iso(d-DAY+8.5*3600_000),observedAvailableAt:iso(d+DAY+12*3600_000),
   forecastSource:'NWS',observationSource:'NWS_CLI_PRELIMINARY_CENTRAL_PARK'};
 });
}

test('independent ladder mirrors Kalshi structure (2 tails + four 2°F bins) without Kalshi listings',()=>{
 const l=independentLadder(61);
 assert.equal(l.length,6);
 assert.deepEqual(validateStrikePartition(l),[{minF:null,maxF:56},{minF:57,maxF:58},{minF:59,maxF:60},
  {minF:61,maxF:62},{minF:63,maxF:64},{minF:65,maxF:null}]);
});

test('no holdout days -> explicit blocked status, not a score',()=>{
 const r=walkForwardContractEvaluation(rows(20));
 assert.equal(r.status,'BLOCKED_INSUFFICIENT_HISTORY');
 assert.equal(r.holdoutDays,0);
 assert.equal(r.models.challenger.meanEventBrier,null);
 assert.equal(r.promotionEligible,false);
});

test('walk-forward never trains on outcomes unavailable at the forecast time',()=>{
 const r=walkForwardContractEvaluation(rows(45));
 // Day i is scored only once 30 earlier outcomes were published before its capture:
 // outcome of day j is published at j+1 12:00Z, capture of day i at i-1 08:30Z -> j <= i-3.
 assert.equal(r.rows[0].trainDays,30);
 assert.equal(r.rows[0].date,rows(45)[32].localDate);
 assert.equal(r.holdoutDays,13);
 for(const row of r.rows){
  assert.equal(row.challenger.reduce((a,b)=>a+b,0),1_000_000);
  assert.equal(row.climatology.reduce((a,b)=>a+b,0),1_000_000);
  assert.equal(row.outcomeBin>=0&&row.outcomeBin<6,true);
 }
 assert.equal(r.status,'INSUFFICIENT_EVIDENCE');
 assert.equal(r.promotionEligible,false);
});

test('scores are reproducible and the challenger is measured against both baselines',()=>{
 const a=walkForwardContractEvaluation(rows(120)),b=walkForwardContractEvaluation(rows(120));
 assert.deepEqual(a,b);
 assert.equal(a.status,'RESEARCH_ONLY_NOT_PROVEN');
 for(const k of ['challenger','climatology','v0PerBin']){
  const m=a.models[k];
  assert.ok(m.meanContractBrier>0&&m.meanContractBrier<1,k);
  assert.ok(m.meanLogLoss>0,k);
 }
 // v0 issues independent per-bin probabilities, which need not sum to one.
 assert.ok(a.models.v0PerBin.meanAbsCoherenceGapPpm>0);
 assert.equal(a.models.challenger.meanAbsCoherenceGapPpm,0);
 // With a stable synthetic error distribution, forecast-anchored models beat climatology.
 assert.ok(a.models.challenger.meanEventBrier<a.models.climatology.meanEventBrier);
 assert.ok(a.paired.challengerVsClimatology.meanEventBrierDelta<0);
 assert.equal(a.reliability.length,5);
 assert.equal(a.reliability.reduce((s,b)=>s+b.n,0),a.holdoutDays*6);
 assert.ok(a.intervalCoverage80>=0&&a.intervalCoverage80<=1);
 // Research output never promotes on its own.
 assert.equal(a.promotionEligible,false);
});

test('blocker report names missing outcomes, gaps, pending days and the 30-pair shortfall',()=>{
 const b=weatherEvidenceBlockers({
  asOf:'2026-11-20T19:00:00Z',
  forecastDates:['2026-11-15','2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21'],
  outcomeDates:['2026-11-18','2026-11-19'],
 });
 assert.deepEqual(b.pairedDays,['2026-11-18','2026-11-19']);
 assert.deepEqual(b.missingOutcomesPastLatestEndpoint,['2026-11-15','2026-11-16','2026-11-17']);
 assert.deepEqual(b.outcomesPending,['2026-11-20','2026-11-21']);
 assert.deepEqual(b.missingForecasts,[]);
 assert.equal(b.trainingShortfall,28);
 // 28 more pairs, earliest from 11-20; the 30th outcome is fetched on 12-18. Observed runs fetch
 // outcomes after that morning's forecast capture, so the first model forecast is captured 12-19.
 assert.equal(b.earliestThirtiethPairTargetDate,'2026-12-17');
 assert.equal(b.earliestFirstModelForecastCaptureDate,'2026-12-19');
 const reordered=weatherEvidenceBlockers({asOf:'2026-11-20T19:00:00Z',forecastDates:['2026-11-18','2026-11-19','2026-11-20'],
  outcomeDates:['2026-11-18','2026-11-19'],outcomeFetchedBeforeSameDayCapture:true});
 assert.equal(reordered.earliestFirstModelForecastCaptureDate,'2026-12-18');
 assert.ok(b.codes.includes('INSUFFICIENT_TRAINING_PAIRS'));
 assert.ok(b.codes.includes('OUTCOMES_MISSED_BY_COLLECTOR'));
 const gap=weatherEvidenceBlockers({asOf:'2026-11-20T19:00:00Z',forecastDates:['2026-11-15','2026-11-18'],outcomeDates:[]});
 assert.deepEqual(gap.missingForecasts,['2026-11-16','2026-11-17']);
 assert.throws(()=>weatherEvidenceBlockers({asOf:'x',forecastDates:[],outcomeDates:[]}),/WEATHER_BLOCKERS_INVALID_INPUT/);
 const orphan=weatherEvidenceBlockers({asOf:'2026-11-20T19:00:00Z',forecastDates:['2026-11-18'],outcomeDates:['2026-11-17','2026-11-18']});
 assert.deepEqual(orphan.outcomesWithoutForecast,['2026-11-17']);
 assert.deepEqual(orphan.pairedDays,['2026-11-18']);
});
