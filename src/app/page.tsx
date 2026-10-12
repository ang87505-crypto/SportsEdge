"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Action,Stat,Details} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import summary from '@/data/research/nba_recent_summary.json';
import {isResearchSnapshot,type ResearchSnapshot} from '@/lib/dashboard-snapshot';

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
 const ledgerState=failed?'Unavailable':data?'Connected to saved records':'Checking records';
 return <div className="dashboard-home">
  <div className="overview-heading"><div className="eyebrow">WORKSPACE / OVERVIEW</div><span className="overview-heading-label"><span className="status-dot"/> RESEARCH ENVIRONMENT</span></div>
  <section className="glass hero" aria-labelledby="home-hero-title">
   <div className="hero-copy">
    <span className="hero-overline">ANALYZE. SIMULATE. REVIEW.</span>
    <h1 id="home-hero-title">A sharper view of <em>every decision.</em></h1>
    <p>Explore recorded sports prices, study model predictions, and follow simulated results—without confusing a good forecast with a profitable strategy.</p>
    <div className="button-row"><Action href="/sports">Explore sports</Action><Action href="/paper-betting" secondary>View paper performance</Action></div>
    <div className="hero-disclosure"><NavIcon name="shield" size={15}/> Research and virtual money only · No brokerage or real betting execution</div>
   </div>
   <div className="hero-method" aria-label="The SportsEdge process">
    <div className="method-heading"><span>OUR PROCESS</span><span>01 — 03</span></div>
    <div className="method-step"><b>01</b><div><strong>Understand the evidence</strong><span>Source, timestamp, and model assumptions</span></div></div>
    <div className="method-step"><b>02</b><div><strong>Record a simulation</strong><span>Track virtual decisions separately</span></div></div>
    <div className="method-step"><b>03</b><div><strong>Measure the outcome</strong><span>Win rate is not the same as return</span></div></div>
    <div className="method-bottom">DISCIPLINE BEFORE CONVICTION <span>↗</span></div>
   </div>
  </section>
  <div className="section-title overview-section-title"><div><div className="eyebrow">PERFORMANCE SNAPSHOT</div><h2>Numbers with context</h2></div><Link href="/research/nba">Explore methodology <NavIcon name="arrow" size={15}/></Link></div>
  <p className="metric-explainer">Historical model accuracy and forward paper-betting outcomes measure different things. Neither alone demonstrates a betting advantage.</p>
  <div className="stats-grid overview-stats">
   <Stat label="Historical NBA winner accuracy" value={`${(summary.accuracy*100).toFixed(2)}%`} detail={`${summary.evaluation_games.toLocaleString()} historical game predictions · not betting ROI`}/>
   <Stat label="Paper bets awaiting result" value={data?data.paper.pending_bets:'—'} detail={failed?'Ledger unavailable':'Recorded simulations not yet settled'}/>
   <Stat label="Settled paper bets" value={data?data.paper.settled_bets:'—'} detail="Only finalized results count here"/>
   <Stat label="Settled paper win rate" value={data?.paper.win_rate!=null?`${(data.paper.win_rate*100).toFixed(1)}%`:'Not measured'} detail="Based only on settled, non-void bets"/>
  </div>
  <section className="glass ledger-status" aria-live="polite" aria-label="Saved research connection">
   <div className="ledger-status-main"><span className={`status-light ${failed?'status-error':data?'status-good':''}`}/><div><strong>Saved research ledger</strong><span>{ledgerState}. This checks recorded data, not live sportsbook prices.</span></div></div>
   <div className="ledger-actions">{failed&&<button type="button" className="button button-secondary" onClick={reload}>Retry data check</button>}<Link href="/connections">Connection details <NavIcon name="arrow" size={15}/></Link></div>
  </section>
  <div className="section-title overview-section-title"><div><div className="eyebrow">EXPLORE THE PLATFORM</div><h2>Choose a workspace</h2></div><Link href="/guide">How SportsEdge works <NavIcon name="arrow" size={15}/></Link></div>
  <div className="two-grid">
   <section className="glass module-card">
    <div className="module-top"><span className="workspace-card-icon"><NavIcon name="sports" size={25}/></span><span className="module-index">01 / SPORTS</span></div>
    <span className="workspace-card-category">RECORDED ODDS & MODEL RESEARCH</span>
    <h2>Sports intelligence</h2>
    <p>Browse scheduled NBA and EPL games, compare saved sportsbook prices, and investigate what the models forecast.</p>
    <div className="workspace-card-facts"><span>Saved quote timestamps</span><span>Model research</span></div>
    <Action href="/sports">Open sports workspace</Action>
   </section>
   <section className="glass module-card">
    <div className="module-top"><span className="workspace-card-icon"><NavIcon name="stocks" size={25}/></span><span className="module-index">02 / STOCKS</span></div>
    <span className="workspace-card-category">WATCHLIST & MANUAL JOURNAL</span>
    <h2>Stock research desk</h2>
    <p>Build a watchlist and track virtual entries and exits. The current journal is browser-local and does not send orders.</p>
    <div className="workspace-card-facts"><span>Manual price inputs</span><span>No broker sync</span></div>
    <Action href="/stocks" secondary>Open stock workspace</Action>
   </section>
  </div>
  <section className="glass overview-bottom" aria-label="What is connected">
   <div><div className="eyebrow">CURRENT CAPABILITIES</div><h2>Be clear about what is—and isn't—connected.</h2><p>SportsEdge has stored sports observations and a simulated NBA ledger. The stock journal saves to this browser, while real-money execution and broker synchronization are not connected.</p></div>
   <div className="overview-bottom-links"><Link href="/paper-betting">Paper account <NavIcon name="arrow" size={15}/></Link><Link href="/connections">Check connections <NavIcon name="arrow" size={15}/></Link><Link href="/guide#limits">Read platform limits <NavIcon name="arrow" size={15}/></Link></div>
  </section>
  <Details title="What is experimental, and what should I trust?"><p><strong>Historical results:</strong> previously recorded game predictions. They are not prospective betting profits.</p><p><strong>Simulated results:</strong> virtual positions with a separate recorded ledger. Actual betting prices and fills may differ.</p><p><strong>Still being developed:</strong> independently verified automated stock trading, live broker synchronization, and reproducible evidence of profitable strategies. See the <Link href="/guide#limits">platform guide</Link> for important limitations.</p></Details>
 </div>;
}
