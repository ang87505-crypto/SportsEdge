/**
 * lab-sports-challengers-v2 (AI 2.0): pre-registered sports challengers that target the weaknesses seen on real
 * captured DFS lines (Nov 2026): More picks under-performing Less picks, confidence above realised hit rate, and
 * worse results when the model disagrees strongly with the line or has little/unstable playing-time history.
 *
 * Research only. Pure and deterministic: no I/O, no network, no randomness except the seeded bootstrap in
 * src/lib/lab/stats.ts. Every feature is computed from pre-lock inputs (the layer-1 forecast, games of history,
 * expected/SD minutes, the model mean and the line); nothing reads the outcome. Nothing here can change the
 * active model, picks, entries, stakes or budgets.
 *
 * Baselines: `base` (production layer 1 unchanged) and `recal` (the existing best retrospective layer:
 * per-stat bias + slope on the base log-odds, i.e. the lab-sports-ablation-v1 recalibration layer).
 */
import {canonicalJson,sha256} from '../../props/normalize.ts';
import type {Probabilities} from '../../props/research.ts';
import {STATS,type Stat} from '../../props/contract.ts';

export type ChallengerInput={base:Probabilities;games:number;expMinutes:number;sdMinutes:number;mean:number;line:number};
export type FeatureSet='recal'|'side_asym'|'uncertainty'|'line_gap'|'all_new';

export const CHALLENGERS_V2_SPEC={
 id:'lab-sports-challengers-v2',domain:'sports' as const,registeredAt:'2026-11-13T20:00:00Z',
 researchOnly:true,
 baselines:['base','recal'],
 candidates:[
  {id:'side_asym',features:'side_asym' as FeatureSet,hypothesis:'More-leaning and Less-leaning forecasts are miscalibrated differently; separate slopes for '+
   'positive and negative base log-odds improve probability quality over a single-slope recalibration.'},
  {id:'uncertainty',features:'uncertainty' as FeatureSet,hypothesis:'Forecasts for players with volatile minutes (high SD/expected minutes) or short history '+
   '(few games) are overconfident; shrinking their log-odds by learned amounts improves probability quality.'},
  {id:'line_gap',features:'line_gap' as FeatureSet,hypothesis:'When the model mean is far from the line, the line carries information the model lacks; '+
   'shrinking log-odds as the relative gap grows improves probability quality.'},
  {id:'all_new',features:'all_new' as FeatureSet,hypothesis:'The three adjustments together improve on single-slope recalibration.'},
 ],
 reference:'recal',
 features:{
  recal:['bias','base_logit'],
  side_asym:['bias','base_logit_pos','base_logit_neg'],
  uncertainty:['bias','base_logit','base_logit*minutes_cv','base_logit*inv_sqrt_games'],
  line_gap:['bias','base_logit','base_logit*abs_rel_gap'],
  all_new:['bias','base_logit_pos','base_logit_neg','base_logit*minutes_cv','base_logit*inv_sqrt_games','base_logit*abs_rel_gap'],
 },
 fitting:{model:'ridge-logistic per stat, bias unpenalised',lambdaGrid:[0.01,0.1,1,10],lambdaChoice:'time-ordered 5-chunk forward validation inside the training data only'},
 folds:[
  {id:'fold1',evidence:'exploratory',train:'2025-26 lines before 2026-01-01',test:'2025-26 lines from 2026-01-01 (season inspected by earlier studies)'},
  {id:'fold2',evidence:'out-of-season',train:'all 2025-26 lines',test:'2026-27 lines to the run date (layer 1 = production parameters)'},
  {id:'forward',evidence:'prospective',train:'all 2025-26 lines (weights frozen in the artifact)',test:'2026-27 games starting at or after forwardStartsAt, scored by re-running with --forward'},
 ],
 forwardStartsAt:'2026-11-14T00:00:00Z',
 metrics:{primary:'brier',secondary:['logLoss','ece','qualified-pick hit rate','coverage','side calibration']},
 decisionRule:{
  family:'Holm across the 4 candidate-vs-recal Brier comparisons in each fold, alpha 0.05, game-clustered bootstrap (2000 replicates, seed 20261113)',
  promising:'fold2 Holm p < 0.05 AND fold2 Brier upper95 < 0 AND fold1 mean Brier difference < 0 AND fold2 log loss not worse',
  rejected:'fold2 Brier lower95 > 0 (credibly worse than recal) OR fold1 and fold2 both point the wrong way',
  otherwise:'NO_CLEAR_EFFECT (kept as a hypothesis; may continue only through prospective forward evaluation)',
  promotion:'Never automatic. PROMISING only enters prospective forward evaluation; the existing review gate (500 graded real lines, 14 dates, 50 games) applies before READY_FOR_REVIEW.',
 },
 bootstrap:{replicates:2000,seed:20261113},
 proxyLines:'floor(median of last 10)+0.5, the lab-sports-ablation-v1 proxy; not platform lines, so no return is implied.',
};
export const CHALLENGERS_V2_SHA256=sha256(canonicalJson(CHALLENGERS_V2_SPEC));

