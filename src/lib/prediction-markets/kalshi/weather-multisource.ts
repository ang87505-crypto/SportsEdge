/**
 * Pre-registered challenger knyc-multisource-emos-v1-research.
 * Protocol (frozen before any outcome was read): research/kalshi_weather_multisource_v1_20261126/protocol.json
 * and docs/KALSHI_WEATHER_MULTISOURCE_PREREG_2026_11_26.md.
 *
 * Combines NWS, NBM, GFS MOS and HRRR daily-high forecasts into one whole-degree distribution for the
 * NWS CLI climate-day high:
 * - per-station, per-anchor 30-day trailing bias correction;
 * - weights shrunk halfway toward equal;
 * - spread-dependent variance fitted by minimum CRPS;
 * - Gaussian discretised to whole degrees in ppm (the same output form as nws-empirical-error-pmf-v1, so the
 *   existing contract-math strike rules price it).
 * PURE: no network, no Kalshi data, no stakes or orders. Forecast skill here is NOT trading profitability.
 */
import {createHash} from 'node:crypto';
import {strikeIntegerRange,validateStrikePartition,type IntegerRange,type TemperatureStrike} from './contract-math.ts';

export const MULTISOURCE_MODEL_ID='knyc-multisource-emos-v1-research' as const;
export const MULTISOURCE_POLICY=Object.freeze({
 minTrainingDays:30,windowDays:30,maxSourceAgeHours:30,shrinkToEqual:0.5,sigmaFloorF:1.0,supportRadiusF:25,
 gridA:Object.freeze(Array.from({length:36},(_,i)=>i+1)),gridB:Object.freeze(Array.from({length:9},(_,i)=>i*0.25)),
 latencyHours:Object.freeze({NBM:2,GFS_MOS:5,HRRR:3}),
});
export const MEMBERS=['NWS','NBM','GFS_MOS','HRRR'] as const;
export type MemberId=typeof MEMBERS[number];
export type Anchor='DAY_AHEAD'|'SAME_DAY';
export const ANCHORS:readonly Anchor[]=['DAY_AHEAD','SAME_DAY'];

/** One member's forecast of one climate day's high, as it existed at availableAt. */
export type MemberForecast={member:MemberId;station:string;targetLocalDate:string;cycle:string;availableAt:string;
 valueF:number;sdF:number|null};
export type OutcomeProvenance='IEM_AFOS_CLI_ARCHIVE'|'NWS_CLI_PRELIMINARY_CENTRAL_PARK';
export type DailyOutcome={station:string;localDate:string;observedHighF:number;observedAvailableAt:string;provenance:OutcomeProvenance};
/** One forecastable day at one anchor: the members known at the anchor, and the outcome. */
export type AnchorDay={station:string;localDate:string;anchor:Anchor;anchorAt:string;
 members:Partial<Record<MemberId,{valueF:number;sdF:number|null;cycle:string}>>;
 observedHighF:number|null;observedAvailableAt:string|null};
export type Pmf={supportMinF:number;supportMaxF:number;pmfPpm:number[]};

