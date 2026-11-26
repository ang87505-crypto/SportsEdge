/**
 * Research challenger props-nb-availability-v1 (docs/PROPS_CHALLENGER_AVAILABILITY_PREREG_2026_11_19.md). Pure; no I/O.
 * NOT used by the live worker. The production model (props-nb-minutes-rate-v1) is unchanged.
 *
 * Availability comes only from EARLIER box scores of the player's team: a did-not-play row with a stated reason other
 * than "COACH'S DECISION" is a recorded absence. A player missing from a box score is UNKNOWN, never assumed available or
 * injured. No pre-game injury report is used (see the rules document for why none is collected).
 */
import {lineProbabilities} from './model.ts';

export const COACH_REASON="COACH'S DECISION";
export const WINDOW_GAMES=5;
export type AvailabilityStatus='PLAYED'|'ABSENT_STATED'|'ABSENT_COACH'|'UNLISTED';
export type AvailabilityCategory='RETURNING'|'RECENT'|'UNKNOWN'|'CLEAR';
export const ADJUSTED:readonly AvailabilityCategory[]=['RETURNING','RECENT'];

/** One team game as the box score lists it: who was listed, and for did-not-play rows, the stated reason. */
export type TeamGame={game:string;start:string;listed:Map<string,{didNotPlay:boolean;reason:string|null}>};

export function statusIn(g:TeamGame,athlete:string):AvailabilityStatus{
 const row=g.listed.get(athlete);
 if(!row)return 'UNLISTED';
 if(!row.didNotPlay)return 'PLAYED';
 const reason=(row.reason??'').trim().toUpperCase();
 return reason===COACH_REASON?'ABSENT_COACH':reason?'ABSENT_STATED':'UNLISTED';
}

/** Statuses in the team's WINDOW_GAMES most recent games strictly before `before`, most recent first, counting only games
 * at or after the player's first listing for this team that is itself before `before`. `teamGames` sorted by start. */
export function availabilityWindow(teamGames:TeamGame[],athlete:string,before:string):AvailabilityStatus[]{
 const cut=Date.parse(before);
 const earlier=teamGames.filter(g=>Date.parse(g.start)<cut);
 const first=earlier.find(g=>g.listed.has(athlete));
 if(!first)return [];
 return earlier.filter(g=>Date.parse(g.start)>=Date.parse(first.start)).slice(-WINDOW_GAMES).reverse().map(g=>statusIn(g,athlete));
}

export function categorize(window:AvailabilityStatus[]):AvailabilityCategory{
 if(window[0]==='ABSENT_STATED')return 'RETURNING';
 if(window.includes('ABSENT_STATED'))return 'RECENT';
 if(window.includes('UNLISTED'))return 'UNKNOWN';
 return 'CLEAR';
}

export type Adjustment={m:number;s:number};
/** The baseline negative binomial with adjusted minutes: expected x m, SD^2 = (m x SD)^2 + (s x expected)^2. */
export function adjustedProbabilities(x:{rate:number;expMinutes:number;sdMinutes:number;dispersion:number;line:number},a:Adjustment){
 if(!(a.m>0)||!(a.s>=0))throw new Error('INVALID_ADJUSTMENT');
 const exp=x.expMinutes*a.m,sd2=(a.m*x.sdMinutes)**2+(a.s*x.expMinutes)**2;
 const mean=x.rate*exp,variance=mean+mean*mean/x.dispersion+x.rate*x.rate*sd2;
 const size=variance>mean*(1+1e-9)?mean*mean/(variance-mean):Infinity;
 return lineProbabilities(x.line,mean,size);
}

/** Fit m and s for one category from played player-games: r = min(minutes, cap) / expected. */
export function fitAdjustment(rows:{minutes:number;expMinutes:number;sdMinutes:number}[],cap=53):Adjustment&{n:number;meanRatio:number;varRatio:number;baselineVar:number}{
 const rs=rows.filter(r=>r.expMinutes>0).map(r=>({r:Math.min(r.minutes,cap)/r.expMinutes,b:(r.sdMinutes/r.expMinutes)**2}));
 if(rs.length<2)throw new Error('TOO_FEW_ROWS');
 const mean=rs.reduce((a,x)=>a+x.r,0)/rs.length;
 const v=rs.reduce((a,x)=>a+(x.r-mean)**2,0)/(rs.length-1),b=rs.reduce((a,x)=>a+x.b,0)/rs.length;
 const r4=(z:number)=>Math.round(z*1e4)/1e4;
 return {m:r4(mean),s:r4(Math.sqrt(Math.max(0,v-b))),n:rs.length,meanRatio:r4(mean),varRatio:r4(v),baselineVar:r4(b)};
}

