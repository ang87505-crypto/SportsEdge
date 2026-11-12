/**
 * Variable PAPER staking research (SHADOW ONLY). Pure and deterministic.
 * Sizes a complete entry, never a leg in isolation, from CALIBRATED evidence: a stated 80% is mapped to the hit rate
 * actually observed at that confidence (with its lower confidence bound), legs are combined with an explicit dependence
 * haircut, and the recorded payout terms decide expected value. Uncertainty can and often does make the right stake zero.
 * Every method is capped at the live $5 stake and the live daily limit; nothing here changes a real virtual stake.
 */
import {PRIZEPICKS_TERMS_V1,settleEntry,type LegResult} from '../props/rules.ts';
import type {Platform} from '../props/contract.ts';
import {wilson,clusteredDifference,holm,seeded,round} from './stats.ts';
import {canonicalJson,sha256} from '../props/normalize.ts';

export const STAKING_POLICY_V1={version:'lab-staking-v1',
 maxStakeCents:500,            // live per-entry stake: never exceeded
 stepCents:100,                // stakes are whole dollars; anything under $1 is no entry
 dailyRiskCents:1500,          // live limit: 3 entries × $5 per account per day
 dependenceHaircut:0.02,       // relative joint-probability haircut for unmodelled common shocks across different games
 confidenceZ:1.645,            // one-sided 95% lower bound on calibrated leg hit rates
 minBinPicks:100,              // a confidence band needs this many graded picks to be used at all
 kelly:{fraction:0.25,bankrollCap:0.01,minBinPicks:300,maxCalibrationGap:0.05},
 confidenceRamp:0.10,          // B: full stake once the joint lower bound clears break-even by 10 points
 evRamp:0.25,                  // C: full stake once the lower-bound EV reaches +25%
 drawdown:{halveAt:0.10,stopAt:0.20}} as const;
export const STAKING_POLICY_SHA256=sha256(canonicalJson(STAKING_POLICY_V1));

export const METHODS=['flat','confidence','expected_value','kelly','edge_gate'] as const;
export type Method=typeof METHODS[number];
export const METHOD_TEXT:Record<Method,string>={
 flat:'A. Flat $5 (the live policy)',
 confidence:'B. Confidence-adjusted: scales with how far the calibrated joint hit-rate lower bound clears break-even',
 expected_value:'C. Expected-value: scales with the lower-bound expected return under the recorded payout',
 kelly:'D. Quarter-Kelly capped at 1% of bankroll and $5, only when calibration is reliable',
 edge_gate:'E. $5 or no entry: enter only when the lower-bound expected return is positive',
};

// ---------------------------------------------------------------- calibration
export type CalibrationBin={from:number;to:number;n:number;hits:number};
export type LegEstimate={stated:number;mid:number;low:number;n:number;reliable:boolean;gap:number};
/** Bins of STATED side probability with graded hit counts, from evidence dated before the entries they size. */
export function calibrationBins(picks:{probability:number;correct:boolean}[],edges=[0.6,0.65,0.7,0.75,0.8]):CalibrationBin[]{
 const bins=edges.slice(0,-1).map((from,i)=>({from,to:edges[i+1],n:0,hits:0}));
 for(const p of picks){const b=bins.find(x=>p.probability>=x.from&&(p.probability<x.to||(x.to===edges[edges.length-1]&&p.probability<=x.to)));if(b){b.n++;b.hits+=Number(p.correct);}}
 return bins;
}
export function legEstimate(stated:number,bins:CalibrationBin[]):LegEstimate{
 const b=bins.find(x=>stated>=x.from&&stated<x.to)??(stated>=bins[bins.length-1]?.to?bins[bins.length-1]:undefined);
 if(!b||b.n<STAKING_POLICY_V1.minBinPicks)return {stated,mid:NaN,low:NaN,n:b?.n??0,reliable:false,gap:NaN};
 const mid=b.hits/b.n,low=wilson(b.hits,b.n,STAKING_POLICY_V1.confidenceZ).lower;
 return {stated,mid,low,n:b.n,reliable:true,gap:stated-mid};
}

// ---------------------------------------------------------------- one entry
export type EntryLeg={probability:number;eventId:string;playerKey:string};
export type EntryInput={id:string;date:string;platform:Platform;legs:EntryLeg[]};
export type SizingState={bankrollCents:number;peakCents:number;stakedTodayCents:number};
export type EntryAssessment={payoutKnown:boolean;breakEven:number|null;legs:LegEstimate[];sameGame:boolean;
 jointMid:number|null;jointLow:number|null;evMid:number|null;evLow:number|null;reasons:string[]};
