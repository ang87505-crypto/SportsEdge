/**
 * NBA props error breakdown and challenger scoring on proxy lines (research only; no I/O, no production path).
 * Walk-forward: every model input, opponent factor and proxy line uses games that started strictly before the
 * predicted game. Production predictions (props-nb-minutes-rate-v1) are reproduced, never changed.
 */
import {predictLine,lineProbabilities,type GameLog,type ModelParams,type PriorSummary} from '../../src/lib/props/model.ts';
import {STATS,type Stat} from '../../src/lib/props/contract.ts';
import {proxyLine,statOf,priors,fitDispersion,byAthlete,MODEL_FIXED,type BoxRow} from './box-csv.ts';

export type Line={game:string;start:string;date:string;athlete:string;team:string;opponent:string;stat:Stat;line:number;
 /** baseline binary P(more); proxy lines are half-points, so P(tie)=0 */
 q:number;y:0|1;mean:number;expMinutes:number;sdMinutes:number;games:number;
 /** the baseline's per-minute rate and NB size for this stat (as stored, rounded to 1e-6) */
 rate:number;dispersion:number;
 /** player per-minute rate divided by the league per-minute rate (prior season) for this stat */
 rateRel:number;
 /** |mean - line| / predictive SD */
 z:number;
 /** opponent's allowed per-minute rate / league per-minute rate, this season, games strictly before; null if < MIN_OPP_GAMES */
 opp:number|null;oppGames:number};

export const MIN_OPP_GAMES=10;

/** The backtest design used by every earlier proxy study: league rates, priors and NB dispersion from the prior season. */
export function backtestParams(prior:BoxRow[]){
 const pr=priors(prior);
 const dispersion=fitDispersion(prior,{players:new Map(),leagueRate:pr.leagueRate},Date.parse('2100-01-01'));
 return {params:{...MODEL_FIXED,leagueRate:pr.leagueRate,dispersion} as ModelParams,priorOf:(a:string)=>pr.players.get(a)??null};
}

/**
 * Walk-forward opponent factors. For each (game, defending team, stat): points/rebounds/assists per minute that the
 * team's opponents produced against it in games that started strictly before this game, divided by the league's
 * per-minute rate over the same earlier games. Key: `${game}|${defendingTeam}|${stat}`.
 */
export function opponentFactors(rows:BoxRow[]){
 type Acc={min:number;s:Record<Stat,number>;games:number};
 const games=new Map<string,{start:string;byTeam:Map<string,{min:number;s:Record<Stat,number>}>}>();
 for(const r of rows){
  const g=r.log;if(g.didNotPlay||g.minutes===null||g.minutes<=0||g.points===null||g.rebounds===null||g.assists===null)continue;
  const x=games.get(r.game)??{start:r.start,byTeam:new Map()};games.set(r.game,x);
  // r.team produced against r.opponent: credit the DEFENDING team r.opponent.
  const t=x.byTeam.get(r.opponent)??{min:0,s:{points:0,rebounds:0,assists:0}};x.byTeam.set(r.opponent,t);
  t.min+=g.minutes;for(const s of STATS)t.s[s]+=statOf(g,s);
 }
 const ordered=[...games.entries()].sort((a,b)=>a[1].start.localeCompare(b[1].start)||a[0].localeCompare(b[0]));
 const team=new Map<string,Acc>(),league={min:0,s:{points:0,rebounds:0,assists:0} as Record<Stat,number>};
 const out=new Map<string,{factor:number|null;games:number}>();
 let i=0;
 while(i<ordered.length){
  // Games sharing a start time are all computed from strictly earlier games, then added together.
  let j=i;while(j<ordered.length&&ordered[j][1].start===ordered[i][1].start)j++;
  for(let k=i;k<j;k++){const [id,x]=ordered[k];
   for(const t of x.byTeam.keys()){const a=team.get(t);
    for(const s of STATS){
     const ok=a&&a.games>=MIN_OPP_GAMES&&a.min>0&&league.min>0&&league.s[s]>0;
     out.set(`${id}|${t}|${s}`,{factor:ok?(a!.s[s]/a!.min)/(league.s[s]/league.min):null,games:a?.games??0});
    }}
  }
  for(let k=i;k<j;k++)for(const [t,v] of ordered[k][1].byTeam){
   const a=team.get(t)??{min:0,s:{points:0,rebounds:0,assists:0},games:0};team.set(t,a);
   a.min+=v.min;a.games++;league.min+=v.min;for(const s of STATS){a.s[s]+=v.s[s];league.s[s]+=v.s[s];}
  }
  i=j;
 }
 return out;
}

