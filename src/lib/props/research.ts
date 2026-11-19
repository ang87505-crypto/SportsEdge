/** Read-only research and rankings. Never writes a pick, changes v1, or learns from a displayed result. */
import {MODEL_VERSION,OBSERVATION_RULES,SELECTION_VERSION,type Platform,type Stat} from './contract.ts';
import {decidePick} from './rules.ts';
import {playerKey} from './identity.ts';

export type Probabilities={pMore:number;pLess:number;pTie:number};
export type ResearchArtifact={protocolId:string;candidateVersion:string;baselineVersion:string;
 baselineArtifactSha256:string;baselineCanonicalSha256:string;forwardStartsAt:string;temperatures:Record<Stat,number>;
 reviewGate:{minGradedLines:number;minDates:number;minGames:number;minCandidateDecisions:number;
 maxBrierDifferenceUpper95:number;bootstrapReplicates:number;bootstrapSeed:number}};
export type ResearchRaw={nowIso:string;windowStart:string;control:{state:string;reason:string}|null;
 observations:{id:number;platform:Platform;provider_event_id:string;home_team:string;away_team:string;lock_at:string;
  player_name:string;stat:Stat;line:number;provider_last_update:string;ingested_at:string;recorded_at:string}[];
 predictions:{id:number;observation_id:number;model_version:string;status:string;athlete_id:string|null;
  p_more:number|null;p_less:number|null;p_tie:number|null;data_cutoff:string;predicted_at:string;mean?:number|null}[];
 picks:{id:number;prediction_id:number;selection_version:string;status:string;side:'more'|'less'|null}[];
 results:{observation_id:number;revision:number;outcome:string;actual:number|null;graded_at:string}[];
 entryLegs:{entry_id:number;pick_id:number}[]};

const finiteDate=(s:string)=>Number.isFinite(Date.parse(s));
const slateDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export function validProbabilities(p:Probabilities){
 return [p.pMore,p.pLess,p.pTie].every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(p.pMore+p.pLess+p.pTie-1)<1e-6;
}
/** Scale conditional More/Less log odds, preserving the explicit probability of an integer-line tie. */
export function temperatureScale(p:Probabilities,temperature:number):Probabilities{
 if(!validProbabilities(p)||!Number.isFinite(temperature)||temperature<1||temperature>3)throw new Error('INVALID_CALIBRATION_INPUT');
 if(temperature===1||p.pTie===1)return {...p};
 const active=1-p.pTie;
 const q=Math.max(1e-12,Math.min(1-1e-12,p.pMore/active));
 const more=active/(1+Math.exp(-Math.log(q/(1-q))/temperature));
 return {pMore:more,pLess:active-more,pTie:p.pTie};
}
/** Multiclass Brier / 2; equals ordinary binary Brier for half-point lines. Ties are scored explicitly. */
export function properScore(p:Probabilities,outcome:'more'|'less'|'tie'){
 const y={pMore:Number(outcome==='more'),pLess:Number(outcome==='less'),pTie:Number(outcome==='tie')};
 const probability=outcome==='more'?p.pMore:outcome==='less'?p.pLess:p.pTie;
 return {brier:((p.pMore-y.pMore)**2+(p.pLess-y.pLess)**2+(p.pTie-y.pTie)**2)/2,
  logLoss:-Math.log(Math.max(probability,1e-12))};
}
export type EvaluationRow={key:string;eventId:string;date:string;stat:Stat;baseline:Probabilities;candidate:Probabilities;outcome:'more'|'less'|'tie'};
export function summarize(rows:{p:Probabilities;outcome:'more'|'less'|'tie'}[]){
 let brier=0,logLoss=0,correct=0,decisions=0,decisionsCorrect=0,directional=0;
 const bins=Array.from({length:5},(_,i)=>({from:0.5+i*0.1,n:0,probability:0,correct:0}));
 for(const {p,outcome} of rows){
  const score=properScore(p,outcome);brier+=score.brier;logLoss+=score.logLoss;
  const side=p.pMore>=p.pLess?'more':'less';
  if(outcome!=='tie'){
   directional++;correct+=Number(side===outcome);
   const probability=p.pTie<1?Math.max(p.pMore,p.pLess)/(1-p.pTie):0.5;
   const bin=bins[Math.min(4,Math.max(0,Math.floor((probability-0.5)*10)))];
   bin.n++;bin.probability+=probability;bin.correct+=Number(side===outcome);
   if(decidePick({status:'scored',...p}).status==='recorded'){decisions++;decisionsCorrect+=Number(side===outcome);}
  }
 }
 return {n:rows.length,directional,correct,hitRate:directional?correct/directional:null,
  brier:rows.length?brier/rows.length:null,logLoss:rows.length?logLoss/rows.length:null,
  decisions,decisionsCorrect,decisionHitRate:decisions?decisionsCorrect/decisions:null,
  reliability:bins.filter(b=>b.n).map(b=>({from:b.from,n:b.n,meanConfidence:b.probability/b.n,hitRate:b.correct/b.n}))};
}
/** Paired resampling by game keeps players/stats/platform duplicates from being treated as independent trials. */
export function pairedInterval(rows:EvaluationRow[],replicates=1000,seed=20261108){
 const groups=new Map<string,{sum:number;n:number}>();
 for(const r of rows){const g=groups.get(r.eventId)??{sum:0,n:0};
  g.sum+=properScore(r.candidate,r.outcome).brier-properScore(r.baseline,r.outcome).brier;g.n++;groups.set(r.eventId,g);}
 const blocks=[...groups.values()];if(blocks.length<2)return null;
 let state=seed>>>0;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const diffs:number[]=[];
 for(let i=0;i<replicates;i++){let sum=0,n=0;for(let j=0;j<blocks.length;j++){const b=blocks[Math.floor(random()*blocks.length)];sum+=b.sum;n+=b.n;}diffs.push(sum/n);}
 diffs.sort((a,b)=>a-b);
 return {lower95:diffs[Math.floor(replicates*0.025)],upper95:diffs[Math.min(replicates-1,Math.floor(replicates*0.975))],games:blocks.length};
}

