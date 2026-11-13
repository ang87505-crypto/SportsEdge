/**
 * AI 2.0 learning engine: domain diagnostics and deterministic hypothesis generation. Pure; no I/O.
 * Sports and stocks are analysed by separate functions over separate row types; only the statistics are shared.
 *
 * A diagnostic is a measured pattern with uncertainty. A hypothesis is a TEMPLATE the engine may register as an
 * experiment; it is never evidence that the idea works. Patterns need a minimum sample and a cluster-aware
 * interval that excludes zero before they can suggest anything, and at most `maxNew` hypotheses are proposed per
 * run. Ideas already rejected or under test are never proposed again.
 */
import {clusteredDifference,wilson,round} from '../stats.ts';
import {blockedIdeas,hypothesisKey,type Domain,type Registry} from './experiments.ts';

// ---------------------------------------------------------------- data quality (both domains)

export type QualityIssue={code:'DUPLICATE'|'FUTURE_TIMESTAMP'|'PREDICTED_AFTER_LOCK'|'MISSING_FIELD'|'INVALID_PROBABILITY'|'STALE_INPUT';key:string};
export type SportsRow={key:string;game:string;date:string;stat:string;predictedAt:string;lockAt:string;gradedAt:string;
 pMore:number;outcome:'more'|'less';picked:'more'|'less'|null;modelVersion:string;
 /** Pre-lock context, null when unknown (never filled in after the fact). */
 lineGapRel:number|null;minutesCv:number|null;games:number|null;booksAgree:boolean|null};

/** Rows that fail checks are excluded from every metric and reported; nothing is repaired or guessed. */
export function sportsQuality(rows:SportsRow[],nowIso:string,maxInputAgeDays=3):{clean:SportsRow[];issues:QualityIssue[]}{
 const issues:QualityIssue[]=[],seen=new Set<string>(),clean:SportsRow[]=[];
 const now=Date.parse(nowIso);
 for(const r of rows){
  const bad=(code:QualityIssue['code'])=>{issues.push({code,key:r.key});};
  if(!r.key||!r.game||!r.predictedAt||!r.lockAt||!r.gradedAt){bad('MISSING_FIELD');continue;}
  if(seen.has(r.key)){bad('DUPLICATE');continue;}
  if(!(r.pMore>0&&r.pMore<1)){bad('INVALID_PROBABILITY');continue;}
  if(Date.parse(r.predictedAt)>=Date.parse(r.lockAt)){bad('PREDICTED_AFTER_LOCK');continue;}
  if(Date.parse(r.gradedAt)>now||Date.parse(r.lockAt)>now){bad('FUTURE_TIMESTAMP');continue;}
  if(Date.parse(r.lockAt)-Date.parse(r.predictedAt)>maxInputAgeDays*86400_000){bad('STALE_INPUT');continue;}
  seen.add(r.key);clean.push(r);
 }
 return {clean,issues};
}

// ---------------------------------------------------------------- sports diagnostics

export type Pattern={id:string;domain:Domain;description:string;n:number;clusters:number;
 effect:number;lower95:number;upper95:number;significant:boolean;idea:string|null};

const gapRows=(rows:SportsRow[],pick:(r:SportsRow)=>boolean)=>rows.filter(r=>r.picked&&pick(r)).map(r=>{
 const conf=r.picked==='more'?r.pMore:1-r.pMore,hit=r.outcome===r.picked?1:0;
 // Overconfidence as a paired loss so the game-clustered bootstrap applies: candidate=conf, reference=hit.
 return {cluster:r.game,candidate:conf,reference:hit};
});

/** Stated confidence minus hit rate for one group of picks, with a game-clustered 95% interval. */
function overconfidence(id:string,description:string,rows:SportsRow[],pick:(r:SportsRow)=>boolean,idea:string|null,minN:number,seed:number):Pattern|null{
 const g=gapRows(rows,pick);if(g.length<minN)return null;
 const ci=clusteredDifference(g,1000,seed);if(!ci)return null;
 return {id,domain:'sports',description,n:g.length,clusters:ci.clusters,effect:round(ci.mean,4)!,lower95:round(ci.lower95,4)!,upper95:round(ci.upper95,4)!,
  significant:ci.lower95>0,idea};
}