/** Score a season walk-forward with the frozen baseline and attach every breakdown feature. Throws on any leakage. */
export function scoreLines(season:BoxRow[],params:ModelParams,priorOf:(a:string)=>PriorSummary|null,since?:string){
 const opp=opponentFactors(season),out:Line[]=[];let checked=0,violations=0,pushes=0;
 for(const games of byAthlete(season).values()){
  games.sort((a,b)=>a.start.localeCompare(b.start));
  games.forEach((r,i)=>{
   if(r.log.didNotPlay||r.log.minutes===null||(since&&r.start<since))return;
   const history:GameLog[]=games.slice(0,i).map(x=>x.log);
   for(const h of history){checked++;if(Date.parse(h.gameStart)>=Date.parse(r.start))violations++;}
   for(const s of STATS){
    const actual=statOf(r.log,s);if(actual===null||actual===undefined)continue;
    const line=proxyLine(history,s);if(line===null)continue;
    const p=predictLine({logs:history,prior:priorOf(r.athlete),stat:s,line,cutoff:r.start,params});
    if(p.status!=='scored')continue;
    if(actual===line){pushes++;continue;}
    const q=p.pMore/(p.pMore+p.pLess),sd=Math.sqrt(p.mean+p.mean**2/params.dispersion[s]+(p.inputs.rate*p.inputs.sdMinutes)**2);
    const o=opp.get(`${r.game}|${r.opponent}|${s}`);
    out.push({game:r.game,start:r.start,date:r.start.slice(0,10),athlete:r.athlete,team:r.team,opponent:r.opponent,stat:s,line,
     q,y:actual>line?1:0,mean:p.mean,expMinutes:p.inputs.expMinutes,sdMinutes:p.inputs.sdMinutes,games:p.inputs.games,
     rate:p.inputs.rate,dispersion:params.dispersion[s],
     rateRel:p.inputs.rate/params.leagueRate[s],z:sd>0?Math.abs(p.mean-line)/sd:0,opp:o?.factor??null,oppGames:o?.games??0});
   }
  });
 }
 if(violations)throw new Error('LEAKAGE: '+violations+' inputs at or after the predicted game');
 out.sort((a,b)=>a.start.localeCompare(b.start)||a.game.localeCompare(b.game)||a.athlete.localeCompare(b.athlete)||a.stat.localeCompare(b.stat));
 return {lines:out,leakage:{checked,violations},pushes};
}

/** Piecewise-linear monotone map (identical rule to applyMap in src/lib/props/monotone-calibration.ts on PR #208). */
export type Knot={x:number;y:number};
export function applyKnots(k:Knot[],q:number,clamp:[number,number]=[0.01,0.99]){
 let v:number;
 if(q<=k[0].x)v=k[0].y;else if(q>=k[k.length-1].x)v=k[k.length-1].y;
 else{let i=0;while(k[i+1].x<q)i++;const a=k[i],b=k[i+1];v=b.x>a.x?a.y+(b.y-a.y)*(q-a.x)/(b.x-a.x):Math.max(a.y,b.y);}
 return Math.min(clamp[1],Math.max(clamp[0],v));
}

export type Bucket={lines:number;games:number;meanConfidence:number;hitRate:number;gap:number;meanQ:number;meanY:number;bias:number;brier:number};
/** Chosen side = the side with probability >= 0.5. gap = mean confidence - hit rate (positive = overconfident);
 * bias = mean(y - q) on P(more) (positive = the model under-predicts the stat). */
