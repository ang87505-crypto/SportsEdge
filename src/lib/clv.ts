/** Closing-line value (CLV) for recorded virtual bets. Pure functions; no I/O.
 *
 * The "close" is the last complete two-way market from the same sportsbook observed before tip-off.
 * If the market is efficient, its margin-free probability is the best available estimate of a bet's
 * true chance, so `closingEv = closeProbability × decimal(bet price) − 1` estimates each bet's real
 * expected return. Consistently positive CLV is evidence of an edge long before profit is.
 */
import {decimalOdds,noVig} from './research-math.ts';

export type Quote={sportsbook:string;selection:string;americanOdds:number;observedAt:string};
export type ClosingLine={americanOdds:number;opponentOdds:number;observedAt:string;minutesBeforeStart:number;probability:number};
export type BetForClv={id:number;selection:string;opponent:string;sportsbook:string;americanOdds:number;startsAt:string};
export type BetClv={id:number;priceClv:number;closingEv:number;beatClose:boolean;close:ClosingLine};

const time=(s:string)=>{const t=Date.parse(s);if(!Number.isFinite(t))throw Error('Invalid timestamp');return t;};

/** Latest pregame snapshot at `sportsbook` with prices for both sides at the same observation time. */
export function closingLine(quotes:Quote[],bet:BetForClv):ClosingLine|null{
 const start=time(bet.startsAt);
 const pre=quotes.filter(q=>q.sportsbook===bet.sportsbook&&time(q.observedAt)<start);
 const times=[...new Set(pre.map(q=>q.observedAt))].sort((a,b)=>time(b)-time(a));
 for(const at of times){
  const mine=pre.find(q=>q.observedAt===at&&q.selection===bet.selection);
  const other=pre.find(q=>q.observedAt===at&&q.selection===bet.opponent);
  if(!mine||!other)continue;
  const [p]=noVig([mine.americanOdds,other.americanOdds]);
  return {americanOdds:mine.americanOdds,opponentOdds:other.americanOdds,observedAt:at,minutesBeforeStart:Math.round((start-time(at))/60000),probability:p};
 }
 return null;
}

export function betClv(bet:BetForClv,close:ClosingLine):BetClv{
 const placed=decimalOdds(bet.americanOdds),closing=decimalOdds(close.americanOdds);
 const closingEv=close.probability*placed-1;
 return {id:bet.id,priceClv:placed/closing-1,closingEv,beatClose:placed>closing,close};
}

export type ClvSummary={bets:number;withClose:number;beatCloseRate:number|null;meanClosingEv:number|null;
 interval:[number,number]|null;medianMinutesBeforeStart:number|null};

/** Mean closing EV with a deterministic bootstrap 95% interval. Fewer than 2 bets gives no interval. */
export function summarizeClv(total:number,items:BetClv[],samples=2000,seed=20261020):ClvSummary{
 if(!items.length)return {bets:total,withClose:0,beatCloseRate:null,meanClosingEv:null,interval:null,medianMinutesBeforeStart:null};
 const ev=items.map(i=>i.closingEv);
 const mean=ev.reduce((a,b)=>a+b,0)/ev.length;
 let interval:[number,number]|null=null;
 if(ev.length>1){
  let s=seed>>>0;
  const rand=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  const means:number[]=[];
  for(let k=0;k<samples;k++){let sum=0;for(let j=0;j<ev.length;j++)sum+=ev[Math.floor(rand()*ev.length)];means.push(sum/ev.length);}
  means.sort((a,b)=>a-b);
  interval=[means[Math.floor(0.025*samples)],means[Math.ceil(0.975*samples)-1]];
 }
 const mins=items.map(i=>i.close.minutesBeforeStart).sort((a,b)=>a-b);
 return {bets:total,withClose:items.length,beatCloseRate:items.filter(i=>i.beatClose).length/items.length,meanClosingEv:mean,interval,
  medianMinutesBeforeStart:mins[Math.floor(mins.length/2)]};
}