/**
 * Forward evaluation rows under the registered admission rules (shared by every candidate so none is judged on looser
 * terms): first archived forecast per exact line, ingested before lock and at/after `forwardStartsAt`, final result
 * graded after lock and consistent with the box-score actual. `candidateOf` maps the baseline forecast to the candidate.
 */
function forwardRows(r:ResearchRaw,now:number,forwardStartsAt:string,
 candidateOf:(base:Probabilities,o:ResearchRaw['observations'][number],p:ResearchRaw['predictions'][number])=>Probabilities){
 const prediction=new Map(r.predictions.filter(p=>p.model_version===MODEL_VERSION).map(p=>[p.observation_id,p]));
 const pick=new Map(r.picks.filter(p=>p.selection_version===SELECTION_VERSION).map(p=>[p.prediction_id,p]));
 const results=new Map<number,ResearchRaw['results'][number]>();
 for(const x of r.results){if(!finiteDate(x.graded_at)||Date.parse(x.graded_at)>now)continue;
  const old=results.get(x.observation_id);if(!old||x.revision>old.revision)results.set(x.observation_id,x);}
 let invalid=0,unscorable=0;
 const scored:Scored[]=[];
 for(const o of r.observations){
  const p=prediction.get(o.id);
  if(!p||p.status!=='scored'){unscorable++;continue;}
  if(p.p_more===null||p.p_less===null||p.p_tie===null){invalid++;continue;}
  const base={pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)};
  const dates=[o.ingested_at,o.recorded_at,o.provider_last_update,o.lock_at,p.data_cutoff,p.predicted_at];
  if(!p.athlete_id||!validProbabilities(base)||!dates.every(finiteDate)||Date.parse(o.ingested_at)>now||
   Date.parse(o.ingested_at)>Date.parse(o.recorded_at)||Date.parse(o.recorded_at)>=Date.parse(o.lock_at)||
   Date.parse(p.predicted_at)>now||Date.parse(p.predicted_at)>=Date.parse(o.lock_at)||Date.parse(p.data_cutoff)>Date.parse(p.predicted_at)||
   Date.parse(o.ingested_at)>Date.parse(p.predicted_at)||!Number.isFinite(Number(o.line))){invalid++;continue;}
  scored.push({o,p,base,candidate:candidateOf(base,o,p),
   key:[o.provider_event_id,p.athlete_id,o.stat,Number(o.line)].join('|'),pick:pick.get(p.id)});
 }
 // Forward evaluation always uses the FIRST archived forecast for an exact line, across both platforms.
 const first=new Map<string,Scored>();
 for(const s of [...scored].sort((a,b)=>Date.parse(a.o.ingested_at)-Date.parse(b.o.ingested_at)||a.o.id-b.o.id))if(!first.has(s.key))first.set(s.key,s);
 const evaluation:EvaluationRow[]=[];let pending=0,voided=0,preRegistration=0;
 for(const s of first.values()){
  if(Date.parse(s.o.ingested_at)<Date.parse(forwardStartsAt)){preRegistration++;continue;}
  const result=results.get(s.o.id);if(!result){pending++;continue;}
  if(!['more','less','tie'].includes(result.outcome)){voided++;continue;}
  // A final result can only be admitted after the associated game locked.
  if(Date.parse(result.graded_at)<=Date.parse(s.o.lock_at)){invalid++;continue;}
  const actual=result.actual===null?null:Number(result.actual);
  if(actual===null||!Number.isFinite(actual)||(actual>Number(s.o.line)?'more':actual<Number(s.o.line)?'less':'tie')!==result.outcome){invalid++;continue;}
  evaluation.push({key:s.key,eventId:s.o.provider_event_id,date:slateDate.format(new Date(s.o.lock_at)),stat:s.o.stat,
   baseline:s.base,candidate:s.candidate,outcome:result.outcome as EvaluationRow['outcome']});
 }
 return {scored,first,evaluation,results,pick,pending,voided,preRegistration,invalid,unscorable};
}
type Scored={o:ResearchRaw['observations'][number];p:ResearchRaw['predictions'][number];base:Probabilities;
 candidate:Probabilities;key:string;pick:ResearchRaw['picks'][number]|undefined};
