/**
 * Staking explanations from SAVED props records (the same Raw snapshot the dashboard and assistant read). Pure.
 * Live stakes are what the ledger recorded (flat $5). Research stakes are recomputed here with the frozen policy
 * lab-staking-v1 and REAL graded picks recorded before each entry, and are always labelled as research, never as stakes.
 */
import type {Raw} from '../props/dashboard-view.ts';
import {assessEntry,recommend,calibrationBins,METHODS,STAKING_POLICY_V1,type Method,type EntryAssessment,type CalibrationBin} from './staking.ts';
import {wilson,round} from './stats.ts';

const etDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
export type EntryExplanation={entryId:number;platform:string;createdAt:string;lockAt:string;liveStakeCents:number;settled:boolean;profitCents:number|null;
 legs:{player:string;stat:string;line:number;side:string;stated:number;observed:number|null;lower:number|null;n:number}[];
 assessment:EntryAssessment;research:Record<Method,{stakeCents:number;reason:string}>;calibrationPicks:number};

function latestResults(r:Raw){const m=new Map<number,Raw['results'][number]>();for(const x of r.results){const p=m.get(x.observation_id);if(!p||x.revision>p.revision)m.set(x.observation_id,x);}return m;}

/** Graded recorded picks with their stated side probability, optionally only those graded before `beforeIso` (approximated by lock). */
export function gradedPicks(r:Raw,beforeIso?:string){
 const res=latestResults(r),pred=new Map(r.predictions.map(p=>[p.id,p])),obs=new Map(r.observations.map(o=>[o.id,o]));
 const seen=new Set<string>();
 return r.picks.flatMap(k=>{
  if(k.status!=='recorded'||!k.side)return [];
  const p=pred.get(k.prediction_id),o=p?obs.get(p.observation_id):undefined,x=p?res.get(p.observation_id):undefined;
  if(!p||!o||!x||(x.outcome!=='more'&&x.outcome!=='less')||p.p_more===null||p.p_less===null)return [];
  if(beforeIso&&Date.parse(o.lock_at)>=Date.parse(beforeIso))return [];
  // The same line on two platforms is one observation of the world.
  const key=[o.provider_event_id,o.player_name.toLowerCase(),o.stat,Number(o.line)].join('|');if(seen.has(key))return [];seen.add(key);
  return [{probability:k.side==='more'?Number(p.p_more):Number(p.p_less),correct:x.outcome===k.side,stat:o.stat,lockAt:o.lock_at}];
 });
}

/** "How accurate are our 80% predictions?": stated vs observed by band, with Wilson intervals, from real graded picks. */
export function accuracyByBand(r:Raw){
 const g=gradedPicks(r);
 const bins:[number,number][]=[[0.6,0.65],[0.65,0.7],[0.7,0.75],[0.75,0.8001]];
 return {picks:g.length,bands:bins.map(([lo,hi])=>{const x=g.filter(p=>p.probability>=lo&&p.probability<hi);const k=x.filter(p=>p.correct).length;
  const w=wilson(k,x.length);
  return {band:`${Math.round(lo*100)}–${Math.round(Math.min(hi,0.8)*100)}%`,n:x.length,meanStated:x.length?round(x.reduce((a,p)=>a+p.probability,0)/x.length,4):null,
   hitRate:x.length?round(k/x.length,4):null,lower:x.length?round(w.lower,4):null,upper:x.length?round(w.upper,4):null};})};
}

