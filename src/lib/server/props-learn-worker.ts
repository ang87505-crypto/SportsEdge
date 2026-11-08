/**
 * Weekly learning loop and the safety brake. SERVER/WORKER ONLY. Paper only: these functions write
 * model artifacts, lifecycle events, reports and control rows; they never collect lines, place an
 * entry or contact any account.
 *   train     retrain a challenger on all data, check it on held-out data, then shadow or drop it
 *   evaluate  score each shadowing challenger on its own forward predictions under the registered gate
 *   review    weekly mistake review and layer scorecards
 *   owner     learning on/off, auto-switch on/off, approve, roll back (one RPC each)
 */
import type {PropsStore} from './props-store.ts';
import {loadActiveModel,MAX_SHADOWING,LAYER1_VERSION} from './props-active-model.ts';
import {loadForwardLines,loadTeamRows,type ForwardLine,type Probs} from './props-learn-data.ts';
import {FEATURES,featureVector,fitRidgeLogistic,chooseLambda,marketFixedZero,predictLearn,artifactSha256,RECENCY_HALF_LIFE_DAYS,
 type LearnArtifact,type LearnInput} from '../props/learn.ts';
import {matchupFeatures,type Matchup,type TeamGameRow} from '../props/features.ts';
import {evaluateChallenger,REVIEW_GATE,type ReviewGate} from '../props/promotion.ts';
import {weeklyReview,type ReviewLine} from '../props/review.ts';
import {safetyBrake} from '../props/brake.ts';
import {properScore,type EvaluationRow} from '../props/research.ts';
import {teamAbbr} from '../props/identity.ts';
import {MODEL_VERSION,SELECTION_VERSION,SELECTION_VERSION_V2,STATS,type Stat} from '../props/contract.ts';

const DAY=86400_000;
const ago=(now:string,days:number)=>new Date(Date.parse(now)-days*DAY).toISOString();
const etDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));

// ---------------------------------------------------------------- pure helpers
export function nextVersion(existing:string[]):string{
 const n=existing.map(v=>/^props-learn-v(\d+)$/.exec(v)?.[1]).filter((x):x is string=>!!x).map(Number);
 return 'props-learn-v'+((n.length?Math.max(...n):0)+1);
}

/** Shadowing (latest event shadow_start/eligible) versions beyond the newest MAX_SHADOWING, never the active one. */
export function retireVersions(events:{id:number;version:string;event:string}[],active:string):string[]{
 const latest=new Map<string,{id:number;event:string}>();
 for(const e of events){const l=latest.get(e.version);if(!l||e.id>l.id)latest.set(e.version,e);}
 return [...latest.entries()].filter(([v,e])=>(e.event==='shadow_start'||e.event==='eligible')&&v!==active)
  .sort((a,b)=>b[1].id-a[1].id).slice(MAX_SHADOWING).map(([v])=>v);
}

/** Drop a challenger that is worse than the active model on held-out data; ties shadow. */
export function trainDecision(candidateBrier:number,activeBrier:number):'shadow'|'drop'{
 return candidateBrier>activeBrier?'drop':'shadow';
}

const favoured=(p:Probs)=>p.pMore>=p.pLess?'more' as const:'less' as const;
function matchupFor(l:ForwardLine,teamRows:TeamGameRow[]):Matchup|null{
 const home=teamAbbr(l.homeTeam),away=teamAbbr(l.awayTeam);
 if(!l.team||!home||!away||(l.team!==home&&l.team!==away))return null;
 return matchupFeatures({teamAbbr:l.team,opponentAbbr:l.team===home?away:home,home:l.team===home,lockAt:l.ingestedAt,stat:l.stat,rows:teamRows});
}
const marketOf=(l:ForwardLine):LearnInput['market']=>l.market?{booksAtSameLine:l.market.booksAtSameLine,pMoreBooks:l.market.pMoreBooks,
 nearestBookLine:l.market.nearestBookLine,lineGap:l.market.lineGap,flags:l.market.flags as ('lagging_line'|'pros_disagree')[]}:null;

