'use client';

import {useMemo,useState} from 'react';
import {Badge,Empty,Segmented,type Tone} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import {american,dateTimeUtc,pct,usdCents} from '@/lib/format';

export type LedgerPosition={
 id:number;
 selection:string;
 american_odds:number;
 stake_cents:number;
 placed_at:string;
 settlement:{position_id:number;profit_cents:number;outcome:string;settled_at:string}|null;
};
type Filter='all'|'open'|'won'|'lost'|'void';
type Order='recent'|'oldest'|'stake';
const STATUS:Record<Exclude<Filter,'all'>,{label:string;tone:Tone}>={
 open:{label:'Open',tone:'info'},won:{label:'Won',tone:'positive'},lost:{label:'Lost',tone:'negative'},void:{label:'Void',tone:'neutral'}
};
function statusOf(p:LedgerPosition):Exclude<Filter,'all'>{
 const o=p.settlement?.outcome;
 return !p.settlement?'open':o==='won'?'won':o==='lost'?'lost':'void';
}
function implied(odds:number){
 if(!Number.isFinite(odds)||Math.abs(odds)<100)return null;
 return odds>0?100/(odds+100):Math.abs(odds)/(Math.abs(odds)+100);
}

export function PaperLedgerBrowser({positions}:{positions:LedgerPosition[]}){
 const [filter,setFilter]=useState<Filter>('all');
 const [order,setOrder]=useState<Order>('recent');
 const [query,setQuery]=useState('');
 const counts=useMemo(()=>{
  const c={all:positions.length,open:0,won:0,lost:0,void:0};
  for(const p of positions)c[statusOf(p)]++;
  return c;
 },[positions]);
 const filtered=useMemo(()=>{
  const term=query.trim().toLocaleLowerCase('en');
  const entries=positions.filter(p=>(filter==='all'||statusOf(p)===filter)&&(!term||p.selection.toLocaleLowerCase('en').includes(term)));
  return [...entries].sort((a,b)=>{
   if(order==='stake')return Number(b.stake_cents)-Number(a.stake_cents)||a.id-b.id;
   const aTime=Date.parse(a.placed_at),bTime=Date.parse(b.placed_at);
   const delta=(Number.isFinite(aTime)?aTime:0)-(Number.isFinite(bTime)?bTime:0);
   return (order==='recent'?-delta:delta)||a.id-b.id;
  });
 },[filter,order,query,positions]);
 return <section className="panel-v2 is-flush paper-ledger-explorer" aria-labelledby="paper-ledger-title">
  <div className="panel-head">
   <div className="panel-head-copy"><h2 id="paper-ledger-title">Bet history</h2><p>Every recorded virtual bet. Prices are the recorded quotes, not live offers.</p></div>
  </div>
  <div className="ledger-controls">
   <Segmented label="Filter recorded paper bets by status" value={filter} onChange={setFilter} options={[
    {value:'all',label:'All',count:counts.all},{value:'open',label:'Open',count:counts.open},{value:'won',label:'Won',count:counts.won},
    {value:'lost',label:'Lost',count:counts.lost},{value:'void',label:'Void',count:counts.void}]}/>
   <div className="ledger-tools">
    <label className="search-field"><span className="sr-only">Search recorded selections</span><NavIcon name="search" size={15}/>
     <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search a team" aria-label="Search recorded selections"/></label>
    <label className="ledger-sort"><span className="sr-only">Sort recorded paper bets</span>
     <select value={order} onChange={e=>setOrder(e.target.value as Order)} aria-label="Sort recorded paper bets">
      <option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="stake">Largest stake</option>
     </select></label>
   </div>
  </div>
  <div role="status" className="ledger-count">{filtered.length} of {positions.length} recorded bets</div>
  {!filtered.length?<Empty title={positions.length?'No bets match this view':'No paper bets recorded yet'}>
   {positions.length?'Clear the search or choose another status.':'A virtual bet is recorded only when a complete, recent market and a qualifying model estimate exist.'}
  </Empty>:<div className="table-wrap table-scroll"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Selection</th><th scope="col" className="num">Price</th><th scope="col" className="num">Stake</th><th scope="col">Status</th><th scope="col" className="num">Realized P&amp;L</th></tr></thead>
   <tbody>{filtered.map(p=>{
    const s=statusOf(p),profit=p.settlement?Number(p.settlement.profit_cents):null,imp=implied(Number(p.american_odds));
    return <tr key={p.id}>
     <td data-label="Selection"><strong>{p.selection}</strong><small>Recorded {dateTimeUtc(p.placed_at)}</small></td>
     <td data-label="Price" className="num">{american(Number(p.american_odds))}<small>{imp===null?'':`Implied ${pct(imp,1)}`}</small></td>
     <td data-label="Stake" className="num">{usdCents(Number(p.stake_cents))}</td>
     <td data-label="Status"><Badge tone={STATUS[s].tone}>{STATUS[s].label}</Badge>{p.settlement&&<small>Settled {dateTimeUtc(p.settlement.settled_at)}</small>}</td>
     <td data-label="Realized P&L" className={`num ${profit===null?'':profit>0?'tone-text-positive':profit<0?'tone-text-negative':''}`}>{profit===null?<span className="quiet">Awaiting result</span>:usdCents(profit,{signed:true})}</td>
    </tr>;})}</tbody>
  </table></div>}
  <p className="ledger-foot">P&amp;L applies only to settled virtual bets. Open stakes are reserved cash, not losses. Sorting changes the view, not the accounting.</p>
 </section>;
}
