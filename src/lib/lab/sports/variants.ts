/**
 * Sports adapter: trains and applies the ablation variants of lab-sports-ablation-v1. Pure.
 * Reuses the production learning layer (src/lib/props/learn.ts): every learned variant is the SAME
 * ridge-logistic model and feature vector, with the weights of excluded layers pinned at exactly zero.
 * The market layer is a fixed, pre-registered rule (no weights are fit on forward data).
 */
import {featureVector,fitRidgeLogistic,chooseLambda,LAMBDA_GRID,type LearnRow} from '../../props/learn.ts';
import type {Matchup} from '../../props/features.ts';
import type {Probabilities} from '../../props/research.ts';
import {STATS,type Stat} from '../../props/contract.ts';
import {canonicalJson,sha256} from '../../props/normalize.ts';
import type {VariantDef} from '../registry.ts';

/** Feature-vector indices each learned layer frees (src/lib/props/learn.ts FEATURES). */
export const LAYER_INDICES:Record<string,number[]>={recalibration:[0,1],matchup_rest:[5,6,7,8]};
const ALL=[0,1,2,3,4,5,6,7,8];
/** Pre-registered market blend weight on the sportsbook log-odds (lab-sports-ablation-v1). */
export const MARKET_BLEND=0.5;

export type SportsLabInput={base:Probabilities;role:Probabilities|null;matchup:Matchup;booksPMore:number|null};
export type VariantArtifact={id:string;layers:string[];baseSource:'layer1'|'role';learned:boolean;market:boolean;
 weights:Record<Stat,number[]>|null;lambda:Record<Stat,number>|null;trainRows:Record<Stat,number>|null};
export type SportsLabArtifact={experimentId:string;specSha256:string;trainedThrough:string;sources:{file:string;sha256:string}[];
 variants:Record<string,VariantArtifact>};

const EPS=1e-6;
const clamp=(p:number)=>Math.min(1-EPS,Math.max(EPS,p));
const logit=(p:number)=>{const c=clamp(p);return Math.log(c/(1-c));};
const sigmoid=(z:number)=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));

export function fixedZeroFor(layers:string[]):number[]{
 const free=new Set(layers.flatMap(l=>LAYER_INDICES[l]??[]));
 return ALL.filter(i=>!free.has(i));
}
const isLearned=(layers:string[])=>layers.some(l=>l in LAYER_INDICES);

/** The base probabilities a variant starts from, or null when its base is unavailable for this line. */
function startingPoint(v:Pick<VariantArtifact,'baseSource'>,x:SportsLabInput):Probabilities|null{
 return v.baseSource==='role'?x.role:x.base;
}

export type TrainItem={stat:Stat;y:0|1;at:string;input:SportsLabInput};
/** Fit one variant on training items only (time-ordered lambda choice). Deterministic. */
export function trainVariant(v:VariantDef,items:TrainItem[]):VariantArtifact{
 const baseSource=v.layers.includes('role_minutes')?'role':'layer1';
 const out:VariantArtifact={id:v.id,layers:[...v.layers],baseSource,learned:isLearned(v.layers),market:v.layers.includes('market'),weights:null,lambda:null,trainRows:null};
 if(!out.learned)return out;
 const fixed=fixedZeroFor(v.layers);
 out.weights={} as Record<Stat,number[]>;out.lambda={} as Record<Stat,number>;out.trainRows={} as Record<Stat,number>;
 for(const s of STATS){
  const rows:(LearnRow&{at:string})[]=[];
  for(const it of items){
   if(it.stat!==s)continue;
   const p0=startingPoint(out,it.input);if(!p0)continue;
   rows.push({x:featureVector({base:p0,market:null,matchup:it.input.matchup}),y:it.y,w:1,at:it.at});
  }
  out.lambda[s]=rows.length?chooseLambda(rows,fixed):LAMBDA_GRID[LAMBDA_GRID.length-1];
  out.weights[s]=rows.length?fitRidgeLogistic(rows,out.lambda[s],fixed):[0,1,0,0,0,0,0,0,0];
  out.trainRows[s]=rows.length;
 }
 return out;
}

/** One variant's probabilities for one line; null when the variant cannot score it (never a guess). */
export function predictVariant(v:VariantArtifact,stat:Stat,x:SportsLabInput):Probabilities|null{
 const p0=startingPoint(v,x);if(!p0)return null;
 if(!v.learned&&!(v.market&&x.booksPMore!==null))return {...p0};
 const noTie=1-p0.pTie;
 let q=noTie>0?p0.pMore/noTie:0.5;
 if(v.learned){
  const w=v.weights![stat];
  q=sigmoid(featureVector({base:p0,market:null,matchup:x.matchup}).reduce((a,f,i)=>a+f*w[i],0));
 }
 if(v.market&&x.booksPMore!==null)q=sigmoid((1-MARKET_BLEND)*logit(q)+MARKET_BLEND*logit(x.booksPMore));
 const pMore=noTie*q;
 return {pMore,pLess:noTie-pMore,pTie:p0.pTie};
}

export function labArtifactSha256(a:SportsLabArtifact):string{return sha256(canonicalJson(a));}