const U=1_000_000,DAY=86_400_000,DATE=/^\d{4}-\d{2}-\d{2}$/;
const ms=(s:string)=>Date.parse(s);
const addDays=(d:string,n:number)=>new Date(ms(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);

/** Anchor instant: DAY_AHEAD = D-1 14:00Z, SAME_DAY = D 11:00Z. */
export function anchorAt(localDate:string,anchor:Anchor):string{
 if(!DATE.test(localDate)||!Number.isFinite(ms(localDate+'T00:00:00Z')))throw Error('WX_MS_INVALID_DATE');
 return anchor==='DAY_AHEAD'?addDays(localDate,-1)+'T14:00:00.000Z':localDate+'T11:00:00.000Z';
}
/** Hours from the anchor to the start of the climate day (D 05:00Z), as in forecastLeadHours. */
export const anchorLeadHours=(localDate:string,anchor:Anchor)=>(ms(localDate+'T05:00:00Z')-ms(anchorAt(localDate,anchor)))/3600_000;

function checkForecast(f:MemberForecast){
 if(!MEMBERS.includes(f.member)||typeof f.station!=='string'||!f.station||!DATE.test(f.targetLocalDate)||
  !Number.isFinite(ms(f.cycle))||!Number.isFinite(ms(f.availableAt))||ms(f.availableAt)<ms(f.cycle)||
  typeof f.valueF!=='number'||!Number.isFinite(f.valueF)||f.valueF< -100||f.valueF>150||
  (f.sdF!==null&&(typeof f.sdF!=='number'||!Number.isFinite(f.sdF)||f.sdF<0||f.sdF>40)))
  throw Error('WX_MS_INVALID_FORECAST');
}
/** Latest cycle of each member known at the anchor, at most maxSourceAgeHours old. Never imputes a missing member. */
export function selectMembers(forecasts:readonly MemberForecast[],station:string,localDate:string,anchor:Anchor,P=MULTISOURCE_POLICY){
 const at=ms(anchorAt(localDate,anchor)),out:AnchorDay['members']={};
 for(const m of MEMBERS){
  let best:MemberForecast|null=null;
  for(const f of forecasts){
   if(f.member!==m||f.station!==station||f.targetLocalDate!==localDate)continue;
   checkForecast(f);
   if(ms(f.availableAt)>at||at-ms(f.cycle)>P.maxSourceAgeHours*3600_000)continue;
   if(!best||ms(f.cycle)>ms(best.cycle)||(ms(f.cycle)===ms(best.cycle)&&ms(f.availableAt)<ms(best.availableAt)))best=f;
  }
  if(best)out[m]={valueF:best.valueF,sdF:best.sdF,cycle:best.cycle};
 }
 return out;
}
/** Every date with an outcome or a member, at one anchor, in date order. Duplicate outcomes are refused. */
export function buildAnchorDays(forecasts:readonly MemberForecast[],outcomes:readonly DailyOutcome[],station:string,anchor:Anchor):AnchorDay[]{
 const byDate=new Map<string,DailyOutcome>();
 for(const o of outcomes){
  if(o.station!==station)continue;
  if(!DATE.test(o.localDate)||!Number.isSafeInteger(o.observedHighF)||!Number.isFinite(ms(o.observedAvailableAt))||
   ms(o.observedAvailableAt)<ms(addDays(o.localDate,1)+'T05:00:00Z'))throw Error('WX_MS_INVALID_OUTCOME');
  if(byDate.has(o.localDate))throw Error('WX_MS_DUPLICATE_OUTCOME');byDate.set(o.localDate,o);
 }
 const dates=new Set([...byDate.keys(),...forecasts.filter(f=>f.station===station).map(f=>f.targetLocalDate)]);
 return [...dates].sort().map(localDate=>{const o=byDate.get(localDate);
  return {station,localDate,anchor,anchorAt:anchorAt(localDate,anchor),members:selectMembers(forecasts,station,localDate,anchor),
   observedHighF:o?.observedHighF??null,observedAvailableAt:o?.observedAvailableAt??null};});
}
/** The trailing window: the most recent days at the same station and anchor whose outcome was public before the anchor. */
export function trainingWindow(days:readonly AnchorDay[],target:AnchorDay,P=MULTISOURCE_POLICY):AnchorDay[]{
 const at=ms(target.anchorAt);
 return days.filter(d=>d.station===target.station&&d.anchor===target.anchor&&d.localDate<target.localDate&&
  d.observedHighF!==null&&d.observedAvailableAt!==null&&ms(d.observedAvailableAt)<at&&Object.keys(d.members).length>0)
  .sort((a,b)=>a.localDate.localeCompare(b.localDate)).slice(-P.windowDays);
}

// ---------- distributions and scores ----------
function erf(x:number){const s=Math.sign(x),t=1/(1+0.3275911*Math.abs(x));
 return s*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x));}
