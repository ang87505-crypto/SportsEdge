'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Badge,Empty,StatusDot,type Tone} from '@/components/ui';
import {headline,latestPicks,overall,strategy,type AutopilotRelease} from '@/lib/stocks/autopilot-view';
import type {PaperAutoLedger} from '@/lib/stocks/paper-auto-ledger';
import {ownerHintPresent} from '@/lib/owner-hint';

type Line={name:string;label:string;tone:Tone;picks:string[];session:string|null};
type Summary={state:'owner';label:string;tone:Tone;practice:boolean;lines:Line[]}|
 {state:'signed-out'}|{state:'unavailable'};
const CACHE='sportsedge-autopilot-summary-v2';
const tone=(t:string):Tone=>t==='positive'?'positive':t==='warning'?'warning':t==='info'?'info':'neutral';

/** Owner-only read of the autopilot; anyone else gets 'signed-out' and sees nothing private. */
async function readSummary(fresh=false):Promise<Summary>{
 try{
  const cached=sessionStorage.getItem(CACHE);
  if(cached&&!fresh){const c=JSON.parse(cached) as {at:number;s:Summary};if(Date.now()-c.at<60_000)return c.s;}
 }catch{/* storage unavailable: read fresh */}
 // Visitors without an owner session hint never call the owner-only API (no 401 on every page view).
 if(!ownerHintPresent(document.cookie))return {state:'signed-out'};
 let s:Summary;
 try{
  const res=await fetch('/api/internal/paper-auto',{cache:'no-store',credentials:'same-origin'});
  if(res.status===401)s={state:'signed-out'};
  else{
   const data=await res.json() as {status?:string;release?:AutopilotRelease;experiments?:PaperAutoLedger[]};
   const ls=data.status==='ok'?(data.experiments??[]).filter(e=>e.registered):[];
   if(!res.ok||!ls.length||typeof data.release?.brokerWritesEnabled!=='boolean'||typeof data.release?.scheduledRunsEnabled!=='boolean')s={state:'unavailable'};
   else{
    const release=data.release;
    const hs=ls.map(l=>headline(l,release));
    const lines=ls.map((l,k)=>{const p=latestPicks(l);
     return {name:strategy(l.status.modelVersion).name,label:hs[k].label,tone:tone(hs[k].tone),picks:p?.targets??[],
      session:p?.session??null};});
    const o=overall(hs);
    s={state:'owner',label:o.label,tone:tone(o.tone),practice:release.brokerWritesEnabled!==true,lines};
   }
  }
 }catch{s={state:'unavailable'};}
 try{sessionStorage.setItem(CACHE,JSON.stringify({at:Date.now(),s}));}catch{/* optional cache */}
 return s;
}
function useSummary(autoRefresh=false){
 const [s,setS]=useState<Summary|null>(null);
 useEffect(()=>{
  let live=true;
  const refresh=()=>{if(document.visibilityState==='visible')void readSummary(autoRefresh).then(x=>{if(live)setS(x);});};
  refresh();
  const timer=autoRefresh?window.setInterval(refresh,60_000):null;
  if(autoRefresh)document.addEventListener('visibilitychange',refresh);
  return()=>{live=false;if(timer)window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[autoRefresh]);
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
export function AutopilotSummary({autoRefresh=false}:{autoRefresh?:boolean}){
 const s=useSummary(autoRefresh);
 if(!s)return <p className="quiet" aria-busy="true">Checking the autopilot…</p>;
 if(s.state==='signed-out')return <Empty title="Owner only" action={<Link className="button button-secondary" href="/stocks/paper-auto">Sign in</Link>}>
  Sign in as the owner to see and control the autopilot.</Empty>;
 if(s.state==='unavailable')return <Empty title="Not connected" action={<Link className="button button-secondary" href="/stocks/paper-auto">Open Autopilot</Link>}>
  The autopilot isn&apos;t connected on this deployment yet.</Empty>;
 return <div className="autopilot-summary">
  <div className="autopilot-summary-head"><StatusDot tone={s.tone}/><strong>{s.label}</strong>
   {s.practice&&<Badge tone="warning">Orders off</Badge>}</div>
  <p className="quiet">{s.practice?'Next step: release paper orders, then use Start to check the account.':'Use the Autopilot page for Start, Pause and Stop.'}</p>
  <ul className="autopilot-summary-lines">{s.lines.map(x=><li key={x.name}>
   {s.lines.length>1&&<><StatusDot tone={x.tone}/><strong>{x.name}</strong> · {x.label}: </>}
   <span className="quiet">{x.picks.length?`${s.lines.length>1?'p':'P'}icks for ${x.session}: ${x.picks.join(', ')}`:
    `${s.lines.length>1?'n':'N'}o picks yet; the next weekly pick is Monday at 8:00 AM ET.`}</span>
  </li>)}</ul>
  <Link className="button" href="/stocks/paper-auto">Open Autopilot</Link>
 </div>;
}
