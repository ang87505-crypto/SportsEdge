/**
 * AI Learning Lab — retrospective sports ablation (lab-sports-ablation-v1). Deterministic; no AI service; no paid requests.
 *   node --experimental-strip-types scripts/lab-sports-ablation.ts --prior player_box_2025.csv --season player_box_2026.csv \
 *     --current player_box_2027.csv --out research/lab_sports_ablation_20261112 --artifact src/data/lab/sports_ablation_v1.json
 *
 * Fold 1 (exploratory; 2025-26 was inspected by earlier studies): train on 2025-26 lines before 2026-01-01, test on the rest of 2025-26.
 * Fold 2 (out-of-season): train on all of 2025-26, test on 2026-27 to date with EXACTLY the production layer-1 parameters and priors
 *   (src/data/props/model_v1.json). The fold-2 training artifact is the frozen artifact used for forward predictions.
 * PROXY lines (floor of last-10 median + 0.5), never platform lines; there is no sportsbook history, so the market layer is
 * evaluated forward only. This measures probability quality; it says nothing about virtual returns.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {STATS,type Stat} from '../src/lib/props/contract.ts';
import {decidePick} from '../src/lib/props/rules.ts';
import type {ModelParams} from '../src/lib/props/model.ts';
import {loadBoxCsv,priors,fitDispersion,MODEL_FIXED} from './lib/box-csv.ts';
import {labItems,type LabHistoryItem} from './lib/lab-history.ts';
import {SPORTS_ABLATION,SPORTS_ABLATION_SPEC} from '../src/lib/lab/sports/spec.ts';
import {restrictSpec,SPORTS_FEATURES,SPORTS_LAYERS} from '../src/lib/lab/registry.ts';
import {trainVariant,predictVariant,labArtifactSha256,type SportsLabArtifact,type SportsLabInput,type VariantArtifact} from '../src/lib/lab/sports/variants.ts';
import {compareVariants,type LabRow} from '../src/lib/lab/compare.ts';
import {riskFlags,calibrationTable,flagEffectiveness,COVERAGE_GAPS,RISK_RULES_V1,type CalibrationCell} from '../src/lib/lab/sports/risk.ts';
import {diagnoseMistakes,type GradedPick} from '../src/lib/lab/sports/attribution.ts';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);if(i<0)throw new Error('missing --'+n);return process.argv[i+1];};
const t0=Date.now();
const protocol=JSON.parse(readFileSync(new URL('../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
const pinned=(p:string)=>{const f=loadBoxCsv(p);if(protocol.sourceHashes[f.file!]!==f.sha256)throw new Error('SOURCE_HASH_MISMATCH '+f.file);return f;};
const prior=pinned(arg('prior')),season=pinned(arg('season'));
const current=loadBoxCsv(arg('current'));   // live season file: hash recorded, not pre-pinned
const model=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8'));

const SPLIT='2026-01-01T00:00:00.000Z';
const NO_MARKET=[{id:'market',reason:'No sportsbook history exists for these seasons; the market layer is tested on forward lines only.'}];
const histSpec=restrictSpec(SPORTS_ABLATION_SPEC,NO_MARKET);
const inputOf=(x:LabHistoryItem):SportsLabInput=>({base:x.base,role:x.role,matchup:x.matchup,booksPMore:null});

function train(items:LabHistoryItem[]){
 const out:Record<string,VariantArtifact>={};
 for(const v of SPORTS_ABLATION_SPEC.variants)out[v.id]=trainVariant(v,items.map(x=>({stat:x.stat,y:x.y,at:x.at,input:inputOf(x)})));
 return out;
}
function evaluate(label:string,variants:Record<string,VariantArtifact>,trainItems:LabHistoryItem[],test:LabHistoryItem[]){
 const rows:LabRow[]=test.map(x=>({key:x.key,cluster:x.eventId,date:x.date,stat:x.stat,outcome:x.y?'more':'less',
  preds:Object.fromEntries(histSpec.variants.map(v=>[v.id,predictVariant(variants[v.id],x.stat,inputOf(x))!]))}));
 const report=compareVariants(histSpec,rows,'retrospective');
 const byStat=Object.fromEntries(STATS.map(s=>[s,compareVariants(histSpec,rows.filter(r=>r.stat===s),'retrospective').variants
  .map(v=>({id:v.id,brier:v.brier,logLoss:v.logLoss,ece:v.ece}))]));
 // Pre-lock flags and mistakes on the picks the production rule (props-select-v1 on layer 1) would have recorded.
 const cal:CalibrationCell[]=calibrationTable(trainItems.map(x=>({stat:x.stat,p:x.base,outcome:x.y?'more':'less'})));
 const graded:GradedPick[]=[];
 for(const x of test){
  const d=decidePick({status:'scored',...x.base});if(d.status!=='recorded')continue;
  const flags=riskFlags({stat:x.stat,probs:x.base,line:x.line,mean:x.mean,layer1:x.layer1,roleExpMinutes:x.roleExpMinutes,booksPMore:null,sameGamePicks:null,calibration:cal});
  const alt=(id:string)=>{const p=rows.length?predictVariant(variants[id],x.stat,inputOf(x)):null;const a=p?decidePick({status:'scored',...p}):null;return a?.status==='recorded'?a.side:null;};
  graded.push({key:x.key,stat:x.stat,side:d.side,correct:(x.y===1)===(d.side==='more'),probability:d.probability,expMinutes:x.layer1.expMinutes,
   actualMinutes:x.actualMinutes,mean:x.mean,actual:x.actual,line:x.line,booksPMore:null,oppAllowedRatio:x.matchup.oppAllowedRatio,flags,
   alternatives:{'base+recalibration':alt('base+recalibration'),'combined-market':alt('combined-market')}});
 }
 return {label,train:{rows:trainItems.length,from:trainItems[0]?.date??null,to:trainItems.reduce((m,x)=>x.date>m?x.date:m,'')},
  test:{rows:test.length,from:test.reduce((m,x)=>!m||x.date<m?x.date:m,''),to:test.reduce((m,x)=>x.date>m?x.date:m,'')},
  comparison:report,byStat,riskFlags:{rules:RISK_RULES_V1,coverageGaps:COVERAGE_GAPS,selectedPicks:graded.length,
   effects:flagEffectiveness(graded.map(g=>({flags:g.flags,correct:g.correct})))},
  calibrationTable:cal,mistakes:diagnoseMistakes(graded)};
}

// Fold 1: 2025-26, priors 2024-25, dispersion through 2025-12-31 (no information from the test period).
const pr24=priors(prior.rows);
const params1:ModelParams={...MODEL_FIXED,leagueRate:pr24.leagueRate,dispersion:fitDispersion(season.rows,pr24,Date.parse('2025-12-31T23:59:59Z'))};
const f1=labItems(season.rows,params1,a=>pr24.players.get(a)??null);
const f1train=f1.items.filter(x=>x.at<SPLIT).sort((a,b)=>a.at.localeCompare(b.at)),f1test=f1.items.filter(x=>x.at>=SPLIT);
const fold1=evaluate('fold1-2025-26-second-half',train(f1train),f1train,f1test);
console.error('fold1 done',(Date.now()-t0)/1000);

// Fold 2: train on all 2025-26 (as the production weekly train does), test on 2026-27 with production layer-1 exactly.
const paramsAll:ModelParams={...MODEL_FIXED,leagueRate:pr24.leagueRate,dispersion:fitDispersion(season.rows,pr24,Date.parse('2100-01-01T00:00:00Z'))};
const f2train=labItems(season.rows,paramsAll,a=>pr24.players.get(a)??null).items.sort((a,b)=>a.at.localeCompare(b.at));
const prodParams=model.params as ModelParams;
const f2=labItems(current.rows,prodParams,a=>model.players[a]?{games:model.players[a].games,minutes:model.players[a].minutes,points:model.players[a].points,
 rebounds:model.players[a].rebounds,assists:model.players[a].assists}:null);
const variants2=train(f2train);
const fold2=evaluate('fold2-2026-27-to-date',variants2,f2train,f2.items);
console.error('fold2 done',(Date.now()-t0)/1000);

const artifact:SportsLabArtifact={experimentId:SPORTS_ABLATION_SPEC.id,specSha256:SPORTS_ABLATION.sha256,trainedThrough:SPORTS_ABLATION_SPEC.trainingData.through,
 sources:SPORTS_ABLATION_SPEC.trainingData.sources,variants:variants2};
const calibrationForward=calibrationTable(f2train.map(x=>({stat:x.stat,p:x.base,outcome:x.y?'more':'less'})));
const stored={artifact,artifactSha256:labArtifactSha256(artifact),calibrationTable:calibrationForward,riskRules:RISK_RULES_V1};
mkdirSync(arg('artifact').replace(/\/[^/]+$/,''),{recursive:true});
writeFileSync(arg('artifact'),JSON.stringify(stored)+'\n');

const report={generatedBy:'scripts/lab-sports-ablation.ts',experimentId:SPORTS_ABLATION_SPEC.id,specSha256:SPORTS_ABLATION.sha256,
 evidence:'retrospective',caveats:['Proxy lines, not platform lines: these results rank hypotheses and cannot promote anything.',
  'Fold 1 reuses a season earlier studies inspected; fold 2 (2026-27 to date) is out-of-season for every trained weight.',
  'No sportsbook history: the market layer is tested on forward lines only. No injury feed: the injury/rotation layer is not tested.',
  'Probability quality only: no virtual or real returns are implied.'],
 sources:[...[prior,season].map(f=>({file:f.file,sha256:f.sha256,pinned:true})),{file:current.file,sha256:current.sha256,pinned:false,note:'live 2026-27 file as downloaded for this run'}],
 leakage:{checked:f1.checked+f2.checked,violations:f1.violations+f2.violations},
 features:SPORTS_FEATURES,layers:SPORTS_LAYERS,spec:histSpec,artifactSha256:stored.artifactSha256,folds:[fold1,fold2],
 runtimeSeconds:Math.round((Date.now()-t0)/1000)};
mkdirSync(arg('out'),{recursive:true});
writeFileSync(arg('out')+'/report.json',JSON.stringify(report,null,1)+'\n');
for(const f of [fold1,fold2]){
 console.log('\n'+f.label,'train',f.train.rows,'test',f.test.rows,f.test.from,'→',f.test.to);
 for(const v of f.comparison.variants)console.log(' ',v.id.padEnd(40),'brier',v.brier,'logloss',v.logLoss,'ece',v.ece,'dec',v.decisions,'decHit',v.decisionHitRate);
 for(const l of f.comparison.layers)console.log('  layer',l.layer,l.verdict,'|',l.explanation);
 console.log('  flags',f.riskFlags.effects.map(e=>`${e.flag}:${e.flagged}/${e.flaggedHitRate}vs${e.unflaggedHitRate}:${e.verdict}`).join(' '));
 console.log('  mistakes',f.mistakes.picks,f.mistakes.hitRate,f.mistakes.patterns.map(p=>`${p.pattern}:${p.misses} lift ${p.lift}`).join(' '));
}
