/**
 * Kalshi NYC daily-high (KXHIGHNY) contract math: PURE, NO NETWORK, NO KALSHI DATA.
 * Encodes the public contract terms and fee schedule as verified on 2026-11-20.
 * Nothing here reads quotes, places orders or claims an edge; it only answers
 * "which whole-degree highs settle YES" and "what would a fill cost".
 */
const U=1_000_000;
const TICK_MICROS=10_000;

/**
 * Verified 2026-11-20 from public documents only (no Kalshi API requests):
 * - GLOBALTEMPERATURE contract terms: operators, $0.01 tick, $1 settlement, first
 *   official non-preliminary report, 10:00 AM ET expiration, TWC then NWS source order.
 *   https://assets.kalshi.com/contract_terms/GLOBALTEMPERATURE.pdf
 * - Help center: daily high/low markets settle on the final NWS Daily Climate Report,
 *   local standard time year round (1 AM-1 AM during DST).
 *   https://help.kalshi.com/en/articles/13823837-weather-markets
 * - Fee schedule effective July 7, 2026: KXHIGHNY is not in the non-standard list, so the
 *   general taker multiplier is 1 and the maker multiplier defaults to 0.
 *   https://kalshi.com/docs/kalshi-fee-schedule.pdf
 */
export const KXHIGHNY_CONTRACT_SPEC=Object.freeze({
 series:'KXHIGHNY',
 station:'KNYC_CENTRAL_PARK',
 climateReport:'NWS_CLINYC',
 sourceAgencyOrder:Object.freeze(['THE_WEATHER_COMPANY','NATIONAL_WEATHER_SERVICE']),
 reportRule:'FIRST_OFFICIAL_NON_PRELIMINARY_REPORT',
 dayDefinition:'LOCAL_STANDARD_TIME_UTC_MINUS_5',
 unit:'WHOLE_DEGREE_FAHRENHEIT',
 minimumTickMicros:TICK_MICROS,
 settlementValueMicros:U,
 expirationTimeEt:'10:00',
 takerFeeMultiplier:1,
 makerFeeMultiplier:0,
 feeScheduleEffective:'2026-07-07',
 verifiedOn:'2026-11-20',
} as const);

/** Operators exactly as defined by GLOBALTEMPERATURE: between inclusive, above >, below <, at least >=. */
export type TemperatureStrike=
 |{kind:'between';lowerF:number;upperF:number}
 |{kind:'above';thresholdF:number}
 |{kind:'below';thresholdF:number}
 |{kind:'at_least';thresholdF:number};
/** Inclusive whole-degree interval; null marks an open tail. */
export type IntegerRange={minF:number|null;maxF:number|null};

const temp=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>= -150&&n<=180;
/** Whole-degree highs that settle YES. Reports are whole °F, so strict bounds become integer bounds. */
export function strikeIntegerRange(s:TemperatureStrike):IntegerRange{
 const x=s as Record<string,unknown>;
 let r:IntegerRange;
 if(x.kind==='between'&&temp(x.lowerF)&&temp(x.upperF))
  r={minF:Math.ceil(x.lowerF as number),maxF:Math.floor(x.upperF as number)};
 else if(x.kind==='above'&&temp(x.thresholdF))r={minF:Math.floor(x.thresholdF as number)+1,maxF:null};
 else if(x.kind==='below'&&temp(x.thresholdF))r={minF:null,maxF:Math.ceil(x.thresholdF as number)-1};
 else if(x.kind==='at_least'&&temp(x.thresholdF))r={minF:Math.ceil(x.thresholdF as number),maxF:null};
 else throw Error('KALSHI_INVALID_STRIKE');
 if(r.minF!==null&&r.maxF!==null&&r.minF>r.maxF)throw Error('KALSHI_INVALID_STRIKE');
 return r;
}
export function inRange(r:IntegerRange,highF:number):boolean{
 return (r.minF===null||highF>=r.minF)&&(r.maxF===null||highF<=r.maxF);
}
export function settlesYes(s:TemperatureStrike,observedHighF:number):boolean{
 if(!Number.isSafeInteger(observedHighF)||!temp(observedHighF))throw Error('KALSHI_INVALID_OBSERVATION');
 return inRange(strikeIntegerRange(s),observedHighF);
}
/**
 * A daily event's strikes must be mutually exclusive and cover every whole degree:
 * one lower tail, contiguous inner ranges, one upper tail. Returns ranges sorted low->high.
 */
