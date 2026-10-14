"use client";
import {useEffect,useState,type CSSProperties} from 'react';
import Link from 'next/link';
import {Action,Stat,Details} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import {ResearchPathways} from '@/components/research-pathways';
import summary from '@/data/research/nba_recent_summary.json';
import {isResearchSnapshot,type ResearchSnapshot} from '@/lib/dashboard-snapshot';

const accuracy=(summary.accuracy*100).toFixed(1);
const accuracyStyle={'--accuracy':`${summary.accuracy*100}%`} as CSSProperties;

export default function Home(){
 const [data,setData]=useState<ResearchSnapshot|null>(null);
 const [failed,setFailed]=useState(false);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/research',{signal:controller.signal,cache:'no-store'})
   .then(async response=>{
    if(!response.ok)throw Error('Ledger unavailable');
    const value:unknown=await response.json();
    if(!isResearchSnapshot(value))throw Error('Unexpected ledger response');
    return value;
   })
   .then(value=>{if(!controller.signal.aborted){setData(value);setFailed(false);}})
   .catch(()=>{if(!controller.signal.aborted){setData(null);setFailed(true);}});
  return ()=>controller.abort();
 },[retry]);
 function reload(){setFailed(false);setData(null);setRetry(previous=>previous+1);}
 const ledgerState=failed?'Unavailable':data?'Saved records verified':'Checking saved records';

 return <div className="dashboard-home experience-home">
  <div className="overview-heading experience-eyebrow">
   <div className="eyebrow">OVERVIEW <span className="eyebrow-divider">/</span> YOUR RESEARCH DESK</div>
   <span className="overview-heading-label"><span className="status-dot"/> RESEARCH ENVIRONMENT</span>
  </div>

  <section className="glass hero experience-hero" aria-labelledby="home-hero-title">
   <div className="hero-noise" aria-hidden="true"/>
   <div className="hero-copy">
    <span className="hero-overline"><span className="hero-overline-line"/> BUILT FOR BETTER DECISIONS</span>
    <h1 id="home-hero-title">Find the signal.<br/><em>Respect the evidence.</em></h1>
    <p>One place to explore sports models, track virtual decisions, and follow the stock algorithm from research to real validation. Clear numbers, clear limits.</p>
    <div className="button-row experience-actions">
     <Action href="/sports">Explore sports research</Action>
     <Action href="/stocks" secondary>Open stock workspace</Action>
    </div>
    <div className="hero-disclosure"><NavIcon name="shield" size={16}/> Research and simulations only. No real-money execution.</div>
   </div>
   <div className="experience-hero-panel" aria-label="Historical NBA model snapshot">
    <div className="hero-panel-top"><span>MODEL SNAPSHOT</span><span>01 / NBA</span></div>
    <div className="hero-metric-body">
     <div className="accuracy-ring" style={accuracyStyle} role="img" aria-label={`${accuracy}% historical NBA winner accuracy; not betting ROI`}>
      <div className="accuracy-ring-core"><span>{accuracy}<small>%</small></span><span className="accuracy-caption">ACCURACY</span></div>
     </div>
     <div className="hero-metric-caption"><span className="hero-caption-kicker">HISTORICAL EVALUATION</span><strong>{summary.evaluation_games.toLocaleString()} games</strong><span>Winner predictions · not trading return</span></div>
    </div>
    <div className="hero-panel-foot"><span><span className="foot-dot"/> Measured historical study</span><Link href="/research/nba">View methodology <NavIcon name="arrow" size={14}/></Link></div>
   </div>
  </section>

  <div className="section-title overview-section-title">
   <div><div className="eyebrow">PERFORMANCE AT A GLANCE</div><h2>What the records actually say</h2></div>
   <Link href="/paper-betting">Inspect paper ledger <NavIcon name="arrow" size={15}/></Link>
  </div>
  <p className="metric-explainer">Historical winner accuracy, unsettled simulations, and realized paper outcomes are different measures. None alone establishes a profitable strategy.</p>
  <div className="stats-grid overview-stats experience-stats">
   <Stat label="Historical NBA winner accuracy" value={`${(summary.accuracy*100).toFixed(2)}%`} detail={`${summary.evaluation_games.toLocaleString()} historical games · not betting ROI`}/>
   <Stat label="Paper bets awaiting result" value={data?data.paper.pending_bets:'—'} detail={failed?'Saved ledger unavailable':'Virtual positions still unsettled'}/>
   <Stat label="Settled paper bets" value={data?data.paper.settled_bets:'—'} detail="Only finalized outcomes count"/>
   <Stat label="Settled paper win rate" value={data?.paper.win_rate!=null?`${(data.paper.win_rate*100).toFixed(1)}%`:'Not measured'} detail="Based only on settled, non-void bets"/>
  </div>
  <section className="glass ledger-status experience-ledger" aria-live="polite" aria-label="Saved research connection">
   <div className="ledger-status-main"><span className={`status-light ${failed?'status-error':data?'status-good':''}`}/><div><strong>{ledgerState}</strong><span>{failed?'The saved research service could not be reached. Metrics are unavailable rather than assumed.':data?'Recorded data loaded. This is not a real-time sportsbook or broker connection.':'Contacting the saved research service. No numbers are assumed while waiting.'}</span></div></div>
   <div className="ledger-actions">
    {failed?<button type="button" className="button button-secondary" onClick={reload}>Try again <NavIcon name="arrow" size={14}/></button>:<Link href="/guide#limits">How data works <NavIcon name="arrow" size={15}/></Link>}
   </div>
  </section>

  <ResearchPathways/>

  <div className="section-title overview-section-title"><div><div className="eyebrow">YOUR WORKSPACES</div><h2>Built for two different kinds of research</h2></div><Link href="/guide">New here? Start with the guide <NavIcon name="arrow" size={15}/></Link></div>
  <div className="two-grid experience-workspaces">
   <section className="glass module-card experience-workspace-card">
    <div className="module-top"><span className="workspace-card-icon"><NavIcon name="sports" size={25}/></span><span className="module-index">01 / SPORTS</span></div>
    <span className="workspace-card-category">ODDS · MODELS · PAPER RESULTS</span>
    <h2>Sports intelligence <span className="experience-title-arrow" aria-hidden="true">↗</span></h2>
    <p>Browse scheduled matchups, compare saved sportsbook observations, and follow how recorded virtual bets settle.</p>
    <div className="workspace-card-facts"><span>Quote timestamps</span><span>Separate virtual ledger</span></div>
    <Action href="/sports">Enter sports workspace</Action>
   </section>
   <section className="glass module-card experience-workspace-card">
    <div className="module-top"><span className="workspace-card-icon"><NavIcon name="stocks" size={25}/></span><span className="module-index">02 / STOCKS</span></div>
    <span className="workspace-card-category">WATCHLIST · JOURNAL · ALGORITHM</span>
    <h2>Stock research desk <span className="experience-title-arrow" aria-hidden="true">↗</span></h2>
    <p>Practice with a manual virtual journal and inspect the frozen momentum strategy while the real historical backtest remains unverified.</p>
    <div className="workspace-card-facts"><span>Manual practice</span><span>Algorithm research</span></div>
    <Action href="/stocks" secondary>Enter stock workspace</Action>
   </section>
  </div>

  <section className="glass overview-bottom experience-bottom" aria-label="What is connected">
   <div><div className="eyebrow">TRUST THE PROVENANCE</div><h2>Know what’s measured.<br/>Know what’s still a hypothesis.</h2><p>SportsEdge contains saved sports observations and a shared virtual NBA ledger. Stock journal entries are saved in your browser. A real after-cost stock backtest and automatic stock execution are not validated on this version.</p></div>
   <div className="overview-bottom-links">
    <Link href="/progress">All project milestones <NavIcon name="arrow" size={15}/></Link>
    <Link href="/research/nba">Historical model research <NavIcon name="arrow" size={15}/></Link>
    <Link href="/guide#limits">Platform limits and sources <NavIcon name="arrow" size={15}/></Link>
   </div>
  </section>
  <Details title="How should I interpret the research numbers?"><p><strong>Historical results:</strong> previously recorded game predictions, not prospective betting profits.</p><p><strong>Paper results:</strong> virtual positions recorded and settled against a separate ledger. Actual prices and fills could differ.</p><p><strong>Still being developed:</strong> audited stock backtesting, controlled broker paper orders and reproducible evidence of profitable strategies. Read the <Link href="/guide#limits">platform guide</Link> for important limitations.</p></Details>
 </div>;
}
