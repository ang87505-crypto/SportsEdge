/** Register already-created production shadow experiments; this never creates or activates a model. */
import {verifiedArtifact} from '../../server/props-active-model.ts';
import {MODEL_VERSION} from '../../props/contract.ts';
import {REVIEW_GATE} from '../../props/promotion.ts';
import {register,type Registry,type Experiment} from './experiments.ts';

export type ShadowArtifact={version:string;sha256:string;artifact:unknown;created_at:string};
export function trackProductionShadows(registry:Registry,rows:ShadowArtifact[],nowIso:string){
 let reg=registry;const added:string[]=[],ignored:{version:string;reason:string}[]=[];
 for(const row of rows){
  if(reg.experiments.some(e=>e.forward?.candidate===row.version)){ignored.push({version:row.version,reason:'already_tracked'});continue;}
  const a=verifiedArtifact(row),created=Date.parse(row.created_at),now=Date.parse(nowIso);
  if(!a||!/^props-learn-v\d+$/.test(row.version)||a.baseModelVersion!==MODEL_VERSION||
   ![created,now,Date.parse(a.trainedAt),Date.parse(a.dataCutoff)].every(Number.isFinite)||created>now||Date.parse(a.trainedAt)>created||Date.parse(a.dataCutoff)>Date.parse(a.trainedAt)){
   ignored.push({version:row.version,reason:'unverified_artifact_or_timestamps'});continue;
  }
  const experiment:Experiment={id:row.version+'-shadow',domain:'sports',hypothesisKey:'sports:registered-shadow-'+row.version,
   hypothesis:'The production-registered shadow improves probability quality on its own later frozen predictions.',
   dataDependencies:['immutable production model artifact '+row.sha256,'pre-lock predictions and verified box-score results'],
   frozen:{features:[...a.features],parameters:{modelVersion:row.version,artifactSha256:row.sha256}},
   dataCutoff:a.dataCutoff,codeFingerprint:'registered-model-artifact:'+row.sha256,datasetFingerprints:[{name:'production model artifact',sha256:row.sha256}],
   metrics:{primary:'paired Brier difference',secondary:['log loss','calibration','selected-pick hit rate']},
   sampleRequirements:{minObservations:REVIEW_GATE.minGradedLines,minDates:REVIEW_GATE.minDates,minClusters:REVIEW_GATE.minGames,minDecisions:REVIEW_GATE.minCandidateDecisions},
   baseline:MODEL_VERSION,costAssumptions:null,decisionRule:'Unchanged production review gate; model remains a shadow pending review.',
   forward:{kind:'ledger-models',candidate:row.version,baseline:MODEL_VERSION,maxStaleDays:7,notBefore:row.created_at},
   status:'RUNNING',result:null,disposition:null,source:'existing',registeredAt:row.created_at,history:[]};
  reg=register(reg,experiment,nowIso);added.push(experiment.id);
 }
 return {registry:reg,added,ignored};
}