/** Registered sports patterns. Each maps to one idea template; the thresholds are fixed here, not tuned on results. */
export function sportsPatterns(rows:SportsRow[],minN=40):Pattern[]{
 const out=[
  overconfidence('picks-overall','All recorded picks: stated confidence minus hit rate',rows,()=>true,'overall-recalibration',minN,1),
  overconfidence('picks-more','More picks: stated confidence minus hit rate',rows,r=>r.picked==='more','side-asymmetric-calibration',minN,2),
  overconfidence('picks-less','Less picks: stated confidence minus hit rate',rows,r=>r.picked==='less',null,minN,3),
  overconfidence('picks-large-line-gap','Picks whose model mean is >= 40% from the line',rows,r=>r.lineGapRel!==null&&r.lineGapRel>=0.4,'line-gap-shrinkage',minN,4),
  overconfidence('picks-volatile-minutes','Picks for players with minutes CV >= 0.30',rows,r=>r.minutesCv!==null&&r.minutesCv>=0.3,'minutes-uncertainty-shrinkage',minN,5),
  overconfidence('picks-short-history','Picks for players with <= 5 games of history',rows,r=>r.games!==null&&r.games<=5,'short-history-shrinkage',minN,6),
  overconfidence('picks-no-book-quote','Picks without a same-line sportsbook quote',rows,r=>r.booksAgree===null,'market-anchor-when-books-missing',minN,7),
 ];
 return out.filter((p):p is Pattern=>!!p);
}

// ---------------------------------------------------------------- stocks diagnostics

export type StockWeek={week:string;strategy:number;spy:number;exposure:number};
/** Weekly forward (or replayed) returns vs SPY. Clusters are 4-week blocks so autocorrelation is respected. */
export function stockPatterns(weeks:StockWeek[],minWeeks=26):Pattern[]{
 if(weeks.length<minWeeks)return [];
 const block=(i:number)=>'b'+Math.floor(i/4);
 const sorted=[...weeks].sort((a,b)=>a.week.localeCompare(b.week));
 const vsMatched=clusteredDifference(sorted.map((w,i)=>({cluster:block(i),candidate:w.spy*w.exposure,reference:w.strategy})),1000,11);
 const vsSpy=clusteredDifference(sorted.map((w,i)=>({cluster:block(i),candidate:w.spy,reference:w.strategy})),1000,12);
 const mk=(id:string,description:string,ci:ReturnType<typeof clusteredDifference>,idea:string):Pattern|null=>ci?{id,domain:'stocks',description,
  n:sorted.length,clusters:ci.clusters,effect:round(ci.mean,5)!,lower95:round(ci.lower95,5)!,upper95:round(ci.upper95,5)!,significant:ci.lower95>0,idea}:null;
 return [mk('trails-exposure-matched-spy','Exposure-matched SPY weekly return minus strategy (selection gap)',vsMatched,'selection-signal-replacement'),
  mk('trails-spy','SPY weekly return minus strategy (total gap, including cash drag)',vsSpy,'exposure-core-satellite')].filter((p):p is Pattern=>!!p);
}

// ---------------------------------------------------------------- hypotheses

export type Hypothesis={key:string;domain:Domain;idea:string;statement:string;motivatedBy:string;evidence:Pick<Pattern,'n'|'effect'|'lower95'|'upper95'>};

/** Deterministic: significant patterns → idea templates, skipping ideas already rejected or under test, at most maxNew. */
export function proposeHypotheses(patterns:Pattern[],reg:Registry,maxNew=2):{proposed:Hypothesis[];skipped:{key:string;why:'already_rejected'|'already_under_test'|'limit'}[]}{
 const {rejected,active}=blockedIdeas(reg);
 const proposed:Hypothesis[]=[],skipped:{key:string;why:'already_rejected'|'already_under_test'|'limit'}[]=[];
 const ranked=patterns.filter(p=>p.significant&&p.idea).sort((a,b)=>b.lower95-a.lower95||a.id.localeCompare(b.id));
 const done=new Set<string>();
 for(const p of ranked){
  const key=hypothesisKey(p.domain,p.idea!);if(done.has(key))continue;done.add(key);
  if(rejected.has(key)){skipped.push({key,why:'already_rejected'});continue;}
  if(active.has(key)){skipped.push({key,why:'already_under_test'});continue;}
  if(proposed.length>=maxNew){skipped.push({key,why:'limit'});continue;}
  proposed.push({key,domain:p.domain,idea:p.idea!,motivatedBy:p.id,evidence:{n:p.n,effect:p.effect,lower95:p.lower95,upper95:p.upper95},
   statement:`${p.description} is ${(p.effect*100).toFixed(1)} pts (95% CI ${(p.lower95*100).toFixed(1)} to ${(p.upper95*100).toFixed(1)}). `+
    `Test whether a frozen ${p.idea!.replaceAll('-',' ')} challenger improves out-of-sample probability quality against the active baseline.`});
 }
 return {proposed,skipped};
}

/** Hit rate with a Wilson interval, for reports. */
export function hitSummary(rows:SportsRow[]){
 const picks=rows.filter(r=>r.picked);const hits=picks.filter(r=>r.outcome===r.picked).length,w=wilson(hits,picks.length);
 return {picks:picks.length,hits,hitRate:round(picks.length?hits/picks.length:null,4),lower95:round(w.lower,4),upper95:round(w.upper,4)};
}
