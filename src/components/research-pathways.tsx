"use client";
import {useState} from 'react';
import Link from 'next/link';
import {NavIcon} from '@/components/nav-icon';

type Mode='sports'|'stocks';
const paths={
 sports:{
  title:'From recorded odds to measurable outcomes',
  intro:'Explore actual saved sportsbook observations, inspect model research, then review the separate virtual ledger. Saved odds are not live quotes.',
  items:[
   {number:'01',title:'Explore the market',detail:'Find an NBA or EPL matchup and inspect saved quote timestamps.',state:'Available',href:'/sports',cta:'Browse games'},
   {number:'02',title:'Understand the model',detail:'Compare historical model accuracy with its documented limitations.',state:'Research',href:'/research/nba',cta:'Review NBA study'},
   {number:'03',title:'Evaluate virtual results',detail:'Follow settled paper bets; don’t mistake a prediction rate for ROI.',state:'Paper study',href:'/paper-betting',cta:'View paper results'}
  ]
 },
 stocks:{
  title:'From a frozen algorithm to defensible results',
  intro:'The stock momentum rules are registered, but a complete point-in-time universe and a real after-cost backtest still need verification.',
  items:[
   {number:'01',title:'Review the strategy',detail:'See the frozen stock rules and candidate comparison.',state:'Registered',href:'/stocks/research',cta:'Open stock research'},
   {number:'02',title:'Verify historical evidence',detail:'Check universe, corporate actions, timestamps, and execution costs.',state:'Not verified',href:'/stocks/research',cta:'Review blockers'},
   {number:'03',title:'Practice without orders',detail:'Use a manual virtual stock journal while broker execution remains separate.',state:'Manual only',href:'/stocks',cta:'Open stock journal'}
  ]
 }
} as const;

export function ResearchPathways(){
 const [mode,setMode]=useState<Mode>('sports');
 const choice=paths[mode];
 return <section className="pathways" aria-labelledby="pathways-heading">
  <div className="section-title overview-section-title pathways-heading">
   <div><div className="eyebrow">YOUR NEXT MOVE</div><h2 id="pathways-heading">Pick a path. See what matters.</h2></div>
   <span className="pathways-caption">Guided exploration · no account required</span>
  </div>
  <div className="glass pathways-panel">
   <div className="pathways-overview">
    <div className="pathways-tabs" role="group" aria-label="Choose a research pathway">
     <button type="button" aria-pressed={mode==='sports'} onClick={()=>setMode('sports')}><NavIcon name="sports" size={18}/> Sports</button>
     <button type="button" aria-pressed={mode==='stocks'} onClick={()=>setMode('stocks')}><NavIcon name="stocks" size={18}/> Stocks</button>
    </div>
    <div className="pathways-copy" key={mode}>
     <div className="pathways-mini-label">RESEARCH WORKFLOW / {mode.toUpperCase()}</div>
     <h3>{choice.title}</h3>
     <p>{choice.intro}</p>
    </div>
    <div className="pathways-guard"><NavIcon name="shield" size={17}/><span>Explore and evaluate only. No real-money trading.</span></div>
   </div>
   <div className="pathway-steps" key={mode+'-steps'}>
    {choice.items.map((step,i)=><div className="pathway-step" key={step.number}>
     <div className="pathway-step-index"><span>{step.number}</span>{i!==choice.items.length-1&&<i aria-hidden="true"/>}</div>
     <div className="pathway-step-content">
      <div className="pathway-step-head"><h4>{step.title}</h4><span className={step.state==='Not verified'?'pathway-state pathway-state-caution':'pathway-state'}>{step.state}</span></div>
      <p>{step.detail}</p>
      <Link href={step.href}>{step.cta} <NavIcon name="arrow" size={15}/></Link>
     </div>
    </div>)}
   </div>
  </div>
 </section>;
}
