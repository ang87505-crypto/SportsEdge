/** Discover the reviewed recalibration only after its first genuine, verified forward ledger receipt exists. */
import {MONOTONE_SHADOW,verifiedMonotoneCalibration,monotoneShadowProbability} from '../../props/monotone-shadow.ts';
import {MODEL_VERSION} from '../../props/contract.ts';
import {REVIEW_GATE} from '../../props/promotion.ts';
import {pair,type FrozenPrediction} from './forward.ts';
import {register,type Registry,type Experiment} from './experiments.ts';

export function trackMonotoneShadow(registry:Registry,predictions:FrozenPrediction[],nowIso:string){
 const id=MONOTONE_SHADOW.model+'-real-lines',key='sports:monotone-nonparametric-recalibration';
 if(registry.experiments.some(e=>e.id===id||e.hypothesisKey===key))return {registry,added:[] as string[]};
 const spec={kind:'ledger-models' as const,candidate:MONOTONE_SHADOW.model,baseline:MODEL_VERSION,
  maxStaleDays:7,notBefore:MONOTONE_SHADOW.notBefore};
 const candidates=predictions.filter(p=>p.model===spec.candidate&&p.artifactSha256===MONOTONE_SHADOW.digest&&
  p.baselineArtifactSha256===MONOTONE_SHADOW.baselineDigest&&Number.isSafeInteger(p.baselinePredictionId)&&
  Number.isSafeInteger(p.observationId)&&Date.parse(p.dataCutoff)>=Date.parse(MONOTONE_SHADOW.notBefore))
  .sort((a,b)=>a.predictedAt.localeCompare(b.predictedAt));
 const c=verifiedMonotoneCalibration();
 const first=candidates.find(p=>{
  const b=predictions.find(b=>b.predictionId===p.baselinePredictionId&&b.model===MODEL_VERSION);
  if(!b)return false;
  const result=pair(spec,[b,p],[],nowIso);
  if(result.ungraded!==1||result.invalidPredictions||result.metadataConflicts||result.refusedAfterLock||result.excludedBeforeRegistration)return false;
  const expected=monotoneShadowProbability(p.stat,b.p,c);
  return Math.abs(expected.pMore-p.p.pMore)<1e-12&&Math.abs(expected.pLess-p.p.pLess)<1e-12&&expected.pTie===p.p.pTie;
 });
 if(!first)return {registry,added:[] as string[]};
 const e:Experiment={id,domain:'sports',hypothesisKey:key,
  hypothesis:'The frozen monotone map improves probability quality on later real platform lines; proxy evidence stays separate.',
  dataDependencies:['pre-lock real platform baseline and shadow predictions','verified line outcomes'],
  frozen:{features:['baseline conditional P(more)','stat'],parameters:{modelVersion:MONOTONE_SHADOW.model,
   calibratorDigest:MONOTONE_SHADOW.digest,baselineArtifactSha256:MONOTONE_SHADOW.baselineDigest}},
  dataCutoff:MONOTONE_SHADOW.notBefore,codeFingerprint:'frozen-monotone:'+MONOTONE_SHADOW.digest,
  datasetFingerprints:[{name:'frozen forward calibrator',sha256:MONOTONE_SHADOW.digest}],
  metrics:{primary:'paired tie-aware Brier difference',secondary:['log loss','calibration','selected-pick hit rate']},
  sampleRequirements:{minObservations:REVIEW_GATE.minGradedLines,minDates:REVIEW_GATE.minDates,
   minClusters:REVIEW_GATE.minGames,minDecisions:REVIEW_GATE.minCandidateDecisions},baseline:MODEL_VERSION,costAssumptions:null,
  decisionRule:'Unchanged real-line production review gate. Historical proxy results do not promote the model.',
  forward:spec,status:'RUNNING',result:null,disposition:null,source:'existing',registeredAt:first.predictedAt,history:[]};
 return {registry:register(registry,e,first.predictedAt),added:[id]};
}