export type Recommendation={method:Method;stakeCents:number;reason:string};

/** Gross payout multiple when every leg wins, from the recorded terms; null when no published table exists (Pick6). */
export function winMultiple(platform:Platform,legs:number):number|null{
 if(platform!=='prizepicks')return null;
 const m=PRIZEPICKS_TERMS_V1.powerMilli[legs];return m?m/1000:null;
}
export function assessEntry(e:EntryInput,bins:CalibrationBin[]):EntryAssessment{
 const P=STAKING_POLICY_V1,reasons:string[]=[];
 const multiple=winMultiple(e.platform,e.legs.length);
 const legs=e.legs.map(l=>legEstimate(l.probability,bins));
 const sameGame=new Set(e.legs.map(l=>l.eventId)).size<e.legs.length;
 if(multiple===null)reasons.push('payout_terms_unknown');
 if(legs.some(l=>!l.reliable))reasons.push('calibration_sample_too_small');
 if(sameGame)reasons.push('same_game_correlation');
 const haircut=1-P.dependenceHaircut-(sameGame?0.10:0);
 const jointMid=legs.every(l=>l.reliable)?legs.reduce((a,l)=>a*l.mid,1)*haircut:null;
 const jointLow=legs.every(l=>l.reliable)?legs.reduce((a,l)=>a*l.low,1)*haircut:null;
 const evMid=multiple!==null&&jointMid!==null?jointMid*multiple-1:null;
 const evLow=multiple!==null&&jointLow!==null?jointLow*multiple-1:null;
 if(evLow!==null&&evLow<=0)reasons.push('lower_bound_edge_not_positive');
 return {payoutKnown:multiple!==null,breakEven:multiple?1/multiple:null,legs,sameGame,jointMid,jointLow,evMid,evLow,reasons};
}

const floorStep=(c:number)=>{const s=Math.floor(c/STAKING_POLICY_V1.stepCents)*STAKING_POLICY_V1.stepCents;return s>=STAKING_POLICY_V1.stepCents?s:0;};
/** One method's stake for one entry. Flat is the live policy and ignores the research gates by design. */
export function recommend(method:Method,a:EntryAssessment,s:SizingState):Recommendation{
 const P=STAKING_POLICY_V1;
 const room=Math.max(0,Math.min(P.dailyRiskCents-s.stakedTodayCents,s.bankrollCents));
 const cap=(c:number,reason:string):Recommendation=>{const stake=floorStep(Math.min(c,P.maxStakeCents,room));
  return {method,stakeCents:stake,reason:stake?reason:room<P.stepCents?'daily_risk_limit_or_bankroll':reason};};
 if(method==='flat')return cap(P.maxStakeCents,'live_flat_policy');
 if(!a.payoutKnown)return {method,stakeCents:0,reason:'payout_terms_unknown'};
 if(a.jointLow===null||a.evLow===null)return {method,stakeCents:0,reason:'calibration_sample_too_small'};
 if(a.evLow<=0)return {method,stakeCents:0,reason:'lower_bound_edge_not_positive'};
 const dd=s.peakCents>0?1-s.bankrollCents/s.peakCents:0;
 if(dd>=P.drawdown.stopAt)return {method,stakeCents:0,reason:'drawdown_stop'};
 const scale=dd>=P.drawdown.halveAt?0.5:1,ddNote=scale<1?'+drawdown_halved':'';
 if(method==='edge_gate')return cap(P.maxStakeCents*scale,'positive_lower_bound_edge'+ddNote);
 if(method==='confidence')return cap(P.maxStakeCents*scale*Math.min(1,(a.jointLow-a.breakEven!)/P.confidenceRamp),'confidence_scaled'+ddNote);
 if(method==='expected_value')return cap(P.maxStakeCents*scale*Math.min(1,a.evLow/P.evRamp),'ev_scaled'+ddNote);
 // Kelly only when every leg's band is well sampled and its stated confidence is close to what was observed.
 if(a.legs.some(l=>l.n<P.kelly.minBinPicks||Math.abs(l.gap)>P.kelly.maxCalibrationGap))return {method,stakeCents:0,reason:'calibration_not_reliable_for_kelly'};
 const b=1/a.breakEven!-1,p=a.jointLow,f=(b*p-(1-p))/b;
 if(f<=0)return {method,stakeCents:0,reason:'kelly_fraction_not_positive'};
 return cap(Math.min(P.kelly.fraction*f*s.bankrollCents,P.kelly.bankrollCap*s.bankrollCents)*scale,'quarter_kelly'+ddNote);
}