export type TrainItem={stat:Stat;input:LearnInput;y:0|1;at:string;key:string;eventId:string;date:string};
/** Graded More/Less forward lines with a layer-1 estimate and a known team, as training items. */
export function forwardItems(lines:ForwardLine[],teamRows:TeamGameRow[]):TrainItem[]{
 const out:TrainItem[]=[];
 for(const l of lines){
  const base=l.predictions[MODEL_VERSION]?.probs;
  if((l.outcome!=='more'&&l.outcome!=='less')||!base)continue;
  const matchup=matchupFor(l,teamRows);if(!matchup)continue;
  out.push({stat:l.stat,input:{base,market:marketOf(l),matchup},y:l.outcome==='more'?1:0,at:l.lockAt,key:l.key,eventId:l.eventId,date:l.date});
 }
 return out;
}
export function forwardTrainingRows(lines:ForwardLine[],teamRows:TeamGameRow[],nowIso:string){
 const rows=Object.fromEntries(STATS.map(s=>[s,[] as {x:number[];y:0|1;w:number;at:string}[]])) as Record<Stat,{x:number[];y:0|1;w:number;at:string}[]>;
 const counts=Object.fromEntries(STATS.map(s=>[s,{forward:0,forwardWithBooks:0}])) as Record<Stat,{forward:number;forwardWithBooks:number}>;
 for(const it of forwardItems(lines,teamRows)){
  const age=Math.max(0,(Date.parse(nowIso)-Date.parse(it.at))/DAY);
  rows[it.stat].push({x:featureVector(it.input),y:it.y,w:0.5**(age/RECENCY_HALF_LIFE_DAYS),at:it.at});
  counts[it.stat].forward++;
  if(it.input.market?.pMoreBooks!=null)counts[it.stat].forwardWithBooks++;
 }
 return {rows,counts};
}

/** Active model vs one challenger on the same graded lines (ties kept as outcomes; voids excluded). */
export function evaluationRows(lines:ForwardLine[],activeVersion:string,challenger:string):EvaluationRow[]{
 return lines.flatMap(l=>{
  const a=l.predictions[activeVersion]?.probs,c=l.predictions[challenger]?.probs;
  if(!a||!c||l.outcome===null||l.outcome==='void')return [];
  return [{key:l.key,eventId:l.eventId,date:l.date,stat:l.stat,baseline:a,candidate:c,outcome:l.outcome}];
 });
}

export function reviewLines(lines:ForwardLine[],activeVersion:string,selectionVersion:string):ReviewLine[]{
 return lines.flatMap(l=>{
  const layer1=l.predictions[MODEL_VERSION]?.probs,active=l.predictions[activeVersion]?.probs;
  if(!layer1||!active||l.outcome===null)return [];
  const pick=l.picks.find(p=>p.modelVersion===activeVersion&&p.selectionVersion===selectionVersion);
  const ratio=[activeVersion,...Object.keys(l.predictions)].map(v=>(l.predictions[v]?.inputs?.matchup as {oppAllowedRatio?:number}|undefined)?.oppAllowedRatio)
   .find((x):x is number=>typeof x==='number')??1;
  const exp=l.predictions[MODEL_VERSION]?.inputs?.expMinutes;
  return [{key:l.key,eventId:l.eventId,date:l.date,stat:l.stat,outcome:l.outcome,layer1,active,books:l.market?.pMoreBooks??null,
   challengers:Object.fromEntries(Object.entries(l.predictions).filter(([v])=>v!==activeVersion&&v!==MODEL_VERSION).map(([v,p])=>[v,p.probs])),
   recorded:pick?.status==='recorded',side:pick?.status==='recorded'?pick.side:null,expMinutes:typeof exp==='number'?exp:null,
   actualMinutes:l.actualMinutes,oppAllowedRatio:ratio}];
 });
}

export function brakePicks(lines:ForwardLine[],activeVersion:string,selectionVersion:string){
 return lines.flatMap(l=>{
  const pick=l.picks.find(p=>p.modelVersion===activeVersion&&p.selectionVersion===selectionVersion&&p.status==='recorded');
  if(!pick?.side||(l.outcome!=='more'&&l.outcome!=='less'))return [];
  return [{key:l.key,correct:pick.side===l.outcome,gradedAt:l.gradedAt??l.lockAt}];
 });
}

export async function applySafetyBrake(store:Pick<PropsStore,'rpc'>,picks:{key:string;correct:boolean;gradedAt:string}[],control:string|null){
 const r=safetyBrake(picks,control);
 if(r.trip)await store.rpc('props_set_control',{p_state:'PAUSED',p_actor:'system:safety-brake',
  p_reason:`SAFETY_BRAKE: last ${r.n} picks hit ${(r.hitRate!*100).toFixed(1)}%, confidently below the 57.7% break-even`});
 return r;
}

