export type ResearchSnapshot={predictions:unknown[];paper:{pending_bets:number;settled_bets:number;win_rate:number|null}};
/** Guard all numbers displayed on the home dashboard; absent/unreliable data is unavailable, never zero. */
export function isResearchSnapshot(v:unknown):v is ResearchSnapshot{
 if(!v||typeof v!=='object')return false;
 const x=v as Record<string,unknown>;
 if(!Array.isArray(x.predictions)||!x.paper||typeof x.paper!=='object')return false;
 const p=x.paper as Record<string,unknown>;
 return Number.isSafeInteger(p.pending_bets)&&Number(p.pending_bets)>=0
  &&Number.isSafeInteger(p.settled_bets)&&Number(p.settled_bets)>=0
  &&(p.win_rate===null||(typeof p.win_rate==='number'&&Number.isFinite(p.win_rate)&&p.win_rate>=0&&p.win_rate<=1));
}

/*
 * Optional detail fields from the same /api/research response. Each row is validated on its own;
 * malformed rows are dropped and malformed figures become null, so a partial backend change can
 * never surface as a fabricated number.
 */
export type SnapshotForecast={id:number;gameId:number;home:string;away:string;startsAt:string;publishedAt:string;homeProbability:number;sport:string|null};
export type SnapshotPosition={id:number;selection:string;americanOdds:number;stakeCents:number;placedAt:string;
 settlement:{outcome:'won'|'lost'|'void';profitCents:number;settledAt:string}|null};
export type SnapshotDetails={initialCents:number|null;equityCents:number|null;availableCents:number|null;pendingStakeCents:number|null;
 profitCents:number|null;roi:number|null;wins:number|null;losses:number|null;maxDrawdownFraction:number|null;
 forecasts:SnapshotForecast[];positions:SnapshotPosition[]};

const int=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)?v:typeof v==='string'&&/^-?\d+$/.test(v)&&Number.isSafeInteger(Number(v))?Number(v):null;
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const obj=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const name=(v:unknown)=>{const o=obj(v);return o&&typeof o.name==='string'&&o.name.trim()?o.name:null;};

export function snapshotDetails(v:ResearchSnapshot):SnapshotDetails{
 const p=v.paper as Record<string,unknown>;
 const forecasts:SnapshotForecast[]=[];
 for(const raw of v.predictions){
  const r=obj(raw),g=obj(r?.games);
  if(!r||!g)continue;
  const id=int(r.id),gameId=int(r.game_id),prob=finite(r.home_probability),startsAt=stamp(r.starts_at)??stamp(g.starts_at),publishedAt=stamp(r.published_at);
  const home=name(g.home),away=name(g.away);
  if(id===null||gameId===null||prob===null||prob<0||prob>1||!startsAt||!publishedAt||!home||!away)continue;
  const league=obj(g.leagues);
  forecasts.push({id,gameId,home,away,startsAt,publishedAt,homeProbability:prob,sport:league&&typeof league.sport_code==='string'?league.sport_code:null});
 }
 const positions:SnapshotPosition[]=[];
 for(const raw of Array.isArray(p.positions)?p.positions:[]){
  const r=obj(raw);if(!r)continue;
  const id=int(r.id),odds=int(r.american_odds),stake=int(r.stake_cents),placedAt=stamp(r.placed_at);
  if(id===null||odds===null||stake===null||stake<=0||!placedAt||typeof r.selection!=='string')continue;
  let settlement:SnapshotPosition['settlement']=null;
  if(r.settlement!==null){
   const s=obj(r.settlement),profit=int(s?.profit_cents),at=stamp(s?.settled_at),outcome=s?.outcome;
   if(!s||profit===null||!at||(outcome!=='won'&&outcome!=='lost'&&outcome!=='void'))continue;
   settlement={outcome,profitCents:profit,settledAt:at};
  }
  positions.push({id,selection:r.selection,americanOdds:odds,stakeCents:stake,placedAt,settlement});
 }
 const roi=finite(p.roi),dd=finite(p.max_drawdown_fraction);
 return {initialCents:int(p.initial_cents),equityCents:int(p.equity_cents),availableCents:int(p.available_cents),pendingStakeCents:int(p.pending_stake_cents),
  profitCents:int(p.profit_cents),roi,wins:int(p.wins),losses:int(p.losses),maxDrawdownFraction:dd!==null&&dd>=0&&dd<=1?dd:null,forecasts,positions};
}

/* Stored sportsbook feed from /api/sports. */
export type FeedQuote={sportsbook:string;selection:string;americanOdds:number;updatedAt:string;noVigProbability:number|null};
export type FeedGame={id:string;home:string;away:string;startsAt:string;bookmakers:FeedQuote[]};
export type SportsFeed={status:'stored';fetchedAt:string|null;quoteLimitReached:boolean;games:FeedGame[]};
export function parseSportsFeed(v:unknown):SportsFeed|null{
 const x=obj(v);
 if(!x||x.status!=='stored'||!Array.isArray(x.games))return null;
 const games:FeedGame[]=[];
 for(const raw of x.games){
  const g=obj(raw);
  if(!g||typeof g.id!=='string'||typeof g.home!=='string'||typeof g.away!=='string'||!stamp(g.startsAt)||!Array.isArray(g.bookmakers))continue;
  const bookmakers:FeedQuote[]=[];
  for(const q of g.bookmakers){
   const o=obj(q),odds=int(o?.americanOdds),nv=o?.noVigProbability===null||o?.noVigProbability===undefined?null:finite(o.noVigProbability);
   if(!o||typeof o.sportsbook!=='string'||typeof o.selection!=='string'||odds===null||!stamp(o.updatedAt))continue;
   bookmakers.push({sportsbook:o.sportsbook,selection:o.selection,americanOdds:odds,updatedAt:o.updatedAt as string,noVigProbability:nv!==null&&nv>0&&nv<1?nv:null});
  }
  games.push({id:g.id,home:g.home,away:g.away,startsAt:g.startsAt as string,bookmakers});
 }
 return {status:'stored',fetchedAt:stamp(x.fetchedAt),quoteLimitReached:x.quoteLimitReached===true,games};
}

/** Median no-vig probability for one selection across books that priced a complete market. */
export function marketProbability(game:FeedGame,selection:string){
 const values=game.bookmakers.filter(q=>q.selection===selection&&q.noVigProbability!==null).map(q=>q.noVigProbability!).sort((a,b)=>a-b);
 if(!values.length)return {median:null,books:0};
 const mid=Math.floor(values.length/2);
 return {median:values.length%2?values[mid]:(values[mid-1]+values[mid])/2,books:values.length};
}

export function latestQuote(games:FeedGame[]){
 let best:string|null=null;
 for(const g of games)for(const q of g.bookmakers)if(!best||Date.parse(q.updatedAt)>Date.parse(best))best=q.updatedAt;
 return best;
}
