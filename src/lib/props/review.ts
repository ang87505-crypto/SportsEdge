/**
 * Weekly mistake review: why the active model's recorded picks missed, which layer that points
 * to, and a scorecard per layer. Pure. It explains; the weekly retrain does the adjusting.
 */
import type {Stat} from './contract.ts';
import {summarize,type Probabilities} from './research.ts';
import type {Summary} from './promotion.ts';

/** Actual minutes below this share of the expected minutes count as a minutes collapse. */
export const MINUTES_COLLAPSE=0.6;
/** One standard deviation of the opponent allowed-rate ratio, for "matchup against the pick". */
export const MATCHUP_SD=0.08;
const BAND_MIN_PICKS=20;
const BANDS:[string,number,number][]=[['0.60-0.65',0.6,0.65],['0.65-0.70',0.65,0.7],['0.70-0.80',0.7,0.8]];

export type MissCause='minutes_collapse'|'books_were_right'|'matchup'|'overconfidence'|'other';
export type ReviewLine={key:string;eventId:string;date:string;stat:Stat;outcome:'more'|'less'|'tie'|'void';layer1:Probabilities;
 active:Probabilities;books:number|null;challengers:Record<string,Probabilities>;recorded:boolean;side:'more'|'less'|null;
 expMinutes:number|null;actualMinutes:number|null;oppAllowedRatio:number};
export type LearningReport={period:{from:string;to:string};misses:Record<MissCause,number>;voidsExcluded:number;
 scorecards:{layer1:Summary;books:Summary|null;active:Summary;challengers:Record<string,Summary>};overconfidentBands:string[]};

/** First matching cause wins, in the spec's order. The caller passes a graded miss only. */
export function classifyMiss(m:{expMinutes:number|null;actualMinutes:number|null;side:'more'|'less';outcome:'more'|'less';
 booksSide:'more'|'less'|null;oppAllowedRatio:number;overconfidentBand:boolean;stat:Stat}):MissCause{
 if(m.expMinutes!==null&&m.actualMinutes!==null&&m.actualMinutes<MINUTES_COLLAPSE*m.expMinutes)return 'minutes_collapse';
 if(m.booksSide!==null&&m.booksSide!==m.side&&m.booksSide===m.outcome)return 'books_were_right';
 if((m.side==='more'&&m.oppAllowedRatio<1-MATCHUP_SD)||(m.side==='less'&&m.oppAllowedRatio>1+MATCHUP_SD))return 'matchup';
 if(m.overconfidentBand)return 'overconfidence';
 return 'other';
}

const confidence=(p:Probabilities)=>p.pTie<1?Math.max(p.pMore,p.pLess)/(1-p.pTie):0.5;
const bandOf=(c:number)=>BANDS.find(([,lo,hi])=>c>=lo&&c<hi)?.[0]??null;

export function weeklyReview(lines:ReviewLine[],period:{from:string;to:string}):LearningReport{
 const inPeriod=[...new Map(lines.filter(l=>l.date>=period.from&&l.date<=period.to).map(l=>[l.key,l])).values()];
 const graded=inPeriod.filter((l):l is ReviewLine&{outcome:'more'|'less'|'tie'}=>l.outcome!=='void');
 const picks=graded.filter(l=>l.recorded&&l.side&&l.outcome!=='tie');
 // A band is overconfident when its hit rate sits more than 2 standard errors below its mean confidence.
 const overconfidentBands=BANDS.map(([name])=>name).filter(name=>{
  const b=picks.filter(l=>bandOf(confidence(l.active))===name);
  if(b.length<BAND_MIN_PICKS)return false;
  const mean=b.reduce((a,l)=>a+confidence(l.active),0)/b.length;
  const hit=b.filter(l=>l.side===l.outcome).length/b.length;
  return hit<mean-2*Math.sqrt(mean*(1-mean)/b.length);
 });
 const misses:Record<MissCause,number>={minutes_collapse:0,books_were_right:0,matchup:0,overconfidence:0,other:0};
 for(const l of picks){
  if(l.side===l.outcome)continue;
  misses[classifyMiss({expMinutes:l.expMinutes,actualMinutes:l.actualMinutes,side:l.side!,outcome:l.outcome as 'more'|'less',
   booksSide:l.books===null?null:l.books>=0.5?'more':'less',oppAllowedRatio:l.oppAllowedRatio,
   overconfidentBand:overconfidentBands.includes(bandOf(confidence(l.active))??''),stat:l.stat})]++;
 }
 const score=(f:(l:ReviewLine)=>Probabilities|null)=>summarize(graded.flatMap(l=>{const p=f(l);return p?[{p,outcome:l.outcome}]:[];}));
 const withBooks=graded.filter(l=>l.books!==null);
 const versions=[...new Set(graded.flatMap(l=>Object.keys(l.challengers)))].sort();
 return {period,misses,voidsExcluded:inPeriod.filter(l=>l.outcome==='void'&&l.recorded).length,
  scorecards:{layer1:score(l=>l.layer1),books:withBooks.length?score(l=>l.books===null?null:{pMore:l.books,pLess:1-l.books,pTie:0}):null,
   active:score(l=>l.active),challengers:Object.fromEntries(versions.map(v=>[v,score(l=>l.challengers[v]??null)]))},
  overconfidentBands};
}