// ---------------------------------------------------------------- comparison on the SAME frozen entries
export type SettledEntry=EntryInput&{legResults:LegResult[]};
export type MethodResult={method:Method;label:string;entries:number;staked:number;skipped:number;totalStakedCents:number;pnlCents:number;
 roi:number|null;growth:number;maxDrawdown:number;maxDailyExposureCents:number;dailyVolatilityCents:number;avgStakeCents:number|null};
export type StakingComparison={policy:string;policySha256:string;initialCents:number;entries:number;dates:number;payoutUnknownExcluded:number;
 methods:MethodResult[];vsFlat:{method:Method;meanProfitDifferenceCents:number;lower95:number;upper95:number;pAdjusted:number}[];
 jointCalibration:{bins:{from:number;n:number;predicted:number;observed:number}[];brier:number|null};
 sensitivity:{shift:number;methods:{method:Method;expectedPnlCents:number;probabilityOfLoss:number;medianMaxDrawdown:number}[]}[];
 perEntry:{id:string;date:string;stakes:Record<Method,number>;reasons:Record<Method,string>;profit:Record<Method,number>;jointMid:number|null;evLow:number|null}[]};

export function runBankroll(entries:SettledEntry[],bins:CalibrationBin[],method:Method,initialCents:number,
 outcomes?:(e:SettledEntry)=>LegResult[]){
 const byDate=new Map<string,SettledEntry[]>();for(const e of entries)byDate.set(e.date,[...(byDate.get(e.date)??[]),e]);
 let bankroll=initialCents,peak=initialCents,maxDd=0,maxExposure=0;
 const daily:number[]=[],rows:{id:string;stake:number;reason:string;profit:number}[]=[];
 for(const date of [...byDate.keys()].sort()){
  const state={bankrollCents:bankroll,peakCents:peak,stakedTodayCents:0};let dayPnl=0;
  for(const e of byDate.get(date)!){
   const r=recommend(method,assessEntry(e,bins),state);
   state.stakedTodayCents+=r.stakeCents;
   let profit=0;
   if(r.stakeCents){const s=settleEntry(e.platform,r.stakeCents,outcomes?outcomes(e):e.legResults);profit=s.profitCents??0;}
   dayPnl+=profit;rows.push({id:e.id,stake:r.stakeCents,reason:r.reason,profit});
  }
  maxExposure=Math.max(maxExposure,state.stakedTodayCents);
  bankroll+=dayPnl;peak=Math.max(peak,bankroll);maxDd=Math.max(maxDd,peak>0?1-bankroll/peak:0);daily.push(dayPnl);
 }
 return {bankroll,maxDd,maxExposure,daily,rows};
}

