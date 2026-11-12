import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {holm,clusteredDifference,calibration,wilson} from './stats.ts';
import {ablationVariants,freezeSpec,verifySpec,restrictSpec,featureClosure,SPORTS_FEATURES} from './registry.ts';
import {ForwardLedger,verifyRecords} from './ledger.ts';
import {SPORTS_ABLATION,SPORTS_ABLATION_SPEC} from './sports/spec.ts';
import {trainVariant,predictVariant,fixedZeroFor,labArtifactSha256} from './sports/variants.ts';
import {riskFlags,flagEffectiveness,calibrationTable} from './sports/risk.ts';
import {diagnoseMistakes,patternOf} from './sports/attribution.ts';
import {compareVariants} from './compare.ts';

// ------------------------------------------------------------ statistics
test('holm matches the textbook step-down adjustment',()=>{
 assert.deepEqual(holm([0.01,0.04,0.03,0.005]).map(x=>+x.toFixed(4)),[0.03,0.06,0.06,0.02]);
 assert.deepEqual(holm([0.5]),[0.5]);
});
test('cluster bootstrap is deterministic and signs the difference correctly',()=>{
 const rows=Array.from({length:400},(_,i)=>({cluster:'g'+(i%40),candidate:0.2+(i%7)*0.001,reference:0.21+(i%7)*0.001}));
 const a=clusteredDifference(rows),b=clusteredDifference(rows);
 assert.deepEqual(a,b);
 assert.ok(a.mean<0&&a.upper95<0&&a.pImprove<0.01);
 assert.equal(clusteredDifference([{cluster:'x',candidate:1,reference:0}]),null);
});
test('calibration and wilson behave on simple inputs',()=>{
 const c=calibration([{p:0.75,y:1},{p:0.75,y:0},{p:0.25,y:0},{p:0.25,y:0}]);
 assert.equal(+c.ece.toFixed(3),0.25);
 const w=wilson(50,100);assert.ok(w.lower<0.5&&w.upper>0.5);
});

// ------------------------------------------------------------ registry and frozen specs
test('ablation variants: base, each layer, combined, leave-one-out; duplicates collapse; unsupported never run',()=>{
 const v=ablationVariants(['recalibration','a','b','injury'],new Set(['recalibration','a','b']),'recalibration',10);
 assert.deepEqual(v.map(x=>x.id),['base','base+recalibration','base+recalibration+a','base+recalibration+b','combined']);
 assert.ok(v.every(x=>!x.layers.includes('injury')));
 assert.throws(()=>ablationVariants(['recalibration','a','b','c','d','e'],new Set(['recalibration','a','b','c','d','e']),'recalibration',5),/LAB_TOO_MANY_VARIANTS/);
});
test('the sports spec is frozen: 9 bounded variants, research only, zero paid requests, injury layer not run',()=>{
 assert.equal(SPORTS_ABLATION_SPEC.variants.length,9);
 assert.ok(verifySpec(SPORTS_ABLATION));
 assert.equal(SPORTS_ABLATION_SPEC.limits.paidRequestsPerVariant,0);
 assert.equal(SPORTS_ABLATION_SPEC.limits.productionShadowLimit,3);
 assert.ok(SPORTS_ABLATION_SPEC.variants.every(v=>!v.layers.includes('injury_rotation')));
 // The registered gate keeps the production promotion requirements.
 const g=SPORTS_ABLATION_SPEC.gate;
 assert.deepEqual([g.minGradedLines,g.minDates,g.minGames,g.minCandidateDecisions,g.requireNoWorseLogLoss],[500,14,50,100,true]);
});
test('any change to a frozen spec is detected; specs that would leak or run unsupported layers are refused',()=>{
 const changed={spec:{...SPORTS_ABLATION.spec,forwardStartsAt:'2026-11-20T00:00:00Z'},sha256:SPORTS_ABLATION.sha256};
 assert.equal(verifySpec(changed),false);
 assert.throws(()=>freezeSpec({...SPORTS_ABLATION_SPEC,forwardStartsAt:'2026-01-01T00:00:00Z'}),/LAB_SPEC_TRAINING_OVERLAPS_FORWARD/);
 assert.throws(()=>freezeSpec({...SPORTS_ABLATION_SPEC,variants:[...SPORTS_ABLATION_SPEC.variants,{id:'inj',label:'x',layers:['injury_rotation'],role:'single_layer'}]}),/UNSUPPORTED/);
 assert.throws(()=>freezeSpec({...SPORTS_ABLATION_SPEC,researchOnly:false}),/RESEARCH_ONLY/);
});
test('restricting a spec drops variants that need missing data and keeps a combined model',()=>{
 const r=restrictSpec(SPORTS_ABLATION_SPEC,[{id:'market',reason:'no history'}]);
 assert.ok(r.variants.every(v=>!v.layers.includes('market')));
 assert.equal(r.variants.find(v=>v.role==='combined').id,'combined-market');
 assert.equal(r.variants.length,5);
});
test('feature dependencies are tracked transitively',()=>{
 assert.deepEqual(featureClosure(SPORTS_FEATURES,['back_to_back']),['back_to_back','rest_days']);
 assert.throws(()=>featureClosure(SPORTS_FEATURES,['nope']),/LAB_UNKNOWN_FEATURE/);
});