// ---------------------------------------------------------------- scoring (binary, non-tie)

export type Scored={game:string;y:0|1;p:Record<string,number>};
const clamp=(x:number)=>Math.min(1-1e-6,Math.max(1e-6,x));
export const brier=(rs:Scored[],m:string)=>rs.reduce((a,r)=>a+(r.p[m]-r.y)**2,0)/rs.length;
export const logLoss=(rs:Scored[],m:string)=>rs.reduce((a,r)=>a-(r.y?Math.log(clamp(r.p[m])):Math.log(1-clamp(r.p[m]))),0)/rs.length;
export const pMoreNoTie=(p:{pMore:number;pLess:number})=>p.pMore+p.pLess>0?p.pMore/(p.pMore+p.pLess):0.5;

/** Paired bootstrap over whole games of score(m) - score(base) for Brier and log loss, with a seeded LCG. */
export function pairedGameBootstrap(rs:Scored[],m:string,base:string,reps:number,seed:number){
 const games=new Map<string,{b:number;l:number;n:number}>();
 for(const r of rs){
  const g=games.get(r.game)??{b:0,l:0,n:0};
  g.b+=(r.p[m]-r.y)**2-(r.p[base]-r.y)**2;
  const ll=(q:number)=>-(r.y?Math.log(clamp(q)):Math.log(1-clamp(q)));
  g.l+=ll(r.p[m])-ll(r.p[base]);g.n++;games.set(r.game,g);
 }
 const list=[...games.values()];
 if(!list.length)return null;
 let state=seed>>>0;const rnd=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const bs:number[]=[],ls:number[]=[];
 for(let k=0;k<reps;k++){
  let b=0,l=0,n=0;
  for(let i=0;i<list.length;i++){const g=list[Math.floor(rnd()*list.length)];b+=g.b;l+=g.l;n+=g.n;}
  bs.push(b/n);ls.push(l/n);
 }
 bs.sort((a,b)=>a-b);ls.sort((a,b)=>a-b);
 const lo=Math.floor(0.025*reps),hi=Math.ceil(0.975*reps)-1,n=list.reduce((a,g)=>a+g.n,0);
 const r6=(x:number)=>Math.round(x*1e6)/1e6;
 return {games:list.length,lines:n,
  brier:{difference:r6(list.reduce((a,g)=>a+g.b,0)/n),lower95:r6(bs[lo]),upper95:r6(bs[hi])},
  logLoss:{difference:r6(list.reduce((a,g)=>a+g.l,0)/n),lower95:r6(ls[lo]),upper95:r6(ls[hi])}};
}

export const BANDS=[0,0.2,0.35,0.45,0.55,0.65,0.8,1.0000001];
export function calibration(rs:Scored[],m:string){
 const r4=(x:number)=>Math.round(x*1e4)/1e4;
 const bands=BANDS.slice(0,-1).map((lo,i)=>{const hi=BANDS[i+1],b=rs.filter(r=>r.p[m]>=lo&&r.p[m]<hi);
  return {band:`${lo}-${Math.min(1,hi).toFixed(2)}`,n:b.length,meanPredicted:b.length?r4(b.reduce((a,r)=>a+r.p[m],0)/b.length):null,
   observedMore:b.length?r4(b.reduce((a,r)=>a+r.y,0)/b.length):null};});
 let ece=0;
 for(let i=0;i<10;i++){const b=rs.filter(r=>Math.min(9,Math.floor(r.p[m]*10))===i);
  if(b.length)ece+=b.length/rs.length*Math.abs(b.reduce((a,r)=>a+r.p[m],0)/b.length-b.reduce((a,r)=>a+r.y,0)/b.length);}
 const meanP=rs.length?rs.reduce((a,r)=>a+r.p[m],0)/rs.length:null,obs=rs.length?rs.reduce((a,r)=>a+r.y,0)/rs.length:null;
 return {bands,ece:rs.length?r4(ece):null,meanPredictedMore:meanP===null?null:r4(meanP),observedMore:obs===null?null:r4(obs),
  calibrationInTheLarge:meanP===null||obs===null?null:r4(meanP-obs)};
}

/** The pre-registered verdict for the primary comparison. */
export function verdict(primary:ReturnType<typeof pairedGameBootstrap>):'INSUFFICIENT_DATA'|'IMPROVES'|'WORSE'|'NO_CLEAR_EFFECT'{
 if(!primary||primary.lines<150||primary.games<30)return 'INSUFFICIENT_DATA';
 if(primary.brier.upper95<0&&primary.logLoss.difference<0)return 'IMPROVES';
 if(primary.brier.lower95>0)return 'WORSE';
 return 'NO_CLEAR_EFFECT';
}
