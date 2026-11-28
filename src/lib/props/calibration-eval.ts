/**
 * Binary probability evaluation for props-nb-monotone-cal-v1 (research only; pure, no I/O).
 * Every score here is BINARY on P(more) with pushes excluded. Tie-aware multiclass scores (research.ts) are a different
 * quantity and are never mixed with these.
 */
export type EvalLine={game:string;date:string;stat:string;y:0|1;p:Record<string,number>};

/** 1 = above the line, 0 = below, null = exact tie (a push; only possible on integer lines) and excluded. */
export function binaryOutcome(actual:number,line:number):0|1|null{
 if(!Number.isFinite(actual)||!Number.isFinite(line))throw new Error('CAL_EVAL_INVALID_OUTCOME');
 return actual>line?1:actual<line?0:null;
}

const EPS=1e-6;
const clamp=(x:number)=>Math.min(1-EPS,Math.max(EPS,x));
const r6=(x:number)=>Math.round(x*1e6)/1e6;
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:NaN;
const ll=(p:number,y:0|1)=>-(y?Math.log(clamp(p)):Math.log(1-clamp(p)));
export const ECE_BINS=10;
const eceBin=(p:number)=>Math.min(ECE_BINS-1,Math.max(0,Math.floor(p*ECE_BINS)));

export const brier=(rs:EvalLine[],m:string)=>mean(rs.map(r=>(r.p[m]-r.y)**2));
export const logLoss=(rs:EvalLine[],m:string)=>mean(rs.map(r=>ll(r.p[m],r.y)));
export function ece(rs:EvalLine[],m:string):number{
 const n=new Array(ECE_BINS).fill(0),sp=new Array(ECE_BINS).fill(0),sy=new Array(ECE_BINS).fill(0);
 for(const r of rs){const k=eceBin(r.p[m]);n[k]++;sp[k]+=r.p[m];sy[k]+=r.y;}
 return rs.length?sp.reduce((a,_,k)=>a+Math.abs(sp[k]-sy[k]),0)/rs.length:NaN;
}
export function reliability(rs:EvalLine[],m:string){
 return Array.from({length:ECE_BINS},(_,k)=>{
  const b=rs.filter(r=>eceBin(r.p[m])===k);
  return {bin:`${(k/10).toFixed(1)}-${((k+1)/10).toFixed(1)}`,n:b.length,
   meanPredicted:b.length?r6(mean(b.map(r=>r.p[m]))):null,observedMore:b.length?r6(mean(b.map(r=>r.y))):null};
 });
}
export const CONFIDENCE_BANDS=[0.5,0.6,0.7,0.8,0.9] as const;
/** Decision-confidence bands max(P,1-P) by direction (More if P>=0.5), each model by its OWN forecasts. */
export function confidenceBands(rs:EvalLine[],m:string){
 const out:{band:string;direction:'More'|'Less';n:number;meanConfidence:number|null;hitRate:number|null;gap:number|null}[]=[];
 for(const dir of ['More','Less'] as const)CONFIDENCE_BANDS.forEach((lo,i)=>{
  const hi=CONFIDENCE_BANDS[i+1]??1.0000001;
  const b=rs.filter(r=>{const p=r.p[m],c=Math.max(p,1-p);return (p>=0.5)===(dir==='More')&&c>=lo&&c<hi;});
  const conf=b.length?mean(b.map(r=>Math.max(r.p[m],1-r.p[m]))):null;
  const hit=b.length?mean(b.map(r=>((r.p[m]>=0.5)===(r.y===1)?1:0))):null;
  out.push({band:lo===0.9?'0.90+':`${lo.toFixed(2)}-${hi.toFixed(2)}`,direction:dir,n:b.length,
   meanConfidence:conf===null?null:r6(conf),hitRate:hit===null?null:r6(hit),gap:conf===null||hit===null?null:r6(conf-hit)});
 });
 return out;
}
/** Murphy decomposition over 20 equal-width forecast bins: Brier ~= reliability - resolution + uncertainty. */
export function murphy(rs:EvalLine[],m:string){
 const K=20,n=new Array(K).fill(0),sp=new Array(K).fill(0),sy=new Array(K).fill(0);
 for(const r of rs){const k=Math.min(K-1,Math.floor(r.p[m]*K));n[k]++;sp[k]+=r.p[m];sy[k]+=r.y;}
 const N=rs.length,o=mean(rs.map(r=>r.y));
 let rel=0,res=0;
 for(let k=0;k<K;k++)if(n[k]){rel+=n[k]*(sp[k]/n[k]-sy[k]/n[k])**2;res+=n[k]*(sy[k]/n[k]-o)**2;}
 return {reliability:r6(rel/N),resolution:r6(res/N),uncertainty:r6(o*(1-o))};
}
/** Mann-Whitney AUC with average ranks for ties. */
export function auc(rs:EvalLine[],m:string):number{
 const s=[...rs].sort((a,b)=>a.p[m]-b.p[m]);
 let rankSumPos=0,pos=0,i=0;
 while(i<s.length){
  let j=i;while(j+1<s.length&&s[j+1].p[m]===s[i].p[m])j++;
  const avg=(i+j)/2+1;
  for(let k=i;k<=j;k++)if(s[k].y===1){rankSumPos+=avg;pos++;}
  i=j+1;
 }
 const neg=s.length-pos;
 return pos&&neg?(rankSumPos-pos*(pos+1)/2)/(pos*neg):NaN;
}
export const spread=(rs:EvalLine[],m:string)=>{const mu=mean(rs.map(r=>r.p[m]));return Math.sqrt(mean(rs.map(r=>(r.p[m]-mu)**2)));};

