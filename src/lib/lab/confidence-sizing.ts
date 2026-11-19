/** A separately versioned cent-sizing proposal. No account, ledger mutation or execution path. */
export const PENNY_POLICY={version:'penny-excess-probability-v1',probabilityScale:1_000_000,
 centsPerPercentagePoint:1,maxStakeCents:50,dailyRiskCents:1500,mode:'PREVIEW_ONLY'} as const;
export type PennySizing={policy:typeof PENNY_POLICY.version;stakeCents:number;uncappedCents:number;
 breakEvenProbability:number|null;reason:'BELOW_BREAK_EVEN'|'SIZED'|'NO_ROOM'|'PAYOUT_UNKNOWN';mode:'PREVIEW_ONLY'};

/** Integer ppm probabilities and gross payout in thousandths. One cent per COMPLETE percentage point above break-even. */
export function pennySizing(probabilityPpm:number,payoutMultiplierMilli:number|null=2000,
 availableCents=1500,stakedTodayCents=0):PennySizing{
 for(const n of [probabilityPpm,availableCents,stakedTodayCents])if(!Number.isSafeInteger(n)||n<0)throw Error('PENNY_INVALID_INPUT');
 if(probabilityPpm>PENNY_POLICY.probabilityScale)throw Error('PENNY_INVALID_PROBABILITY');
 const base={policy:PENNY_POLICY.version,mode:PENNY_POLICY.mode};
 if(payoutMultiplierMilli===null)return {...base,stakeCents:0,uncappedCents:0,breakEvenProbability:null,reason:'PAYOUT_UNKNOWN'};
 if(!Number.isSafeInteger(payoutMultiplierMilli)||payoutMultiplierMilli<=1000||payoutMultiplierMilli>100_000)throw Error('PENNY_INVALID_PAYOUT');
 // All products stay below 10^11, well within the exact safe-integer range.
 const edge=probabilityPpm*payoutMultiplierMilli-1_000_000_000;
 const uncapped=edge<=0?0:Math.floor(edge/(payoutMultiplierMilli*10_000));
 const room=Math.max(0,Math.min(availableCents,PENNY_POLICY.dailyRiskCents-stakedTodayCents));
 const stakeCents=Math.min(uncapped,PENNY_POLICY.maxStakeCents,room);
 return {...base,stakeCents,uncappedCents:uncapped,breakEvenProbability:1000/payoutMultiplierMilli,
  reason:uncapped===0?'BELOW_BREAK_EVEN':stakeCents===0?'NO_ROOM':'SIZED'};
}

export const PENNY_EXAMPLES=[50,55,60,65,70,75,80,90,100].map(percent=>({percent,...pennySizing(percent*10_000)}));
