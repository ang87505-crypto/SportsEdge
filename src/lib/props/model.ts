/**
 * props-nb-minutes-rate-v1: a transparent player-stat baseline (pure, deterministic).
 *
 * X | plays ~ NegativeBinomial(mean mu, size k'), where
 *   mu  = expected minutes x per-minute rate,
 *   E[minutes] = exponentially weighted mean of recent played minutes (half-life 4 games),
 *   rate = (recency-weighted stat + K x prior rate) / (recency-weighted minutes + K)   [shrinkage],
 *   Var  = mu + mu^2/k_stat + rate^2 x Var(minutes)      (minutes uncertainty propagated),
 *   k'   = mu^2 / (Var - mu).
 * The model is CONDITIONAL ON PLAYING: both platforms void a DNP, so a DNP is
 * graded void rather than scored as zero. Injury/lineup news is NOT used and is
 * never invented; players returning after a long absence are marked unscorable.
 * Only games that started strictly before the data cutoff are admitted.
 */
import type {Stat} from './contract.ts';

export type GameLog={gameStart:string;minutes:number|null;didNotPlay:boolean;
 points:number|null;rebounds:number|null;assists:number|null;seasonType?:'regular'|'post'|'other'};
export type PriorSummary={games:number;minutes:number;points:number;rebounds:number;assists:number};
export type ModelParams={
 version:string;
 minMinutesForRate:number;      // appearances under this are outliers (injury exit / garbage time)
 minCurrentGames:number;        // played games required in the current season
 maxGapDays:number;             // last played game must be this recent
 minutesHalfLife:number;rateHalfLife:number;maxGames:number;
 priorStrengthMinutes:number;   // K
 priorMinMinutes:number;        // prior-season minutes needed to use the player's own prior rate
 leagueRate:Record<Stat,number>;// per-minute fallback prior
 dispersion:Record<Stat,number>;// k_stat (NB size at fixed minutes)
 maxMinutes:number;
 /** Challenger props-nb-role-minutes-v1 only: follow a consistent recent shift in minutes (role change). Absent = layer 1. */
 roleChange?:{recentGames:number;minShift:number};
};

export type Prediction=
 |{status:'scored';reason:'ok';mean:number;pMore:number;pLess:number;pTie:number;
   inputs:{games:number;expMinutes:number;sdMinutes:number;rate:number;priorRate:number;priorSource:'player'|'league';
    size:number;lastPlayed:string;cutoff:string;roleShift?:boolean}}
 |{status:'unscorable';reason:'insufficient_history'|'stale_history'|'missing_stat'|'invalid_line'|'invalid_input';
   inputs:{games:number;cutoff:string}};