// ------------------------------------------------------------ immutable forward predictions
const P={experimentId:'lab-sports-ablation-v1',specSha256:'x'.repeat(64),variantId:'combined',observationId:'101',pMore:0.6,pLess:0.38,pTie:0.02,
 dataCutoff:'2026-11-14T18:00:00Z',lockAt:'2026-11-15T00:10:00Z',inputs:{books:0.55}};
test('a prediction is frozen before lock and can never be rewritten, even before the result',()=>{
 const l=new ForwardLedger();
 const first=l.append(P,'2026-11-14T18:05:00Z');
 assert.equal(first.ok,true);
 const again=l.append({...P,pMore:0.7,pLess:0.28},'2026-11-14T19:00:00Z');
 assert.deepEqual(again,{ok:false,refusal:'LAB_DUPLICATE'});
 assert.equal(l.records()[0].pMore,0.6);
 assert.throws(()=>{first.record.pMore=0.9;});
 assert.throws(()=>{first.record.inputs.books=0.1;});
});
test('predictions cannot be written at or after lock, with a future data cutoff, or once a result exists',()=>{
 const l=new ForwardLedger();
 assert.equal(l.append(P,'2026-11-15T00:10:00Z').refusal,'LAB_AFTER_LOCK');
 assert.equal(l.append({...P,dataCutoff:'2026-11-14T19:00:00Z'},'2026-11-14T18:05:00Z').refusal,'LAB_CUTOFF_AFTER_PREDICTION');
 assert.equal(l.append({...P,pMore:0.7},'2026-11-14T18:05:00Z').refusal,'LAB_INVALID_PROBABILITIES');
 l.append(P,'2026-11-14T18:05:00Z');
 l.grade({observationId:'101',outcome:'less',gradedAt:'2026-11-15T03:00:00Z'});
 // A new variant for the same, already-graded observation is refused: outcomes never shape predictions.
 assert.equal(l.append({...P,variantId:'base'},'2026-11-14T23:00:00Z').refusal,'LAB_RESULT_ALREADY_KNOWN');
 assert.equal(l.records()[0].pMore,0.6);
 assert.throws(()=>l.grade({observationId:'101',outcome:'more',gradedAt:'2026-11-14T23:00:00Z'}),/LAB_GRADE_BEFORE_LOCK/);
});
test('a record edited outside the ledger fails hash verification',()=>{
 const l=new ForwardLedger();
 const r=l.append(P,'2026-11-14T18:05:00Z').record;
 assert.equal(verifyRecords([r]).ok,true);
 const forged={...r,pMore:0.65,pLess:0.33};
 assert.deepEqual(verifyRecords([forged]).tampered,['lab-sports-ablation-v1|combined|101']);
});

