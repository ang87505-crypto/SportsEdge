/**
 * Research challenger props-nb-monotone-cal-v1 (docs/PROPS_CHALLENGER_MONOTONE_CAL_PREREG_2026_11_20.md). Pure; no I/O.
 * NOT used by the live worker. The production model (props-nb-minutes-rate-v1) is unchanged.
 *
 * A per-stat, shrinkage-regularized isotonic map from the frozen baseline's binary P(more) to a recalibrated P(more).
 * Non-parametric in shape, so it can represent a plateau of observed hit rates at high stated confidence, which a
 * log-odds intercept/slope recalibration (already tested) cannot. Monotone, so the baseline's ranking of lines is kept
 * (ties may merge) and genuinely strong forecasts stay the strongest.
 *
 * Small-sample safeguards: every bin is shrunk toward the pooled-stat bin with KAPPA pseudo-lines, the pooled bin is
 * shrunk toward the identity (the baseline itself) with KAPPA pseudo-lines, and empty bins are the identity.
 */
import {createHash} from 'node:crypto';

export const CHALLENGER_ID='props-nb-monotone-cal-v1';
export const BIN_EDGES=Array.from({length:21},(_,i)=>i/20);
export const KAPPA=100;
export const OUTPUT_CLAMP:[number,number]=[0.01,0.99];
export const MIN_TRAINING_LINES_PER_STAT=2000;

export type CalLine={stat:string;q:number;y:0|1};
type Bin={n:number;sumQ:number;sumY:number};
export type Knot={x:number;y:number;w:number};
export type MonotoneMap={knots:Knot[]};
export type MonotoneCalibration={challenger:typeof CHALLENGER_ID;kappa:number;binEdges:number[];
 trainingLines:Record<string,number>;pooled:MonotoneMap;byStat:Record<string,MonotoneMap>};

export const binOf=(q:number)=>Math.min(BIN_EDGES.length-2,Math.max(0,Math.floor(q*20)));
const r6=(x:number)=>Math.round(x*1e6)/1e6;

function bins(rows:CalLine[]):Bin[]{
 const b=Array.from({length:BIN_EDGES.length-1},()=>({n:0,sumQ:0,sumY:0}));
 for(const r of rows){
  if(!(r.q>=0&&r.q<=1)||(r.y!==0&&r.y!==1))throw new Error('MONOTONE_CAL_INVALID_LINE');
  const k=b[binOf(r.q)];k.n++;k.sumQ+=r.q;k.sumY+=r.y;
 }
 return b;
}
/** Weighted pool-adjacent-violators: the closest non-decreasing sequence. */
export function pav(points:{y:number;w:number}[]):number[]{
 const blocks:{y:number;w:number;len:number}[]=[];
 for(const p of points){
  blocks.push({y:p.y,w:p.w,len:1});
  while(blocks.length>1&&blocks[blocks.length-2].y>blocks[blocks.length-1].y){
   const b=blocks.pop()!,a=blocks.pop()!;
   blocks.push({y:(a.y*a.w+b.y*b.w)/(a.w+b.w),w:a.w+b.w,len:a.len+b.len});
  }
 }
 return blocks.flatMap(b=>Array(b.len).fill(b.y));
}
/**
 * Knots at each bin's mean forecast (bin midpoint when empty). Target = (hits + KAPPA * anchor) / (n + KAPPA),
 * where the anchor is the identity (pooled map) or the pooled map's value (per-stat map). Then PAV with weights n + KAPPA.
 */
function fitMap(b:Bin[],anchor:(x:number)=>number,kappa:number):MonotoneMap{
 const raw=b.map((k,i)=>{
  const x=k.n?k.sumQ/k.n:(BIN_EDGES[i]+BIN_EDGES[i+1])/2;
  return {x,y:(k.sumY+kappa*anchor(x))/(k.n+kappa),w:k.n+kappa};
 });
 const ys=pav(raw);
 return {knots:raw.map((k,i)=>({x:r6(k.x),y:r6(ys[i]),w:k.w}))};
}
/** Piecewise-linear through the knots; outside the outer knots the end value holds. Clamped to OUTPUT_CLAMP. */
export function applyMap(m:MonotoneMap,q:number):number{
 if(!(q>=0&&q<=1))throw new Error('MONOTONE_CAL_INVALID_PROBABILITY');
 const k=m.knots;let v:number;
 if(q<=k[0].x)v=k[0].y;
 else if(q>=k[k.length-1].x)v=k[k.length-1].y;
 else{
  let i=0;while(k[i+1].x<q)i++;
  const a=k[i],b=k[i+1];v=b.x>a.x?a.y+(b.y-a.y)*(q-a.x)/(b.x-a.x):Math.max(a.y,b.y);
 }
 return Math.min(OUTPUT_CLAMP[1],Math.max(OUTPUT_CLAMP[0],v));
}
export function fitMonotoneCalibration(rows:CalLine[],stats:readonly string[],kappa=KAPPA):MonotoneCalibration{
 const trainingLines=Object.fromEntries(stats.map(s=>[s,rows.filter(r=>r.stat===s).length]));
 for(const s of stats)if(trainingLines[s]<MIN_TRAINING_LINES_PER_STAT)throw new Error('MONOTONE_CAL_TOO_FEW_TRAINING_LINES '+s);
 const pooled=fitMap(bins(rows),x=>x,kappa);
 const byStat=Object.fromEntries(stats.map(s=>[s,fitMap(bins(rows.filter(r=>r.stat===s)),x=>applyMap(pooled,x),kappa)]));
 return {challenger:CHALLENGER_ID,kappa,binEdges:BIN_EDGES,trainingLines,pooled,byStat};
}
export function calibrate(c:MonotoneCalibration,stat:string,q:number):number{
 const m=c.byStat[stat];if(!m)throw new Error('MONOTONE_CAL_UNKNOWN_STAT '+stat);
 return applyMap(m,q);
}
export const calibrationDigest=(c:MonotoneCalibration)=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