export const normalCdf=(z:number)=>0.5*(1+erf(z/Math.SQRT2));
/** Integer ppm, each cell at least 1 ppm, summing to exactly 1,000,000 (the nws-empirical-error-pmf-v1 rule). */
export function toPpm(weights:number[]):number[]{
 const total=weights.reduce((a,b)=>a+b,0),free=U-weights.length;
 const raw=weights.map(w=>w/total*free),floor=raw.map(r=>Math.floor(r)+1);
 let left=U-floor.reduce((a,b)=>a+b,0);
 for(const {i} of raw.map((r,i)=>({i,frac:r-Math.floor(r)})).sort((a,b)=>b.frac-a.frac||a.i-b.i)){if(left<=0)break;floor[i]++;left--;}
 return floor;
}
/** Gaussian discretised to whole degrees over round(mu) +/- radius; the edge cells hold the open tails. */
export function gaussianPmf(mu:number,sigma:number,P=MULTISOURCE_POLICY):Pmf{
 if(!Number.isFinite(mu)||!Number.isFinite(sigma)||sigma<=0)throw Error('WX_MS_INVALID_DISTRIBUTION');
 const c=Math.round(mu),lo=c-P.supportRadiusF,hi=c+P.supportRadiusF;
 const F=(x:number)=>normalCdf((x-mu)/sigma);
 const w=Array.from({length:hi-lo+1},(_,i)=>{const k=lo+i;
  return (k===hi?1:F(k+0.5))-(k===lo?0:F(k-0.5));}).map(x=>Math.max(x,0));
 return {supportMinF:lo,supportMaxF:hi,pmfPpm:toPpm(w)};
}
/** Ranked probability score over whole degrees: the CRPS of an integer-valued forecast. Outcomes outside clip to the tails. */
export function integerCrps(p:Pmf,y:number):number{
 let cum=0,s=0;
 for(let i=0;i<p.pmfPpm.length;i++){cum+=p.pmfPpm[i]/U;const k=p.supportMinF+i;
  if(i<p.pmfPpm.length-1)s+=(cum-(y<=k?1:0))**2;}
 return s;
}
/**
 * The same whole-degree CRPS for the discretised Gaussian before ppm rounding (used only to fit (a,b); the published
 * distribution is still the rounded gaussianPmf, which differs by at most one ppm per cell).
 */
export function gaussianIntegerCrps(mu:number,sigma:number,y:number,P=MULTISOURCE_POLICY):number{
 const c=Math.round(mu),lo=c-P.supportRadiusF,hi=c+P.supportRadiusF;let s=0;
 for(let k=lo;k<hi;k++)s+=(normalCdf((k+0.5-mu)/sigma)-(y<=k?1:0))**2;
 return s;
}
const cellOf=(p:Pmf,y:number)=>Math.min(p.pmfPpm.length-1,Math.max(0,y-p.supportMinF));
export const logLoss=(p:Pmf,y:number)=>-Math.log(p.pmfPpm[cellOf(p,y)]/U);
/** Central interval holding at least `level` of the mass, and whether y falls in it. */
export function intervalCovers(p:Pmf,y:number,level=0.8):boolean{
 const tail=(1-level)/2*U;let cum=0,lo=p.supportMinF,hi=p.supportMaxF,foundLo=false;
 for(let i=0;i<p.pmfPpm.length;i++){const k=p.supportMinF+i;
  if(!foundLo&&cum+p.pmfPpm[i]>tail){lo=k;foundLo=true;}
  cum+=p.pmfPpm[i];if(cum>=U-tail){hi=k;break;}}
 return y>=lo&&y<=hi;
}
/** PIT value (randomised to the cell midpoint) for calibration histograms. */
export function pit(p:Pmf,y:number):number{
 const c=cellOf(p,y);let below=0;for(let i=0;i<c;i++)below+=p.pmfPpm[i];
 return (below+p.pmfPpm[c]/2)/U;
}
/** P(YES) for any Kalshi strike, refusing strikes that split an open tail cell (same rule as the v1 PMF). */
export function pmfRangeProbabilityPpm(p:Pmf,r:IntegerRange):number{
 const lo=p.supportMinF,hi=p.supportMaxF;
 if((r.minF!==null&&r.minF<=lo)||(r.minF===null&&r.maxF!==null&&r.maxF<lo)||
  (r.maxF!==null&&r.maxF>=hi)||(r.maxF===null&&r.minF!==null&&r.minF>hi))throw Error('WEATHER_STRIKE_OUTSIDE_MODEL_SUPPORT');
 let t=0;p.pmfPpm.forEach((x,i)=>{const k=lo+i;if((r.minF===null||k>=r.minF)&&(r.maxF===null||k<=r.maxF))t+=x;});
 return t;
}
export function pmfEventProbabilitiesPpm(p:Pmf,strikes:readonly TemperatureStrike[]):number[]{
 validateStrikePartition(strikes);
 const out=strikes.map(s=>pmfRangeProbabilityPpm(p,strikeIntegerRange(s)));
 if(out.reduce((a,b)=>a+b,0)!==U)throw Error('WEATHER_EVENT_NOT_COHERENT');
 return out;
}