export type Interval={difference:number;lower95:number;upper95:number};
export type PairedResult={games:number;lines:number;brier:Interval;logLoss:Interval;ece:Interval};
/**
 * Paired bootstrap of whole games: all lines of a resampled game (every stat, every player) move together.
 * Differences are model a minus model b. Seeded LCG, so results are reproducible.
 */
export function pairedGameBootstrap(rs:EvalLine[],a:string,b:string,reps:number,seed:number):PairedResult|null{
 const games=new Map<string,{n:number;br:number;l:number;bins:Float64Array}>();
 for(const r of rs){
  const g=games.get(r.game)??{n:0,br:0,l:0,bins:new Float64Array(ECE_BINS*4)};
  const pa=r.p[a],pb=r.p[b];
  if(!(pa>=0&&pa<=1&&pb>=0&&pb<=1))throw new Error('CAL_EVAL_INVALID_PROBABILITY');
  g.n++;g.br+=(pa-r.y)**2-(pb-r.y)**2;g.l+=ll(pa,r.y)-ll(pb,r.y);
  // per bin: [sumP_a - sumY in a's bins] and [sumP_b - sumY in b's bins], kept as signed sums per bin
  g.bins[eceBin(pa)]+=pa-r.y;g.bins[ECE_BINS+eceBin(pb)]+=pb-r.y;
  games.set(r.game,g);
 }
 const list=[...games.keys()].sort().map(k=>games.get(k)!);
 if(!list.length)return null;
 const eceOf=(sel:typeof list,N:number)=>{
  const acc=new Float64Array(ECE_BINS*2);
  for(const g of sel)for(let k=0;k<ECE_BINS*2;k++)acc[k]+=g.bins[k];
  let ea=0,eb=0;for(let k=0;k<ECE_BINS;k++){ea+=Math.abs(acc[k]);eb+=Math.abs(acc[ECE_BINS+k]);}
  return (ea-eb)/N;
 };
 const N=list.reduce((s,g)=>s+g.n,0);
 let state=seed>>>0;const rnd=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const bs:number[]=[],ls:number[]=[],es:number[]=[];
 for(let k=0;k<reps;k++){
  const sel:typeof list=[];let n=0,br=0,l=0;
  for(let i=0;i<list.length;i++){const g=list[Math.floor(rnd()*list.length)];sel.push(g);n+=g.n;br+=g.br;l+=g.l;}
  bs.push(br/n);ls.push(l/n);es.push(eceOf(sel,n));
 }
 const ci=(xs:number[],point:number):Interval=>{const s=[...xs].sort((x,y)=>x-y);
  return {difference:r6(point),lower95:r6(s[Math.floor(0.025*reps)]),upper95:r6(s[Math.ceil(0.975*reps)-1])};};
 return {games:list.length,lines:N,
  brier:ci(bs,list.reduce((s,g)=>s+g.br,0)/N),logLoss:ci(ls,list.reduce((s,g)=>s+g.l,0)/N),ece:ci(es,eceOf(list,N))};
}

// ------------------------------------------------------------ the already-tested comparator

