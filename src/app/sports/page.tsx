"use client";
import Link from 'next/link';
import {useMemo,useState} from 'react';
import {PageHeading,Panel,Metric,MetricGrid,Badge,Callout,Empty,Details,Segmented,Loading,type Tone} from '@/components/ui';
import {ProbabilityCompare} from '@/components/charts';
import {NavIcon} from '@/components/nav-icon';
import summary from '@/data/research/nba_recent_summary.json';
import epl from '@/data/research/epl_october_2026_forecasts.json';
import {useNow} from '@/lib/use-now';
import {useResearch,useSportsFeed} from '@/lib/use-live-data';
import {marketProbability,latestQuote,type FeedGame,type SnapshotForecast} from '@/lib/dashboard-snapshot';
import {age,ageHours,american,dateTime,pct,pp} from '@/lib/format';

type Sport='nba'|'soccer';
type Filter='all'|'forecast'|'priced';
const STALE_HOURS=24;

function quoteTone(hours:number|null):Tone{return hours===null?'neutral':hours>STALE_HOURS?'warning':'positive';}

export default function Sports(){
 const [sport,setSport]=useState<Sport>('nba');
 const [search,setSearch]=useState('');
 const [filter,setFilter]=useState<Filter>('all');
 const [feed,retryFeed]=useSportsFeed(sport);
 const [research]=useResearch();
 const now=useNow();

 const forecastsByGame=useMemo(()=>{
  const map=new Map<string,SnapshotForecast>();
  if(research.status!=='ready')return map;
  for(const f of research.data.details.forecasts){
   const prev=map.get(String(f.gameId));
   if(!prev||Date.parse(f.publishedAt)>Date.parse(prev.publishedAt))map.set(String(f.gameId),f);
  }
  return map;
 },[research]);

 const games=feed.status==='ready'?feed.data.games:[];
 const term=search.trim().toLowerCase();
 const visible=games.filter(g=>{
  if(term&&!`${g.home} ${g.away}`.toLowerCase().includes(term))return false;
  if(filter==='forecast'&&!(sport==='nba'&&forecastsByGame.has(g.id)))return false;
  if(filter==='priced'&&!g.bookmakers.length)return false;
  return true;
 });
 const newest=feed.status==='ready'?latestQuote(games):null;
 const withForecast=sport==='nba'?games.filter(g=>forecastsByGame.has(g.id)).length:0;
 const priced=games.filter(g=>g.bookmakers.length).length;

 function changeSport(next:Sport){if(next!==sport){setSport(next);setSearch('');setFilter('all');}}

 return <>
  <PageHeading title="Sports AI" description="Upcoming NBA and EPL games with the model's probability beside the market's margin-free probability from stored sportsbook prices. A gap between the two is a research question, not a proven betting edge."
   action={<><Link href="/research/nba" className="button button-secondary">NBA model</Link><Link href="/paper-betting" className="button button-secondary">Paper ledger</Link></>}/>

  <MetricGrid columns={4} className="sports-models">
   <Metric label="NBA winner accuracy" value={pct(summary.accuracy)} evidence="historical" detail={`${summary.evaluation_games.toLocaleString()} games, 2024–26. Home-team baseline ${pct(summary.baseline_accuracy)}`}/>
   <Metric label="NBA calibration error" value={pct(summary.calibration.expected_calibration_error,1)} evidence="historical" hint="Average gap between forecast probability and observed win rate, weighted by games." detail="Expected calibration error across 10 probability bins"/>
   <Metric label="EPL archived forecasts" value={epl.forecasts.length} evidence="unverified" detail={`Snapshot model ${epl.model_version.split('-').slice(0,3).join('-')}, results to ${epl.source_latest_result_date}`}/>
   <Metric label="Proven betting edge" value="None" evidence="not-measured" detail="No forward closing-line or profit evidence yet"/>
  </MetricGrid>

  <div className="board-toolbar">
   <Segmented label="Sport" value={sport} onChange={changeSport} options={[{value:'nba',label:'NBA'},{value:'soccer',label:'Soccer (EPL)'}]}/>
   <Segmented label="Show games" value={filter} onChange={setFilter} options={[{value:'all',label:'All'},...(sport==='nba'?[{value:'forecast' as Filter,label:'With forecast',count:feed.status==='ready'?withForecast:undefined}]:[]),{value:'priced',label:'Priced',count:feed.status==='ready'?priced:undefined}]}/>
   <label className="search-field board-search"><span className="sr-only">Search teams</span>
    <NavIcon name="search" size={15}/><input type="search" placeholder="Search a team" value={search} onChange={e=>setSearch(e.target.value)}/>
   </label>
  </div>

  <div className="board-status" role="status" aria-live="polite">
   {feed.status==='loading'?'Loading stored games and prices…':feed.status==='error'?'Stored odds unavailable.':
    <>
     <span><strong>{visible.length}</strong> of {games.length} upcoming game(s)</span>
     <span>Latest quote {newest?<Badge tone={quoteTone(now?ageHours(newest,now):null)}>{now?age(newest,now):dateTime(newest)}</Badge>:<Badge tone="warning">none stored</Badge>}</span>
     <span>Source: The Odds API, stored snapshots</span>
     {sport==='nba'&&<span>Model: {research.status==='ready'?`${forecastsByGame.size} recorded forecast(s)`:research.status==='loading'?'loading':'unavailable'}</span>}
    </>}
  </div>

  {feed.status==='loading'?<div className="game-grid"><Loading label="Loading games"/><Loading label="Loading games"/></div>:
   feed.status==='error'?<Panel><Empty title="Stored odds are unavailable" action={<button type="button" className="button button-secondary" onClick={retryFeed}>Try again</button>}>The saved odds service did not respond. No prices are shown in place of real data. Your paper ledger is separate and unaffected.</Empty></Panel>:
   visible.length===0?<Panel><Empty title={games.length?'No games match these filters':'No upcoming games stored'}
     action={games.length?<button type="button" className="button button-secondary" onClick={()=>{setSearch('');setFilter('all');}}>Clear filters</button>:undefined}>
     {games.length?'Try another team name or show all games.':`There are no scheduled ${sport==='nba'?'NBA':'EPL'} games with stored data right now. Check the other sport or come back after the next collection run.`}</Empty></Panel>:
   <div className="game-grid">{visible.map(g=><GameCard key={g.id} game={g} sport={sport} forecast={sport==='nba'?forecastsByGame.get(g.id)??null:null} now={now}/>)}</div>}

  {feed.status==='ready'&&feed.data.quoteLimitReached&&<Callout tone="warning" title="Quote limit reached">This read hit its 1,000-quote limit, so some books may be missing from the comparison.</Callout>}

  <div className="two-grid sports-explain">
   <Details title="Model probability, market probability and edge"><p><strong>Model probability</strong> is the Elo model&apos;s estimate that a team wins, published before the game.</p><p><strong>Market probability</strong> removes the sportsbook margin from one book&apos;s complete set of prices. The board shows the median across books that priced every outcome.</p><p><strong>Model − market</strong> is a difference in percentage points. It becomes evidence of an edge only after many forward bets beat closing prices and settle profitably after costs. That evidence does not exist yet.</p></Details>
   <Details title="How to read American odds"><p>+120 means a winning $100 stake returns $120 profit. −150 means staking $150 to win $100. Higher is a better price for the bettor on the same outcome.</p><p>Each quote shows when it was recorded. Stored quotes may no longer be available.</p></Details>
  </div>
 </>;
}