const EPS=1e-6;
const clamp=(p:number)=>Math.min(1-EPS,Math.max(EPS,p));
const logit=(p:number)=>{const c=clamp(p);return Math.log(c/(1-c));};
const sigmoid=(z:number)=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));

/** P(More | not a tie) from a layer-1 forecast. */
export function baseMore(p:Probabilities):number{const n=1-p.pTie;return n>0?p.pMore/n:0.5;}

/** The pre-lock feature vector for one line. Every input exists before lock; no outcome is read. */
export function features(set:FeatureSet,x:ChallengerInput):number[]{
 const z=logit(baseMore(x.base));
 const cv=x.expMinutes>0?Math.min(2,x.sdMinutes/x.expMinutes):1;
 const invG=1/Math.sqrt(Math.max(1,x.games));
 const gap=Math.min(2,Math.abs(x.mean-x.line)/Math.max(1,x.line));
 switch(set){
  case 'recal':return [1,z];
  case 'side_asym':return [1,Math.max(z,0),Math.min(z,0)];
  case 'uncertainty':return [1,z,z*cv,z*invG];
  case 'line_gap':return [1,z,z*gap];
  case 'all_new':return [1,Math.max(z,0),Math.min(z,0),z*cv,z*invG,z*gap];
 }
}

/** Dense solve (small systems). */
function solve(A:number[][],b:number[]):number[]{
 const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
 for(let c=0;c<n;c++){
  let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
  [M[c],M[p]]=[M[p],M[c]];const d=M[c][c];if(Math.abs(d)<1e-12)throw new Error('LAB_V2_SINGULAR');
  for(let r=c+1;r<n;r++){const f=M[r][c]/d;for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}
 }
 const x=new Array(n).fill(0);
 for(let r=n-1;r>=0;r--){let s=M[r][n];for(let k=r+1;k<n;k++)s-=M[r][k]*x[k];x[r]=s/M[r][r];}
 return x;
}

export type Row={x:number[];y:0|1;at:string};
/** Ridge logistic regression by Newton/IRLS; the bias (index 0) is not penalised. Starts from the identity
 * calibration (bias 0, first slope-like weights 1) so a weak signal stays close to the base model. */
export function fitRidge(rows:Row[],lambda:number,start:number[]):number[]{
 const k=start.length;let w=[...start];
 for(let it=0;it<60;it++){
  const g=new Array(k).fill(0),H=Array.from({length:k},()=>new Array(k).fill(0));
  for(const r of rows){
   const p=sigmoid(r.x.reduce((a,v,i)=>a+v*w[i],0)),e=p-r.y,s=Math.max(p*(1-p),1e-9);
   for(let i=0;i<k;i++){g[i]+=e*r.x[i];for(let j=0;j<k;j++)H[i][j]+=s*r.x[i]*r.x[j];}
  }
  for(let i=1;i<k;i++){g[i]+=lambda*(w[i]-start[i]);H[i][i]+=lambda;}
  const step=solve(H,g);let max=0;
  w=w.map((v,i)=>{max=Math.max(max,Math.abs(step[i]));return v-step[i];});
  if(max<1e-8)break;
 }
 return w;
}

/** Identity starting weights: the base forecast unchanged. */
export function identityStart(set:FeatureSet):number[]{
 switch(set){
  case 'recal':return [0,1];
  case 'side_asym':return [0,1,1];
  case 'uncertainty':return [0,1,0,0];
  case 'line_gap':return [0,1,0];
  case 'all_new':return [0,1,1,0,0,0];
 }
}

const logLossOf=(rows:Row[],w:number[])=>rows.reduce((a,r)=>{const p=clamp(sigmoid(r.x.reduce((s,v,i)=>s+v*w[i],0)));return a-(r.y?Math.log(p):Math.log(1-p));},0)/Math.max(1,rows.length);