// ---------- the challenger ----------
type Fit={bias:Partial<Record<MemberId,number>>;mse:Partial<Record<MemberId,number>>;a:number;b:number};
const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
function combine(members:AnchorDay['members'],fit:Pick<Fit,'bias'|'mse'>,P=MULTISOURCE_POLICY){
 const present=MEMBERS.filter(m=>members[m]&&fit.bias[m]!==undefined&&fit.mse[m]!==undefined);
 if(!present.length)return null;
 const g=Object.fromEntries(present.map(m=>[m,members[m]!.valueF+fit.bias[m]!])) as Record<MemberId,number>;
 const inv=present.map(m=>1/Math.max(fit.mse[m]!,1e-6)),invSum=inv.reduce((a,b)=>a+b,0);
 const w=present.map((_,i)=>P.shrinkToEqual/present.length+(1-P.shrinkToEqual)*inv[i]/invSum);
 const mu=present.reduce((s,m,i)=>s+w[i]*g[m],0);
 const xnd=members.NBM&&present.includes('NBM')?members.NBM.sdF??0:0;
 const s2=present.reduce((s,m,i)=>s+w[i]*(g[m]-mu)**2,0)+xnd**2;
 return {mu,s2,weights:Object.fromEntries(present.map((m,i)=>[m,w[i]])) as Partial<Record<MemberId,number>>,present};
}
/** Fit bias, MSE and the (a,b) variance by minimum CRPS, using the window only. */
export function fitWindow(window:readonly AnchorDay[],P=MULTISOURCE_POLICY):Fit{
 const bias:Fit['bias']={},mse:Fit['mse']={};
 for(const m of MEMBERS){
  const rows=window.filter(d=>d.members[m]);
  if(!rows.length)continue;
  bias[m]=mean(rows.map(d=>d.observedHighF!-d.members[m]!.valueF));
  mse[m]=mean(rows.map(d=>(d.observedHighF!-d.members[m]!.valueF-bias[m]!)**2));
 }
 const pts=window.map(d=>({c:combine(d.members,{bias,mse},P),y:d.observedHighF!})).filter(x=>x.c);
 let best={a:P.gridA[0],b:P.gridB[0],score:Infinity};
 for(const a of P.gridA)for(const b of P.gridB){
  const score=mean(pts.map(x=>gaussianIntegerCrps(x.c!.mu,Math.max(P.sigmaFloorF,Math.sqrt(a+b*x.c!.s2)),x.y,P)));
  if(score<best.score-1e-12)best={a,b,score};
 }
 return {bias,mse,a:best.a,b:best.b};
}
export type MultisourceForecast={modelId:typeof MULTISOURCE_MODEL_ID;station:string;localDate:string;anchor:Anchor;anchorAt:string;
 leadHours:number;status:'AWAITING_VERIFIED_HISTORY'|'UNCALIBRATED_EXPERIMENTAL_MODEL';blocker:null|'WX_MS_INSUFFICIENT_DAYS'|'WX_MS_NO_MEMBER';
 trainingDays:number;trainingDigest:string|null;members:AnchorDay['members'];weights:Partial<Record<MemberId,number>>;
 bias:Fit['bias'];variance:{a:number;b:number}|null;mu:number|null;sigma:number|null;distribution:Pmf|null;marketDataUsed:false};