// ---------------------------------------------------------------- orchestrators
type Control={active_model_version:string;previous_model_version:string|null;learning_enabled:boolean;auto_switch_enabled:boolean};
async function control(store:PropsStore):Promise<Control>{
 const [c]=await store.select<Control>('props_model_control','select=active_model_version,previous_model_version,learning_enabled,auto_switch_enabled');
 if(!c)throw new Error('PROPS_MODEL_CONTROL_MISSING');
 return c;
}
const brier=(rows:{p:Probs;y:0|1}[])=>rows.length?rows.reduce((a,r)=>a+properScore(r.p,r.y?'more':'less').brier,0)/rows.length:null;

export type LearnDeps={store:PropsStore;now:()=>string;historical:TrainItem[]};

export async function runTrain(d:LearnDeps){
 const c=await control(d.store);
 if(!c.learning_enabled)return {status:'LEARNING_DISABLED'};
 const now=d.now();
 const active=await loadActiveModel(d.store);
 const [lines,teamRows]=await Promise.all([loadForwardLines(d.store,ago(now,180)),loadTeamRows(d.store,ago(now,275))]);
 // Hold out the newest 14 days of forward lines and the newest 20% of history to check the challenger.
 const cut=ago(now,14);
 const fwd=forwardItems(lines,teamRows);
 const hist=[...d.historical].sort((a,b)=>a.at.localeCompare(b.at));
 const histCut=hist.length?hist[Math.floor(hist.length*0.8)]?.at??hist[hist.length-1].at:'';
 const train=[...hist.filter(x=>x.at<histCut).map(x=>({...x,w:1})),
  ...fwd.filter(x=>x.at<cut).map(x=>({...x,w:0.5**(Math.max(0,(Date.parse(now)-Date.parse(x.at))/DAY)/RECENCY_HALF_LIFE_DAYS)}))];
 const holdout=[...hist.filter(x=>x.at>=histCut),...fwd.filter(x=>x.at>=cut)];
 const withBooks=train.filter(x=>x.input.market?.pMoreBooks!=null).length;
 const fixed=marketFixedZero(withBooks);
 const weights={} as Record<Stat,number[]>,lambda={} as Record<Stat,number>;
 try{
  for(const s of STATS){
   const rows=train.filter(x=>x.stat===s).map(x=>({x:featureVector(x.input),y:x.y,w:x.w,at:x.at}));
   if(rows.some(r=>!r.x.every(Number.isFinite)))throw new Error('PROPS_LEARN_NON_FINITE');
   lambda[s]=rows.length?chooseLambda(rows,fixed):1;
   weights[s]=rows.length?fitRidgeLogistic(rows,lambda[s],fixed):[0,1,0,0,0,0,0,0,0];
  }
 }catch{return {status:'FAILED_INVALID_ARTIFACT'};}
 const artifacts=await d.store.select<{version:string}>('props_model_artifacts','select=version&limit=1000');
 const version=nextVersion(artifacts.map(a=>a.version));
 const artifact:LearnArtifact={modelVersion:version,baseModelVersion:MODEL_VERSION,trainedAt:now,dataCutoff:cut,features:[...FEATURES],
  weights,lambda,marketWeightsActive:fixed.length===0,
  counts:Object.fromEntries(STATS.map(s=>[s,{historical:hist.filter(x=>x.stat===s&&x.at<histCut).length,
   forward:fwd.filter(x=>x.stat===s&&x.at<cut).length,forwardWithBooks:fwd.filter(x=>x.stat===s&&x.at<cut&&x.input.market?.pMoreBooks!=null).length}])) as LearnArtifact['counts']};
 const candidate=brier(holdout.map(x=>({p:predictLearn(artifact,x.stat,x.input),y:x.y})));
 const current=brier(holdout.map(x=>({p:active.artifact?predictLearn(active.artifact,x.stat,x.input):x.input.base,y:x.y})));
 const decision=candidate===null||current===null?'shadow':trainDecision(candidate,current);
 const holdoutSummary={n:holdout.length,candidateBrier:candidate,activeBrier:current,activeVersion:active.version};
 await d.store.insert('props_model_artifacts',[{version,sha256:artifactSha256(artifact),artifact}]);
 await d.store.insert('props_model_events',[{version,event:'created',reason:'weekly retrain',actor:'system:learn',detail:{holdout:holdoutSummary}},
  {version,event:decision==='shadow'?'shadow_start':'dropped',actor:'system:learn',detail:{holdout:holdoutSummary},
   reason:decision==='shadow'?'Not worse than the active model on held-out data':'Worse than the active model on held-out data'}]);
 const events=await d.store.select<{id:number;version:string;event:string}>('props_model_events','select=id,version,event&order=id.desc&limit=1000');
 const retired=retireVersions(events,active.version);
 if(retired.length)await d.store.insert('props_model_events',retired.map(v=>({version:v,event:'retired',actor:'system:learn',
  reason:'Replaced by newer challengers (at most '+MAX_SHADOWING+' shadow at once)'})));
 return {status:decision==='shadow'?'SHADOWING':'DROPPED',version,holdout:holdoutSummary,marketWeightsActive:artifact.marketWeightsActive,retired};
}

