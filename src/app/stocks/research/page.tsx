import {Suspense} from 'react';
import {connection} from 'next/server';
import Link from 'next/link';
import {PageHeading,Panel,Badge,Callout} from '@/components/ui';
import {loadStockResearch} from '@/lib/server/stock-research-load';
import {DAILY_NAMES,RESEARCH_NAMES,RESEARCH_REPORT_URL} from '@/lib/research/stock-summary';
import {pct} from '@/lib/format';

export const metadata={title:'Strategy research · SportsEdge',description:'Published stock strategy evaluations, collection health and forward paper evidence.'};
export default function StockResearchPage(){
 return <>
  <PageHeading title="Strategy research" description="The same published evidence used by Ask SportsEdge. Historical simulations and forward paper results are shown separately."
   action={<Link href="/assistant" className="button button-secondary">Ask about these results</Link>}/>
  <Suspense fallback={<Panel title="Research"><p>Reading the published research summary…</p></Panel>}><ResearchResults/></Suspense>
 </>;
}
async function ResearchResults(){
 await connection();
 const view=await loadStockResearch(new Date().toISOString()),s=view.summary;
 if(!s)return <Callout tone="warning" title="Research feed unavailable">No result can be inferred from a missing report.</Callout>;
 const updated=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'}).format(new Date(s.generatedAt));
 return <>
  <Callout tone="warning" title={s.overall}>{view.mode==='saved'?'Showing a saved report because the live summary feed is unavailable.':'Showing the latest published summary.'} Updated {updated} Mountain time. Research candidates have not been activated.</Callout>
  <Panel title="Historical evaluation" description={s.window?`${s.window.join(' to ')}. All strategy returns below include 10 bps per side.`:'Not measured.'} flush className="mt-8">
   <div className="table-wrap"><table className="data-table">
    <thead><tr><th scope="col">Strategy</th><th scope="col">Continuous CAGR</th><th scope="col">CAGR with safety halt</th><th scope="col">Continuous drawdown</th><th scope="col">Verdict</th></tr></thead>
    <tbody>{s.candidates.map(c=><tr key={c.id}><th scope="row">{RESEARCH_NAMES[c.id]}</th>
     <td>{c.historical?pct(c.historical.continuous.cagr,1):'Not measured'}</td>
     <td>{c.historical?pct(c.historical.asLive.cagr,1):'Not measured'}</td>
     <td>{c.historical?pct(c.historical.continuous.max_drawdown,1):'Not measured'}</td>
     <td><Badge tone="neutral">{c.historical?.verdict??'Forward only'}</Badge></td></tr>)}</tbody>
   </table></div>
   <p className="panel-note">SPY buy-and-hold: {pct(s.benchmark.cagr,1)} CAGR, with dividends before investor costs. Previously inspected data and a survivorship-biased stock universe; this is exploratory simulation, not account profit.</p>
  </Panel>
  <Panel title="Forward paper evidence" className="mt-8">
   {s.candidates.map(c=><p key={c.id}><strong>{RESEARCH_NAMES[c.id]}:</strong> {c.forward.status.replaceAll('_',' ')} · {c.forward.sessions} measured sessions · {c.forward.totalReturn===null?'No return measured yet':pct(c.forward.totalReturn,1)+' cumulative return'}.</p>)}
  </Panel>
  {s.daily?<Panel title="Daily strategies (paper research)" description="Pre-registered 2026-11-10. Each is checked every session; simulated trades only, nothing is activated." flush className="mt-8">
   <div className="table-wrap"><table className="data-table">
    <thead><tr><th scope="col">Strategy</th><th scope="col">Historical CAGR after 10 bps</th><th scope="col">Before costs</th><th scope="col">Drawdown</th><th scope="col">Trades per year (turnover)</th><th scope="col">Verdict</th><th scope="col">Forward paper</th></tr></thead>
    <tbody>{s.daily.strategies.map(c=><tr key={c.id}><th scope="row">{DAILY_NAMES[c.id]}</th>
     <td>{c.historical?pct(c.historical.continuous.cagr,1):'Not run yet'}</td>
     <td>{c.historical?pct(c.historical.gross.cagr,1):'—'}</td>
     <td>{c.historical?pct(c.historical.continuous.max_drawdown,1):'—'}</td>
     <td>{c.historical?.turnoverPerYear!=null?c.historical.turnoverPerYear.toFixed(0)+'×':'—'}</td>
     <td><Badge tone="neutral">{c.historical?.verdict??'Pending'}</Badge></td>
     <td>{c.forward.sessions?`${c.forward.sessions} sessions · ${c.forward.totalReturn===null?'no return yet':pct(c.forward.totalReturn,1)}`:'Starts at the Nov 10 open'}</td></tr>)}</tbody>
   </table></div>
   <p className="panel-note">{s.daily.overall}. Daily trading pays costs on every rotation; compare the before- and after-cost columns. A forward record never activates a strategy by itself. <a href="https://github.com/ang87505-crypto/SportsEdge/blob/main/docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md">Pre-registered rules</a></p>
  </Panel>:null}
  <Panel title="Last recorded source checks" className="mt-8">
   {s.sources.map(x=><p key={x.id}><strong>{x.id}:</strong> {x.status} · {x.retrievedAt}. Last successful read: {x.lastSuccessAt??'none recorded'}.</p>)}
   <p>Source statuses describe the saved observation, not a guarantee that the next run succeeds.</p>
  </Panel>
  <p className="mt-8"><a href={RESEARCH_REPORT_URL}>Full published research report</a> · <a href="https://github.com/ang87505-crypto/SportsEdge/blob/main/research/stock_audit_20261012/protocol.json">Earlier stock protocol</a></p>
 </>;
}
