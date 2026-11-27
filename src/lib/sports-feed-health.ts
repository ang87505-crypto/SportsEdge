import type {FeedGame} from './dashboard-snapshot.ts';

/** Display age only. This is never an execution, market-completeness or release gate. */
export const QUOTE_DISPLAY_MAX_AGE_MS=24*3600_000;
const CLOCK_ROUNDING_MS=60_000;
export type QuoteAge='recent'|'stale'|'unverified';
export type FeedHealthState='empty'|'no-prices'|'recent'|'mixed'|'stale'|'unverified'|'partial';

export function quoteAge(stamp:string,now:number):QuoteAge{
 const at=Date.parse(stamp);
 if(!Number.isFinite(at)||!Number.isFinite(now)||now<=0||at>now+CLOCK_ROUNDING_MS)return 'unverified';
 return now-at>QUOTE_DISPLAY_MAX_AGE_MS?'stale':'recent';
}

/** Count every displayed quote; a newer game or book cannot conceal older prices. */
export function sportsFeedHealth(games:FeedGame[],now:number){
 let recent=0,stale=0,unverified=0,withoutPrices=0;
 let newest:string|null=null,oldest:string|null=null;
 for(const game of games){
  if(!game.bookmakers.length)withoutPrices++;
  for(const quote of game.bookmakers){
   const state=quoteAge(quote.updatedAt,now);
   if(state==='recent')recent++;else if(state==='stale')stale++;else unverified++;
   if(Number.isFinite(Date.parse(quote.updatedAt))){
    if(!newest||Date.parse(quote.updatedAt)>Date.parse(newest))newest=quote.updatedAt;
    if(!oldest||Date.parse(quote.updatedAt)<Date.parse(oldest))oldest=quote.updatedAt;
   }
  }
 }
 const quotes=recent+stale+unverified;
 const state:FeedHealthState=!games.length?'empty':!quotes?'no-prices':unverified?'unverified':recent&&stale?'mixed':stale?'stale':withoutPrices?'partial':'recent';
 return {state,games:games.length,quotedGames:games.length-withoutPrices,withoutPrices,quotes,recent,stale,unverified,newest,oldest};
}

export const FEED_HEALTH_LABEL:Record<FeedHealthState,string>={
 empty:'No upcoming games saved',
 'no-prices':'No saved prices',
 recent:'Saved quotes within 24 h',
 mixed:'Mixed quote ages',
 stale:'Saved quotes are stale',
 unverified:'Quote times need verification',
 partial:'Some games have no prices',
};