export function bucket(ls:{q:number;y:0|1;game:string}[]):Bucket|null{
 if(!ls.length)return null;
 let c=0,h=0,qs=0,ys=0,b=0;const g=new Set<string>();
 for(const l of ls){const conf=Math.max(l.q,1-l.q),pickMore=l.q>=0.5;c+=conf;h+=(pickMore?l.y:1-l.y);qs+=l.q;ys+=l.y;b+=(l.q-l.y)**2;g.add(l.game);}
 const n=ls.length,r6=(x:number)=>Math.round(x*1e6)/1e6;
 return {lines:n,games:g.size,meanConfidence:r6(c/n),hitRate:r6(h/n),gap:r6((c-h)/n),meanQ:r6(qs/n),meanY:r6(ys/n),bias:r6((ys-qs)/n),brier:r6(b/n)};
}

export const DIMENSIONS:Record<string,(l:Line)=>string|null>={
 confidence:l=>{const c=Math.max(l.q,1-l.q);return c<0.55?'a 0.50-0.55':c<0.6?'b 0.55-0.60':c<0.65?'c 0.60-0.65':c<0.7?'d 0.65-0.70':c<0.8?'e 0.70-0.80':'f 0.80+';},
 direction:l=>l.q>=0.5?'more':'less',
 expectedMinutes:l=>l.expMinutes<15?'a <15':l.expMinutes<25?'b 15-25':l.expMinutes<32?'c 25-32':'d 32+',
 perMinuteRate:l=>l.rateRel<0.7?'a <0.7x league':l.rateRel<0.9?'b 0.7-0.9x':l.rateRel<1.1?'c 0.9-1.1x':l.rateRel<1.4?'d 1.1-1.4x':'e 1.4x+',
 lineDistanceZ:l=>l.z<0.25?'a <0.25':l.z<0.5?'b 0.25-0.5':l.z<0.75?'c 0.5-0.75':l.z<1?'d 0.75-1':'e >=1',
 historyGames:l=>l.games<=5?'a 3-5':l.games<=10?'b 6-10':'c 11-20',
 opponent:l=>l.opp===null?'z unknown (<10 games)':l.opp<0.94?'a <0.94 (stingy)':l.opp<0.98?'b 0.94-0.98':l.opp<1.02?'c 0.98-1.02':l.opp<1.06?'d 1.02-1.06':'e >=1.06 (generous)',
 stat:l=>l.stat,
};

export function breakdown(lines:Line[],qOf:(l:Line)=>number=l=>l.q){
 const out:Record<string,Record<string,Bucket|null>>={};
 const all=lines.map(l=>({q:qOf(l),y:l.y,game:l.game}));
 out.overall={all:bucket(all)};
 for(const [dim,f] of Object.entries(DIMENSIONS)){
  const m=new Map<string,{q:number;y:0|1;game:string}[]>();
  lines.forEach((l,i)=>{const k=f(l);if(k===null)return;const a=m.get(k)??[];a.push(all[i]);m.set(k,a);});
  out[dim]=Object.fromEntries([...m.keys()].sort().map(k=>[k,bucket(m.get(k)!)]));
 }
 return out;
}