function GameCard({game,sport,forecast,now}:{game:FeedGame;sport:Sport;forecast:SnapshotForecast|null;now:number}){
 const outcomes=sport==='soccer'?[game.home,'Draw',game.away]:[game.away,game.home];
 const books=new Set(game.bookmakers.map(q=>q.sportsbook)).size;
 const newest=latestQuote([game]);
 const hours=newest&&now?ageHours(newest,now):null;
 const rows=outcomes.map(sel=>{
  const market=marketProbability(game,sel);
  const quotes=game.bookmakers.filter(q=>q.selection===sel);
  const best=quotes.reduce<typeof quotes[number]|null>((b,q)=>!b||q.americanOdds>b.americanOdds?q:b,null);
  const model=forecast?sel===game.home?forecast.homeProbability:sel===game.away?1-forecast.homeProbability:null:null;
  return {sel,market,best,model,diff:model!==null&&market.median!==null?model-market.median:null};
 });
 const home=rows.find(r=>r.sel===game.home)!;
 return <article className="game-card-v2" aria-labelledby={`game-${game.id}`}>
  <header className="game-card-head">
   <div>
    <time dateTime={game.startsAt}>{dateTime(game.startsAt,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time>
    <h3 id={`game-${game.id}`}>{game.away} <span>at</span> {game.home}</h3>
   </div>
   <div className="game-card-badges">
    {sport==='nba'&&(forecast?<Badge tone="info">Model forecast</Badge>:<Badge tone="neutral">No forecast</Badge>)}
    {books?<Badge tone={quoteTone(hours)} title={newest?`Latest quote ${dateTime(newest)}`:undefined}>{books} book{books===1?'':'s'}{newest&&now?`, ${age(newest,now)}`:''}</Badge>:<Badge tone="warning">No prices</Badge>}
   </div>
  </header>

  <table className="game-odds">
   <thead><tr><th scope="col">Outcome</th>{sport==='nba'&&<th scope="col" className="num">Model</th>}<th scope="col" className="num">Market</th>{sport==='nba'&&<th scope="col" className="num">Diff.</th>}<th scope="col" className="num">Best price</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.sel}>
    <th scope="row">{r.sel}</th>
    {sport==='nba'&&<td className="num">{pct(r.model)}</td>}
    <td className="num">{pct(r.market.median)}{r.market.books>0&&<small>{r.market.books} book{r.market.books===1?'':'s'}</small>}</td>
    {sport==='nba'&&<td className="num">{r.diff===null?'—':<span className={Math.abs(r.diff)>=0.05?'diff-strong':undefined}>{pp(r.diff)}</span>}</td>}
    <td className="num">{r.best?<>{american(r.best.americanOdds)}<small>{r.best.sportsbook}</small></>:'—'}</td>
   </tr>)}</tbody>
  </table>

  {sport==='nba'&&(forecast||home.market.median!==null)&&<ProbabilityCompare rows={[
   {label:`Model, ${shortName(game.home)}`,value:home.model,color:'var(--c1)'},
   {label:`Market, ${shortName(game.home)}`,value:home.market.median,color:'var(--c2)'}]}
   caption={home.diff!==null?<>Home-win difference {pp(home.diff)}. A difference is not an edge until forward results confirm it.</>:forecast?'No complete market to compare against.':'No published model forecast for this game.'}/>}
  {sport==='nba'&&home.diff!==null&&Math.abs(home.diff)>=0.1&&<p className="game-card-warning">A gap this large usually means the Elo model is missing information the market has, such as injuries or roster changes.</p>}
  {sport==='soccer'&&<p className="game-card-note">Market probabilities only. The EPL model is an archived experiment; see <Link className="text-link" href="/research/epl">Soccer model</Link>.</p>}

  {game.bookmakers.length>0&&<details className="game-quotes">
   <summary>All {game.bookmakers.length} recorded prices</summary>
   <div className="table-wrap"><table className="data-table">
    <thead><tr><th scope="col">Book</th><th scope="col">Outcome</th><th scope="col" className="num">Odds</th><th scope="col" className="num">No-vig</th><th scope="col">Recorded</th></tr></thead>
    <tbody>{game.bookmakers.map((q,i)=><tr key={i}><td>{q.sportsbook}</td><td>{q.selection}</td><td className="num">{american(q.americanOdds)}</td><td className="num">{q.noVigProbability===null?<span title="This book's market was incomplete">—</span>:pct(q.noVigProbability)}</td><td>{dateTime(q.updatedAt)}{now?<small>{age(q.updatedAt,now)}</small>:null}</td></tr>)}</tbody>
   </table></div>
  </details>}
 </article>;
}

function shortName(team:string){const parts=team.split(' ');return parts.length>1?parts[parts.length-1]:team;}
