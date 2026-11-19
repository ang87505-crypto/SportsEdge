/** Rolling diagnostics request a review; they never retrain, promote, change gates or alter stakes. */
import type {SportsRow} from './diagnostics.ts';
import {seeded,holm,round,brier} from '../stats.ts';
export const DRIFT_POLICY={version:'sports-drift-v1',recentDays:7,referenceDays:28,minLinesPerWindow:100,minGamesPerWindow:10,
 minBrierChange:0.02,minConfidenceGapChange:0.05,replicates:1000,seed:20261119,familyAlpha:0.05} as const;
type Window={lines:number;games:number;picks:number;pickGames:number;brier:number|null;confidenceGap:number|null};
type Change={metric:'brier'|'confidence_gap';difference:number;lower95:number;upper95:number;pAdjusted:number;review:boolean};
export type DriftReport={policy:typeof DRIFT_POLICY;status:'COLLECTING'|'NO_CLEAR_DRIFT'|'REVIEW_REQUESTED';
 recent:Window;reference:Window;changes:Change[];reason:string};
const metric=(r:SportsRow,kind:'brier'|'confidence_gap')=>kind==='brier'?brier(r.pMore,r.outcome==='more'?1:0):
 (r.picked==='more'?r.pMore:1-r.pMore)-Number(r.picked===r.outcome);
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function stats(rows:SportsRow[]):Window{
 const picks=rows.filter(r=>r.picked);
 return {lines:rows.length,games:new Set(rows.map(r=>r.game)).size,picks:picks.length,pickGames:new Set(picks.map(r=>r.game)).size,
  brier:round(mean(rows.map(r=>metric(r,'brier'))),6),confidenceGap:round(mean(picks.map(r=>metric(r,'confidence_gap'))),6)};
}
function difference(a:SportsRow[],b:SportsRow[],kind:Change['metric']){
 const groups=(rows:SportsRow[])=>{const m=new Map<string,number[]>();for(const r of rows)m.set(r.game,[...(m.get(r.game)??[]),metric(r,kind)]);return [...m.values()];};
 const ga=groups(a),gb=groups(b),rnd=seeded(DRIFT_POLICY.seed),values:number[]=[];
 const draw=(g:number[][])=>{let sum=0,n=0;for(let i=0;i<g.length;i++){const rows=g[Math.floor(rnd()*g.length)];for(const x of rows){sum+=x;n++;}}return sum/n;};
 for(let i=0;i<DRIFT_POLICY.replicates;i++)values.push(draw(ga)-draw(gb));
 const p=(values.filter(v=>v<=0).length+1)/(values.length+1);values.sort((a,b)=>a-b);
 return {metric:kind,difference:round(mean(a.map(r=>metric(r,kind)))!-mean(b.map(r=>metric(r,kind)))!,6)!,
  lower95:round(values[25],6)!,upper95:round(values[974],6)!,pAdjusted:p,review:false};
}
export function sportsDrift(rows:readonly SportsRow[],nowIso:string):DriftReport{
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('DRIFT_INVALID_CLOCK');
 const day=86400_000,cutoff=now-DRIFT_POLICY.recentDays*day,start=cutoff-DRIFT_POLICY.referenceDays*day;
 const clean=[...new Map([...rows].sort((a,b)=>a.key.localeCompare(b.key)).filter(r=>Date.parse(r.gradedAt)<=now&&Date.parse(r.lockAt)<=now&&
  Date.parse(r.lockAt)>start).map(r=>[r.key,r])).values()];
 const recent=clean.filter(r=>Date.parse(r.lockAt)>cutoff),reference=clean.filter(r=>Date.parse(r.lockAt)<=cutoff);
 const a=stats(recent),b=stats(reference),enough=(w:Window)=>w.lines>=DRIFT_POLICY.minLinesPerWindow&&w.games>=DRIFT_POLICY.minGamesPerWindow;
 if(!enough(a)||!enough(b))return {policy:DRIFT_POLICY,status:'COLLECTING',recent:a,reference:b,changes:[],
  reason:'Needs 100 unique graded lines across 10 games in each window. No drift conclusion or model action.'};
 const changes=[difference(recent,reference,'brier')];
 if(a.picks>=40&&b.picks>=40&&a.pickGames>=10&&b.pickGames>=10)changes.push(difference(recent.filter(r=>r.picked),reference.filter(r=>r.picked),'confidence_gap'));
 const adjusted=holm(changes.map(c=>c.pAdjusted));
 changes.forEach((c,i)=>{c.pAdjusted=round(adjusted[i],6)!;c.review=c.pAdjusted<DRIFT_POLICY.familyAlpha&&c.lower95>0&&
  c.difference>=(c.metric==='brier'?DRIFT_POLICY.minBrierChange:DRIFT_POLICY.minConfidenceGapChange);});
 const review=changes.some(c=>c.review);
 return {policy:DRIFT_POLICY,status:review?'REVIEW_REQUESTED':'NO_CLEAR_DRIFT',recent:a,reference:b,changes,
  reason:review?'Recent probability errors worsened under the registered drift rule. Review data freshness and a bounded shadow retrain; the active model and promotion requirements are unchanged.':
   'No clear deterioration detected under this rule. This does not establish stable accuracy or profitability.'};
}
export function readSportsDrift(raw:unknown):DriftReport|null{
 if(!raw||typeof raw!=='object')return null;const r=raw as DriftReport;
 if(r.policy?.version!==DRIFT_POLICY.version||!['COLLECTING','NO_CLEAR_DRIFT','REVIEW_REQUESTED'].includes(r.status)||typeof r.reason!=='string'||!Array.isArray(r.changes))return null;
 for(const w of [r.recent,r.reference])if(!w||![w.lines,w.games,w.picks,w.pickGames].every(n=>Number.isSafeInteger(n)&&n>=0)||w.games>w.lines||w.picks>w.lines||w.pickGames>w.picks)return null;
 return r;
}