// ------------------------------------------------------------ sports variants
const mu={oppAllowedRatio:1.1,home:1,restDays:1,backToBack:0};
test('excluded layers are pinned at zero; the base variant returns layer 1 unchanged',()=>{
 assert.deepEqual(fixedZeroFor(['recalibration']),[2,3,4,5,6,7,8]);
 assert.deepEqual(fixedZeroFor(['recalibration','matchup_rest']),[2,3,4]);
 const base={pMore:0.55,pLess:0.42,pTie:0.03};
 const v=trainVariant({id:'base',label:'b',layers:[],role:'base'},[]);
 assert.deepEqual(predictVariant(v,'points',{base,role:null,matchup:mu,booksPMore:null}),base);
 // A role-based variant cannot score a line without the role forecast: no guess.
 const r=trainVariant({id:'r',label:'r',layers:['role_minutes'],role:'single_layer'},[]);
 assert.equal(predictVariant(r,'points',{base,role:null,matchup:mu,booksPMore:null}),null);
});
test('the market rule blends only when books quote the same line, and keeps the tie probability',()=>{
 const v={id:'m',layers:['market'],baseSource:'layer1',learned:false,market:true,weights:null,lambda:null,trainRows:null};
 const base={pMore:0.6,pLess:0.4,pTie:0};
 assert.deepEqual(predictVariant(v,'points',{base,role:null,matchup:mu,booksPMore:null}),base);
 const p=predictVariant(v,'points',{base,role:null,matchup:mu,booksPMore:0.4});
 assert.ok(Math.abs(p.pMore-0.5)<1e-9);
 const t=predictVariant(v,'points',{base:{pMore:0.57,pLess:0.38,pTie:0.05},role:null,matchup:mu,booksPMore:0.5});
 assert.equal(t.pTie,0.05);
});
test('the committed forward artifact matches its hash and the frozen spec',()=>{
 const stored=JSON.parse(readFileSync(new URL('../../data/lab/sports_ablation_v1.json',import.meta.url),'utf8'));
 assert.equal(labArtifactSha256(stored.artifact),stored.artifactSha256);
 assert.equal(stored.artifact.specSha256,SPORTS_ABLATION.sha256);
 assert.deepEqual(Object.keys(stored.artifact.variants).sort(),SPORTS_ABLATION_SPEC.variants.map(v=>v.id).sort());
 for(const v of Object.values(stored.artifact.variants))if(v.weights)for(const w of Object.values(v.weights))
  for(const k of fixedZeroFor(v.layers))assert.equal(w[k],0,v.id);
});

