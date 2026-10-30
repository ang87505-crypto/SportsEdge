/** Operational PAPER limits, checked on fresh broker equity by every observer.
 * Equal-to-limit observations remain allowed, matching the existing experiment.
 * A breach stops submissions; it does not liquidate an existing position.
 */
export type PaperRiskInput={equityCents:number;highWaterCents:number;
 capitalLimitCents:number;drawdownStopBps:number};
export type PaperRiskCode='CAPITAL_LIMIT_REACHED'|'DRAWDOWN_LIMIT';

export function paperRiskBreach(x:PaperRiskInput):PaperRiskCode|null{
 if(!x||![x.equityCents,x.highWaterCents,x.capitalLimitCents,x.drawdownStopBps]
  .every(Number.isSafeInteger)||x.equityCents<0||x.highWaterCents<=0||x.capitalLimitCents<=0||
  x.drawdownStopBps<100||x.drawdownStopBps>9000)throw Error('INVALID_RISK_INPUT');
 if(x.equityCents>x.capitalLimitCents)return 'CAPITAL_LIMIT_REACHED';
 // Products can exceed Number's exact integer range even when each input is safe.
 if(BigInt(x.equityCents)*BigInt(10000)<BigInt(x.highWaterCents)*BigInt(10000-x.drawdownStopBps))
  return 'DRAWDOWN_LIMIT';
 return null;
}
