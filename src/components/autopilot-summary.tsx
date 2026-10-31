'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Badge,Empty,StatusDot,type Tone} from '@/components/ui';
import {headline,latestPicks} from '@/lib/stocks/autopilot-view';
import type {PaperAutoLedger} from '@/lib/stocks/paper-auto-ledger';

type Summary={state:'owner';label:string;tone:Tone;practice:boolean;picks:string[];session:string|null}|
 {state:'signed-out'}|{state:'unavailable'};
const CACHE='sportsedge-autopilot-summary';

/** Owner-only read of the autopilot; anyone else gets 'signed-out' and sees nothing private. */
async function readSummary():Promise<Summary>{
 try{
  const cached=sessionStorage.getItem(CACHE);
  if(cached){const c=JSON.parse(cached) as {at:number;s:Summary};if(Date.now()-c.at<60_000)return c.s;}
 }catch{/* storage unavailable: read fresh */}
 let s:Summary;
 try{
  const res=await fetch('/api/internal/paper-auto',{cache:'no-store',credentials:'same-origin'});
  if(res.status===401)s={state:'signed-out'};
  else{
   const data=await res.json() as {status?:string;release?:{brokerWritesEnabled?:boolean};experiments?:PaperAutoLedger[]};
   const l=data.status==='ok'?data.experiments?.find(e=>e.registered):undefined;
   if(!l)s={state:'unavailable'};
   else{
    const h=headline(l),p=latestPicks(l);
    s={state:'owner',label:h.label,tone:h.tone==='positive'?'positive':h.tone==='warning'?'warning':h.tone==='info'?'info':'neutral',
     practice:data.release?.brokerWritesEnabled!==true,picks:p?.targets??[],session:p?.session??null};
   }
  }
 }catch{s={state:'unavailable'};}
 try{sessionStorage.setItem(CACHE,JSON.stringify({at:Date.now(),s}));}catch{/* optional cache */}
 return s;
}
function useSummary(){
 const [s,setS]=useState<Summary|null>(null);
 useEffect(()=>{let live=true;void readSummary().then(x=>{if(live)setS(x);});return()=>{live=false;};},[]);
 return s;
}

/** Top-bar pill: visible only to the signed-in owner, links to the Autopilot page. */
export function AutopilotBadge(){
 const s=useSummary();
 if(!s||s.state!=='owner')return null;
 return <Link href="/stocks/paper-auto" className="autopilot-pill" title="Open Autopilot">
  <StatusDot tone={s.tone}/>Autopilot: {s.label}</Link>;
}

/** Card for the Stocks page: status, this week's picks and a way in. */
export function AutopilotSummary(){
 const s=useSummary();
 if(!s)return <p className="quiet" aria-busy="true">Checking the autopilot…</p>;
 if(s.state==='signed-out')return <Empty title="Owner only" action={<Link className="button button-secondary" href="/stocks/paper-auto">Sign in</Link>}>
  Sign in as the owner to see and control the autopilot.</Empty>;
 if(s.state==='unavailable')return <Empty title="Not connected" action={<Link className="button button-secondary" href="/stocks/paper-auto">Open Autopilot</Link>}>
  The autopilot isn&apos;t connected on this deployment yet.</Empty>;
 return <div className="autopilot-summary">
  <div className="autopilot-summary-head"><StatusDot tone={s.tone}/><strong>{s.label}</strong>
   {s.practice&&<Badge tone="warning">Practice mode</Badge>}</div>
  <p className="quiet">{s.picks.length?`Picks for ${s.session}: ${s.picks.join(', ')}`:'No picks yet; the next weekly pick is Monday at 8:00 AM ET.'}</p>
  <Link className="button" href="/stocks/paper-auto">Open Autopilot</Link>
 </div>;
}
