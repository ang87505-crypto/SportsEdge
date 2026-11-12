/**
 * Mistake intelligence: recurring failure patterns among graded selected picks. Pure.
 * Every pattern is a measurable comparison of predicted vs actual (minutes, production, market, band);
 * nothing is inferred about motivation or psychology. For each pattern we report how often it occurs, how
 * much more common it is among misses than hits, whether a PRE-LOCK signal anticipated it, and what a
 * skip rule on that signal would have cost in good picks.
 */
import type {Stat} from '../../props/contract.ts';
import {round} from '../stats.ts';
import type {RiskFlag} from './risk.ts';

export const MISS_RULES_V1={minutesCollapse:0.6,minutesSurge:1.35,minutesNormalBand:0.15,matchupSd:0.08} as const;
export type Pattern='minutes_collapse'|'minutes_surge'|'production_rate_miss'|'books_were_right'|'matchup_against'|'unexplained';
export const PATTERN_TEXT:Record<Pattern,{what:string;feature:string;preLock:string}>={
 minutes_collapse:{what:'Played far fewer minutes than expected (under 60%)',feature:'Injury/rotation status before lock; game-script (spread) context',
  preLock:'Only partly: absence and minutes-variability flags are pre-lock; the collapse itself is only known after the game'},
 minutes_surge:{what:'Played far more minutes than expected (over 135%), hurting a Less pick',feature:'Teammate injury / rotation news before lock',
  preLock:'Not collected: teammate absences are not stored before lock'},
 production_rate_miss:{what:'Minutes were as expected, but production per minute missed',feature:'Usage/role and matchup detail',
  preLock:'Matchup features are pre-lock; per-minute variance itself is largely noise'},
 books_were_right:{what:'Sportsbooks leaned the other way at the same line, and were right',feature:'Market layer / books_disagree skip',
  preLock:'Yes: sportsbook quotes are captured before lock in the same request'},
 matchup_against:{what:'The opponent normally allows less of this stat (for More) or more (for Less)',feature:'Matchup layer',
  preLock:'Yes: opponent allowed rate uses games before lock'},
 unexplained:{what:'No measurable cause among the stored signals',feature:'None identified; may be ordinary variance',preLock:'n/a'},
};

export type GradedPick={key:string;stat:Stat;side:'more'|'less';correct:boolean;probability:number;
 expMinutes:number|null;actualMinutes:number|null;mean:number|null;actual:number|null;line:number;booksPMore:number|null;
 oppAllowedRatio:number|null;flags:RiskFlag[];
 /** Other variants' side for the same line (null = that variant would not have picked). */
 alternatives:Record<string,'more'|'less'|null>};

export function patternOf(p:GradedPick):Pattern{
 const R=MISS_RULES_V1;
 if(p.expMinutes&&p.actualMinutes!==null){
  if(p.actualMinutes<R.minutesCollapse*p.expMinutes)return 'minutes_collapse';
  if(p.side==='less'&&p.actualMinutes>R.minutesSurge*p.expMinutes)return 'minutes_surge';
 }
 if(p.booksPMore!==null){const bs=p.booksPMore>=0.5?'more':'less';if(bs!==p.side)return 'books_were_right';}
 if(p.oppAllowedRatio!==null&&((p.side==='more'&&p.oppAllowedRatio<1-R.matchupSd)||(p.side==='less'&&p.oppAllowedRatio>1+R.matchupSd)))return 'matchup_against';
 if(p.expMinutes&&p.actualMinutes!==null&&Math.abs(p.actualMinutes/p.expMinutes-1)<=R.minutesNormalBand)return 'production_rate_miss';
 return 'unexplained';
}

export type PatternReport={pattern:Pattern;what:string;misses:number;shareOfMisses:number|null;rateAmongHits:number|null;
 /** How many times more common among misses than among hits (>1 = distinctive of failure). */
 lift:number|null;evidence:Record<string,number|null>;candidateFeature:string;availableBeforeLock:string;
 bestPreLockSignal:{flag:RiskFlag;flaggedMisses:number;skipRule:{missesAvoided:number;goodPicksRejected:number}}|null;
 alternativeModels:{variant:string;wouldHaveAvoided:number;wouldAlsoRejectGood:number}[]};
export type MistakeReport={picks:number;misses:number;hitRate:number|null;patterns:PatternReport[];caveats:string[]};

const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

export function diagnoseMistakes(picks:GradedPick[]):MistakeReport{
 const misses=picks.filter(p=>!p.correct),hits=picks.filter(p=>p.correct);
 const label=new Map(picks.map(p=>[p.key,patternOf(p)]));
 const patterns=(Object.keys(PATTERN_TEXT) as Pattern[]).map(pattern=>{
  const m=misses.filter(p=>label.get(p.key)===pattern),h=hits.filter(p=>label.get(p.key)===pattern);
  const shareM=misses.length?m.length/misses.length:null,shareH=hits.length?h.length/hits.length:null;
  // Which pre-lock flag catches the most of this pattern's misses, and what skipping on it would also throw away.
  const flags=[...new Set(m.flatMap(p=>p.flags))];
  const best=flags.map(flag=>({flag,flaggedMisses:m.filter(p=>p.flags.includes(flag)).length,
   skipRule:{missesAvoided:misses.filter(p=>p.flags.includes(flag)).length,goodPicksRejected:hits.filter(p=>p.flags.includes(flag)).length}}))
   .sort((a,b)=>b.flaggedMisses-a.flaggedMisses||a.skipRule.goodPicksRejected-b.skipRule.goodPicksRejected)[0]??null;
  const variants=[...new Set(picks.flatMap(p=>Object.keys(p.alternatives)))].sort();
  const alternativeModels=variants.map(v=>({variant:v,
   wouldHaveAvoided:m.filter(p=>p.alternatives[v]!==p.side).length,
   wouldAlsoRejectGood:hits.filter(p=>p.alternatives[v]!==p.side).length}));
  return {pattern,what:PATTERN_TEXT[pattern].what,misses:m.length,shareOfMisses:round(shareM,4),rateAmongHits:round(shareH,4),
   lift:shareM!==null&&shareH?round(shareM/shareH,3):null,
   evidence:{meanExpectedMinutes:round(mean(m.flatMap(p=>p.expMinutes===null?[]:[p.expMinutes])),2),
    meanActualMinutes:round(mean(m.flatMap(p=>p.actualMinutes===null?[]:[p.actualMinutes])),2),
    meanConfidence:round(mean(m.map(p=>p.probability)),4)},
   candidateFeature:PATTERN_TEXT[pattern].feature,availableBeforeLock:PATTERN_TEXT[pattern].preLock,bestPreLockSignal:best,alternativeModels};
 }).filter(p=>p.misses>0).sort((a,b)=>b.misses-a.misses);
 return {picks:picks.length,misses:misses.length,hitRate:picks.length?round(hits.length/picks.length,4):null,patterns,
  caveats:['Patterns describe measured differences between expected and actual minutes, production and market signals; they are not explanations of player intent.',
   'A pattern that is equally common among hits (lift near 1) is not a cause of failure.']};
}