export function explainEntries(r:Raw):EntryExplanation[]{
 const pick=new Map(r.picks.map(k=>[k.id,k])),pred=new Map(r.predictions.map(p=>[p.id,p])),obs=new Map(r.observations.map(o=>[o.id,o]));
 const acct=new Map(r.accounts.map(a=>[a.id,a])),sett=new Map(r.settlements.map(s=>[s.entry_id,s]));
 const ordered=[...r.entries].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id-b.id);
 const out:EntryExplanation[]=[];
 const stakedToday=new Map<string,Record<Method,number>>();
 for(const e of ordered){
  const a=acct.get(e.account_id);if(!a)continue;
  const legs=r.legs.filter(l=>l.entry_id===e.id).map(l=>{const k=pick.get(l.pick_id),p=k?pred.get(k.prediction_id):undefined,o=p?obs.get(p.observation_id):undefined;
   return k&&p&&o&&k.side?{k,p,o}:null;}).filter((x):x is NonNullable<typeof x>=>!!x);
  if(legs.length<2)continue;
  // Calibration only from picks whose games locked before this entry was made: nothing from the future.
  const bins:CalibrationBin[]=calibrationBins(gradedPicks(r,e.created_at));
  const input={id:String(e.id),date:etDate(e.lock_at),platform:a.platform,legs:legs.map(l=>({probability:l.k.side==='more'?Number(l.p.p_more):Number(l.p.p_less),
   eventId:l.o.provider_event_id,playerKey:l.o.player_name.toLowerCase()}))};
  const assessment=assessEntry(input,bins);
  // Bankroll before this entry: initial + settled profit of earlier entries − open earlier stakes (as the ledger computes it).
  const earlier=ordered.filter(x=>x.account_id===e.account_id&&x.created_at<e.created_at);
  const settledProfit=earlier.reduce((s,x)=>s+(sett.get(x.id)?.profit_cents??0),0);
  const open=earlier.filter(x=>!sett.has(x.id)).reduce((s,x)=>s+x.stake_cents,0);
  const day=a.id+'|'+etDate(e.created_at);
  const used=stakedToday.get(day)??Object.fromEntries(METHODS.map(m=>[m,0])) as Record<Method,number>;
  const research=Object.fromEntries(METHODS.map(m=>{const rec=recommend(m,assessment,{bankrollCents:a.initial_cents+settledProfit-open,peakCents:a.initial_cents+Math.max(0,settledProfit),stakedTodayCents:used[m]});
   used[m]+=rec.stakeCents;return [m,{stakeCents:rec.stakeCents,reason:rec.reason}];})) as EntryExplanation['research'];
  stakedToday.set(day,used);
  const s=sett.get(e.id);
  out.push({entryId:e.id,platform:a.platform,createdAt:e.created_at,lockAt:e.lock_at,liveStakeCents:e.stake_cents,settled:!!s,profitCents:s?.profit_cents??null,
   legs:legs.map((l,i)=>({player:l.o.player_name,stat:l.o.stat,line:Number(l.o.line),side:l.k.side!,stated:round(input.legs[i].probability,4)!,
    observed:Number.isFinite(assessment.legs[i].mid)?round(assessment.legs[i].mid,4):null,lower:Number.isFinite(assessment.legs[i].low)?round(assessment.legs[i].low,4):null,n:assessment.legs[i].n})),
   assessment,research,calibrationPicks:bins.reduce((s,b)=>s+b.n,0)});
 }
 return out;
}

export const REASON_TEXT:Record<string,string>={
 live_flat_policy:'the live policy stakes a flat $5',
 payout_terms_unknown:'the platform publishes no payout table for this entry, so expected value cannot be computed',
 calibration_sample_too_small:`fewer than ${STAKING_POLICY_V1.minBinPicks} real graded picks exist at this confidence, so the true hit rate is too uncertain to size on`,
 lower_bound_edge_not_positive:'at the cautious end of the observed hit rates, both legs together would not beat the 1-in-3 break-even',
 drawdown_stop:'the virtual bankroll is 20% or more below its peak',
 calibration_not_reliable_for_kelly:'stated confidence differs from observed accuracy by more than 5 points, or the sample is too small for Kelly',
 kelly_fraction_not_positive:'the Kelly fraction is not positive',
 daily_risk_limit_or_bankroll:'the $15 daily risk limit (or the available bankroll) is already used',
 positive_lower_bound_edge:'the cautious expected return is positive',
 confidence_scaled:'scaled by how far the cautious joint hit rate clears break-even',
 ev_scaled:'scaled by the cautious expected return',
 quarter_kelly:'a quarter of the Kelly fraction, capped at 1% of bankroll and $5',
};
export const reasonText=(r:string)=>r.split('+').map(x=>x==='drawdown_halved'?'halved because the bankroll is 10%+ below its peak':REASON_TEXT[x]??x.replaceAll('_',' ')).join('; ');
