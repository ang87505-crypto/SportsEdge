/**
 * Pre-decision mistake prevention (RESEARCH ONLY). Independent checks computed from information that
 * existed before lock. They are recorded beside each line and evaluated later; they never change a
 * pick, a threshold or an entry. Thresholds are frozen in RISK_RULES_V1 before any forward evaluation.
 */
import type {Probabilities} from '../../props/research.ts';
import type {Stat} from '../../props/contract.ts';
import {holm,wilson,round} from '../stats.ts';

export const RISK_RULES_V1={version:'lab-risk-flags-v1',
 minGames:10,               // insufficient_history: fewer played games this season
 absenceDays:7,             // long_absence: days since the last played game (an absence proxy, NOT injury data)
 minutesShift:4,            // minutes_shift: role-rule expected minutes differ from layer 1 by this many minutes
 minutesCv:0.30,            // high_minutes_uncertainty: sd/expected minutes
 booksLean:0.05,            // books_disagree: books lean at least this far to the other side
 lineGap:0.25,              // large_line_gap: |model mean − line| / line
 sameGameMax:1} as const;   // same_game_exposure: more recorded picks than this in one game

export type RiskFlag='insufficient_history'|'long_absence'|'minutes_shift'|'high_minutes_uncertainty'|'books_disagree'|
 'large_line_gap'|'poor_category_calibration'|'same_game_exposure';
export const RISK_FLAGS:RiskFlag[]=['insufficient_history','long_absence','minutes_shift','high_minutes_uncertainty','books_disagree',
 'large_line_gap','poor_category_calibration','same_game_exposure'];
export const RISK_TEXT:Record<RiskFlag,string>={
 insufficient_history:'Fewer than 10 played games this season',
 long_absence:'More than 7 days since the player last played (absence proxy; no injury feed is collected)',
 minutes_shift:'Recent minutes moved sharply (role change)',
 high_minutes_uncertainty:'Minutes have been unusually variable',
 books_disagree:'Sportsbooks lean the other way at the same line',
 large_line_gap:'Model mean is far from the posted line (the line may know something the model does not)',
 poor_category_calibration:'This stat and confidence band was overconfident in training data',
 same_game_exposure:'More than one pick from the same game',
};
/** Coverage gaps that apply to every line; reported once, never as a per-line flag that cannot discriminate. */
export const COVERAGE_GAPS=['No official injury or rotation feed is stored before lock, so injury risk is unknown, not absent.'];

export type CalibrationCell={stat:Stat;band:string;n:number;meanConfidence:number;hitRate:number;overconfident:boolean};
const BANDS:[string,number,number][]=[['0.55-0.60',0.55,0.6],['0.60-0.65',0.6,0.65],['0.65-0.70',0.65,0.7],['0.70-0.80',0.7,0.8],['0.80-1.00',0.8,1.01]];
export const confidenceOf=(p:Probabilities)=>p.pTie<1?Math.max(p.pMore,p.pLess)/(1-p.pTie):0.5;
export const bandOf=(c:number)=>BANDS.find(([,lo,hi])=>c>=lo&&c<hi)?.[0]??null;

/** Category calibration from TRAINING rows only; a band is overconfident when hits sit 2+ standard errors below confidence. */
export function calibrationTable(rows:{stat:Stat;p:Probabilities;outcome:'more'|'less'|'tie'}[]):CalibrationCell[]{
 const cells=new Map<string,{stat:Stat;band:string;n:number;conf:number;hit:number}>();
 for(const r of rows){
  if(r.outcome==='tie')continue;
  const c=confidenceOf(r.p),band=bandOf(c);if(!band)continue;
  const k=r.stat+'|'+band,x=cells.get(k)??{stat:r.stat,band,n:0,conf:0,hit:0};
  x.n++;x.conf+=c;x.hit+=Number((r.p.pMore>=r.p.pLess?'more':'less')===r.outcome);cells.set(k,x);
 }
 return [...cells.values()].map(x=>{const m=x.conf/x.n,h=x.hit/x.n;
  return {stat:x.stat,band:x.band,n:x.n,meanConfidence:round(m,4)!,hitRate:round(h,4)!,overconfident:x.n>=50&&h<m-2*Math.sqrt(m*(1-m)/x.n)};});
}