/** The challenger's forecast for one day: probabilities only with >= 30 admitted window days and >= 1 member. */
export function multisourceForecast(days:readonly AnchorDay[],target:AnchorDay,P=MULTISOURCE_POLICY):MultisourceForecast{
 const window=trainingWindow(days,target,P);
 const base={modelId:MULTISOURCE_MODEL_ID,station:target.station,localDate:target.localDate,anchor:target.anchor,
  anchorAt:target.anchorAt,leadHours:anchorLeadHours(target.localDate,target.anchor),trainingDays:window.length,
  members:target.members,marketDataUsed:false as const};
 const empty={weights:{},bias:{},variance:null,mu:null,sigma:null,distribution:null};
 if(window.length<P.minTrainingDays)return {...base,...empty,status:'AWAITING_VERIFIED_HISTORY',blocker:'WX_MS_INSUFFICIENT_DAYS',trainingDigest:null};
 const fit=fitWindow(window,P),c=combine(target.members,fit,P);
 const trainingDigest=createHash('sha256').update(JSON.stringify(window.map(d=>[d.localDate,d.members,d.observedHighF]))).digest('hex');
 if(!c)return {...base,...empty,status:'AWAITING_VERIFIED_HISTORY',blocker:'WX_MS_NO_MEMBER',trainingDigest};
 const sigma=Math.max(P.sigmaFloorF,Math.sqrt(fit.a+fit.b*c.s2));
 return {...base,status:'UNCALIBRATED_EXPERIMENTAL_MODEL',blocker:null,trainingDigest,weights:c.weights,bias:fit.bias,
  variance:{a:fit.a,b:fit.b},mu:Number(c.mu.toFixed(6)),sigma:Number(sigma.toFixed(6)),distribution:gaussianPmf(c.mu,sigma,P)};
}

// ---------- pre-registered baselines (same window, same day) ----------
export type BaselineId=`${MemberId}_RAW`|`${MemberId}_CORRECTED`|'NBM_NATIVE'|'CLIMATOLOGY';
export function baselinePmfs(window:readonly AnchorDay[],target:AnchorDay,P=MULTISOURCE_POLICY):Partial<Record<BaselineId,Pmf>>{
 const out:Partial<Record<BaselineId,Pmf>>={};
 for(const m of MEMBERS){
  const t=target.members[m],rows=window.filter(d=>d.members[m]);
  if(!t||!rows.length)continue;
  const err=rows.map(d=>d.observedHighF!-d.members[m]!.valueF),b=mean(err);
  out[`${m}_RAW`]=gaussianPmf(t.valueF,Math.max(P.sigmaFloorF,Math.sqrt(mean(err.map(e=>e*e)))),P);
  out[`${m}_CORRECTED`]=gaussianPmf(t.valueF+b,Math.max(P.sigmaFloorF,Math.sqrt(mean(err.map(e=>(e-b)**2)))),P);
 }
 if(target.members.NBM)out.NBM_NATIVE=gaussianPmf(target.members.NBM.valueF,Math.max(P.sigmaFloorF,target.members.NBM.sdF??0),P);
 if(window.length){const ys=window.map(d=>d.observedHighF!),mu=mean(ys);
  out.CLIMATOLOGY=gaussianPmf(mu,Math.max(P.sigmaFloorF,Math.sqrt(mean(ys.map(y=>(y-mu)**2)))),P);}
 return out;
}