export function buildResearch(r:ResearchRaw,a:ResearchArtifact){
 if(a.baselineVersion!==MODEL_VERSION)throw new Error('RESEARCH_BASELINE_MISMATCH');
 const now=Date.parse(r.nowIso);if(!Number.isFinite(now))throw new Error('RESEARCH_INVALID_CLOCK');
 const {scored,first,evaluation,results,pending,voided,preRegistration,invalid,unscorable}=
  forwardRows(r,now,a.forwardStartsAt,(base,o)=>temperatureScale(base,a.temperatures[o.stat]));
 const baseline=summarize(evaluation.map(x=>({p:x.baseline,outcome:x.outcome})));
 const candidate=summarize(evaluation.map(x=>({p:x.candidate,outcome:x.outcome})));
 const dates=new Set(evaluation.map(x=>x.date)).size,games=new Set(evaluation.map(x=>x.eventId)).size;
 const g=a.reviewGate;
 const enough=baseline.n>=g.minGradedLines&&dates>=g.minDates&&games>=g.minGames&&candidate.decisions>=g.minCandidateDecisions;
 const interval=enough?pairedInterval(evaluation,g.bootstrapReplicates,g.bootstrapSeed):null;
 const passes=!!(enough&&interval&&interval.upper95<g.maxBrierDifferenceUpper95&&candidate.logLoss!==null&&baseline.logLoss!==null&&candidate.logLoss<=baseline.logLoss);
 const latest=new Map<string,Scored>();
 for(const s of [...scored].sort((a,b)=>a.o.provider_last_update.localeCompare(b.o.provider_last_update)||a.o.ingested_at.localeCompare(b.o.ingested_at)||a.o.id-b.o.id))
  latest.set(s.o.platform+'|'+s.key,s);
 const quoteKey=(o:ResearchRaw['observations'][number])=>[o.platform,o.provider_event_id,playerKey(o.player_name),o.stat,Number(o.line)].join('|');
 const latestQuote=new Map<string,number>();
 for(const o of [...r.observations].filter(o=>finiteDate(o.recorded_at)&&Date.parse(o.recorded_at)<=now)
  .sort((a,b)=>a.provider_last_update.localeCompare(b.provider_last_update)||a.ingested_at.localeCompare(b.ingested_at)||a.id-b.id))latestQuote.set(quoteKey(o),o.id);
 const ranking=(version:'baseline'|'candidate')=>{
  if(r.control?.state!=='RUNNING')return [];
  return [...latest.values()].flatMap(s=>{
   if(latestQuote.get(quoteKey(s.o))!==s.o.id)return [];
   const lock=Date.parse(s.o.lock_at),quote=Date.parse(s.o.provider_last_update);
   if(lock-now<=OBSERVATION_RULES.lockBufferMs||quote>now+OBSERVATION_RULES.maxClockSkewMs||
    now-quote>OBSERVATION_RULES.maxQuoteAgeMs||results.has(s.o.id))return [];
   const probs=version==='baseline'?s.base:s.candidate,decision=decidePick({status:'scored',...probs});
   if(decision.status!=='recorded')return [];
   if(version==='baseline'&&(s.pick?.status!=='recorded'||s.pick.side!==decision.side))return [];
   return [{observationId:s.o.id,platform:s.o.platform,eventId:s.o.provider_event_id,player:s.o.player_name,stat:s.o.stat,line:Number(s.o.line),
    side:decision.side,probability:decision.probability,game:s.o.away_team+' @ '+s.o.home_team,lockAt:s.o.lock_at,
    quoteAt:s.o.provider_last_update,entryIds:version==='baseline'?r.entryLegs.filter(l=>l.pick_id===s.pick?.id).map(l=>l.entry_id):[]}];
  }).sort((a,b)=>b.probability-a.probability||a.lockAt.localeCompare(b.lockAt)||a.observationId-b.observationId);
 };
 return {asOf:r.nowIso,windowStart:r.windowStart,control:r.control,protocolId:a.protocolId,candidateVersion:a.candidateVersion,
  activeVersion:MODEL_VERSION,forwardStartsAt:a.forwardStartsAt,baseline,candidate,
  progress:{dates,games,pending,voided,preRegistration,invalid,unscorable,duplicates:scored.length-first.size},
  review:{status:passes?'ready_for_review':enough?'needs_more_evidence':'collecting',gate:g,interval,promotionEnabled:false,profitabilityDemonstrated:false},
  rankings:{baseline:ranking('baseline'),candidate:ranking('candidate')},
  byStat:Object.fromEntries((['points','rebounds','assists'] as const).map(stat=>[stat,{
   baseline:summarize(evaluation.filter(x=>x.stat===stat).map(x=>({p:x.baseline,outcome:x.outcome}))),
   candidate:summarize(evaluation.filter(x=>x.stat===stat).map(x=>({p:x.candidate,outcome:x.outcome})))}]))};
}
export type PropsResearchView=ReturnType<typeof buildResearch>;