export type RiskInput={stat:Stat;probs:Probabilities;line:number;mean:number|null;
 layer1:{games:number;expMinutes:number|null;sdMinutes:number|null;lastPlayed:string|null;cutoff:string};
 roleExpMinutes:number|null;booksPMore:number|null;sameGamePicks:number|null;calibration:CalibrationCell[]};

export function riskFlags(x:RiskInput):RiskFlag[]{
 const R=RISK_RULES_V1,f:RiskFlag[]=[];
 if(x.layer1.games<R.minGames)f.push('insufficient_history');
 if(x.layer1.lastPlayed&&(Date.parse(x.layer1.cutoff)-Date.parse(x.layer1.lastPlayed))/86400_000>R.absenceDays)f.push('long_absence');
 if(x.roleExpMinutes!==null&&x.layer1.expMinutes!==null&&Math.abs(x.roleExpMinutes-x.layer1.expMinutes)>=R.minutesShift)f.push('minutes_shift');
 if(x.layer1.expMinutes&&x.layer1.sdMinutes!==null&&x.layer1.sdMinutes/x.layer1.expMinutes>=R.minutesCv)f.push('high_minutes_uncertainty');
 const side=x.probs.pMore>=x.probs.pLess?'more':'less';
 if(x.booksPMore!==null){const bs=x.booksPMore>=0.5?'more':'less';if(bs!==side&&Math.abs(x.booksPMore-0.5)>=R.booksLean)f.push('books_disagree');}
 if(x.mean!==null&&x.line>0&&Math.abs(x.mean-x.line)/x.line>=R.lineGap)f.push('large_line_gap');
 const band=bandOf(confidenceOf(x.probs));
 if(band&&x.calibration.some(c=>c.stat===x.stat&&c.band===band&&c.overconfident))f.push('poor_category_calibration');
 if(x.sameGamePicks!==null&&x.sameGamePicks>R.sameGameMax)f.push('same_game_exposure');
 return f;
}

/** Two-proportion z-test, one-sided: flagged picks hit LESS often than unflagged ones. */
function pLower(k1:number,n1:number,k0:number,n0:number){
 if(!n1||!n0)return 1;
 const p=(k1+k0)/(n1+n0),se=Math.sqrt(p*(1-p)*(1/n1+1/n0));
 if(se===0)return 1;
 const z=(k1/n1-k0/n0)/se;
 return 0.5*erfc(-z/Math.SQRT2);
}
function erfc(x:number){const t=1/(1+0.5*Math.abs(x));
 const y=t*Math.exp(-x*x-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277)))))))));
 return x>=0?y:2-y;}

export type FlagEffect={flag:RiskFlag;flagged:number;flaggedHitRate:number|null;flaggedInterval:{lower:number;upper:number}|null;
 unflaggedHitRate:number|null;skipRule:{missesAvoided:number;goodPicksRejected:number;hitRateBefore:number|null;hitRateAfter:number|null};
 pAdjusted:number;verdict:'would_help'|'no_evidence'|'too_few'};
/** Would "skip when flagged" have helped the selected picks? Holm-adjusted across flags; needs 30+ flagged picks. */
export function flagEffectiveness(picks:{flags:RiskFlag[];correct:boolean}[],minFlagged=30):FlagEffect[]{
 const n=picks.length,k=picks.filter(p=>p.correct).length;
 const raw=RISK_FLAGS.map(flag=>{
  const f=picks.filter(p=>p.flags.includes(flag)),u=picks.filter(p=>!p.flags.includes(flag));
  const fk=f.filter(p=>p.correct).length,uk=u.filter(p=>p.correct).length;
  return {flag,f:f.length,fk,u:u.length,uk,p:pLower(fk,f.length,uk,u.length)};
 });
 const adj=holm(raw.map(r=>r.p));
 return raw.map((r,i)=>({flag:r.flag,flagged:r.f,flaggedHitRate:r.f?round(r.fk/r.f,4):null,flaggedInterval:r.f?wilson(r.fk,r.f):null,
  unflaggedHitRate:r.u?round(r.uk/r.u,4):null,
  skipRule:{missesAvoided:r.f-r.fk,goodPicksRejected:r.fk,hitRateBefore:n?round(k/n,4):null,hitRateAfter:r.u?round(r.uk/r.u,4):null},
  pAdjusted:round(adj[i],6)!,verdict:r.f<minFlagged?'too_few':adj[i]<0.05?'would_help':'no_evidence'}));
}