export function compareStaking(all:SettledEntry[],bins:CalibrationBin[],initialCents=50000,seed=20261112):StakingComparison{
 // Pick6 has no published payout table: its returns are unknown, so it is never scored as money.
 const entries=all.filter(e=>winMultiple(e.platform,e.legs.length)!==null).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const runs=Object.fromEntries(METHODS.map(m=>[m,runBankroll(entries,bins,m,initialCents)])) as Record<Method,ReturnType<typeof runBankroll>>;
 const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
 const methods:MethodResult[]=METHODS.map(m=>{
  const r=runs[m],staked=r.rows.filter(x=>x.stake>0),total=staked.reduce((a,x)=>a+x.stake,0),pnl=r.rows.reduce((a,x)=>a+x.profit,0);
  const mu=mean(r.daily);
  return {method:m,label:METHOD_TEXT[m],entries:r.rows.length,staked:staked.length,skipped:r.rows.length-staked.length,totalStakedCents:total,pnlCents:pnl,
   roi:total?round(pnl/total,4):null,growth:round((r.bankroll-initialCents)/initialCents,4)!,maxDrawdown:round(r.maxDd,4)!,maxDailyExposureCents:r.maxExposure,
   dailyVolatilityCents:round(Math.sqrt(mean(r.daily.map(x=>(x-mu)**2))),1)!,avgStakeCents:staked.length?round(total/staked.length,1):null};
 });
 // Paired by entry, resampled by date; Holm across the four alternatives. Flat is the reference.
 const flat=new Map(runs.flat.rows.map(x=>[x.id,x.profit]));
 const dateOf=new Map(entries.map(e=>[e.id,e.date]));
 const alts=METHODS.filter(m=>m!=='flat');
 const diffs=alts.map(m=>clusteredDifference(runs[m].rows.map(x=>({cluster:dateOf.get(x.id)!,candidate:-x.profit,reference:-(flat.get(x.id)??0)})),2000,seed));
 const adj=holm(diffs.map(d=>d?.pImprove??1));
 const vsFlat=alts.map((m,i)=>({method:m,meanProfitDifferenceCents:round(-(diffs[i]?.mean??0),2)!,lower95:round(-(diffs[i]?.upper95??0),2)!,
  upper95:round(-(diffs[i]?.lower95??0),2)!,pAdjusted:round(adj[i],4)!}));
 // Are joint probabilities honest? Calibrated joint (mid) vs the realised all-legs-won rate.
 const jb=[0,0.3,0.4,0.5,0.6,1].slice(0,-1).map((from,i,a)=>({from,to:[0.3,0.4,0.5,0.6,1][i],n:0,p:0,w:0}));
 let brier=0,nb=0;
 for(const e of entries){const a=assessEntry(e,bins);if(a.jointMid===null||e.legResults.includes('void'))continue;
  const won=e.legResults.every(l=>l==='win')?1:0,b=jb.find(x=>a.jointMid!>=x.from&&a.jointMid!<x.to)!;b.n++;b.p+=a.jointMid;b.w+=won;brier+=(a.jointMid-won)**2;nb++;}
 // Sensitivity: replay the same stakes against outcomes simulated from leg probabilities LOWER than our calibrated
 // estimate (overconfidence of 0, 2, 4 and 6 points per leg). 500 seeded replications each.
 const sensitivity=[0,0.02,0.04,0.06].map(shift=>({shift,methods:METHODS.map(m=>{
  const rnd=seeded(seed+Math.round(shift*1000));const pnls:number[]=[],dds:number[]=[];
  for(let k=0;k<500;k++){
   const r=runBankroll(entries,bins,m,initialCents,e=>assessEntry(e,bins).legs.map(l=>rnd()<(Number.isFinite(l.mid)?l.mid:l.stated)-shift?'win':'loss'));
   pnls.push(r.bankroll-initialCents);dds.push(r.maxDd);
  }
  dds.sort((a,b)=>a-b);
  return {method:m,expectedPnlCents:round(mean(pnls),0)!,probabilityOfLoss:round(pnls.filter(x=>x<0).length/pnls.length,3)!,medianMaxDrawdown:round(dds[Math.floor(dds.length/2)],4)!};
 })}));
 const perEntry=entries.map(e=>{const a=assessEntry(e,bins);
  return {id:e.id,date:e.date,jointMid:round(a.jointMid,4),evLow:round(a.evLow,4),
   stakes:Object.fromEntries(METHODS.map(m=>[m,runs[m].rows.find(x=>x.id===e.id)!.stake])) as Record<Method,number>,
   reasons:Object.fromEntries(METHODS.map(m=>[m,runs[m].rows.find(x=>x.id===e.id)!.reason])) as Record<Method,string>,
   profit:Object.fromEntries(METHODS.map(m=>[m,runs[m].rows.find(x=>x.id===e.id)!.profit])) as Record<Method,number>};});
 return {policy:STAKING_POLICY_V1.version,policySha256:STAKING_POLICY_SHA256,initialCents,entries:entries.length,dates:new Set(entries.map(e=>e.date)).size,
  payoutUnknownExcluded:all.length-entries.length,methods,vsFlat,
  jointCalibration:{bins:jb.filter(b=>b.n).map(b=>({from:b.from,n:b.n,predicted:round(b.p/b.n,4)!,observed:round(b.w/b.n,4)!})),brier:nb?round(brier/nb,5):null},
  sensitivity,perEntry};
}

