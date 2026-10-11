import 'server-only';
import {currentMarkets,freshQuote,quoteAgeLimit} from '@/lib/ingestion/current-market';
import {performance,noVig,type SettledPosition} from '@/lib/research-math';
export async function researchDb<T>(path: string, body?: object): Promise<T> {
  const address=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!address||!key)throw new Error('Research database is not configured');
  const url=new URL(address);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid database address');
  const response=await fetch(`${url.origin}/rest/v1/${path}`,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`} : {}),'Content-Type':'application/json',Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`Research database request failed (${response.status})`);
  const raw=await response.text();return (raw?JSON.parse(raw):null) as T;
}
export type StoredGame={id:number;starts_at:string;status:string;home:{name:string};away:{name:string};leagues:{sport_code:string}};
export async function storedSports(sport: string) {
  const maxAge=quoteAgeLimit(process.env.SPORTSEDGE_QUOTE_MAX_AGE_SECONDS);
  const games=await researchDb<StoredGame[]>(`games?select=id,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),leagues!inner(sport_code)&leagues.sport_code=eq.${encodeURIComponent(sport)}&status=eq.scheduled&starts_at=gt.${encodeURIComponent(new Date().toISOString())}&order=starts_at&limit=100`);
  const ids=games.map(g=>g.id);
  type Quote={id:number;game_id:number;sportsbook:string;provider:string;selection:string;american_odds:number;observed_at:string;ingested_at:string};
  const quotes=ids.length?await researchDb<Quote[]>(`odds_snapshots?select=id,game_id,sportsbook,provider,selection,american_odds,observed_at,ingested_at&game_id=in.(${ids.join(',')})&market=eq.h2h&line=is.null&order=observed_at.desc,id.desc&limit=1000`):[];
  const seen=new Set<string>();
  const latest=quotes.filter(q=>{const k=JSON.stringify([q.game_id,q.sportsbook,q.provider,q.selection]);if(seen.has(k))return false;seen.add(k);return true;});
  return {status:'stored',source:'The Odds API / stored snapshots',fetchedAt:new Date().toISOString(),quoteLimitReached:quotes.length===1000,games:games.map(g=>({id:String(g.id),home:g.home.name,away:g.away.name,startsAt:g.starts_at,bookmakers:latest.filter(q=>q.game_id===g.id).map(q=>{

    const expected=sport==='nba'?[g.home.name,g.away.name]:sport==='soccer'?[g.home.name,g.away.name,'Draw']:[];
    const pair=currentMarkets(quotes.filter(x=>x.game_id===g.id),expected).find(m=>m.some(x=>x.id===q.id));
    const complete=quotes.length<1000&&pair!==undefined;
    const age=Date.now()-Date.parse(q.observed_at);
    const freshness=freshQuote(q,Date.now(),maxAge)?(age<=maxAge/2?'fresh':'aging'):'stale';
    return {sportsbook:q.sportsbook,provider:q.provider,ingestedAt:q.ingested_at,freshness,completeMarket:complete,selection:q.selection,americanOdds:q.american_odds,updatedAt:q.observed_at,noVigProbability:complete&&pair?noVig(pair.map(x=>x.american_odds))[pair.indexOf(q)]:null};
  })}))};
}
export type ForecastRow={id:number;game_id:number;home_probability:number;published_at:string;starts_at:string;model_version:string;games:StoredGame};
export async function forecasts(){return researchDb<ForecastRow[]>('research_forecasts?select=*,games(id,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),leagues(sport_code))&order=published_at.desc&limit=100');}
export async function paperPerformance(){
 const accounts=await researchDb<{id:number;initial_cents:number}[]>('research_accounts?select=id,initial_cents&slug=eq.nba-elo-research-v1');
 if(accounts.length!==1)throw new Error('Research account unavailable');
 type P={id:number;stake_cents:number;selection:string;american_odds:number;placed_at:string};
 const positions=await researchDb<P[]>(`research_positions?select=id,stake_cents,selection,american_odds,placed_at&account_id=eq.${accounts[0].id}&order=placed_at&limit=1000`);
 if(positions.length===1000)throw new Error('Ledger needs pagination before complete performance can be shown');
 type S={position_id:number;profit_cents:number;outcome:string;settled_at:string};
 const settlements=positions.length?await researchDb<S[]>(`research_settlements?select=*&position_id=in.(${positions.map(p=>p.id).join(',')})&order=settled_at,position_id&limit=1000`):[];
 const settled:SettledPosition[]=[],pending:P[]=[];
 for(const p of positions){const s=settlements.find(s=>s.position_id===p.id);if(s)settled.push({stake_cents:Number(p.stake_cents),profit_cents:Number(s.profit_cents),outcome:s.outcome,settled_at:s.settled_at});else pending.push(p);}
 return {...performance(Number(accounts[0].initial_cents),settled,pending.reduce((a,p)=>a+Number(p.stake_cents),0)),initial_cents:Number(accounts[0].initial_cents),pending_bets:pending.length,positions:positions.map(p=>({...p,settlement:settlements.find(s=>s.position_id===p.id)??null})),scope:'Shared virtual research account; no real money or personal account'};
}

