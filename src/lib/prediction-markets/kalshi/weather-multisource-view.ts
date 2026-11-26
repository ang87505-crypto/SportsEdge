/**
 * Dashboard view of the multi-source weather challenger (knyc-multisource-emos-v1-research), read-only:
 * - historical: the committed, receipt-verified 2024 evaluation (pre-registered method, retrospective only);
 * - forward: the newest shadow PAPER scorecard written by the daily workflow on the public research-data branch.
 * No Kalshi data, prices, orders or stakes. Forecast accuracy is not trading profitability.
 */
import eval2024 from '../../../../research/kalshi_weather_multisource_v1_20261126/eval-2024-knyc.json' with {type:'json'};

const LIST='https://api.github.com/repos/ang87505-crypto/SportsEdge/contents/kalshi-independent/nyc-weather/multisource-v1/scorecards?ref=research-data';
const RAW='https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/kalshi-independent/nyc-weather/multisource-v1/scorecards/';
const NAME=/^\d{4}-\d{2}-\d{2}T\d{4}Z\.json$/;
type Num=number|null;
export type HistoricalRow={anchor:string;holdoutDays:number;holdoutRange:[string,string]|null;disposition:string;
 crps:{combined:Num;nbmCorrected:Num;nbmRaw:Num;nbmNative:Num;gfsCorrected:Num};
 vsNbmCorrected:{mean:Num;lower95:Num;upper95:Num}|null;coverage80:Num};
type EvalAnchor={anchor:string;holdoutDays:number;holdoutRange:[string,string]|null;disposition:string;
 holdout:Record<string,{meanCrps:Num;coverage80:Num}>;holdoutPairs?:Record<string,{mean:Num;lower95:Num;upper95:Num}>};
/** Compact rows from a committed evaluation summary. */
export function historicalRows(report:{anchors:EvalAnchor[]}):HistoricalRow[]{
 return report.anchors.map(a=>({anchor:a.anchor,holdoutDays:a.holdoutDays,holdoutRange:a.holdoutRange,disposition:a.disposition,
  crps:{combined:a.holdout.COMBINED?.meanCrps??null,nbmCorrected:a.holdout.NBM_CORRECTED?.meanCrps??null,nbmRaw:a.holdout.NBM_RAW?.meanCrps??null,
   nbmNative:a.holdout.NBM_NATIVE?.meanCrps??null,gfsCorrected:a.holdout.GFS_MOS_CORRECTED?.meanCrps??null},
  vsNbmCorrected:a.holdoutPairs?.NBM_CORRECTED?{mean:a.holdoutPairs.NBM_CORRECTED.mean,lower95:a.holdoutPairs.NBM_CORRECTED.lower95,
   upper95:a.holdoutPairs.NBM_CORRECTED.upper95}:null,coverage80:a.holdout.COMBINED?.coverage80??null}));
}
export const HISTORICAL_2024={label:'Calendar year 2024 (KNYC)',disposition:(eval2024 as {disposition:string}).disposition,
 rows:historicalRows(eval2024 as unknown as {anchors:EvalAnchor[]})};

export type ForwardAnchor={anchor:string;frozen:number;graded:number;ungraded:number;missed:number;
 combinedCrps:Num;nbmCorrectedCrps:Num;disposition:string;reason:string};
export type ShadowCard={at:string;anchors:ForwardAnchor[];paperForecasting:{status:string;missing:string[]};
 ownerReview:{status:string;missing:string[]};exchange:'DISABLED'};
const num=(x:unknown):Num=>typeof x==='number'&&Number.isFinite(x)?x:null;
const int=(x:unknown)=>Number.isSafeInteger(x)&&(x as number)>=0?x as number:null;
/** Validates the public scorecard shape. Anything unexpected is refused, never partially shown. */
export function verifyShadowCard(raw:unknown):ShadowCard{
 const c=raw as {schema?:string;at?:string;summary?:unknown[];readiness?:{paperForecasting?:{status?:string;missing?:unknown[]};
  ownerReview?:{status?:string;missing?:unknown[]};exchange?:string}};
 if(!c||c.schema!=='kalshi-weather-multisource-paper-scorecard-v1'||typeof c.at!=='string'||!Number.isFinite(Date.parse(c.at))||
  !Array.isArray(c.summary)||c.summary.length!==2||c.readiness?.exchange!=='DISABLED')throw Error('WX_MS_VIEW_INVALID');
 const anchors=c.summary.map(x=>{const s=x as Record<string,unknown>,m=(s.meanCrps??{}) as Record<string,unknown>;
  const a={anchor:String(s.anchor),frozen:int(s.frozen),graded:int(s.graded),ungraded:int(s.ungraded),
   missed:Array.isArray(s.missedSince)?s.missedSince.length:null};
  if(!['SAME_DAY','DAY_AHEAD'].includes(a.anchor)||a.frozen===null||a.graded===null||a.ungraded===null||a.missed===null||
   !['PROMISING','NO_CLEAR_EFFECT','REJECTED'].includes(String(s.disposition)))throw Error('WX_MS_VIEW_INVALID');
  return {...a,frozen:a.frozen,graded:a.graded,ungraded:a.ungraded,missed:a.missed,combinedCrps:num(m.COMBINED),
   nbmCorrectedCrps:num(m.NBM_CORRECTED),disposition:String(s.disposition),reason:String(s.reason??'').slice(0,300)};});
 const stage=(x:{status?:string;missing?:unknown[]}|undefined)=>{
  if(!x||!['READY','NOT_READY'].includes(String(x.status)))throw Error('WX_MS_VIEW_INVALID');
  return {status:String(x.status),missing:(x.missing??[]).map(String).slice(0,8)};};
 return {at:c.at,anchors,paperForecasting:stage(c.readiness.paperForecasting),ownerReview:stage(c.readiness.ownerReview),exchange:'DISABLED'};
}
export async function loadMultisourceShadow(fetcher:typeof fetch=fetch):Promise<
 {state:'RECORDED';card:ShadowCard}|{state:'AWAITING_FIRST_FORECAST'|'ARCHIVE_UNAVAILABLE';card:null}>{
 const opts={method:'GET',redirect:'error' as const,credentials:'omit' as const,headers:{Accept:'application/json'},
  next:{revalidate:600},signal:AbortSignal.timeout(5_000)};
 try{
  const l=await fetcher(LIST,opts);
  if(l.status===404)return {state:'AWAITING_FIRST_FORECAST',card:null};
  if(!l.ok)return {state:'ARCHIVE_UNAVAILABLE',card:null};
  const list=await l.json() as {name?:unknown;type?:unknown}[];
  const names=Array.isArray(list)?list.filter(x=>x.type==='file'&&typeof x.name==='string'&&NAME.test(x.name)).map(x=>x.name as string).sort():[];
  if(!names.length)return {state:'AWAITING_FIRST_FORECAST',card:null};
  const r=await fetcher(RAW+names.at(-1),opts);
  if(!r.ok)return {state:'ARCHIVE_UNAVAILABLE',card:null};
  const body=await r.text();if(body.length>200_000)return {state:'ARCHIVE_UNAVAILABLE',card:null};
  return {state:'RECORDED',card:verifyShadowCard(JSON.parse(body))};
 }catch{return {state:'ARCHIVE_UNAVAILABLE',card:null};}
}
