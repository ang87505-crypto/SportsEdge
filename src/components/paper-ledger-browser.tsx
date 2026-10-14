'use client';

import {useMemo,useState} from 'react';
import {Empty} from '@/components/ui';

export type LedgerPosition={
 id:number;
 selection:string;
 american_odds:number;
 stake_cents:number;
 placed_at:string;
 settlement:{position_id:number;profit_cents:number;outcome:string;settled_at:string}|null;
};
type Filter='all'|'pending'|'settled';
type Order='recent'|'oldest';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const date=(stamp:string)=>{
 const d=new Date(stamp);
 return Number.isFinite(d.getTime())?d.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':'Unknown';
};
export function PaperLedgerBrowser({positions}:{positions:LedgerPosition[]}){
 const [filter,setFilter]=useState<Filter>('all');
 const [order,setOrder]=useState<Order>('recent');
 const [query,setQuery]=useState('');
 const pending=positions.filter(p=>p.settlement===null).length;
 const settled=positions.length-pending;
 const filtered=useMemo(()=>{
  const term=query.trim().toLocaleLowerCase('en');
  const entries=positions.filter(p=>{
   if(filter==='pending'&&p.settlement!==null)return false;
   if(filter==='settled'&&p.settlement===null)return false;
   return !term||p.selection.toLocaleLowerCase('en').includes(term);
  });
  return [...entries].sort((a,b)=>{
   const aTime=Date.parse(a.placed_at),bTime=Date.parse(b.placed_at);
   const delta=(Number.isFinite(aTime)?aTime:0)-(Number.isFinite(bTime)?bTime:0);
   return (order==='recent'?-delta:delta)||a.id-b.id;
  });
 },[filter,order,query,positions]);
 return <section className="glass paper-ledger-explorer" aria-labelledby="paper-ledger-title">
  <div className="paper-ledger-intro">
   <div><div className="eyebrow">RECORDED PAPER ACTIVITY</div><h2 id="paper-ledger-title">Every recorded decision, with context.</h2><p>Filter the shared NBA practice ledger. These are recorded research entries, not real wagers or real-time offers.</p></div>
   <span className="pill">Virtual-money records</span>
  </div>
  <div className="paper-ledger-controls">
   <div className="paper-ledger-tabs" role="group" aria-label="Filter recorded paper bets">
    <button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All <span>{positions.length}</span></button>
    <button type="button" aria-pressed={filter==='pending'} onClick={()=>setFilter('pending')}>Pending <span>{pending}</span></button>
    <button type="button" aria-pressed={filter==='settled'} onClick={()=>setFilter('settled')}>Settled <span>{settled}</span></button>
   </div>
   <div className="paper-ledger-tools">
    <label>Find a team or selection <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search recorded selections…" aria-label="Search recorded selections"/></label>
    <label>Order <select value={order} onChange={e=>setOrder(e.target.value as Order)} aria-label="Sort recorded paper bets"><option value="recent">Newest first</option><option value="oldest">Oldest first</option></select></label>
   </div>
  </div>
  <div role="status" className="paper-ledger-count">{filtered.length} matching records · {positions.length} total recorded positions</div>
  {!filtered.length?<Empty title={positions.length?'No recorded bets match this view':'No paper bets recorded yet'}>
   {positions.length?'Try another selection, or switch between pending and settled results.':'Complete, recent market observations and qualifying model estimates are required before a virtual bet is recorded.'}
  </Empty>:<div className="table-wrap"><table className="data-table">
   <thead><tr><th scope="col">Selection</th><th scope="col">Recorded price</th><th scope="col">Virtual stake</th><th scope="col">State</th><th scope="col">Realized P&amp;L</th></tr></thead>
   <tbody>{filtered.map(p=><tr key={p.id}>
    <td><strong>{p.selection}</strong><small>Recorded {date(p.placed_at)}</small></td>
    <td>{p.american_odds>0?'+':''}{p.american_odds}</td>
    <td>{money(Number(p.stake_cents))}</td>
    <td><span className={p.settlement?'pill':'pill pill-amber'}>{p.settlement?.outcome??'Pending'}</span>{p.settlement&&<small>Settled {date(p.settlement.settled_at)}</small>}</td>
    <td>{p.settlement?money(Number(p.settlement.profit_cents)):'Awaiting result'}</td>
   </tr>)}</tbody>
  </table></div>}
  <p className="paper-ledger-foot">Profit and loss applies only to settled virtual positions. Sorting changes the table, not the accounting, and pending stakes are not realized losses.</p>
 </section>;
}
