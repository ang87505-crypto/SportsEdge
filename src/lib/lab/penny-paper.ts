/** Separate forward PAPER experiment. Frozen model estimates are not calibrated probabilities or a profit claim. */
import {canonicalJson,sha256} from '../props/normalize.ts';
import {pennySizing} from './confidence-sizing.ts';

export const PENNY_PAPER_POLICY={id:'penny-paper-entry-v1',version:1,paperOnly:true,
 sizingPolicy:'penny-excess-probability-v1',initialCents:50000,maxStakeCents:50,dailyRiskCents:1500,
 referenceStakeCents:10,probabilityScale:1_000_000,dependenceHaircutPercent:2,
 probabilityBasis:'recorded_model_estimate_not_calibrated',entryType:'two_pick_power_different_games',
 termsVersion:'prizepicks-power-standard-20261107',grossMultiplierMilli:3000,
 fractionalCentReturn:'floor',comparison:'same_entries_flat_ten_cents',promotion:'none'} as const;
export const PENNY_PAPER_SHA256=sha256(canonicalJson(PENNY_PAPER_POLICY));
export function pennyJointPpm(first:number,second:number){
 for(const p of [first,second])if(!Number.isSafeInteger(p)||p<0||p>1_000_000)throw Error('PENNY_INVALID_PROBABILITY');
 return Math.floor(first*second*98/100_000_000);
}
/** Fractional-cent returns are explicitly floored for this virtual experiment, not claimed as provider policy. */
export function pennyReturnCents(stake:number,multiplierMilli:number){
 if(!Number.isSafeInteger(stake)||stake<0||stake>50||![0,1000,1500,3000].includes(multiplierMilli))throw Error('PENNY_INVALID_SETTLEMENT');
 return Math.floor(stake*multiplierMilli/1000);
}
export function pennyEntrySizing(first:number,second:number,availableCents=50000,stakedTodayCents=0){
 return pennySizing(pennyJointPpm(first,second),3000,availableCents,stakedTodayCents);
}
export type PennyEntry={id:number;source_entry_id:number;probability_ppm:number|null;stake_cents:number;reference_stake_cents:number;
 reason:string;recorded_at:string;lock_at:string;record_sha256:string};
export type PennySettlement={penny_entry_id:number;revision:number;grade_ids:number[];outcome:string;return_cents:number|null;
 profit_cents:number|null;reference_return_cents:number|null;reference_profit_cents:number|null;recorded_at:string};

export function pennySummary(entries:PennyEntry[],settlements:PennySettlement[],nowIso:string){
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('PENNY_INVALID_CLOCK');
 const rows=[...entries].filter(e=>Date.parse(e.recorded_at)<=now).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.id-b.id);
 if(new Set(rows.map(e=>e.id)).size!==rows.length)throw Error('PENNY_DUPLICATE_ENTRY');
 const latest=new Map<number,PennySettlement>();
 for(const s of settlements){if(!Number.isFinite(Date.parse(s.recorded_at))||Date.parse(s.recorded_at)>now)continue;const old=latest.get(s.penny_entry_id);if(!old||s.revision>old.revision)latest.set(s.penny_entry_id,s);}
 for(const e of rows)for(const n of [e.stake_cents,e.reference_stake_cents])if(!Number.isSafeInteger(n)||n<0||n>50)throw Error('PENNY_INVALID_LEDGER');
 const arm=(reference:boolean)=>{
  let bank:number=PENNY_PAPER_POLICY.initialCents,peak=bank,maxDrawdown=0,staked=0,pnl=0,open=0,entered=0;
  const daily=new Map<string,number>();
  for(const e of rows){
   const stake=reference?e.reference_stake_cents:e.stake_cents,s=latest.get(e.id),profit=reference?s?.reference_profit_cents:s?.profit_cents;
   if(profit!==null&&profit!==undefined&&(!Number.isSafeInteger(profit)||profit < -stake))throw Error('PENNY_INVALID_LEDGER');
   if(stake){entered++;staked+=stake;const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.recorded_at));daily.set(day,(daily.get(day)??0)+stake);}
   if(profit===null||profit===undefined)open+=stake;
  }
  // Realized equity follows every settlement receipt and correction, not a rewritten latest-only history.
  const byId=new Map(rows.map(e=>[e.id,e])),booked=new Map<number,{revision:number;profit:number}>();
  const known=settlements.filter(s=>byId.has(s.penny_entry_id)&&Number.isFinite(Date.parse(s.recorded_at))&&Date.parse(s.recorded_at)<=now)
   .sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||a.penny_entry_id-b.penny_entry_id||a.revision-b.revision);
  for(const s of known){
   const old=booked.get(s.penny_entry_id);
   if(old&&s.revision<=old.revision)throw Error('PENNY_INVALID_LEDGER');
   const e=byId.get(s.penny_entry_id)!,stake=reference?e.reference_stake_cents:e.stake_cents;
   const p=reference?s.reference_profit_cents:s.profit_cents;
   if(p!==null&&(!Number.isSafeInteger(p)||p < -stake))throw Error('PENNY_INVALID_LEDGER');
   const profit=p??0,delta=profit-(old?.profit??0);
   booked.set(s.penny_entry_id,{revision:s.revision,profit});
   pnl+=delta;bank+=delta;peak=Math.max(peak,bank);maxDrawdown=Math.max(maxDrawdown,1-bank/peak);
  }
  return {entered,totalStakedCents:staked,realizedProfitCents:pnl,realizedEquityCents:bank,openStakeCents:open,availableCents:bank-open,
   settledStakeCents:rows.reduce((a,e)=>a+(latest.has(e.id)&&(reference?latest.get(e.id)!.reference_profit_cents:latest.get(e.id)!.profit_cents)!==null?(reference?e.reference_stake_cents:e.stake_cents):0),0),
   maxDrawdown,maxDailyExposureCents:Math.max(0,...daily.values())};
 };
 const eligible=rows.filter(e=>e.probability_ppm!==null),settled=rows.filter(e=>latest.has(e.id));
 return {entries:rows.length,eligible:eligible.length,settled:settled.length,pending:rows.length-settled.length,
  gradedUnknown:settled.filter(e=>latest.get(e.id)!.profit_cents===null).length,
  dates:new Set(eligible.map(e=>e.recorded_at.slice(0,10))).size,variable:arm(false),reference:arm(true),
  recent:rows.slice(-12).reverse().map(e=>({...e,settlement:latest.get(e.id)??null})),
  verdict:'COLLECTING' as const,note:'Forward virtual experiment using uncalibrated model estimates. No promotion or claim of better returns.'};
}