const logit=(p:number)=>Math.log(clamp(p)/(1-clamp(p)));
/** Single-slope recalibration (tested before: lab-sports-ablation-v1-recalibration): per stat, logistic on [1, logit(q)]. */
export function fitSingleSlopeRecal(rows:{stat:string;q:number;y:0|1}[],stats:readonly string[]){
 return Object.fromEntries(stats.map(s=>{
  const R=rows.filter(r=>r.stat===s);if(R.length<2)throw new Error('CAL_EVAL_RECAL_TOO_FEW '+s);
  let a=0,b=1;
  for(let it=0;it<50;it++){
   let g0=0,g1=0,h00=0,h01=0,h11=0;
   for(const r of R){const z=logit(r.q),p=1/(1+Math.exp(-(a+b*z))),e=p-r.y,w=Math.max(p*(1-p),1e-12);
    g0+=e;g1+=e*z;h00+=w;h01+=w*z;h11+=w*z*z;}
   const det=h00*h11-h01*h01;if(!(Math.abs(det)>1e-12))throw new Error('CAL_EVAL_RECAL_SINGULAR');
   a-=(h11*g0-h01*g1)/det;b-=(h00*g1-h01*g0)/det;
  }
  return [s,{intercept:r6(a),slope:r6(b)}];
 })) as Record<string,{intercept:number;slope:number}>;
}
export const applyRecal=(c:{intercept:number;slope:number},q:number)=>1/(1+Math.exp(-(c.intercept+c.slope*logit(q))));

// ------------------------------------------------------------ the pre-registered verdict

export type Verdict='QUALIFIES_FOR_FORWARD_TEST'|'NO_CLEAR_EFFECT'|'FAILS'|'INSUFFICIENT_EVIDENCE';
export const REQUIREMENTS={minLines:20_000,minGames:500,minResolutionRatio:0.8,maxAucDrop:0.002,minSpreadRatio:0.5} as const;
export type VerdictInput={
 lines:number;games:number;trainingLinesPerStat:Record<string,number>;minTrainingLinesPerStat:number;
 overall:PairedResult;highConfidence70:PairedResult|null;subgroups:Record<string,PairedResult|null>;
 resolution:{challenger:number;baseline:number};auc:{challenger:number;baseline:number};
 spread:{challenger:number;baseline:number};vsTestedRecalBrier:number;
};
/** `minimums` defaults to the retrospective R0; the forward arm passes its own pre-registered 5,000 lines / 150 games. */
export function decide(x:VerdictInput,minimums:{lines:number;games:number}={lines:REQUIREMENTS.minLines,games:REQUIREMENTS.minGames}):{verdict:Verdict;requirements:Record<string,boolean>}{
 const r={
  R0_data:x.lines>=minimums.lines&&x.games>=minimums.games&&
   Object.values(x.trainingLinesPerStat).every(n=>n>=x.minTrainingLinesPerStat),
  R1_brier:x.overall.brier.upper95<0,
  R2_logLoss:x.overall.logLoss.upper95<0,
  R3_ece:x.overall.ece.upper95<0,
  R4_highConfidence:!!x.highConfidence70&&x.highConfidence70.brier.upper95<0,
  R5_noSubgroupHarm:Object.values(x.subgroups).every(s=>!!s&&s.brier.lower95<=0),
  R6_noExcessCompression:x.resolution.challenger>=REQUIREMENTS.minResolutionRatio*x.resolution.baseline&&
   x.auc.challenger>=x.auc.baseline-REQUIREMENTS.maxAucDrop&&x.spread.challenger>=REQUIREMENTS.minSpreadRatio*x.spread.baseline,
  R7_beyondTestedRecal:x.vsTestedRecalBrier<0,
 };
 let verdict:Verdict;
 if(!r.R0_data)verdict='INSUFFICIENT_EVIDENCE';
 else if(x.overall.brier.lower95>0||x.overall.logLoss.lower95>0)verdict='FAILS';
 else if(r.R1_brier&&r.R2_logLoss&&r.R3_ece&&r.R4_highConfidence&&r.R5_noSubgroupHarm&&r.R6_noExcessCompression&&r.R7_beyondTestedRecal)
  verdict='QUALIFIES_FOR_FORWARD_TEST';
 else verdict='NO_CLEAR_EFFECT';
 return {verdict,requirements:r};
}
