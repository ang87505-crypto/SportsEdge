/** Read-only NBA research screening. NEVER authorizes or places a paper bet.
 * Works exclusively with already-stored, source-timestamped model/market data.
 */
export const NBA_MODEL_VERSION = 'nba-elo-k20-h65-2026-04-v1';
export const NBA_MAX_QUOTE_AGE_MS = 60_000;
export type StoredQuote = {
  sportsbook:string;provider:string;selection:string;americanOdds:number;
  updatedAt:string;ingestedAt:string;completeMarket:boolean;
  noVigProbability:number|null;freshness:string;
};
export type StoredGame = {id:string;home:string;away:string;startsAt:string;bookmakers:StoredQuote[]};
export type StoredForecast = {
  id:number;game_id:number;starts_at:string;published_at:string;
  home_probability:number;model_version:string;
  games?:{home?:{name?:string};away?:{name?:string}};
};
export type ScreeningStatus = 'screened'|'no_edge'|'stale'|'incomplete'|'no_forecast';
export type ScreeningQuote = {
  selection:string;sportsbook:string;provider:string;americanOdds:number;
  modelProbability:number;marketNoVigProbability:number;estimatedEv:number;
  observedAt:string;fresh:boolean;
};
export type ScreeningGame = {
  gameId:string;home:string;away:string;startsAt:string;
  status:ScreeningStatus;reason:string;
  forecast:StoredForecast|null;best:ScreeningQuote|null;
  completeMarketCount:number;freshMarketCount:number;
};

function validTime(s:unknown):number {
  if(typeof s!=='string'||!s.trim())return NaN;
  return Date.parse(s);
}
function decimalOdds(american:number):number {
  if(!Number.isSafeInteger(american)||Math.abs(american)<100)return NaN;
  return american>0 ? 1+american/100 : 1+100/Math.abs(american);
}
function validQuote(q:StoredQuote,at:number,maxAgeMs:number):boolean {
  const observed=validTime(q.updatedAt),ingested=validTime(q.ingestedAt);
  return Number.isFinite(observed)&&Number.isFinite(ingested)&&
    observed<=ingested&&ingested<=at&&at-observed<=maxAgeMs&&at-ingested<=maxAgeMs;
}
function isForecastValid(f:StoredForecast,g:StoredGame,at:number):boolean {
  const start=validTime(g.startsAt),pub=validTime(f.published_at);
  const p=Number(f.home_probability);
  return f.model_version===NBA_MODEL_VERSION&&
    Number.isFinite(pub)&&pub<=at&&pub<start&&f.starts_at===g.startsAt&&
    p>0&&p<1&&Number.isFinite(p)&&
    f.games?.home?.name===g.home&&f.games?.away?.name===g.away;
}
/** Hard fail on incomplete, inconsistent or superseded displayed market pairs. */
export function analyzeNbaGames(
  games:StoredGame[],forecasts:StoredForecast[],at:number,maxAgeMs=NBA_MAX_QUOTE_AGE_MS
):ScreeningGame[]{
  if(!Number.isFinite(at)||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1000||maxAgeMs>NBA_MAX_QUOTE_AGE_MS)
    throw new Error('Invalid screening timestamp or price-age policy');
  const matches:ScreeningGame[]=[];
  for(const g of games){
    if(!g||typeof g.id!=='string'||!Number.isFinite(validTime(g.startsAt))||validTime(g.startsAt)<=at||
       !g.home||!g.away||!Array.isArray(g.bookmakers))continue;
    const valid=forecasts.filter(f=>Number(f.game_id)===Number(g.id)&&isForecastValid(f,g,at));
    valid.sort((a,b)=>validTime(b.published_at)-validTime(a.published_at)||b.id-a.id);
    const forecast=valid[0]??null;
    const row:ScreeningGame={gameId:g.id,home:g.home,away:g.away,startsAt:g.startsAt,status:'no_forecast',
      reason:'No valid pregame NBA model forecast for this matchup.',forecast,best:null,
      completeMarketCount:0,freshMarketCount:0};
    if(!forecast){matches.push(row);continue;}
    const all=new Map<string,StoredQuote[]>();
    for(const q of g.bookmakers){
      if(!q||typeof q.sportsbook!=='string'||!q.sportsbook||typeof q.provider!=='string'||!q.provider)continue;
      const key=JSON.stringify([q.sportsbook,q.provider]);
      all.set(key,[...(all.get(key)??[]),q]);
    }
    const picks:ScreeningQuote[]=[];
    const stalePicks:ScreeningQuote[]=[];
    for(const quotes of all.values()){
      if(quotes.length!==2||!quotes.every(q=>q.completeMarket===true))continue;
      const home=quotes.find(q=>q.selection===g.home),away=quotes.find(q=>q.selection===g.away);
      if(!home||!away||home===away||home.updatedAt!==away.updatedAt)continue;
      const dh=decimalOdds(home.americanOdds),da=decimalOdds(away.americanOdds);
      if(!Number.isFinite(dh)||!Number.isFinite(da))continue;
      const impliedHome=1/dh,impliedAway=1/da,total=impliedHome+impliedAway;
      const market=[impliedHome/total,impliedAway/total];
      if(!quotes.every(q=>Number.isFinite(Number(q.noVigProbability))&&q.noVigProbability!==null))continue;
      if(Math.abs((home.noVigProbability as number)-market[0])>0.0001||
         Math.abs((away.noVigProbability as number)-market[1])>0.0001)continue;
      row.completeMarketCount++;
      const fresh=quotes.every(q=>validQuote(q,at,maxAgeMs));
      if(fresh)row.freshMarketCount++;
      const values=[
        {q:home,p:Number(forecast.home_probability),market:market[0],price:dh},
        {q:away,p:1-Number(forecast.home_probability),market:market[1],price:da}
      ];
      for(const {q,p,market:fair,price} of values){
        const pick:ScreeningQuote={selection:q.selection,sportsbook:q.sportsbook,provider:q.provider,
          americanOdds:q.americanOdds,modelProbability:p,marketNoVigProbability:fair,
          estimatedEv:p*price-1,observedAt:q.updatedAt,fresh};
        (fresh?picks:stalePicks).push(pick);
      }
    }
    const sort=(a:ScreeningQuote,b:ScreeningQuote)=>b.estimatedEv-a.estimatedEv||
      a.sportsbook.localeCompare(b.sportsbook)||a.selection.localeCompare(b.selection);
    picks.sort(sort);stalePicks.sort(sort);
    row.best=picks[0]??stalePicks[0]??null;
    if(picks.length){
      const qualifies=picks.find(q=>q.estimatedEv>=0.02&&q.modelProbability>q.marketNoVigProbability);
      if(qualifies){
        row.best=qualifies;row.status='screened';
        row.reason='Passes preliminary model-value screening at a recently recorded price. The server must recheck the line before any paper bet.';
      }else{
        row.status='no_edge';row.reason='Current recorded prices do not pass both the 2% estimated-value and no-vig edge rules.';
      }
    }else if(stalePicks.length){
      row.status='stale';row.reason='The last complete market is too old. Refresh the source before evaluating a paper bet.';
    }else{
      row.status='incomplete';row.reason='No complete, consistent latest two-way sportsbook market. Older prices are not substitutes.';
    }
    matches.push(row);
  }
  const rank:Record<ScreeningStatus,number>={screened:0,no_edge:1,stale:2,incomplete:3,no_forecast:4};
  return matches.sort((a,b)=>rank[a.status]-rank[b.status]||a.startsAt.localeCompare(b.startsAt)||a.gameId.localeCompare(b.gameId));
}