// ------------------------------------------------------------ risk flags and mistakes
const l1={games:20,expMinutes:30,sdMinutes:5,lastPlayed:'2026-11-12T00:00:00Z',cutoff:'2026-11-14T00:00:00Z'};
test('each pre-lock risk flag fires on its frozen rule only',()=>{
 const x={stat:'points',probs:{pMore:0.65,pLess:0.35,pTie:0},line:20.5,mean:22,layer1:l1,roleExpMinutes:30,booksPMore:null,sameGamePicks:1,calibration:[]};
 assert.deepEqual(riskFlags(x),[]);
 assert.deepEqual(riskFlags({...x,layer1:{...l1,games:5}}),['insufficient_history']);
 assert.deepEqual(riskFlags({...x,layer1:{...l1,lastPlayed:'2026-11-01T00:00:00Z'}}),['long_absence']);
 assert.deepEqual(riskFlags({...x,roleExpMinutes:35}),['minutes_shift']);
 assert.deepEqual(riskFlags({...x,layer1:{...l1,sdMinutes:10}}),['high_minutes_uncertainty']);
 assert.deepEqual(riskFlags({...x,booksPMore:0.4}),['books_disagree']);
 assert.deepEqual(riskFlags({...x,mean:30}),['large_line_gap']);
 assert.deepEqual(riskFlags({...x,sameGamePicks:2}),['same_game_exposure']);
 assert.deepEqual(riskFlags({...x,calibration:[{stat:'points',band:'0.65-0.70',n:80,meanConfidence:0.67,hitRate:0.5,overconfident:true}]}),['poor_category_calibration']);
});
test('calibration table flags an overconfident band from training rows only',()=>{
 const rows=Array.from({length:100},(_,i)=>({stat:'points',p:{pMore:0.72,pLess:0.28,pTie:0},outcome:i<50?'more':'less'}));
 const t=calibrationTable(rows);
 assert.equal(t[0].band,'0.70-0.80');assert.equal(t[0].overconfident,true);
});
test('flag effectiveness reports misses avoided AND good picks rejected, with too-small samples withheld',()=>{
 const picks=[...Array.from({length:60},(_,i)=>({flags:['long_absence'],correct:i<20})),...Array.from({length:200},(_,i)=>({flags:[],correct:i<140}))];
 const e=flagEffectiveness(picks).find(x=>x.flag==='long_absence');
 assert.equal(e.verdict,'would_help');
 assert.deepEqual([e.skipRule.missesAvoided,e.skipRule.goodPicksRejected],[40,20]);
 assert.equal(flagEffectiveness(picks.slice(0,10).concat(picks.slice(60))).find(x=>x.flag==='long_absence').verdict,'too_few');
});
test('mistake patterns are measured, ranked, and judged against hits',()=>{
 const pick=(o)=>({key:Math.random().toString(),stat:'points',side:'more',correct:false,probability:0.65,expMinutes:30,actualMinutes:30,mean:22,actual:15,
  line:20.5,booksPMore:null,oppAllowedRatio:1,flags:[],alternatives:{alt:'more'},...o});
 assert.equal(patternOf(pick({actualMinutes:12})),'minutes_collapse');
 assert.equal(patternOf(pick({side:'less',actualMinutes:42})),'minutes_surge');
 assert.equal(patternOf(pick({booksPMore:0.4})),'books_were_right');
 assert.equal(patternOf(pick({oppAllowedRatio:0.85})),'matchup_against');
 assert.equal(patternOf(pick({})),'production_rate_miss');
 const r=diagnoseMistakes([pick({actualMinutes:10,flags:['long_absence'],alternatives:{alt:null}}),pick({actualMinutes:11}),pick({correct:true})]);
 assert.equal(r.patterns[0].pattern,'minutes_collapse');
 assert.equal(r.patterns[0].misses,2);
 assert.equal(r.patterns[0].bestPreLockSignal.flag,'long_absence');
 assert.deepEqual(r.patterns[0].alternativeModels,[{variant:'alt',wouldHaveAvoided:1,wouldAlsoRejectGood:0}]);
});

// ------------------------------------------------------------ comparison report
test('a layer that genuinely helps is detected; forward evidence below the minimums is only "collecting"',()=>{
 const spec=restrictSpec(SPORTS_ABLATION_SPEC,[{id:'market',reason:'x'}]);
 let s=7;const r=()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};
 const rows=Array.from({length:3000},(_,i)=>{
  const truth=0.3+0.4*r(),y=r()<truth;
  const noisy=Math.min(0.95,Math.max(0.05,truth+(r()-0.5)*0.4));
  const pm=(p)=>({pMore:p,pLess:1-p,pTie:0});
  const good=pm(truth),bad=pm(noisy);
  return {key:'k'+i,cluster:'g'+(i%120),date:'d'+(i%30),stat:'points',outcome:y?'more':'less',
   preds:{base:bad,'base+recalibration':bad,'base+recalibration+role_minutes':bad,'base+recalibration+matchup_rest':good,'combined-market':good}};
 });
 const retro=compareVariants(spec,rows,'retrospective');
 assert.equal(retro.layers.find(l=>l.layer==='matchup_rest').verdict,'helps');
 assert.notEqual(retro.layers.find(l=>l.layer==='role_minutes').verdict,'helps');
 assert.equal(retro.layers.find(l=>l.layer==='injury_rotation').verdict,'not_tested');
 const fwd=compareVariants(spec,rows.slice(0,200),'forward');
 assert.equal(fwd.sampleMinimumsMet,false);
 assert.equal(fwd.layers.find(l=>l.layer==='matchup_rest').verdict,'collecting');
});
