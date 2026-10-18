'use client';

import {useMemo,useState} from 'react';
import type {RealizedPoint} from '@/lib/performance-series';
import {LineChart} from '@/components/charts';
import {Evidence,Segmented,Badge} from '@/components/ui';
import {usdCents,pct,shortDate} from '@/lib/format';

type Mode='equity'|'profit'|'drawdown';

/**
 * Realized-only performance. Points are settled or closed events, so the x-axis is the event
 * sequence, not calendar time; pending/open positions never move the line.
 */
export function PerformanceChart({points,heading,description,initialCents,source}:
 {points:RealizedPoint[];heading:string;description:string;initialCents:number;source:string}){
 const [mode,setMode]=useState<Mode>('equity');
 const drawdown=useMemo(()=>{
  const out:number[]=[];
  for(let i=0,peak=-Infinity;i<points.length;i++){peak=Math.max(peak,points[i].equityCents);out.push(peak>0?(points[i].equityCents-peak)/peak:0);}
  return out;
 },[points]);
 if(!points.length)return <section className="glass panel realized-chart-panel" aria-label={heading}>
  <div className="chart-header"><div><h2>{heading}</h2><p>{description}</p></div><Evidence kind="not-measured"/></div>
  <div className="chart-empty"><strong>No settled or closed positions to chart yet.</strong><p>Once events are recorded, this chart traces realized results only. No price or balance history is invented.</p></div>
 </section>;
 const last=points[points.length-1];
 const worst=Math.min(...drawdown);
 const series=mode==='drawdown'
  ?[{id:'dd',label:'Drawdown from peak',color:'var(--neg)',points:points.map((p,i)=>({x:i,y:drawdown[i],note:shortDate(p.at)}))}]
  :[{id:mode,label:mode==='equity'?'Realized balance':'Net realized profit',color:'var(--c1)',points:points.map((p,i)=>({x:i,y:mode==='equity'?p.equityCents:p.profitCents,note:shortDate(p.at)}))}];
 const format=mode==='drawdown'?(v:number)=>pct(v,1):(v:number)=>usdCents(v,{whole:Math.abs(v)>=100000});
 const profitTone=last.profitCents>0?'positive':last.profitCents<0?'negative':'neutral';
 return <section className="glass panel realized-chart-panel" aria-label={heading}>
  <div className="chart-header">
   <div><h2>{heading}</h2><p>{description}</p></div>
   <Segmented label="Chart measure" value={mode} onChange={setMode} options={[{value:'equity',label:'Balance'},{value:'profit',label:'Net profit'},{value:'drawdown',label:'Drawdown'}]}/>
  </div>
  <div className="chart-stat-row">
   <div><small>Realized balance</small><strong>{usdCents(last.equityCents)}</strong><span>Started at {usdCents(initialCents)}</span></div>
   <div><small>Net realized profit</small><strong className={`tone-text-${profitTone}`}>{usdCents(last.profitCents,{signed:true})}</strong><span>{points.length-1} settled or closed event(s)</span></div>
   <div><small>Largest drawdown</small><strong className={worst<0?'tone-text-negative':undefined}>{pct(worst,1)}</strong><span>Peak-to-trough on realized balance</span></div>
  </div>
  <div className="chart-graphic">
   <LineChart series={series} height={220} yFormat={format}
    xFormat={i=>i===0?'Start':`Event ${i}`}
    baseline={mode==='equity'?{y:initialCents,label:'Starting balance'}:mode==='profit'?{y:0,label:'Break-even'}:undefined}
    area={mode==='drawdown'}
    yDomain={mode==='drawdown'?[Math.min(worst*1.15,-0.01),0]:undefined}
    ariaLabel={`${heading}: ${mode==='drawdown'?'drawdown':'realized balance'} across ${points.length-1} event(s), ending at ${usdCents(last.equityCents)}. Not marked to market.`}/>
  </div>
  <p className="chart-source"><Badge tone="neutral">Event sequence, not calendar time</Badge> {source}. Lines connect discrete settlements for readability. This is not a daily equity history, a live valuation, or an audited investment return. Pending and open positions are excluded.</p>
 </section>;
}
