/** Stored quotes only. Freshness is not a guarantee of sportsbook availability. */
export type MarketQuote = {id:number; sportsbook:string; provider:string; selection:string; american_odds:number; observed_at:string; ingested_at:string};
export const MAX_QUOTE_AGE_MS = 60_000;
export function quoteAgeLimit(raw?:string):number {
  if(raw===undefined)return MAX_QUOTE_AGE_MS;
  const seconds=Number(raw);
  if(!Number.isInteger(seconds)||seconds<1||seconds>60)throw new Error('Quote age must be 1–60 seconds');
  return seconds*1000;
}
export function freshQuote(q:MarketQuote, now:number, maxAge=MAX_QUOTE_AGE_MS):boolean {
  const observed=Date.parse(q.observed_at),ingested=Date.parse(q.ingested_at);
  return Number.isFinite(now)&&Number.isFinite(observed)&&Number.isFinite(ingested)&&
    observed<=ingested&&ingested<=now&&now-observed<=maxAge&&now-ingested<=maxAge&&
    Number.isSafeInteger(q.american_odds)&&Math.abs(q.american_odds)>=100;
}
/** Never fall back when the latest observation is incomplete or ambiguous. */
export function currentMarkets<T extends MarketQuote>(quotes:T[], selections:string[]):T[][] {
  if(![2,3].includes(selections.length)||new Set(selections).size!==selections.length)return [];
  const books=new Map<string,T[]>();
  for(const q of quotes){const key=JSON.stringify([q.sportsbook,q.provider]);books.set(key,[...(books.get(key)??[]),q]);}
  const markets:T[][]=[];
  for(const rows of books.values()){
    if(rows.some(q=>!q.sportsbook||!q.provider||!Number.isFinite(Date.parse(q.observed_at))))continue;
    const latest=Math.max(...rows.map(q=>Date.parse(q.observed_at)));
    const market=rows.filter(q=>Date.parse(q.observed_at)===latest);
    // Conflicting prices at the same timestamp are ambiguous, even if one arrived later.
    if(market.length!==selections.length||!selections.every(s=>market.filter(q=>q.selection===s).length===1))continue;
    if(market.some(q=>!Number.isSafeInteger(q.american_odds)||Math.abs(q.american_odds)<100))continue;
    markets.push(selections.map(s=>market.find(q=>q.selection===s)!));
  }
  return markets;
}
