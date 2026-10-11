import 'server-only';
import {researchDb,forecasts} from './research-db';
import {decimalOdds,noVig} from '@/lib/research-math';
import {currentMarkets,freshQuote,quoteAgeLimit,type MarketQuote} from '@/lib/ingestion/current-market';
import {verifiedFinal} from '@/lib/result-validation';
export async function publishResearch(){
 const fixtures=await researchDb<{game_id:number}[]>('research_fixture_checks?select=game_id&limit=100');
 const ids=[];for(const c of fixtures)ids.push(await researchDb<number>('rpc/research_publish',{p_game:c.game_id,p_version:'nba-elo-k20-h65-2026-04-v1'}));
 return {forecastIds:ids};
}
export async function placeResearch(limit=100){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid run limit');
 const maxAge=quoteAgeLimit(process.env.SPORTSEDGE_QUOTE_MAX_AGE_SECONDS);
 let checked=0;const failedGames:number[]=[];
 const accounts=await researchDb<{id:number}[]>('research_accounts?select=id&slug=eq.nba-elo-research-v1');
 if(accounts.length!==1)throw new Error('Research account unavailable');
 // An already recorded position must never be represented as a newly placed bet.
 // Under concurrent invocation an RPC can return an ID created by the other run;
 // without an atomic per-run receipt we deliberately do not claim exclusive creation.
 const existing=await researchDb<{id:number;forecast_id:number}[]>(`research_positions?select=id,forecast_id&account_id=eq.${accounts[0].id}&limit=1000`);
 if(existing.length===1000)throw new Error('Research position audit needs pagination');
 const existingByForecast=new Map(existing.map(p=>[p.forecast_id,p.id]));
 const all=await forecasts(),positionIds:number[]=[],alreadyRecordedPositionIds:number[]=[],skippedGames:number[]=[];
 const skippedReasons:{gameId:number;reason:'game_not_upcoming'|'no_fresh_quotes'|'no_qualifying_price'|'invalid_prediction'|'quote_scan_limit'}[]=[];
 type Q=MarketQuote;
 for(const f of all){
  if(checked>=limit)break;
  if(!Number.isFinite(Date.parse(f.starts_at))||Date.parse(f.starts_at)<=Date.now()){
   skippedGames.push(f.game_id);skippedReasons.push({gameId:f.game_id,reason:'game_not_upcoming'});continue;
  }
  if(!Number.isFinite(Number(f.home_probability))||Number(f.home_probability)<=0||Number(f.home_probability)>=1){
   skippedGames.push(f.game_id);skippedReasons.push({gameId:f.game_id,reason:'invalid_prediction'});continue;
  }
  const recorded=existingByForecast.get(f.id);
  if(recorded!==undefined){alreadyRecordedPositionIds.push(recorded);continue;}
  checked++;
  const cutoff=encodeURIComponent(new Date(Date.now()-maxAge).toISOString());
  const quotes=await researchDb<Q[]>(`odds_snapshots?select=id,sportsbook,provider,selection,observed_at,ingested_at,american_odds&game_id=eq.${f.game_id}&market=eq.h2h&line=is.null&observed_at=gte.${cutoff}&order=observed_at.desc,id.desc&limit=200`);
  if(!quotes.length){
   skippedGames.push(f.game_id);skippedReasons.push({gameId:f.game_id,reason:'no_fresh_quotes'});continue;
  }
  if(quotes.length===200){skippedGames.push(f.game_id);skippedReasons.push({gameId:f.game_id,reason:'quote_scan_limit'});continue;}
  const candidates:{id:number;ev:number}[]=[];
  for(const qs of currentMarkets(quotes,[f.games.home.name,f.games.away.name])){
   if(!qs.every(q=>freshQuote(q,Date.now(),maxAge)))continue;
   const [h,a]=qs;
   const probs=noVig([h.american_odds,a.american_odds]);
   for(const [index,q] of [h,a].entries()){
    const p=index===0?Number(f.home_probability):1-Number(f.home_probability),ev=p*decimalOdds(q.american_odds)-1;
    if(ev>=0.02&&p>probs[index])candidates.push({id:q.id,ev});
   }
  }
  candidates.sort((a,b)=>b.ev-a.ev||a.id-b.id);
  if(!candidates.length){
   skippedGames.push(f.game_id);skippedReasons.push({gameId:f.game_id,reason:'no_qualifying_price'});continue;
  }
  // The database RPC is the authoritative, locked gate for freshness,
  // value threshold, idempotency and actual integer-cent position sizing.
  try{positionIds.push(await researchDb<number>('rpc/research_place_current',{p_account:accounts[0].id,p_forecast:f.id,p_quote:candidates[0].id,p_max_age_seconds:maxAge/1000}));}
  catch{failedGames.push(f.game_id);break;} // A write may have committed: stop, never retry automatically.
 }
 return {
  positionIds,
  failedGames,
  alreadyRecordedPositionIds,
  skippedGames,
  skippedReasons,
  candidateRpcsReturned:positionIds.length,
  note:'Returned position IDs can include concurrent pre-existing positions. Only an atomic per-run receipt can verify newly created bets.',
  rule:`Virtual only: 1% available bankroll, model EV >=2%, latest complete market, quote age <= ${maxAge/1000}s`
 };
}
export async function settleResearch(){
 const all=await forecasts(),recorded:number[]=[],unavailable:number[]=[];
 const cache=new Map<string,unknown>();
 for(const f of all){
  if(Date.parse(f.starts_at)>=Date.now())continue;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(f.starts_at));
  const day=['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('');
  const url=`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day}&limit=100`;
  if(!cache.has(day)){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Result provider unavailable');cache.set(day,await r.json());}
  const result=verifiedFinal(cache.get(day),{startsAt:f.starts_at,home:f.games.home.name,away:f.games.away.name});
  if(!result){unavailable.push(f.game_id);continue;}
  await researchDb('rpc/research_record_result',{p_game:f.game_id,p_status:'final',p_home:result.homeScore,p_away:result.awayScore,p_source:url});recorded.push(f.game_id);
 }
 const settled=await researchDb<number>('rpc/research_settle',{});
 return {recordedGames:recorded,unavailableGames:unavailable,settledPositions:settled};
}


