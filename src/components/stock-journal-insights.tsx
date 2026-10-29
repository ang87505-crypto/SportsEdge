'use client';

import {useMemo} from 'react';
import Link from 'next/link';
import {PerformanceChart} from '@/components/performance-chart';
import {realizedSeries} from '@/lib/performance-series';
import {INITIAL_CENTS,type Journal} from '@/lib/stocks/journal';

const cash=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

export function StockJournalInsights({journal,invalid}:{journal:Journal;invalid:boolean}){
 const events=useMemo(()=>journal.trades.filter(t=>t.exitCents!==undefined&&t.closedAt).map(t=>({
  id:t.id,at:t.closedAt!,profitCents:(t.exitCents!-t.entryCents)*t.shares
 })),[journal]);
 const points=useMemo(()=>{
  if(invalid)return [];
  try{return realizedSeries(INITIAL_CENTS,events);}catch{return [];}
 },[events,invalid]);
 const closed=journal.trades.filter(t=>t.exitCents!==undefined);
 const winners=closed.filter(t=>(t.exitCents??0)>t.entryCents).length;
 const losers=closed.filter(t=>(t.exitCents??0)<t.entryCents).length;
 const volume=closed.reduce((sum,t)=>sum+t.shares*t.entryCents,0);
 const realized=closed.reduce((sum,t)=>sum+(t.exitCents!-t.entryCents)*t.shares,0);
 return <section className="stock-insights" aria-labelledby="journal-insights-heading">
  <div className="section-header"><div><h2 id="journal-insights-heading">How your closed trades added up</h2><p>Realized outcomes from trades you closed. Open positions are not valued.</p></div></div>
  <div className="metric-grid cols-4 journal-insight-kpis">
   <div className="metric"><span className="metric-label">Closed trades</span><strong className="metric-value">{invalid?'—':closed.length}</strong><span className="metric-detail">Manual entries and exits</span></div>
   <div className="metric"><span className="metric-label">Winning / losing</span><strong className="metric-value">{invalid?'—':`${winners} / ${losers}`}</strong><span className="metric-detail">Flat closes excluded</span></div>
   <div className="metric"><span className="metric-label">Realized P&amp;L</span><strong className="metric-value">{invalid?'Unavailable':cash(realized)}</strong><span className="metric-detail">Before unrecorded costs</span></div>
   <div className="metric"><span className="metric-label">Closed entry notional</span><strong className="metric-value">{invalid?'Unavailable':cash(volume)}</strong><span className="metric-detail">Not live market value</span></div>
  </div>
  <PerformanceChart
   points={points}
   heading="Manual trade outcomes"
   description="Realized balance after each practice trade you closed."
   initialCents={INITIAL_CENTS}
   source="Source: entries and exits in your browser-local stock journal"
  />
  <p className="journal-insight-footer">This journal is not your Alpaca account and not the frozen stock strategy. <Link className="text-link" href="/stocks/research">See the stock research status</Link></p>
 </section>;
}
