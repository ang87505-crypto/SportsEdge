/**
 * Learning layer: per-stat, L2-regularised logistic regression that decides how much to trust the
 * stats model, the sportsbooks and the matchup. Pure and deterministic. About a dozen readable
 * weights per stat, so it cannot memorise noise and every weight can be shown to the owner.
 *
 *   logit P(More | no tie) = w · x,   P(More) = (1 − P(tie)) · σ(w · x)
 *
 * P(tie) is carried unchanged from the stats model (layer 1).
 */
import type {Stat} from './contract.ts';
import type {MarketView} from './market.ts';
import type {Matchup} from './features.ts';
import type {Probabilities} from './research.ts';
import {canonicalJson,sha256} from './normalize.ts';

export const FEATURES=['bias','stats_logit','books_logit','books_present','line_gap_books','opp_allowed_ratio','home','rest_days','back_to_back'] as const;
/** Indices of the sportsbook terms: held at 0 until enough graded real lines carry book data. */
export const MARKET_FEATURES=[2,3,4];
export const MARKET_MIN_LINES=150;
export const LAMBDA_GRID=[0.01,0.1,1,10];
export const RECENCY_HALF_LIFE_DAYS=60;
const MAX_ITER=50;
const EPS=1e-6;

export type LearnInput={base:Probabilities;market:MarketView|null;matchup:Matchup};
export type LearnRow={x:number[];y:0|1;w:number};
export type LearnArtifact={modelVersion:string;baseModelVersion:'props-nb-minutes-rate-v1';trainedAt:string;dataCutoff:string;
 features:typeof FEATURES|string[];weights:Record<Stat,number[]>;lambda:Record<Stat,number>;marketWeightsActive:boolean;
 counts:Record<Stat,{historical:number;forward:number;forwardWithBooks:number}>};

const clamp=(p:number)=>Math.min(1-EPS,Math.max(EPS,p));
const logit=(p:number)=>{const c=clamp(p);return Math.log(c/(1-c));};
const sigmoid=(z:number)=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));

export function featureVector(x:LearnInput):number[]{
 const noTie=1-x.base.pTie;
 const statsMore=noTie>0?x.base.pMore/noTie:0.5;
 const books=x.market?.pMoreBooks??null;
 return [1,logit(statsMore),books===null?0:logit(books),books===null?0:1,x.market?.lineGap??0,
  x.matchup.oppAllowedRatio-1,x.matchup.home,x.matchup.restDays,x.matchup.backToBack];
}

/** The sportsbook terms are fixed at zero until this many graded real lines with book data exist. */
export function marketFixedZero(forwardWithBooks:number):number[]{
 return forwardWithBooks>=MARKET_MIN_LINES?[]:[...MARKET_FEATURES];
}

/** Solve A·x = b by Gaussian elimination with partial pivoting (small dense systems only). */
function solve(A:number[][],b:number[]):number[]{
 const n=b.length,M=A.map((row,i)=>[...row,b[i]]);
 for(let c=0;c<n;c++){
  let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
  [M[c],M[p]]=[M[p],M[c]];
  const d=M[c][c];if(Math.abs(d)<1e-12)throw new Error('PROPS_LEARN_SINGULAR');
  for(let r=c+1;r<n;r++){const f=M[r][c]/d;for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}
 }
 const x=new Array(n).fill(0);
 for(let r=n-1;r>=0;r--){let s=M[r][n];for(let k=r+1;k<n;k++)s-=M[r][k]*x[k];x[r]=s/M[r][r];}
 return x;
}

/** Newton/IRLS fit of weighted ridge logistic regression. Bias is unpenalised; fixed weights stay 0. */
export function fitRidgeLogistic(rows:LearnRow[],lambda:number,fixedZero:number[]):number[]{
 const k=FEATURES.length;
 const free=Array.from({length:k},(_,i)=>i).filter(i=>!fixedZero.includes(i));
 const w=new Array(k).fill(0);
 for(let it=0;it<MAX_ITER;it++){
  const g=new Array(free.length).fill(0);
  const H=free.map(()=>new Array(free.length).fill(0));
  for(const r of rows){
   const p=sigmoid(r.x.reduce((a,v,i)=>a+v*w[i],0));
   const e=r.w*(r.y-p),h=r.w*p*(1-p);
   for(let a=0;a<free.length;a++){
    const xa=r.x[free[a]];if(xa===0)continue;
    g[a]+=e*xa;
    for(let b=a;b<free.length;b++)H[a][b]+=h*xa*r.x[free[b]];
   }
  }
  for(let a=0;a<free.length;a++){
   for(let b=0;b<a;b++)H[a][b]=H[b][a];
   if(free[a]!==0){g[a]-=2*lambda*w[free[a]];H[a][a]+=2*lambda;}
   H[a][a]+=1e-9;
  }
  const step=solve(H,g);
  let max=0;
  free.forEach((i,a)=>{w[i]+=step[a];max=Math.max(max,Math.abs(step[a]));});
  if(max<1e-8)break;
 }
 if(!w.every(Number.isFinite))throw new Error('PROPS_LEARN_NON_FINITE');
 return w;
}

function meanLogLoss(rows:LearnRow[],w:number[]){
 let s=0,n=0;
 for(const r of rows){const p=clamp(sigmoid(r.x.reduce((a,v,i)=>a+v*w[i],0)));s+=r.w*-(r.y?Math.log(p):Math.log(1-p));n+=r.w;}
 return n?s/n:Infinity;
}

/** Forward-chaining validation over 5 time-ordered chunks; ties go to the larger (safer) lambda. */
export function chooseLambda(rows:(LearnRow&{at:string})[],fixedZero:number[]):number{
 const sorted=[...rows].sort((a,b)=>a.at.localeCompare(b.at));
 const size=Math.ceil(sorted.length/5);
 const chunks=Array.from({length:5},(_,i)=>sorted.slice(i*size,(i+1)*size)).filter(c=>c.length);
 if(chunks.length<2)return LAMBDA_GRID[LAMBDA_GRID.length-1];
 let best=LAMBDA_GRID[LAMBDA_GRID.length-1],bestLoss=Infinity;
 for(const lambda of [...LAMBDA_GRID].reverse()){
  let loss=0;
  for(let k=1;k<chunks.length;k++)loss+=meanLogLoss(chunks[k],fitRidgeLogistic(chunks.slice(0,k).flat(),lambda,fixedZero));
  if(loss<bestLoss-1e-12){bestLoss=loss;best=lambda;}
 }
 return best;
}

export function predictLearn(a:LearnArtifact,stat:Stat,x:LearnInput):Probabilities{
 const w=a.weights[stat];
 const z=featureVector(x).reduce((s,v,i)=>s+v*w[i],0);
 const noTie=1-x.base.pTie;
 const pMore=noTie*sigmoid(z);
 return {pMore,pLess:noTie-pMore,pTie:x.base.pTie};
}

export function artifactSha256(a:LearnArtifact):string{return sha256(canonicalJson(a));}
