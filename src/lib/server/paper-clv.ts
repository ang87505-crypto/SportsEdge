import 'server-only';
import {researchDb} from '@/lib/server/research-db';
import {betClv,closingLine,summarizeClv,type BetClv,type BetForClv,type ClvSummary,type Quote} from '@/lib/clv';

/*
 * Read-only closing-line value for the shared NBA paper ledger. Uses only stored rows
 * (research_positions, research_forecasts, games, odds_snapshots); it never calls an odds
 * provider and never writes. The "close" is the last stored two-way quote at the bet's
 * sportsbook before tip-off, so its quality depends on how close to tip-off the collector ran.
 */
type PositionRow={id:number;selection:string;american_odds:number;
 quote:{sportsbook:string;game_id:number}|null;forecast:{game_id:number;starts_at:string}|null};
type GameRow={id:number;starts_at:string;home:{name:string};away:{name:string}};
type QuoteRow={game_id:number;sportsbook:string;selection:string;american_odds:number;observed_at:string};

export type PaperClv={summary:ClvSummary;bets:(BetClv&{selection:string;sportsbook:string;americanOdds:number})[];startedBets:number;quoteLimitReached:boolean};

const QUOTE_LIMIT=10000;

export async function paperClosingLineValue(now=Date.now()):Promise<PaperClv>{
 const accounts=await researchDb<{id:number}[]>('research_accounts?select=id&slug=eq.nba-elo-research-v1');
 if(accounts.length!==1)throw new Error('Research account unavailable');
 const positions=await researchDb<PositionRow[]>(`research_positions?select=id,selection,american_odds,quote:odds_snapshots(sportsbook,game_id),forecast:research_forecasts(game_id,starts_at)&account_id=eq.${accounts[0].id}&order=placed_at&limit=1000`);
 if(positions.length===1000)throw new Error('Ledger needs pagination before closing-line value can be complete');
 const started=positions.filter(p=>p.forecast&&p.quote&&Date.parse(p.forecast.starts_at)<=now);
 const ids=[...new Set(started.map(p=>p.forecast!.game_id))];
 if(!ids.length)return {summary:summarizeClv(0,[]),bets:[],startedBets:0,quoteLimitReached:false};
 const [games,quotes]=await Promise.all([
  researchDb<GameRow[]>(`games?select=id,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)&id=in.(${ids.join(',')})`),
  researchDb<QuoteRow[]>(`odds_snapshots?select=game_id,sportsbook,selection,american_odds,observed_at&game_id=in.(${ids.join(',')})&market=eq.h2h&line=is.null&order=observed_at.desc,id.desc&limit=${QUOTE_LIMIT}`),
 ]);
 const gameById=new Map(games.map(g=>[g.id,g]));
 const bets:PaperClv['bets']=[];
 for(const p of started){
  const g=gameById.get(p.forecast!.game_id);
  if(!g||(p.selection!==g.home.name&&p.selection!==g.away.name))continue;
  const bet:BetForClv={id:p.id,selection:p.selection,opponent:p.selection===g.home.name?g.away.name:g.home.name,
   sportsbook:p.quote!.sportsbook,americanOdds:Number(p.american_odds),startsAt:g.starts_at};
  const q:Quote[]=quotes.filter(x=>x.game_id===g.id).map(x=>({sportsbook:x.sportsbook,selection:x.selection,americanOdds:Number(x.american_odds),observedAt:x.observed_at}));
  const close=closingLine(q,bet);
  if(close)bets.push({...betClv(bet,close),selection:bet.selection,sportsbook:bet.sportsbook,americanOdds:bet.americanOdds});
 }
 return {summary:summarizeClv(started.length,bets),bets,startedBets:started.length,quoteLimitReached:quotes.length===QUOTE_LIMIT};
}