export function validateStrikePartition(strikes:readonly TemperatureStrike[]):IntegerRange[]{
 if(!Array.isArray(strikes)||strikes.length<2||strikes.length>40)throw Error('KALSHI_STRIKES_NOT_PARTITION');
 const ranges=strikes.map(strikeIntegerRange)
  .sort((a,b)=>(a.minF??-Infinity)-(b.minF??-Infinity));
 if(ranges[0].minF!==null||ranges.at(-1)!.maxF!==null)throw Error('KALSHI_STRIKES_NOT_PARTITION');
 for(let i=1;i<ranges.length;i++){
  const prev=ranges[i-1].maxF,cur=ranges[i].minF;
  if(prev===null||cur===null||cur!==prev+1)throw Error('KALSHI_STRIKES_NOT_PARTITION');
 }
 return ranges;
}

/**
 * The schedule TEXT says fees round up "such that the fee + positionCost is rounded to a
 * centicent"; the schedule's own worked TABLE is only reproduced by rounding to a whole cent.
 * Until Kalshi confirms which applies, research decisions use the more expensive table rule.
 */
export type FeeRounding='SCHEDULE_TABLE_CENT'|'SCHEDULE_TEXT_CENTICENT';
export type FeeRole='taker'|'maker';
const RATE:{[k in FeeRole]:{num:bigint;den:bigint}}={
 taker:{num:BigInt(7),den:BigInt(100)},maker:{num:BigInt(175),den:BigInt(10_000)}};
const ROUND_UNIT:{[k in FeeRounding]:bigint}={SCHEDULE_TABLE_CENT:BigInt(10_000),SCHEDULE_TEXT_CENTICENT:BigInt(100)};
export type FeeInput={priceMicros:number;contracts:number;role:FeeRole;rounding:FeeRounding;
 /** Defaults to the KXHIGHNY multipliers (taker 1, maker 0). */
 multiplier?:number};
export function tradingFeeMicros(i:FeeInput):number{
 const multiplier=i.multiplier??(i.role==='maker'?KXHIGHNY_CONTRACT_SPEC.makerFeeMultiplier:KXHIGHNY_CONTRACT_SPEC.takerFeeMultiplier);
 if(!Number.isSafeInteger(i.priceMicros)||i.priceMicros<=0||i.priceMicros>=U||
  !Number.isSafeInteger(i.contracts)||i.contracts<1||i.contracts>100_000||
  !(i.role in RATE)||!(i.rounding in ROUND_UNIT)||
  !Number.isSafeInteger(multiplier)||multiplier<0||multiplier>10)throw Error('KALSHI_INVALID_FEE_INPUT');
 if(i.priceMicros%TICK_MICROS!==0)throw Error('KALSHI_PRICE_OFF_TICK');
 if(multiplier===0)return 0;
 const p=BigInt(i.priceMicros),c=BigInt(i.contracts),m=BigInt(multiplier),u=BigInt(U);
 const {num,den}=RATE[i.role],unit=ROUND_UNIT[i.rounding];
 // raw fee (micros) = m*rate*c*p*(1-p) = m*num*c*p*(U-p) / (den*U)
 const rawNum=m*num*c*p*(u-p),rawDen=den*u;
 const position=c*p;
 const totalNum=position*rawDen+rawNum,step=rawDen*unit;
 const roundedTotal=((totalNum+step-BigInt(1))/step)*unit;
 return Number(roundedTotal-position);
}
export type ExpectedValue={feeMicros:number;costMicros:number;expectedPayoutMicros:number;expectedNetMicros:number};
/** Buying C contracts of one side at priceMicros; probabilityWinPpm is the model's chance that side settles $1. */
export function expectedValueMicros(i:FeeInput&{probabilityWinPpm:number}):ExpectedValue{
 if(!Number.isSafeInteger(i.probabilityWinPpm)||i.probabilityWinPpm<0||i.probabilityWinPpm>U)
  throw Error('KALSHI_INVALID_PROBABILITY');
 const feeMicros=tradingFeeMicros(i);
 const costMicros=i.contracts*i.priceMicros+feeMicros;
 const expectedPayoutMicros=i.contracts*i.probabilityWinPpm;
 return {feeMicros,costMicros,expectedPayoutMicros,expectedNetMicros:expectedPayoutMicros-costMicros};
}
/** Smallest win probability (ppm, rounded up) at which the fill is not negative EV after fees. */
export function breakevenProbabilityPpm(i:FeeInput):number{
 const cost=i.contracts*i.priceMicros+tradingFeeMicros(i);
 return Math.ceil(cost/i.contracts);
}