/**
 * Research-only challenger props-gap-shrink-v1 (docs/PROPS_CHALLENGER_GAP_SHRINK_2026_11_12.md). Hypothesis: when the
 * model's mean is far from the DFS line, the line reflects information the model lacks (role, injury, rotation), so the
 * model's conditional More/Less edge should shrink toward 50%. Ties keep their explicit probability. Pure; frozen rule.
 */
export type GapShrinkRule={noShrinkBelow:number;fullShrinkAt:number;minKeep:number};
export function gapShrink(p:Probabilities,mean:number,line:number,rule:GapShrinkRule):Probabilities{
 if(!validProbabilities(p)||!Number.isFinite(mean)||!(line>0)||!(rule.fullShrinkAt>rule.noShrinkBelow)||rule.minKeep<0||rule.minKeep>1)
  throw new Error('INVALID_GAP_SHRINK_INPUT');
 if(p.pTie===1)return {...p};
 const gap=Math.abs(mean-line)/line;
 const keep=Math.max(rule.minKeep,Math.min(1,1-(gap-rule.noShrinkBelow)/(rule.fullShrinkAt-rule.noShrinkBelow)));
 const active=1-p.pTie,q=p.pMore/active,shrunk=0.5+(q-0.5)*keep;
 return {pMore:shrunk*active,pLess:(1-shrunk)*active,pTie:p.pTie};
}
export type ChallengerSpec={version:string;protocolId:string;registeredAt:string;forwardStartsAt:string;rule:GapShrinkRule;
 reviewGate:{minGradedLines:number;minDates:number;minGames:number;maxBrierDifferenceUpper95:number;bootstrapReplicates:number;bootstrapSeed:number}};
/** Prospective score of the gap-shrink challenger against the live model on the same admitted lines. Never promotes. */
export function evaluateGapChallenger(r:ResearchRaw,spec:ChallengerSpec){
 const now=Date.parse(r.nowIso);if(!Number.isFinite(now))throw new Error('RESEARCH_INVALID_CLOCK');
 let missingMean=0;
 const {evaluation,pending,voided,preRegistration,invalid}=forwardRows(r,now,spec.forwardStartsAt,(base,o,p)=>{
  const mean=p.mean===null||p.mean===undefined?NaN:Number(p.mean);
  if(!Number.isFinite(mean)){missingMean++;return base;}
  return gapShrink(base,mean,Number(o.line),spec.rule);});
 const baseline=summarize(evaluation.map(x=>({p:x.baseline,outcome:x.outcome})));
 const candidate=summarize(evaluation.map(x=>({p:x.candidate,outcome:x.outcome})));
 const dates=new Set(evaluation.map(x=>x.date)).size,games=new Set(evaluation.map(x=>x.eventId)).size,g=spec.reviewGate;
 const enough=baseline.n>=g.minGradedLines&&dates>=g.minDates&&games>=g.minGames;
 const interval=enough?pairedInterval(evaluation,g.bootstrapReplicates,g.bootstrapSeed):null;
 const better=!!(interval&&interval.upper95<g.maxBrierDifferenceUpper95&&candidate.logLoss!==null&&baseline.logLoss!==null&&candidate.logLoss<=baseline.logLoss);
 return {version:spec.version,protocolId:spec.protocolId,forwardStartsAt:spec.forwardStartsAt,
  baseline:{n:baseline.n,brier:baseline.brier,logLoss:baseline.logLoss},candidate:{n:candidate.n,brier:candidate.brier,logLoss:candidate.logLoss},
  progress:{dates,games,pending,voided,preRegistration,invalid,missingMean},interval,
  status:!enough?'collecting':better?'ready_for_review':'no_improvement_yet',promotionEnabled:false as const,profitabilityDemonstrated:false as const};
}
