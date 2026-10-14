'use client';

import {useState} from 'react';
import type {RealizedPoint} from '@/lib/performance-series';

type Mode='equity'|'profit';
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
const compact=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
const W=760,H=236,LEFT=67,RIGHT=21,TOP=23,BOTTOM=35;

export function PerformanceChart({points,heading,description,initialCents,source}:
 {points:RealizedPoint[];heading:string;description:string;initialCents:number;source:string}){
 const [mode,setMode]=useState<Mode>('equity');
 const [index,setIndex]=useState<number|null>(null);
 if(!points.length)return <section className="glass panel realized-chart-panel" aria-label={heading}>
  <div className="chart-header"><div><span className="eyebrow">RECORDED PERFORMANCE</span><h2>{heading}</h2><p>{description}</p></div><span className="pill pill-amber">Not measured</span></div>
  <div className="chart-empty"><strong>No settled or closed positions to chart yet.</strong><p>Once events are recorded, the chart will trace actual realized results rather than invent a price or balance history.</p></div>
 </section>;
 const field=mode==='equity'?'equityCents':'profitCents';
 const values=points.map(p=>p[field]);
 const low=Math.min(...values),high=Math.max(...values);
 const extent=Math.max(1,high-low);
 const pad=Math.max(100,Math.ceil(extent*.12));
 const min=low-pad,max=high+pad;
 const x=(i:number)=>LEFT+i*(W-LEFT-RIGHT)/Math.max(1,points.length-1);
 const y=(value:number)=>TOP+(max-value)*(H-TOP-BOTTOM)/(max-min);
 const path=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(2)} ${y(p[field]).toFixed(2)}`).join(' ');
 const selected=Math.min(index??points.length-1,points.length-1);
 const current=points[selected];
 const positive=values.at(-1)!>=values[0];
 const finalValue=values.at(-1)??0;
 const ticks=[0,.5,1].map(f=>({value:min+(max-min)*f,y:y(min+(max-min)*f)}));
 const color=positive?'#a7f5c1':'#edb5a0';
 return <section className="glass panel realized-chart-panel" aria-label={heading}>
  <div className="chart-header">
   <div><span className="eyebrow">REALIZED PERFORMANCE</span><h2>{heading}</h2><p>{description}</p></div>
   <div className="chart-switch" role="group" aria-label="Chart measure">
    <button type="button" aria-pressed={mode==='equity'} onClick={()=>{setMode('equity');setIndex(null);}}>Realized balance</button>
    <button type="button" aria-pressed={mode==='profit'} onClick={()=>{setMode('profit');setIndex(null);}}>Net profit</button>
   </div>
  </div>
  <div className="chart-stat-row">
   <div><small>{mode==='equity'?'Ending realized-only balance':'Cumulative realized profit'}</small><strong style={{color:mode==='profit'?color:undefined}}>{dollars(finalValue)}</strong><span>{points.length-1} settled / closed event(s) · starts at {dollars(initialCents)}</span></div>
   <div className="chart-selected-readout" aria-live="polite"><small>{selected===0?'Opening balance':`Event ${selected} of ${points.length-1}`}</small><strong>{dollars(current[field])}</strong><span>{new Date(current.at).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}</span></div>
  </div>
  <div className="chart-graphic">
   <svg role="img" aria-label={`${heading}: ${mode==='equity'?'realized balance':'cumulative profit'} from ${dollars(values[0])} to ${dollars(finalValue)} over ${points.length-1} event(s). Not marked to market.`}
     viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
    {ticks.map((tick,i)=><g key={i}><line className="chart-gridline" x1={LEFT} x2={W-RIGHT} y1={tick.y} y2={tick.y}/><text className="chart-axis-label" x={LEFT-10} y={tick.y+4} textAnchor="end">{compact(tick.value)}</text></g>)}
    <path d={path} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    <line className="chart-marker-line" x1={x(selected)} x2={x(selected)} y1={TOP} y2={H-BOTTOM}/>
    <circle cx={x(selected)} cy={y(current[field])} r="5" stroke="#0a1c12" strokeWidth="3" fill={color}/>
    <text className="chart-axis-label" x={LEFT} y={H-9}>FIRST EVENT</text>
    <text className="chart-axis-label" x={W-RIGHT} y={H-9} textAnchor="end">LATEST EVENT</text>
   </svg>
  </div>
  <label className="chart-scrubber">Explore recorded outcomes
   <input aria-label="Select recorded performance event" type="range" min={0} max={points.length-1} step={1} value={selected} onChange={event=>setIndex(Number(event.target.value))}/>
  </label>
  <p className="chart-source">{source}. Curve connects discrete recorded events for readability; it is not a daily equity history, live broker valuation, or audited investment return. Pending/open positions are excluded.</p>
 </section>;
}