export async function runEvaluate(d:Omit<LearnDeps,'historical'>,gate:ReviewGate=REVIEW_GATE){
 const c=await control(d.store);
 const active=await loadActiveModel(d.store);
 const lines=await loadForwardLines(d.store,ago(d.now(),90));
 const events=await d.store.select<{id:number;version:string;event:string}>('props_model_events','select=id,version,event&order=id.desc&limit=1000');
 const latest=(v:string)=>events.find(e=>e.version===v)?.event;
 const challengers=[];let promoted:string|null=null;
 for(const {version} of active.shadows){
  const ev=evaluateChallenger(evaluationRows(lines,active.version,version),gate);
  const detail={lines:ev.candidate.n,dates:ev.dates,games:ev.games,decisions:ev.candidate.decisions,upper95:ev.interval?.upper95??null,
   candidateBrier:ev.candidate.brier,activeBrier:ev.baseline.brier,activeVersion:active.version};
  challengers.push({version,eligible:ev.eligible,failed:ev.failed,...detail});
  if(!ev.eligible)continue;
  if(latest(version)!=='eligible')await d.store.insert('props_model_events',[{version,event:'eligible',actor:'system:evaluate',
   reason:'Passed the registered review gate on its own forward predictions',detail}]);
  if(c.auto_switch_enabled&&!promoted){
   await d.store.rpc('props_promote_model',{p_version:version,p_actor:'system:auto-switch',
    p_reason:`Auto-switch: beat ${active.version} on ${detail.lines} graded lines`});
   promoted=version;
  }
 }
 return {status:'OK',active:active.version,challengers,promoted};
}

export async function runReview(d:Omit<LearnDeps,'historical'>){
 const now=d.now();
 const active=await loadActiveModel(d.store);
 const selection=active.artifact?SELECTION_VERSION_V2:SELECTION_VERSION;
 const lines=await loadForwardLines(d.store,ago(now,9));
 const period={from:etDate(ago(now,7)),to:etDate(now)};
 const report=weeklyReview(reviewLines(lines,active.version,selection),period);
 await d.store.insert('props_learning_reports',[{period_from:period.from,period_to:period.to,model_version:active.version,report}]);
 return {status:'OK',period,misses:report.misses,lines:report.scorecards.active.n};
}

/** After each settle: pause RUNNING picking when the active model's recent picks are confidently below break-even. */
export async function checkSafetyBrake(store:PropsStore,nowIso:string){
 const [ctl]=await store.select<{state:string}>('props_control','select=state&id=eq.1');
 const active=await loadActiveModel(store);
 const lines=await loadForwardLines(store,ago(nowIso,45));
 const r=await applySafetyBrake(store,brakePicks(lines,active.version,active.artifact?SELECTION_VERSION_V2:SELECTION_VERSION),ctl?.state??null);
 return {...r,model:active.version};
}

export const OWNER_KINDS=['learning_on','learning_off','auto_on','auto_off','approve','rollback'] as const;
export type OwnerKind=typeof OWNER_KINDS[number];
export async function runOwnerAction(store:PropsStore,kind:OwnerKind,a:{version?:string;reason:string;actor:string}){
 if(kind==='approve'){
  if(!a.version||!/^props-learn-v[0-9]+$/.test(a.version))throw new Error('PROPS_INVALID_VERSION');
  return store.rpc('props_promote_model',{p_version:a.version,p_actor:a.actor,p_reason:a.reason});
 }
 if(kind==='rollback')return store.rpc('props_rollback_model',{p_actor:a.actor,p_reason:a.reason});
 const c=await control(store);
 const learning=kind==='learning_on'?true:kind==='learning_off'?false:c.learning_enabled;
 const auto=kind==='auto_on'?true:kind==='auto_off'?false:c.auto_switch_enabled;
 return store.rpc('props_set_learning',{p_learning:learning,p_auto:auto,p_actor:a.actor,p_reason:a.reason});
}
export {LAYER1_VERSION};