/** Forward evidence gate for any claim that a sizing method beats flat: enough settled entries, dates, and a Holm-adjusted win. */
export const STAKING_GATE={minSettledEntries:100,minDates:14,familyAlpha:0.05} as const;
export function stakingVerdict(c:StakingComparison,evidence:'retrospective'|'forward'){
 const enough=c.entries>=STAKING_GATE.minSettledEntries&&c.dates>=STAKING_GATE.minDates;
 return c.vsFlat.map(v=>({method:v.method,verdict:evidence==='retrospective'?(v.pAdjusted<STAKING_GATE.familyAlpha&&v.lower95>0?'promising_retrospective_only':'not_better_than_flat'):
  !enough?'collecting':v.pAdjusted<STAKING_GATE.familyAlpha&&v.lower95>0?'better_than_flat_forward':'not_better_than_flat'}));
}

// ---------------------------------------------------------------- forward: frozen shadow stakes on real entries
export type ForwardStakeRow={entryId:string;date:string;platform:Platform;stakes:Partial<Record<Method,number>>;legResults:LegResult[]|null;liveStakeCents:number};
/**
 * Scores frozen shadow stakes once entries settle. Pick6 has no published payout table, so it is counted but never valued.
 * Unsettled entries are pending. The live stake is reported beside the flat shadow so any difference is visible.
 */
export function forwardStaking(rows:ForwardStakeRow[],initialCents=50000,seed=20261112){
 const settled=rows.filter(r=>r.legResults&&winMultiple(r.platform,r.legResults.length)!==null).sort((a,b)=>a.date.localeCompare(b.date)||a.entryId.localeCompare(b.entryId));
 const profitOf=(r:ForwardStakeRow,m:Method)=>{const st=r.stakes[m]??0;return st?settleEntry(r.platform,st,r.legResults!).profitCents??0:0;};
 const dates=[...new Set(settled.map(r=>r.date))].sort();
 const methods=METHODS.map(m=>{
  let bank=initialCents,peak=initialCents,maxDd=0,maxExp=0;const daily:number[]=[];
  for(const d of dates){const day=settled.filter(r=>r.date===d);const exp=day.reduce((a,r)=>a+(r.stakes[m]??0),0);maxExp=Math.max(maxExp,exp);
   const pnl=day.reduce((a,r)=>a+profitOf(r,m),0);daily.push(pnl);bank+=pnl;peak=Math.max(peak,bank);maxDd=Math.max(maxDd,1-bank/peak);}
  const total=settled.reduce((a,r)=>a+(r.stakes[m]??0),0),pnl=daily.reduce((a,b)=>a+b,0),mu=daily.length?pnl/daily.length:0;
  return {method:m,label:METHOD_TEXT[m],staked:settled.filter(r=>(r.stakes[m]??0)>0).length,skipped:settled.filter(r=>!(r.stakes[m]??0)).length,
   totalStakedCents:total,pnlCents:pnl,roi:total?round(pnl/total,4):null,growth:round(pnl/initialCents,4),maxDrawdown:round(maxDd,4),maxDailyExposureCents:maxExp,
   dailyVolatilityCents:round(Math.sqrt(daily.length?daily.reduce((a,x)=>a+(x-mu)**2,0)/daily.length:0),1)};
 });
 const alts=METHODS.filter(m=>m!=='flat');
 const diffs=alts.map(m=>clusteredDifference(settled.map(r=>({cluster:r.date,candidate:-profitOf(r,m),reference:-profitOf(r,'flat')})),2000,seed));
 const adj=holm(diffs.map(d=>d?.pImprove??1));
 const enough=settled.length>=STAKING_GATE.minSettledEntries&&dates.length>=STAKING_GATE.minDates;
 const verdicts=alts.map((m,i)=>({method:m,meanProfitDifferenceCents:diffs[i]?round(-diffs[i]!.mean,2):null,pAdjusted:round(adj[i],4),
  verdict:!enough?'collecting':adj[i]<STAKING_GATE.familyAlpha&&diffs[i]!.upper95<0?'better_than_flat_forward':'not_better_than_flat'}));
 return {evidence:'forward' as const,entries:rows.length,settled:settled.length,pending:rows.filter(r=>!r.legResults).length,
  payoutUnknown:rows.filter(r=>r.legResults&&winMultiple(r.platform,r.legResults.length)===null).length,dates:dates.length,
  liveStakeMatchesFlat:rows.every(r=>(r.stakes.flat??0)===r.liveStakeCents||r.liveStakeCents>STAKING_POLICY_V1.maxStakeCents),
  gate:STAKING_GATE,methods,verdicts};
}
