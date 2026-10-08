import 'server-only';
import {researchDb,forecasts} from './research-db';
import {decimalOdds,noVig} from '@/lib/research-math';
import {verifiedFinal} from '@/lib/result-validation';
export async function publishResearch(){
 const fixtures=await researchDb<{game_id:number}[]>('research_fixture_checks?select=game_id&limit=100');
 const ids=[];for(const c of fixtures)ids.push(await researchDb<number>('rpc/research_publish',{p_game:c.game_id,p_version:'nba-elo-k20-h65-2026-04-v1'}));
 return {forecastIds:ids};
}
export async function placeResearch(){
 const accounts=await researchDb<{id:number}[]>('research_accounts?select=id&slug=eq.nba-elo-research-v1');
 if(accounts.length!==1)throw new Error('Research account unavailable');
 const all=await forecasts(),placed:number[]=[],skipped:number[]=[];
 type Q={id:number;sportsbook:string;provider:string;selection:string;observed_at:string;ingested_at:string;american_odds:number};
 for(const f of all){
  if(Date.parse(f.starts_at)<=Date.now())continue;
  const quotes=await researchDb<Q[]>(`odds_snapshots?select=id,sportsbook,provider,selection,observed_at,ingested_at,american_odds&game_id=eq.${f.game_id}&market=eq.h2h&line=is.null&observed_at=gte.${encodeURIComponent(new Date(Date.now()-3600000).toISOString())}&order=observed_at.desc,id.desc&limit=200`);
  const groups=new Map<string,Q[]>();for(const q of quotes){const k=`${q.sportsbook}|${q.provider}|${q.observed_at}`;groups.set(k,[...(groups.get(k)??[]),q]);}
  const candidates:{id:number;ev:number}[]=[];
  for(const qs of groups.values()){
   const h=qs.find(q=>q.selection===f.games.home.name),a=qs.find(q=>q.selection===f.games.away.name);
   if(!h||!a||qs.length!==2)continue;
   const probs=noVig([h.american_odds,a.american_odds]);
   for(const [index,q] of [h,a].entries()){
    const p=index===0?Number(f.home_probability):1-Number(f.home_probability),ev=p*decimalOdds(q.american_odds)-1;
    if(ev>=0.02&&p>probs[index])candidates.push({id:q.id,ev});
   }
  }
  candidates.sort((a,b)=>b.ev-a.ev||a.id-b.id);
  if(!candidates.length){skipped.push(f.game_id);continue;}
  placed.push(await researchDb<number>('rpc/research_place',{p_account:accounts[0].id,p_forecast:f.id,p_quote:candidates[0].id}));
 }
 return {positionIds:placed,skippedGames:skipped,rule:'Virtual only: 1% available bankroll, model EV >=2%, complete fresh market'};
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
