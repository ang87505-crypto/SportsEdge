/**
 * Shared experiment statistics for the AI Learning Lab. Pure and deterministic (seeded resampling),
 * no external services. Every comparison is paired (same frozen observations) and resampled by
 * cluster (a game for sports, a date for stocks), so correlated rows are never treated as independent.
 */

/** Seeded LCG, the same generator the props research uses, so results reproduce exactly. */
export function seeded(seed:number){let s=seed>>>0;return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};}

export type PairedLoss={cluster:string;candidate:number;reference:number};
export type PairedInterval={mean:number;lower95:number;upper95:number;clusters:number;n:number;
 /** One-sided bootstrap p-value for "candidate loss is lower than reference loss" ((k+1)/(B+1)). */
 pImprove:number};

/** Cluster bootstrap of mean(candidate − reference). Negative means the candidate has lower loss. */
export function clusteredDifference(rows:PairedLoss[],replicates=2000,seed=20261112):PairedInterval|null{
 const groups=new Map<string,{sum:number;n:number}>();
 let total=0;
 for(const r of rows){
  if(!Number.isFinite(r.candidate)||!Number.isFinite(r.reference))throw new Error('LAB_NON_FINITE_LOSS');
  const g=groups.get(r.cluster)??{sum:0,n:0};g.sum+=r.candidate-r.reference;g.n++;groups.set(r.cluster,g);total+=r.candidate-r.reference;
 }
 const blocks=[...groups.values()];
 if(blocks.length<2)return null;
 const random=seeded(seed),diffs:number[]=[];
 let notBetter=0;
 for(let i=0;i<replicates;i++){
  let sum=0,n=0;
  for(let j=0;j<blocks.length;j++){const b=blocks[Math.floor(random()*blocks.length)];sum+=b.sum;n+=b.n;}
  const d=sum/n;diffs.push(d);if(d>=0)notBetter++;
 }
 diffs.sort((a,b)=>a-b);
 return {mean:total/rows.length,lower95:diffs[Math.floor(replicates*0.025)],upper95:diffs[Math.min(replicates-1,Math.floor(replicates*0.975))],
  clusters:blocks.length,n:rows.length,pImprove:(notBetter+1)/(replicates+1)};
}

/**
 * Holm–Bonferroni step-down adjustment. Controls the family-wise error rate across every comparison
 * an experiment runs, so testing more variants cannot manufacture a "significant" improvement.
 */
export function holm(pValues:number[]):number[]{
 const order=pValues.map((p,i)=>({p,i})).sort((a,b)=>a.p-b.p||a.i-b.i);
 const m=pValues.length,out=new Array<number>(m).fill(1);
 let running=0;
 order.forEach(({p,i},k)=>{running=Math.max(running,Math.min(1,(m-k)*p));out[i]=running;});
 return out;
}

/** Binary Brier and log loss for P(y=1)=p. */
export const brier=(p:number,y:0|1)=>(p-y)**2;
export const logLoss=(p:number,y:0|1)=>{const c=Math.min(1-1e-12,Math.max(1e-12,p));return -(y?Math.log(c):Math.log(1-c));};

/** Expected calibration error over equal-width probability bins (10 bins), plus the bins themselves. */
export function calibration(rows:{p:number;y:0|1}[],bins=10){
 const b=Array.from({length:bins},(_,i)=>({from:i/bins,to:(i+1)/bins,n:0,meanP:0,observed:0}));
 for(const r of rows){const k=Math.min(bins-1,Math.max(0,Math.floor(r.p*bins)));b[k].n++;b[k].meanP+=r.p;b[k].observed+=r.y;}
 let ece=0;
 for(const x of b)if(x.n){x.meanP/=x.n;x.observed/=x.n;ece+=x.n/rows.length*Math.abs(x.meanP-x.observed);}
 return {ece:rows.length?ece:null,bins:b.filter(x=>x.n)};
}

/** Wilson score interval for k successes in n. */
export function wilson(k:number,n:number,z=1.96){
 if(n<=0)return {lower:0,upper:1};
 const p=k/n,z2=z*z,den=1+z2/n,centre=p+z2/(2*n),half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n));
 return {lower:(centre-half)/den,upper:(centre+half)/den};
}

export const round=(v:number|null|undefined,d=5)=>v===null||v===undefined||!Number.isFinite(v)?null:Math.round(v*10**d)/10**d;
