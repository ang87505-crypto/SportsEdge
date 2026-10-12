"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {PageHeading,Action,Details,Empty} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import {quoteDisplayStatus,quoteStatusLabels} from '@/lib/ingestion/quote-display';

type Quote={sportsbook:string;selection:string;americanOdds:number;updatedAt:string;ingestedAt?:string;completeMarket?:boolean;freshness?:string;noVigProbability?:number|null};
type Game={id:string;home:string;away:string;startsAt:string;bookmakers:Quote[]};
type Feed={status:string;games:Game[];message?:string;quoteLimitReached?:boolean};
export default function Sports(){
 const [sport,setSport]=useState('nba');
 const [search,setSearch]=useState('');
 const [feed,setFeed]=useState<Feed|null>(null);
 const [reload,setReload]=useState(0);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/sports?sport=${sport}`,{signal:controller.signal,cache:'no-store'})
   .then(async r=>{if(!r.ok)throw Error();const data:Feed=await r.json();if(!data||!Array.isArray(data.games))throw Error();return data;})
   .then(data=>{if(!controller.signal.aborted)setFeed(data);})
   .catch(()=>{if(!controller.signal.aborted)setFeed({status:'error',games:[]});});
  return ()=>controller.abort();
 },[sport,reload]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return ()=>clearInterval(timer);},[]);
 const games=feed?.games.filter(g=>`${g.home} ${g.away}`.toLowerCase().includes(search.toLowerCase()))??[];
 function refresh(){setFeed(null);setReload(n=>n+1);}
 function choose(next:'nba'|'soccer'){if(next!==sport){setSport(next);setFeed(null);setSearch('');}}
 return <>
  <PageHeading eyebrow="SPORTS / RESEARCH" title="Understand the matchup." description="Compare saved prices, review model predictions, and see exactly when each observation was recorded. Nothing on this page places a bet." action={<Action href="/paper-betting" secondary>Paper account</Action>}/>
  <section className="glass sports-feature">
   <div><span className="eyebrow">FEATURED ANALYSIS</span><h2>NBA Game Analysis</h2><p>Inspect model probabilities alongside stored bookmaker odds. Price freshness and incomplete markets are clearly flagged before you draw conclusions.</p><span className="pill">Read-only · No wagering</span></div>
   <Action href="/opportunities">Explore game analysis</Action>
  </section>
  <div className="sports-resource-links" aria-label="Research resources">
   <Link href="/research/nba"><span><strong>NBA prediction research</strong><small>Forecasts, evaluation and limitations</small></span><NavIcon name="arrow" size={18}/></Link>
   <Link href="/research/epl"><span><strong>EPL prediction research</strong><small>Experimental coverage and outcomes</small></span><NavIcon name="arrow" size={18}/></Link>
  </div>
  <div className="section-title sports-feed-heading"><div><div className="eyebrow">RECORDED MARKET DATA</div><h2>Upcoming games</h2></div><span className="quiet">{feed?.status==='stored'?`${games.length} games displayed`:feed?'Feed unavailable':'Loading saved games'}</span></div>
  <div className="toolbar odds-toolbar">
   <div className="tabs" role="group" aria-label="Choose sport"><button aria-pressed={sport==='nba'} onClick={()=>choose('nba')}>Basketball · NBA</button><button aria-pressed={sport==='soccer'} onClick={()=>choose('soccer')}>Soccer · EPL</button></div>
   <div className="odds-toolbar-actions"><input className="search-input" aria-label="Search teams" placeholder="Search for a team" value={search} onChange={e=>setSearch(e.target.value)}/><button type="button" className="button button-secondary" onClick={refresh}>Reload saved data ↻</button></div>
  </div>
  <div className="notice sports-source-note"><strong>Saved observations, not executable prices.</strong> Price labels age even while this page is open. Reload reads SportsEdge’s database; it does not request new sportsbook quotes or incur provider credits.</div>
  {!feed?<div className="glass loading" role="status">Loading saved matchups…</div>:feed.status!=='stored'?<div className="glass sports-empty"><Empty title="Stored sports data is unavailable">The saved research feed could not be loaded. No prices have been substituted.</Empty><button type="button" className="button button-secondary" onClick={refresh}>Try again</button></div>:games.length===0?<div className="glass"><Empty title={search?'No matching teams':'No upcoming games in this feed'}>{search?'Try another team name or clear the search.':'Check another sport or revisit when more saved observations are available.'}</Empty></div>:<div className="games-list">{games.map(g=><article key={g.id} className="glass game-card">
   <div className="game-header"><div><small>{new Date(g.startsAt).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · local time</small><h3>{g.away}<span className="quiet"> at </span>{g.home}</h3></div><span className="pill">{g.bookmakers.length?`${new Set(g.bookmakers.map(q=>q.sportsbook)).size} sportsbooks recorded`:'No prices recorded'}</span></div>
   <details><summary>View recorded prices <span aria-hidden="true">↗</span></summary>
    {g.bookmakers.length?<div className="table-wrap"><table className="data-table"><caption className="sr-only">Recorded sportsbook prices for {g.away} at {g.home}</caption><thead><tr><th>Outcome</th><th>Sportsbook</th><th>American odds</th><th>Market chance*</th><th>Quote status</th><th>Recorded at</th></tr></thead><tbody>{g.bookmakers.map((q,i)=><tr key={i}><td>{q.selection}</td><td>{q.sportsbook}</td><td>{q.americanOdds>0?'+':''}{q.americanOdds}</td><td>{q.noVigProbability==null?'Unavailable':`${(q.noVigProbability*100).toFixed(1)}%`}</td><td><span className={quoteDisplayStatus(q,now)==='fresh'?'pill':'pill pill-amber'}>{quoteStatusLabels[quoteDisplayStatus(q,now)]}</span></td><td>{new Date(q.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div>:<p className="quiet">No observations recorded for this matchup.</p>}
   </details>
  </article>)}</div>}
  {feed?.quoteLimitReached&&<p className="notice">The stored quote read reached its limit, so this display may omit some prices.</p>}
  <Details title="How to interpret odds, market chance, and model results"><p><strong>American odds</strong> describe a possible payout, not whether an offer is still available. +120 would earn $120 profit on a winning $100 wager; −150 would require risking $150 for $100 profit.</p><p><strong>Market chance</strong> normalizes the implied probabilities of a complete sportsbook market to remove its margin. It is not SportsEdge’s model prediction.</p><p><strong>Win rate alone is not profitability.</strong> Realizable prices, losses, and execution costs matter. The SportsEdge paper ledger tracks simulated positions separately from historical predictions.</p></Details>
 </>;
}