/** Lambda chosen by time-ordered forward validation inside the training rows only (never the test fold). */
export function chooseLambda(rows:Row[],set:FeatureSet,grid=CHALLENGERS_V2_SPEC.fitting.lambdaGrid):number{
 const sorted=[...rows].sort((a,b)=>a.at.localeCompare(b.at));
 const size=Math.ceil(sorted.length/5),chunks=Array.from({length:5},(_,i)=>sorted.slice(i*size,(i+1)*size)).filter(c=>c.length);
 if(chunks.length<2)return grid[grid.length-1];
 let best=grid[grid.length-1],bestLoss=Infinity;
 for(const lambda of [...grid].reverse()){
  let loss=0,n=0;
  for(let c=1;c<chunks.length;c++){const w=fitRidge(chunks.slice(0,c).flat(),lambda,identityStart(set));loss+=logLossOf(chunks[c],w)*chunks[c].length;n+=chunks[c].length;}
  if(loss/n<bestLoss-1e-9){bestLoss=loss/n;best=lambda;}
 }
 return best;
}

export type TrainItem={stat:Stat;y:0|1;at:string;input:ChallengerInput};
export type ChallengerArtifact={set:FeatureSet;weights:Record<Stat,number[]>;lambda:Record<Stat,number>;trainRows:Record<Stat,number>};

export function trainChallenger(set:FeatureSet,items:TrainItem[]):ChallengerArtifact{
 const out:ChallengerArtifact={set,weights:{} as Record<Stat,number[]>,lambda:{} as Record<Stat,number>,trainRows:{} as Record<Stat,number>};
 for(const s of STATS){
  const rows=items.filter(i=>i.stat===s).map(i=>({x:features(set,i.input),y:i.y,at:i.at}));
  out.lambda[s]=rows.length?chooseLambda(rows,set):10;
  out.weights[s]=rows.length?fitRidge(rows,out.lambda[s],identityStart(set)):identityStart(set);
  out.trainRows[s]=rows.length;
 }
 return out;
}

/** Challenger probabilities for one line; keeps the base tie probability. */
export function predictChallenger(a:ChallengerArtifact|null,stat:Stat,x:ChallengerInput):Probabilities{
 const noTie=1-x.base.pTie;
 const q=a?sigmoid(features(a.set,x).reduce((s,v,i)=>s+v*a.weights[stat][i],0)):baseMore(x.base);
 const pMore=noTie*q;
 return {pMore,pLess:noTie-pMore,pTie:x.base.pTie};
}

export type Disposition='PROMISING'|'NO_CLEAR_EFFECT'|'REJECTED';
export type FoldComparison={candidate:string;brier:{mean:number;lower95:number;upper95:number}|null;logLossMean:number|null;pAdjusted:number|null};

/** The pre-registered decision rule, applied mechanically. */
export function disposition(fold1:FoldComparison|undefined,fold2:FoldComparison|undefined,alpha=0.05):{status:Disposition;reason:string}{
 if(!fold2?.brier||!fold1?.brier)return {status:'NO_CLEAR_EFFECT',reason:'A fold has no comparable observations.'};
 const f2=fold2.brier,f1=fold1.brier;
 if(f2.lower95>0)return {status:'REJECTED',reason:`Credibly worse than recalibration out of season (Brier +${f2.mean.toFixed(5)}, 95% CI ${f2.lower95.toFixed(5)} to ${f2.upper95.toFixed(5)}).`};
 if(f1.mean>=0&&f2.mean>=0)return {status:'REJECTED',reason:'No improvement in either fold.'};
 if(fold2.pAdjusted!==null&&fold2.pAdjusted<alpha&&f2.upper95<0&&f1.mean<0&&(fold2.logLossMean??0)<=0)
  return {status:'PROMISING',reason:`Better than recalibration in both folds; out of season Brier ${f2.mean.toFixed(5)} (95% CI ${f2.lower95.toFixed(5)} to ${f2.upper95.toFixed(5)}, Holm p=${fold2.pAdjusted.toFixed(4)}). Prospective evaluation required.`};
 return {status:'NO_CLEAR_EFFECT',reason:`Not distinguishable from recalibration after Holm (fold2 Brier ${f2.mean.toFixed(5)}, 95% CI ${f2.lower95.toFixed(5)} to ${f2.upper95.toFixed(5)}, p=${fold2.pAdjusted?.toFixed(4)}).`};
}