function logGamma(x:number):number{
 // Lanczos approximation (g=7, n=9), accurate to ~1e-15 for x>0.
 const c=[0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,
  -176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
 if(x<0.5)return Math.log(Math.PI/Math.sin(Math.PI*x))-logGamma(1-x);
 x-=1;let a=c[0];const t=x+7.5;
 for(let i=1;i<9;i++)a+=c[i]/(x+i);
 return 0.5*Math.log(2*Math.PI)+(x+0.5)*Math.log(t)-t+Math.log(a);
}
/** NB pmf with mean mu and size r (r -> infinity approaches Poisson). */
export function nbPmf(n:number,mu:number,r:number):number{
 if(!Number.isInteger(n)||n<0)return 0;
 if(mu<=0)return n===0?1:0;
 if(!Number.isFinite(r)||r>1e7){return Math.exp(n*Math.log(mu)-mu-logGamma(n+1));}
 const p=r/(r+mu);
 return Math.exp(logGamma(n+r)-logGamma(r)-logGamma(n+1)+r*Math.log(p)+n*Math.log(1-p));
}
/** P(X<line), P(X=line), P(X>line) for a half-point or integer line. */
export function lineProbabilities(line:number,mu:number,r:number){
 let below=0,tie=0;
 const top=Math.ceil(line);
 for(let n=0;n<top;n++){if(n<line)below+=nbPmf(n,mu,r);}
 if(Number.isInteger(line))tie=nbPmf(line,mu,r);
 below=Math.min(1,Math.max(0,below));tie=Math.min(1-below,Math.max(0,tie));
 const more=Math.max(0,1-below-tie);
 return {pLess:below,pTie:tie,pMore:more};
}

const statOf=(g:GameLog,s:Stat)=>s==='points'?g.points:s==='rebounds'?g.rebounds:g.assists;

export function predictLine(input:{logs:GameLog[];prior:PriorSummary|null;stat:Stat;line:number;cutoff:string;params:ModelParams}):Prediction{
 const {params:P,stat}=input;
 const cut=Date.parse(input.cutoff);
 const base={games:0,cutoff:input.cutoff};
 if(!Number.isFinite(cut)||!Array.isArray(input.logs))return {status:'unscorable',reason:'invalid_input',inputs:base};
 if(!(input.line>0&&input.line<100&&Math.round(input.line*2)===input.line*2))return {status:'unscorable',reason:'invalid_line',inputs:base};
 // Strictly pre-cutoff, played, non-outlier appearances; missing values are never zero.
 const played=input.logs
  .filter(g=>Date.parse(g.gameStart)<cut&&!g.didNotPlay&&g.minutes!==null&&g.minutes>=P.minMinutesForRate)
  .sort((a,b)=>Date.parse(b.gameStart)-Date.parse(a.gameStart))
  .slice(0,P.maxGames);
 const games={...base,games:played.length};
 if(played.length<P.minCurrentGames)return {status:'unscorable',reason:'insufficient_history',inputs:games};
 if(played.some(g=>statOf(g,stat)===null))return {status:'unscorable',reason:'missing_stat',inputs:games};
 const lastPlayed=played[0].gameStart;
 if(cut-Date.parse(lastPlayed)>P.maxGapDays*86400_000)return {status:'unscorable',reason:'stale_history',inputs:games};

 const wM=(i:number)=>Math.pow(0.5,i/P.minutesHalfLife),wR=(i:number)=>Math.pow(0.5,i/P.rateHalfLife);
 let sw=0,sm=0;
 played.slice(0,10).forEach((g,i)=>{const m=Math.min(g.minutes!,P.maxMinutes);sw+=wM(i);sm+=wM(i)*m;});
 let expMinutes=sm/sw,expMinutesOverride:number|null=null;
 let sv=0;
 played.slice(0,10).forEach((g,i)=>{const m=Math.min(g.minutes!,P.maxMinutes);sv+=wM(i)*(m-expMinutes)**2;});
 let sdMinutes=Math.sqrt(sv/sw);
 // Role change: the last few games all moved the same way, by enough to matter. Earlier games only.
 let roleShift=false;
 if(P.roleChange){
  const k=P.roleChange.recentGames,mins=played.slice(0,10).map(g=>Math.min(g.minutes!,P.maxMinutes));
  const recent=mins.slice(0,k),older=mins.slice(k);
  if(recent.length===k&&older.length>=3){
   const r=recent.reduce((a,b)=>a+b,0)/k,o=older.reduce((a,b)=>a+b,0)/older.length;
   if(Math.abs(r-o)>=P.roleChange.minShift&&recent.every(m=>Math.sign(m-o)===Math.sign(r-o))){
    const sdRecent=Math.sqrt(recent.reduce((a,m)=>a+(m-r)**2,0)/k);
    expMinutesOverride=r;sdMinutes=Math.max(sdMinutes,sdRecent);roleShift=true;
   }
  }
 }
 if(expMinutesOverride!==null)expMinutes=expMinutesOverride;
 const priorOwn=input.prior&&input.prior.minutes>=P.priorMinMinutes?input.prior[stat]/input.prior.minutes:null;
 const priorRate=priorOwn??P.leagueRate[stat];
 let num=P.priorStrengthMinutes*priorRate,den=P.priorStrengthMinutes;
 played.forEach((g,i)=>{num+=wR(i)*statOf(g,stat)!;den+=wR(i)*Math.min(g.minutes!,P.maxMinutes);});
 const rate=num/den;
 const mean=rate*expMinutes;
 const variance=mean+mean*mean/P.dispersion[stat]+rate*rate*sdMinutes*sdMinutes;
 const size=variance>mean*(1+1e-9)?mean*mean/(variance-mean):Infinity;
 const p=lineProbabilities(input.line,mean,size);
 const r6=(x:number)=>Math.round(x*1e6)/1e6;
 // Round to 1e-9 and renormalise so stored probabilities sum to 1 exactly at storage precision.
 const pm=Math.round(p.pMore*1e9)/1e9,pt=Math.round(p.pTie*1e9)/1e9;
 return {status:'scored',reason:'ok',mean:r6(mean),pMore:pm,pTie:pt,pLess:Math.round((1-pm-pt)*1e9)/1e9,
  inputs:{games:played.length,expMinutes:r6(expMinutes),sdMinutes:r6(sdMinutes),rate:r6(rate),priorRate:r6(priorRate),
   priorSource:priorOwn===null?'league':'player',size:Number.isFinite(size)?r6(size):1e9,lastPlayed,cutoff:input.cutoff,
   ...(P.roleChange?{roleShift}:{})}};
}

/** Simple baselines for comparison only (never used for recorded picks). */
export function poissonMeanBaseline(logs:GameLog[],stat:Stat,line:number,cutoff:string,lastN:number|null){
 const cut=Date.parse(cutoff);
 const played=logs.filter(g=>Date.parse(g.gameStart)<cut&&!g.didNotPlay&&g.minutes!==null&&statOf(g,stat)!==null)
  .sort((a,b)=>Date.parse(b.gameStart)-Date.parse(a.gameStart));
 const use=lastN===null?played:played.slice(0,lastN);
 if(use.length<3)return null;
 const mean=use.reduce((a,g)=>a+statOf(g,stat)!,0)/use.length;
 return {mean,...lineProbabilities(line,Math.max(mean,0.05),Infinity)};
}
