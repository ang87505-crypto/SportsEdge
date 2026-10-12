"use client";
import {useState} from 'react';
import Link from 'next/link';
import {PageHeading,Action} from '@/components/ui';
import {isResearchSnapshot} from '@/lib/dashboard-snapshot';
import {parseOwnerStatus,storedOddsAvailable,type PublicOwnerControlStatus} from '@/lib/connection-readiness';

type Probe='not-checked'|'available'|'unavailable';
type Result={ledger:Probe;odds:Probe;controls:Probe;owner:PublicOwnerControlStatus|null;checkedAt:string|null};
const START:Result={ledger:'not-checked',odds:'not-checked',controls:'not-checked',owner:null,checkedAt:null};
const label=(status:Probe)=>status==='available'?'Read-only check passed':status==='unavailable'?'Unavailable / check failed':'Not checked yet';
async function getResult(path:string,valid:(data:unknown)=>boolean):Promise<Probe>{
 try{
  const response=await fetch(path,{method:'GET',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok)return 'unavailable';
  return valid(await response.json())?'available':'unavailable';
 }catch{return 'unavailable';}
}
export default function Connections(){
 const [result,setResult]=useState<Result>(START);
 const [busy,setBusy]=useState(false);
 const [journal,setJournal]=useState<Probe>('not-checked');
 async function check(){
  if(busy)return;
  setBusy(true);
  try{
   const [ledger,odds,control]=await Promise.all([
    getResult('/api/research',isResearchSnapshot),
    getResult('/api/sports?sport=nba',storedOddsAvailable),
    fetch('/api/paper-control',{method:'GET',cache:'no-store',headers:{Accept:'application/json'}}).then(async r=>r.ok?parseOwnerStatus(await r.json()):null).catch(()=>null)
   ]);
   let local:Probe='unavailable';
   try{if(typeof window.localStorage.getItem('sportsedge-stock-journal-v1')==='string'||window.localStorage.length>=0)local='available';}catch{}
   setJournal(local);
   setResult({ledger,odds,controls:control?'available':'unavailable',owner:control,checkedAt:new Date().toISOString()});
  }finally{setBusy(false);}
 }
 return <>
  <PageHeading eyebrow="PLATFORM CONNECTIONS" title="Know what's working." description="Check the existing saved-data endpoints without requesting paid odds, making a paper bet or placing a stock order." action={<Action href="/guide" secondary>Read the platform guide</Action>}/>
  <section className="glass panel connection-intro">
   <div><span className="pill">READ-ONLY DIAGNOSTICS</span><h2>Check this workspace</h2><p>The check below only reads SportsEdge’s existing endpoints and this browser’s local storage availability. Successful access does not mean prices are fresh or that an algorithm is profitable.</p></div>
   <div><button className="button" disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check connections ↗'}</button>{result.checkedAt&&<small className="quiet">Last checked {new Date(result.checkedAt).toLocaleString()}</small>}</div>
  </section>
  <div className="connection-grid">
   <section className="glass panel"><span className="eyebrow">SPORTS RESEARCH</span><h2>Saved research ledger</h2><p>Loads prior forecasts and simulated results from SportsEdge’s server. No wager is created.</p><span role="status" className={`connection-indicator ${result.ledger}`}>{label(result.ledger)}</span><Link className="text-link" href="/paper-betting">View virtual results →</Link></section>
   <section className="glass panel"><span className="eyebrow">SPORTS ODDS</span><h2>Recorded NBA quotes</h2><p>Checks existing saved observations. It does not contact the sportsbook provider, refresh a quote or establish executable odds.</p><span role="status" className={`connection-indicator ${result.odds}`}>{label(result.odds)}</span><Link className="text-link" href="/sports">View stored games →</Link></section>
   <section className="glass panel"><span className="eyebrow">PAPER CONTROLS</span><h2>Owner control status</h2><p>{result.owner?(result.owner.configured?'Owner configuration detected.':'Owner sign-in is not configured.'):'Checks whether the server can report owner configuration.'} Trading permissions remain separate from data access.</p><span role="status" className={`connection-indicator ${result.controls}`}>{label(result.controls)}{result.owner?' · '+(result.owner.enabled?'Execution flag enabled':'Execution flag off'):''}</span><Link className="text-link" href="/paper-betting">View paper controls →</Link></section>
   <section className="glass panel"><span className="eyebrow">YOUR DEVICE</span><h2>Manual stock journal</h2><p>Stored locally in this browser, not Supabase or Alpaca. Export your entries before clearing browser data.</p><span role="status" className={`connection-indicator ${journal}`}>{label(journal)}</span><Link className="text-link" href="/stocks">Open manual journal →</Link></section>
  </div>
  <section className="glass panel connection-limits">
   <div><h2>Integrations that are not connected</h2><p>Alpaca account balances and orders, a verified stock-trading execution engine, and real-money sportsbook execution do not sync to this website. An external link to Alpaca’s paper dashboard is only a shortcut.</p></div>
   <span className="pill pill-amber">No live brokerage sync</span>
  </section>
 </>;
}
