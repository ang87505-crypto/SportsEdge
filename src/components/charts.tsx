'use client';

import {useEffect,useMemo,useRef,useState,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';

/*
 * Dependency-free SVG charts sized to their container so text stays crisp.
 * Rules: one y-axis, thin 2px lines, recessive grid, a legend whenever there
 * are two or more series, crosshair + tooltip on hover and arrow keys.
 * Colours come from the validated --c1/--c2/--c3 tokens; status colours are
 * only used where the series itself is a status (e.g. drawdown).
 */

export type ChartPoint={x:number;y:number;note?:string};
/** Serializable format presets so server components can configure client charts. */
export type FormatPreset='pct0'|'pct1'|'usd'|'usdWhole'|'int'|'dec3'|'monthYear'|'shortDate';
export type Formatter=FormatPreset|((v:number)=>string);
const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const usdWhole=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
export function resolveFormat(f:Formatter):(v:number)=>string{
 if(typeof f==='function')return f;
 switch(f){
  case 'pct0':return v=>`${(v*100).toFixed(0)}%`;
  case 'pct1':return v=>`${(v*100).toFixed(1)}%`;
  case 'usd':return v=>usd.format(v/100);
  case 'usdWhole':return v=>usdWhole.format(v/100);
  case 'int':return v=>Math.round(v).toLocaleString('en-US');
  case 'dec3':return v=>v.toFixed(3);
  case 'monthYear':return v=>new Date(v).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
  case 'shortDate':return v=>new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
 }
}
export type ChartSeries={id:string;label:string;color:string;points:ChartPoint[];dashed?:boolean};

function useWidth<T extends HTMLElement>(){
 const ref=useRef<T>(null);
 const [width,setWidth]=useState(0);
 useEffect(()=>{
  const el=ref.current;if(!el)return;
  const ro=new ResizeObserver(entries=>{for(const e of entries)setWidth(Math.floor(e.contentRect.width));});
  ro.observe(el);
  return()=>ro.disconnect();
 },[]);
 return [ref,width] as const;
}

function niceTicks(min:number,max:number,count=4){
 if(!(max>min))return [min];
 const span=max-min,step0=span/count,mag=10**Math.floor(Math.log10(step0));
 const norm=step0/mag,step=(norm>=5?10:norm>=2?5:norm>=1?2:1)*mag;
 const ticks:number[]=[];
 for(let v=Math.ceil(min/step)*step;v<=max+step*1e-9;v+=step)ticks.push(Number(v.toPrecision(12)));
 return ticks;
}

export function Legend({items}:{items:{label:string;color:string;dashed?:boolean}[]}){
 return <ul className="chart-legend">{items.map(i=><li key={i.label}><span className={i.dashed?'legend-swatch is-dashed':'legend-swatch'} style={{['--swatch' as string]:i.color}} aria-hidden="true"/>{i.label}</li>)}</ul>;
}

export function LineChart({series,height=240,yFormat:yF,xFormat:xF,ariaLabel,baseline,area=false,yDomain,gapBreak,emptyText='No data to chart.'}:
 {series:ChartSeries[];height?:number;yFormat:Formatter;xFormat:Formatter;ariaLabel:string;gapBreak?:number;
  baseline?:{y:number;label:string};area?:boolean;yDomain?:[number,number];emptyText?:string}){
 const [ref,width]=useWidth<HTMLDivElement>();
 const [active,setActive]=useState<number|null>(null);
 const yFormat=resolveFormat(yF),xFormat=resolveFormat(xF);
 const primary=series[0]?.points??[];
 const all=useMemo(()=>series.flatMap(s=>s.points),[series]);
 const geometry=useMemo(()=>{
  if(!all.length)return null;
  const xs=all.map(p=>p.x),ys=all.map(p=>p.y);
  if(baseline)ys.push(baseline.y);
  let lo=yDomain?yDomain[0]:Math.min(...ys),hi=yDomain?yDomain[1]:Math.max(...ys);
  if(!yDomain){const pad=Math.max((hi-lo)*0.08,Math.abs(hi)*0.002,1e-9);lo-=pad;hi+=pad;}
  if(hi===lo){hi+=1;lo-=1;}
  return {xMin:Math.min(...xs),xMax:Math.max(...xs),lo,hi,ticks:niceTicks(lo,hi,4).filter(t=>t>=lo&&t<=hi)};
 },[all,baseline,yDomain]);
 if(!geometry||!primary.length)return <div className="chart-empty-inline">{emptyText}</div>;
 const M={top:14,right:series.length>1&&width>520?96:16,bottom:26,left:Math.max(44,Math.min(72,Math.max(...geometry.ticks.map(t=>yFormat(t).length))*7+12))};
 const W=Math.max(width,1),H=height,iw=Math.max(1,W-M.left-M.right),ih=H-M.top-M.bottom;
 const sx=(x:number)=>M.left+(geometry.xMax===geometry.xMin?iw/2:(x-geometry.xMin)/(geometry.xMax-geometry.xMin)*iw);
 const sy=(y:number)=>M.top+(geometry.hi-y)/(geometry.hi-geometry.lo)*ih;
 // A gap wider than gapBreak (in x units) starts a new segment instead of drawing a line through missing data.
 const path=(pts:ChartPoint[])=>pts.map((p,i)=>`${i&&!(gapBreak&&p.x-pts[i-1].x>gapBreak)?'L':'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
 const idx=active===null?null:Math.min(active,primary.length-1);
 const ax=idx===null?null:primary[idx].x;
 const nearest=(pts:ChartPoint[],x:number)=>pts.reduce((b,p)=>Math.abs(p.x-x)<Math.abs(b.x-x)?p:b,pts[0]);
 function move(e:PointerEvent<SVGSVGElement>){
  const r=e.currentTarget.getBoundingClientRect(),px=e.clientX-r.left;
  let best=0,bd=Infinity;
  primary.forEach((p,i)=>{const d=Math.abs(sx(p.x)-px);if(d<bd){bd=d;best=i;}});
  setActive(best);
 }
 function key(e:KeyboardEvent<HTMLDivElement>){
  if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
   e.preventDefault();
   setActive(i=>{const cur=i??(e.key==='ArrowRight'?-1:primary.length);return Math.max(0,Math.min(primary.length-1,cur+(e.key==='ArrowRight'?1:-1)));});
  }
  if(e.key==='Escape')setActive(null);
 }
 const xTicks=primary.length>1?[primary[0].x,primary[Math.floor((primary.length-1)/2)].x,primary[primary.length-1].x]:[primary[0].x];
 const tipLeft=ax===null?0:Math.min(Math.max(sx(ax),90),W-90);
 return <div className="line-chart" ref={ref} tabIndex={0} onKeyDown={key} onBlur={()=>setActive(null)} role="group" aria-label={`${ariaLabel}. Use left and right arrow keys to inspect points.`}>
  {series.length>1&&<Legend items={series.map(s=>({label:s.label,color:s.color,dashed:s.dashed}))}/>}
  <div className="line-chart-plot" style={{height:H}}>
   {width>0&&<svg width={W} height={H} role="img" aria-label={ariaLabel} onPointerMove={move} onPointerLeave={()=>setActive(null)}>
    {geometry.ticks.map(t=><g key={t}><line className="chart-grid" x1={M.left} x2={W-M.right} y1={sy(t)} y2={sy(t)}/><text className="chart-tick" x={M.left-8} y={sy(t)+4} textAnchor="end">{yFormat(t)}</text></g>)}
    {baseline&&<g><line className="chart-baseline" x1={M.left} x2={W-M.right} y1={sy(baseline.y)} y2={sy(baseline.y)}/><text className="chart-tick" x={W-M.right} y={sy(baseline.y)-6} textAnchor="end">{baseline.label}</text></g>}
    {xTicks.map((t,i)=><text key={i} className="chart-tick" x={sx(t)} y={H-7} textAnchor={i===0?'start':i===xTicks.length-1?'end':'middle'}>{xFormat(t)}</text>)}
    {area&&series[0]&&<path d={`${path(series[0].points)} L${sx(series[0].points.at(-1)!.x)} ${sy(Math.max(geometry.lo,Math.min(geometry.hi,baseline?.y??geometry.lo)))} L${sx(series[0].points[0].x)} ${sy(Math.max(geometry.lo,Math.min(geometry.hi,baseline?.y??geometry.lo)))} Z`} fill={series[0].color} opacity={0.1}/>}
    {series.map(s=><path key={s.id} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed?'5 4':undefined}/>)}
    {series.length>1&&width>520&&series.map(s=>{const last=s.points.at(-1);return last?<text key={s.id} className="chart-direct-label" x={sx(last.x)+8} y={sy(last.y)+4}>{s.label}</text>:null;})}
    {series.map(s=>s.points.length===1?<circle key={s.id+'-single'} cx={sx(s.points[0].x)} cy={sy(s.points[0].y)} r={4} fill={s.color}/>:null)}
    {ax!==null&&<g><line className="chart-crosshair" x1={sx(ax)} x2={sx(ax)} y1={M.top} y2={H-M.bottom}/>
     {series.map(s=>{const p=nearest(s.points,ax);return <circle key={s.id} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2}/>;})}</g>}
   </svg>}
   {ax!==null&&<div className="chart-tooltip" style={{left:tipLeft}} role="status">
    <div className="chart-tooltip-x">{xFormat(ax)}</div>
    {series.map(s=>{const p=nearest(s.points,ax);return <div key={s.id} className="chart-tooltip-row"><span className="legend-swatch" style={{['--swatch' as string]:s.color}} aria-hidden="true"/>{series.length>1&&<span>{s.label}</span>}<strong>{yFormat(p.y)}</strong></div>;})}
    {primary[idx!]?.note&&<div className="chart-tooltip-note">{primary[idx!].note}</div>}
   </div>}
  </div>
 </div>;
}

/** Reliability diagram: predicted probability vs observed frequency, with 95% Wilson intervals. */
export type CalibrationBin={lower_bound:number;upper_bound:number;sample_size:number;mean_probability:number;observed_frequency:number;observed_frequency_wilson_95:number[]};
export function CalibrationChart({bins,label}:{bins:CalibrationBin[];label:string}){
 const [ref,width]=useWidth<HTMLDivElement>();
 const [active,setActive]=useState<number|null>(null);
 const W=Math.max(width,1),H=Math.min(320,Math.max(220,W*0.62));
 const M={top:12,right:14,bottom:34,left:44},iw=W-M.left-M.right,ih=H-M.top-M.bottom;
 const sx=(p:number)=>M.left+p*iw,sy=(p:number)=>M.top+(1-p)*ih;
 const maxN=Math.max(...bins.map(b=>b.sample_size));
 const ticks=[0,0.25,0.5,0.75,1];
 const sel=active===null?null:bins[active];
 return <div className="calibration-chart" ref={ref}>
  <Legend items={[{label:'Observed win rate (95% interval)',color:'var(--c1)'},{label:'Perfect calibration',color:'var(--c-ref)',dashed:true}]}/>
  <div className="line-chart-plot" style={{height:H}}>
   {width>0&&<svg width={W} height={H} role="img" aria-label={label}>
    {ticks.map(t=><g key={t}><line className="chart-grid" x1={M.left} x2={W-M.right} y1={sy(t)} y2={sy(t)}/><text className="chart-tick" x={M.left-8} y={sy(t)+4} textAnchor="end">{Math.round(t*100)}%</text><text className="chart-tick" x={sx(t)} y={H-16} textAnchor="middle">{Math.round(t*100)}%</text></g>)}
    <text className="chart-axis-title" x={M.left+iw/2} y={H-2} textAnchor="middle">Model probability for the home team</text>
    <line className="chart-baseline" x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)}/>
    {bins.map((b,i)=>{
     const [lo,hi]=b.observed_frequency_wilson_95;
     const r=3+5*Math.sqrt(b.sample_size/maxN);
     return <g key={i} onPointerEnter={()=>setActive(i)} onPointerLeave={()=>setActive(null)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} tabIndex={0} role="img"
       aria-label={`Predicted ${(b.mean_probability*100).toFixed(1)}%, observed ${(b.observed_frequency*100).toFixed(1)}% across ${b.sample_size} games`}>
      <line x1={sx(b.mean_probability)} x2={sx(b.mean_probability)} y1={sy(lo)} y2={sy(hi)} stroke="var(--c1)" strokeWidth={2} strokeLinecap="round" opacity={0.55}/>
      <circle cx={sx(b.mean_probability)} cy={sy(b.observed_frequency)} r={r} fill="var(--c1)" stroke="var(--surface)" strokeWidth={2}/>
      <rect x={sx(b.mean_probability)-14} y={M.top} width={28} height={ih} fill="transparent"/>
     </g>;
    })}
   </svg>}
   {sel&&<div className="chart-tooltip" style={{left:Math.min(Math.max(sx(sel.mean_probability),90),W-90)}} role="status">
    <div className="chart-tooltip-x">Forecasts {Math.round(sel.lower_bound*100)}–{Math.round(sel.upper_bound*100)}%</div>
    <div className="chart-tooltip-row"><span>Mean forecast</span><strong>{(sel.mean_probability*100).toFixed(1)}%</strong></div>
    <div className="chart-tooltip-row"><span>Home won</span><strong>{(sel.observed_frequency*100).toFixed(1)}%</strong></div>
    <div className="chart-tooltip-row"><span>Games</span><strong>{sel.sample_size.toLocaleString()}</strong></div>
   </div>}
  </div>
 </div>;
}

/** Two bars on one 0–100% scale: model probability vs. market no-vig probability for the same outcome. */
export function ProbabilityCompare({rows,caption}:{rows:{label:string;value:number|null;color:string;detail?:ReactNode}[];caption?:ReactNode}){
 return <div className="prob-compare">
  {rows.map(r=><div className="prob-row" key={r.label}>
   <span className="prob-label">{r.label}</span>
   <div className="prob-track" aria-hidden="true">{r.value!==null&&<span className="prob-fill" style={{width:`${Math.max(0,Math.min(1,r.value))*100}%`,background:r.color}}/>}<span className="prob-mid"/></div>
   <span className="prob-value">{r.value===null?'—':`${(r.value*100).toFixed(1)}%`}</span>
   {r.detail&&<span className="prob-detail">{r.detail}</span>}
  </div>)}
  {caption&&<div className="prob-caption">{caption}</div>}
 </div>;
}

/** Part-to-whole bar with 2px gaps; each segment keeps a text label in the legend. */
export function StackedBar({segments,label}:{segments:{label:string;value:number;color:string}[];label:string}){
 const total=segments.reduce((a,s)=>a+s.value,0);
 return <figure className="stacked">
  <div className="stacked-bar" role="img" aria-label={`${label}: ${segments.map(s=>`${s.label} ${s.value}`).join(', ')}`}>
   {total===0?<span className="stacked-empty"/>:segments.filter(s=>s.value>0).map(s=><span key={s.label} title={`${s.label}: ${s.value}`} style={{flexGrow:s.value,background:s.color}}/>)}
  </div>
  <figcaption><ul className="chart-legend">{segments.map(s=><li key={s.label}><span className="legend-swatch" style={{['--swatch' as string]:s.color}} aria-hidden="true"/>{s.label}<strong>{s.value}</strong></li>)}</ul></figcaption>
 </figure>;
}

/** Paired horizontal bars against a shared scale, e.g. model accuracy vs. a naive baseline per league. */
export function PairedBars({rows,scale,format:f,labels}:{rows:{label:string;a:number;b:number;note?:string}[];scale:[number,number];format:Formatter;labels:[string,string]}){
 const format=resolveFormat(f);
 const w=(v:number)=>`${Math.max(0,Math.min(1,(v-scale[0])/(scale[1]-scale[0])))*100}%`;
 return <div className="paired-bars">
  <Legend items={[{label:labels[0],color:'var(--c1)'},{label:labels[1],color:'var(--c-ref)'}]}/>
  {rows.map(r=><div className="paired-row" key={r.label} title={r.note}>
   <span className="paired-label">{r.label}</span>
   <div className="paired-tracks">
    <div className="paired-track"><span style={{width:w(r.a),background:'var(--c1)'}}/><em>{format(r.a)}</em></div>
    <div className="paired-track is-ref"><span style={{width:w(r.b),background:'var(--c-ref)'}}/><em>{format(r.b)}</em></div>
   </div>
  </div>)}
 </div>;
}