/** Deterministic PRNG for game-clustered bootstrap. */
export function mulberry32(seed:number){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

/** Game-clustered bootstrap of a per-line statistic's mean: returns mean and 95% percentile interval. */
export function clusteredMean(items:{game:string;v:number}[],reps:number,seed:number){
 const byGame=new Map<string,number[]>();for(const it of items){const a=byGame.get(it.game)??[];a.push(it.v);byGame.set(it.game,a);}
 const gs=[...byGame.values()],rnd=mulberry32(seed),means:number[]=[];
 const total=items.reduce((a,b)=>a+b.v,0)/items.length;
 for(let r=0;r<reps;r++){let s=0,n=0;for(let i=0;i<gs.length;i++){const g=gs[Math.floor(rnd()*gs.length)];for(const v of g){s+=v;n++;}}means.push(s/n);}
 means.sort((a,b)=>a-b);
 return {mean:total,lo:means[Math.floor(0.025*reps)],hi:means[Math.ceil(0.975*reps)-1],games:gs.length,lines:items.length};
}

/** Directional test: slope of residual (y - q) on log(opponent factor), via OLS, with a game-clustered bootstrap CI. */
export function oppSlope(lines:Line[],qOf:(l:Line)=>number,reps:number,seed:number){
 const xs=lines.filter(l=>l.opp!==null).map(l=>({game:l.game,x:Math.log(l.opp!),r:l.y-qOf(l)}));
 const fit=(a:typeof xs)=>{let mx=0,mr=0;for(const p of a){mx+=p.x;mr+=p.r;}mx/=a.length;mr/=a.length;
  let sxx=0,sxr=0;for(const p of a){sxx+=(p.x-mx)**2;sxr+=(p.x-mx)*(p.r-mr);}return sxx>0?sxr/sxx:0;};
 const byGame=new Map<string,typeof xs>();for(const p of xs){const a=byGame.get(p.game)??[];a.push(p);byGame.set(p.game,a);}
 const gs=[...byGame.values()],rnd=mulberry32(seed),b:number[]=[];
 for(let r=0;r<reps;r++){const s:typeof xs=[];for(let i=0;i<gs.length;i++)s.push(...gs[Math.floor(rnd()*gs.length)]);b.push(fit(s));}
 b.sort((a,c)=>a-c);
 return {slope:fit(xs),lo:b[Math.floor(0.025*reps)],hi:b[Math.ceil(0.975*reps)-1],lines:xs.length,games:gs.length};
}

// ---------------------------------------------------------------- challenger props-nb-opponent-rate-v1

/** Pre-registered grid for beta (docs/PROPS_CHALLENGER_OPPONENT_RATE_PREREG_2026_11_24.md). */
export const BETA_GRID=Array.from({length:16},(_,i)=>Math.round(i*0.1*10)/10);
/** Challenger binary P(more): the baseline's own negative binomial with the per-minute rate scaled by opp^beta.
 * Unknown opponent (fewer than MIN_OPP_GAMES earlier games) means no adjustment. beta = 0 reproduces the baseline. */
export function opponentQ(l:Pick<Line,'opp'|'rate'|'expMinutes'|'sdMinutes'|'dispersion'|'line'>,beta:number){
 if(!(beta>=0&&beta<=1.5))throw new Error('OPPONENT_BETA_OUT_OF_RANGE');
 const f=l.opp===null?1:l.opp;
 if(!(f>0))throw new Error('OPPONENT_FACTOR_INVALID');
 const rate=l.rate*f**beta,mean=rate*l.expMinutes;
 const variance=mean+mean*mean/l.dispersion+rate*rate*l.sdMinutes*l.sdMinutes;
 const size=variance>mean*(1+1e-9)?mean*mean/(variance-mean):Infinity;
 const p=lineProbabilities(l.line,mean,size);
 return p.pMore/(p.pMore+p.pLess);
}
export const brierOf=(ls:{y:0|1}[],q:(i:number)=>number)=>ls.reduce((a,l,i)=>a+(q(i)-l.y)**2,0)/ls.length;
/** Fit beta per stat on ONE earlier season by minimum binary Brier over BETA_GRID; ties go to the smaller beta. */
export function fitBeta(lines:Line[]){
 const out={} as Record<Stat,number>;
 for(const s of STATS){
  const ls=lines.filter(l=>l.stat===s);if(!ls.length)throw new Error('OPPONENT_FIT_EMPTY '+s);
  let best=0,bestB=Infinity;
  for(const b of BETA_GRID){const v=brierOf(ls,i=>opponentQ(ls[i],b));if(v<bestB-1e-12){bestB=v;best=b;}}
  out[s]=best;
 }
 return out;
}
const clampP=(p:number)=>Math.min(1-1e-6,Math.max(1e-6,p));
/** Paired per-line differences (challenger - baseline) with a game-clustered bootstrap; qc gives the challenger P(more). */
export function pairedDiffBy(lines:Line[],qc:(l:Line)=>number,reps:number,seed:number){
 const b=lines.map(l=>({game:l.game,v:(qc(l)-l.y)**2-(l.q-l.y)**2}));
 const ll=lines.map(l=>{const c=clampP(qc(l)),q=clampP(l.q);
  return {game:l.game,v:-(l.y?Math.log(c):Math.log(1-c))+(l.y?Math.log(q):Math.log(1-q))};});
 return {brier:clusteredMean(b,reps,seed),logLoss:clusteredMean(ll,reps,seed+1)};
}
export const pairedDiff=(lines:Line[],beta:Record<Stat,number>,reps:number,seed:number)=>
 pairedDiffBy(lines,l=>opponentQ(l,beta[l.stat]),reps,seed);
