/** Aggregate evidence from the existing frozen gap-shrink scorer. No model or gate changes. */
import gapSpec from '../../../data/props/challenger_gap_shrink_v1.json' with {type:'json'};
import {MODEL_VERSION} from '../../props/contract.ts';
import {fingerprint} from './experiments.ts';
import type {Result} from './evaluate.ts';

export const PROPS_RESEARCH_DIRECTORY='props-research/runs';
export const PROPS_RESEARCH_FILE=/^\d{8}T\d{9}Z-\d{1,24}-[1-9]\d{0,4}\.json$/;
export const PROPS_RESEARCH_MAX_AGE_MS=48*3600_000;
type Score={n:number;brier:number|null;logLoss:number|null};
type Gap={version:string;protocolId:string;forwardStartsAt:string;baseline:Score;candidate:Score;
 progress:{dates:number;games:number;pending:number;voided:number;preRegistration:number;invalid:number;missingMean:number};
 interval:{lower95:number;upper95:number}|null;status:'collecting'|'ready_for_review'|'no_improvement_yet';
 promotionEnabled:false;profitabilityDemonstrated:false};
export type PropsResearchEvidence={schema:'props-research-evidence-v1';asOf:string;runId:string;sourceCommit:string;
 activeModel:string;protocolSha256:string;gap:Gap;sha256:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const bad=():never=>{throw Error('PROPS_RESEARCH_INVALID_EVIDENCE');};

function readScore(v:unknown):Score{
 if(!object(v)||!count(v.n))return bad();
 if(v.n===0){if(v.brier!==null||v.logLoss!==null)return bad();}
 else if(!finite(v.brier)||v.brier<0||v.brier>2||!finite(v.logLoss)||v.logLoss<0)return bad();
 return {n:v.n,brier:v.brier as number|null,logLoss:v.logLoss as number|null};
}
function readGap(v:unknown):Gap{
 if(!object(v)||v.version!==gapSpec.version||v.protocolId!==gapSpec.protocolId||v.forwardStartsAt!==gapSpec.forwardStartsAt||
  v.promotionEnabled!==false||v.profitabilityDemonstrated!==false||!['collecting','ready_for_review','no_improvement_yet'].includes(String(v.status))||!object(v.progress))return bad();
 const baseline=readScore(v.baseline),candidate=readScore(v.candidate);
 if(baseline.n!==candidate.n)return bad();
 const rawProgress=v.progress;
 const keys=['dates','games','pending','voided','preRegistration','invalid','missingMean'] as const;
 if(keys.some(k=>!count(rawProgress[k]))||Number(rawProgress.dates)>baseline.n||Number(rawProgress.games)>baseline.n)return bad();
 const progress=Object.fromEntries(keys.map(k=>[k,rawProgress[k]])) as Gap['progress'];
 let interval:Gap['interval']=null;
 if(v.interval!==null){
  if(!object(v.interval)||!finite(v.interval.lower95)||!finite(v.interval.upper95)||v.interval.lower95>v.interval.upper95)return bad();
  interval={lower95:v.interval.lower95,upper95:v.interval.upper95};
 }
 return {version:gapSpec.version,protocolId:gapSpec.protocolId,forwardStartsAt:gapSpec.forwardStartsAt,baseline,candidate,progress,interval,
  status:v.status as Gap['status'],promotionEnabled:false,profitabilityDemonstrated:false};
}

/** Publish only bounded aggregate evidence; rankings, raw player rows and credentials never enter this archive. */
export function makePropsResearchEvidence(snapshot:unknown,runId:string,sourceCommit:string):PropsResearchEvidence{
 if(!object(snapshot)||typeof snapshot.asOf!=='string'||!Number.isFinite(Date.parse(snapshot.asOf))||snapshot.activeVersion!==MODEL_VERSION||
  !object(snapshot.challengers)||!/^\d{1,24}-[1-9]\d{0,4}$/.test(runId)||!/^[a-f0-9]{40}$/.test(sourceCommit))return bad();
 const core={schema:'props-research-evidence-v1' as const,asOf:new Date(snapshot.asOf).toISOString(),runId,sourceCommit,
  activeModel:MODEL_VERSION,protocolSha256:fingerprint(gapSpec),gap:readGap(snapshot.challengers[gapSpec.version])};
 return {...core,sha256:fingerprint(core)};
}
export function verifyPropsResearchEvidence(v:unknown):PropsResearchEvidence{
 if(!object(v)||v.schema!=='props-research-evidence-v1'||typeof v.runId!=='string'||typeof v.sourceCommit!=='string')return bad();
 const checked=makePropsResearchEvidence({asOf:v.asOf,activeVersion:v.activeModel,challengers:{[gapSpec.version]:v.gap}},v.runId,v.sourceCommit);
 if(v.protocolSha256!==checked.protocolSha256||v.sha256!==checked.sha256)throw Error('PROPS_RESEARCH_DIGEST_MISMATCH');
 return checked;
}
export function propsResearchFilename(v:PropsResearchEvidence){return v.asOf.replace(/[-:.]/g,'')+'-'+v.runId+'.json';}

export function propsResearchResult(v:PropsResearchEvidence,nowIso:string):{experimentId:string;result:Result&{details:Record<string,unknown>}}{
 const e=verifyPropsResearchEvidence(v),now=Date.parse(nowIso),at=Date.parse(e.asOf);
 if(!Number.isFinite(now))throw Error('PROPS_RESEARCH_BAD_CLOCK');
 if(at>now)throw Error('PROPS_RESEARCH_FUTURE_EVIDENCE');
 if(now-at>PROPS_RESEARCH_MAX_AGE_MS)throw Error('PROPS_RESEARCH_STALE_EVIDENCE');
 // This producer does not supply the registered 100-decision count or family correction. Record sample progress,
 // but never turn its single-scorer ready_for_review label into an engine review-ready or promotion claim.
 return {experimentId:gapSpec.version,result:{evidence:'forward',disposition:'NO_CLEAR_EFFECT',observations:e.gap.baseline.n,
  dates:e.gap.progress.dates,clusters:e.gap.progress.games,
  reason:`Gap-shrink scorer: ${e.gap.baseline.n} admitted graded lines, ${e.gap.progress.dates} dates, ${e.gap.progress.games} games. `+
   'Decision counts and the registered family correction are not supplied; no review-ready claim is inferred. Frozen rules and owner review remain authoritative.',
  details:{protocolSha256:e.protocolSha256,forwardStartsAt:e.gap.forwardStartsAt,baseline:e.gap.baseline,candidate:e.gap.candidate,
   progress:e.gap.progress,interval:e.gap.interval,producerStatus:e.gap.status,decisionCountSupplied:false,familyCorrectionSupplied:false}}};
}
