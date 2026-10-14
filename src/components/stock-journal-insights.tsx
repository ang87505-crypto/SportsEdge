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
  <div className="section-title">
   <div><div className="eyebrow">VIRTUAL JOURNAL INSIGHTS</div><h2 id="journal-insights-heading">See how your recorded decisions added up.</h2></div>
   <span className="pill">Local browser data</span>
  </div>
  <div className="journal-insight-kpis">
   <div><span>Closed journal trades</span><strong>{invalid?'—':closed.length}</strong><small>Manual entries and exits only</small></div>
   <div><span>Winning / losing closes</span><strong>{invalid?'—':`${winners} / ${losers}`}</strong><small>Flat outcomes excluded</small></div>
   <div><span>Realized profit / loss</span><strong>{invalid?'Unavailable':cash(realized)}</strong><small>Before any unrecorded costs</small></div>
   <div><span>Closed-trade entry notional</span><strong>{invalid?'Unavailable':cash(volume)}</strong><small>Not lifetime volume or live market value</small></div>
  </div>
  <PerformanceChart
   points={points}
   heading="Manual trade outcomes"
   description="Explore what happened when you closed recorded practice trades. This curve does not value open positions."
   initialCents={INITIAL_CENTS}
   source="Source: entries and exits in your browser-local stock journal"
  />
  <p className="journal-insight-footer">Your manual journal is not your Alpaca account and not the frozen stock algorithm. <Link href="/stocks/research">Check the actual stock research status ↗</Link></p>
 </section>;
}
