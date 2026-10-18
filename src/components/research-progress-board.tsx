'use client';

import {useState} from 'react';
import Link from 'next/link';

export type ProgressRecord={
 id:string;group:'Stocks'|'Sports'|'Platform';title:string;state:'Registered'|'Measured'|'Available'|'In review'|'Not verified'|'Not enabled';
 description:string;next:string;href:string;source:string;
};
const filters=['All','Stocks','Sports','Platform'] as const;
type Filter=typeof filters[number];

export function ResearchProgressBoard({records}:{records:ProgressRecord[]}){
 const [filter,setFilter]=useState<Filter>('All');
 const visible=records.filter(x=>filter==='All'||x.group===filter);
 return <section className="progress-workflow-board" aria-labelledby="progress-board-heading">
  <div className="section-header progress-board-top"><div><h2 id="progress-board-heading">Tracks and gates</h2><p>{visible.length} tracked item(s). Filter by area.</p></div></div>
  <div className="progress-filters" role="group" aria-label="Filter project milestones">
   {filters.map(f=><button key={f} type="button" onClick={()=>setFilter(f)} aria-pressed={filter===f}>{f}{f==='All'?<span>{records.length}</span>:<span>{records.filter(r=>r.group===f).length}</span>}</button>)}
  </div>
  <div className="progress-card-grid" aria-live="polite">
   {visible.map(item=><article className="glass progress-record" key={item.id}>
    <div className="progress-record-top"><span>{item.group}</span><span className={`progress-record-state ${item.state==='Not verified'||item.state==='Not enabled'?'is-blocked':item.state==='In review'?'is-review':'is-ready'}`}>{item.state}</span></div>
    <h3>{item.title}</h3><p>{item.description}</p>
    <div className="progress-next"><span>Next evidence required</span><p>{item.next}</p></div>
    <div className="progress-record-foot"><span>{item.source}</span><Link href={item.href} className="text-link">Open</Link></div>
   </article>)}
  </div>
 </section>;
}
