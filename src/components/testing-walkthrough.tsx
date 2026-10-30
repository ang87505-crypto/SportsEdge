'use client';
import {useState} from 'react';
import Link from 'next/link';

type Step={
 id:string;area:'Platform'|'Sports'|'Stocks'|'Broker';
 name:string;description:string;check:string;
 href:string;linkText:string;
 state:'Inspectable'|'Private preview'|'Blocked';
};
const steps:Step[]=[
 {id:'home',area:'Platform',name:'Find your way around',
 description:'Start on the Overview page. Use the sidebar, mobile tabs or Jump to search to reach the main workspaces.',
 check:'Can you find Stocks, Sports, Progress and this Test center without guessing?',
 href:'/',linkText:'Open overview',state:'Inspectable'},
 {id:'sports',area:'Sports',name:'Review sports research',
 description:'Look at recorded games and model results, then open the separate NBA virtual-money ledger.',
 check:'Are historical prediction accuracy and settled paper returns clearly labeled as different measurements?',
 href:'/paper-betting',linkText:'Open paper-betting ledger',state:'Inspectable'},
 {id:'stocks',area:'Stocks',name:'Try the manual stock journal',
 description:'Review your local watchlist and trade journal. Export a JSON backup before changing or restoring anything.',
 check:'Can you distinguish manual-entry P&L from actual Alpaca paper-equity and algorithm backtest returns?',
 href:'/stocks/journal',linkText:'Open practice journal',state:'Inspectable'},
 {id:'research',area:'Stocks',name:'Check stock backtest evidence',
 description:'Read the frozen strategy protocol and published research gates. Engineering tests alone are not profitable backtest results.',
 check:'Are genuine historical returns still shown as unverified until a real audit is approved?',
 href:'/stocks/research',linkText:'Open stock research',state:'Inspectable'},
 {id:'alpaca',area:'Broker',name:'Inspect your private Alpaca paper account',
 description:'On an authorized protected Preview, unlock the separate PAPER-only owner dashboard and refresh the broker snapshot. Never share your owner key.',
 check:'Does it show virtual balances and a read-only history button without an order submission control?',
 href:'/stocks/alpaca',linkText:'Open private paper viewer',state:'Private preview'},
 {id:'execution',area:'Broker',name:'Paper-order execution rehearsal',
 description:'Not available for owner testing. Database outbox, reconciliation logic and limits have isolated tests, but the verified live order writer, operational kill switch and approved model signal source are not released.',
 check:'No paper or live orders should be launched from this tour.',
 href:'/progress',linkText:'Review release blockers',state:'Blocked'}
];
export function TestingWalkthrough(){
 const [selected,setSelected]=useState(0);
 const [filter,setFilter]=useState<'All'|'Inspectable'|'Private preview'|'Blocked'>('All');
 const active=steps[selected];
 const visible=steps.map((s,i)=>({s,i})).filter(({s})=>filter==='All'||s.state===filter);
 return <section aria-label="SportsEdge guided owner acceptance tour" className="test-tour">
  <div className="test-tour-top">
   <div><h2>Owner acceptance tour</h2><p>One route through every major feature. Visiting a step does not certify it as passed.</p></div>
   <span className="pill">6 checkpoints</span>
  </div>
  <div className="test-tour-filters" role="group" aria-label="Filter owner testing steps">
   {(['All','Inspectable','Private preview','Blocked'] as const).map(v=>
    <button type="button" key={v} aria-pressed={filter===v} onClick={()=>{
     setFilter(v);
     const match=steps.findIndex(x=>v==='All'||x.state===v);
     if(match>=0)setSelected(match);
    }}>{v}</button>)}
  </div>
  <div className="test-tour-layout">
   <nav className="test-tour-steps" aria-label="Testing checkpoints">
    {visible.map(({s,i})=><button type="button" key={s.id} onClick={()=>setSelected(i)}
     aria-current={selected===i?'step':undefined} className={selected===i?'test-tour-step is-current':'test-tour-step'}>
     <span className="test-step-number">{String(i+1).padStart(2,'0')}</span>
     <span className="test-step-copy"><strong>{s.name}</strong><small>{s.area} · {s.state}</small></span>
    </button>)}
   </nav>
   <article className="glass test-tour-detail" aria-live="polite" aria-labelledby="test-current-step">
    <div className="module-top"><span className="eyebrow">Step {selected+1} of {steps.length}</span><span className={active.state==='Inspectable'?'pill':'pill pill-amber'}>{active.state}</span></div>
    <h3 id="test-current-step">{active.name}</h3>
    <p>{active.description}</p>
    <div className="test-tour-expect"><strong>What to check during testing</strong><p>{active.check}</p></div>
    <div className="button-row">
     <Link className="button" href={active.href}>{active.linkText}</Link>
     <button type="button" className="button button-secondary" onClick={()=>{
      const current=visible.findIndex(x=>x.i===selected);
      setSelected(visible[(current+1)%visible.length].i);
     }} disabled={visible.length<=1}>Next checkpoint</button>
    </div>
    {active.state==='Private preview'&&<p className="test-tour-note">This route works only on an owner-configured Preview deployment. Production may intentionally reject private sign-in.</p>}
    {active.state==='Blocked'&&<p className="test-tour-note">Engineering progress is not authorization to submit simulated or real orders.</p>}
   </article>
  </div>
 </section>;
}
