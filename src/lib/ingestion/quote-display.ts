/** A conservative, client-side label for source-timestamped stored odds.
 * The server remains the authority for whether a price can be recorded.
 */
export type DisplayQuote={
  updatedAt:string;ingestedAt?:string;
  freshness?:string;completeMarket?:boolean;
  americanOdds:number;
};
export type PriceDisplayStatus='fresh'|'aging'|'stale'|'incomplete';
export function quoteDisplayStatus(q:DisplayQuote,now:number,maxAgeMs=60_000):PriceDisplayStatus{
 if(!q||!Number.isFinite(now)||!Number.isSafeInteger(maxAgeMs)||
    maxAgeMs<1000||maxAgeMs>60_000)return 'incomplete';
 if(q.completeMarket!==true)return 'incomplete';
 if(!Number.isSafeInteger(q.americanOdds)||Math.abs(q.americanOdds)<100)
  return 'incomplete';
 const observed=Date.parse(q.updatedAt);
 const ingested=q.ingestedAt?Date.parse(q.ingestedAt):NaN;
 if(!Number.isFinite(observed)||!Number.isFinite(ingested)||
  observed>ingested||ingested>now||now-observed>maxAgeMs||now-ingested>maxAgeMs)
  return 'stale';
 if(!['fresh','aging'].includes(q.freshness??''))return 'stale';
 const secondsOld=now-observed;
 return secondsOld>maxAgeMs/2||q.freshness==='aging'?'aging':'fresh';
}
export const quoteStatusLabels:Record<PriceDisplayStatus,string>={
 fresh:'Fresh',aging:'Aging',stale:'Stale — recorded only',
 incomplete:'Incomplete market'
};
