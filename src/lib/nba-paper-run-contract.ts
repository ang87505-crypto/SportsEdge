/**
 * Side-effect-free NBA shared-ledger paper-bet candidate selector.
 * This NEVER authorizes a wager, refreshes paid quotes, or writes a position.
 * Account and quote provenance must be confirmed by the server/database.
 */
import {decimalOdds,noVig} from './research-math.ts';

export const NBA_MODEL_VERSION='nba-elo-k20-h65-2026-04-v1';
export type NbaForecast={
 id:number;game_id:number;model_version:string;home_probability:number;
 published_at:string;starts_at:string;
 games:{id:number;starts_at:string;status:string;home:{name:string};
 away:{name:string};leagues:{sport_code:string}};
};
export type NbaQuote={
 id:number;game_id:number;sportsbook:string;provider:string;
 selection:string;american_odds:number;observed_at:string;ingested_at:string;
};
export type NbaCandidate={
 gameId:number;forecastId:number;quoteId:number;selection:string;
 opponent:string;sportsbook:string;americanOdds:number;
 expectedValue:number;modelProbability:number;noVigProbability:number;
 startsAt:string;observedAt:string;ingestedAt:string;
};
function stamp(s:unknown):number {
 if(typeof s!=='string'||s.length>55)return NaN;
 const n=Date.parse(s);
 return Number.isFinite(n)?n:NaN;
}
function validId(n:unknown):n is number {
 return Number.isSafeInteger(n)&&n>0;
}
export function selectOneNbaPaperCandidate(input:{
 forecasts:NbaForecast[];quotes:NbaQuote[];recordedForecastIds:number[];
 now:string;
}):{candidate:NbaCandidate|null;eligibleMarkets:number;skippedForecasts:number}{
 const clock=stamp(input.now);
 if(!Number.isFinite(clock)||!Array.isArray(input.forecasts)||
  !Array.isArray(input.quotes)||!Array.isArray(input.recordedForecastIds)||
  input.forecasts.length>100||input.quotes.length>999||
  input.recordedForecastIds.some(id=>!validId(id)))
  throw Error('NBA_PAPER_UNVERIFIED_INPUT');
 const used=new Set(input.recordedForecastIds);
 const entries:NbaCandidate[]=[];
 let markets=0,skipped=0;
 for(const f of input.forecasts){
  const g=f.games;
  const start=stamp(f.starts_at),published=stamp(f.published_at);
  if(!validId(f.id)||!validId(f.game_id)||!g||g.id!==f.game_id||
   f.model_version!==NBA_MODEL_VERSION||g.leagues?.sport_code!=='nba'||
   g.status!=='scheduled'||g.starts_at!==f.starts_at||
   !Number.isFinite(start)||!Number.isFinite(published)||
   start<=clock||published>clock||published>=start||
   typeof f.home_probability!=='number'||
   !Number.isFinite(f.home_probability)||f.home_probability<=0||f.home_probability>=1||
   typeof g.home?.name!=='string'||!g.home.name||
   typeof g.away?.name!=='string'||!g.away.name||g.home.name===g.away.name||
   used.has(f.id)){skipped++;continue;}
  const groups=new Map<string,NbaQuote[]>();
  for(const q of input.quotes){
   const seen=stamp(q.observed_at),received=stamp(q.ingested_at);
   if(q.game_id!==f.game_id||!validId(q.id)||
      typeof q.sportsbook!=='string'||!q.sportsbook||q.sportsbook.length>100||
      typeof q.provider!=='string'||!q.provider||q.provider.length>100||
      !Number.isFinite(seen)||!Number.isFinite(received)||
      seen>received||seen>clock||received>clock||clock-seen>3600_000||
      clock-received>3600_000||seen>=start||received>=start||
      !Number.isSafeInteger(q.american_odds)||Math.abs(q.american_odds)<100||
      ![g.home.name,g.away.name].includes(q.selection))continue;
   const key=[q.sportsbook,q.provider,q.observed_at].join('\u0000');
   groups.set(key,[...(groups.get(key)??[]),q]);
  }
  for(const book of groups.values()){
   if(book.length!==2||new Set(book.map(q=>q.selection)).size!==2)continue;
   const home=book.find(q=>q.selection===g.home.name);
   const away=book.find(q=>q.selection===g.away.name);
   if(!home||!away)continue;
   let fair:number[];
   try{fair=noVig([home.american_odds,away.american_odds]);}
   catch{continue;}
   markets++;
   for(const [i,q] of [home,away].entries()){
    const prob=i===0?f.home_probability:1-f.home_probability;
    const ev=prob*decimalOdds(q.american_odds)-1;
    if(ev>=0.02&&prob>fair[i]){
     entries.push({gameId:f.game_id,forecastId:f.id,quoteId:q.id,
      selection:q.selection,opponent:i===0?g.away.name:g.home.name,
      sportsbook:q.sportsbook,americanOdds:q.american_odds,
      expectedValue:ev,modelProbability:prob,noVigProbability:fair[i],
      startsAt:f.starts_at,observedAt:q.observed_at,ingestedAt:q.ingested_at});
    }
   }
  }
 }
 entries.sort((a,b)=>b.expectedValue-a.expectedValue||
  Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.quoteId-b.quoteId);
 return {candidate:entries[0]??null,eligibleMarkets:markets,skippedForecasts:skipped};
}
