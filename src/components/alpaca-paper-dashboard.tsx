'use client';

import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Empty,Stat} from '@/components/ui';
import {AlpacaPaperAutomationReadiness} from '@/components/alpaca-paper-automation-readiness';
import {AlpacaPaperReconciliationPanel} from '@/components/alpaca-paper-reconciliation-panel';
import {AlpacaStagingStopPanel} from '@/components/alpaca-staging-stop-panel';
import {AlpacaPaperFirstTestDraft} from '@/components/alpaca-paper-first-test-draft';
import {AlpacaPaperOneOrder} from '@/components/alpaca-paper-one-order';
import {AlpacaPaperPerformanceEvidence} from '@/components/alpaca-paper-performance-evidence';
import {isPaperSnapshot,type PaperSnapshot} from '@/lib/stocks/paper-snapshot';
import {ownerKeyInput,ownerSignInError,OWNER_KEY_HINT} from '@/lib/owner-sign-in';

type ViewStatus='checking'|'login'|'ready'|'unconfigured'|'error';
const fmt=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
function money(value:string) {
  const amount=Number(value);
  return Number.isFinite(amount)?fmt.format(amount):'Unavailable';
}
function date(value:string) {
  const d=new Date(value);
  return Number.isFinite(d.getTime())?d.toLocaleString():'Unavailable';
}
export function AlpacaPaperDashboard() {
  const ownerKeyRef=useRef<HTMLInputElement>(null);
  const [status,setStatus]=useState<ViewStatus>('checking');
  const [snapshot,setSnapshot]=useState<PaperSnapshot|null>(null);
  const [message,setMessage]=useState('');
  const [working,setWorking]=useState(false);
  const refresh=useCallback(async()=>{
    setWorking(true);setMessage('');
    try {
      const response=await fetch('/api/internal/alpaca-paper/view',{method:'GET',cache:'no-store',credentials:'same-origin'});
      const data:unknown=await response.json();
      const state=data&&typeof data==='object'?'status'in data?(data as {status?:unknown}).status:undefined:undefined;
      if(response.status===401&&state==='owner_access_required') {
        setSnapshot(null);setStatus('login');return;
      }
      if(response.status===503&&state==='owner_access_not_configured') {
        setSnapshot(null);setStatus('unconfigured');return;
      }
      if(!response.ok||!isPaperSnapshot(data)) {
        setSnapshot(null);setStatus('error');
        setMessage('Broker snapshot unavailable. Check your private connection diagnostics.');
        return;
      }
      setSnapshot(data);setStatus('ready');
    } catch {
      setSnapshot(null);setStatus('error');setMessage('Could not reach the SportsEdge account viewer.');
    } finally {setWorking(false);}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>{void refresh();},0);return()=>window.clearTimeout(timer);},[refresh]);
  async function signIn(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(working)return;
    const ownerKey=ownerKeyInput(ownerKeyRef.current?.value??'');
    if(!ownerKey){setMessage(OWNER_KEY_HINT);return;}
    if(ownerKeyRef.current)ownerKeyRef.current.value='';
    setWorking(true);setMessage('');
    try {
      const res=await fetch('/api/internal/alpaca-paper/session',{
        method:'POST',headers:{'Content-Type':'application/json'},
        cache:'no-store',credentials:'same-origin',body:JSON.stringify({ownerKey})
      });
      if(!res.ok){
        const data=await res.json().catch(()=>null) as {reason?:unknown}|null;
        setMessage(ownerSignInError(res.status,data?.reason));
        return;
      }
      await refresh();
    } catch {setMessage('Sign-in failed. Please try again.');}
    finally {setWorking(false);}
  }
  async function signOut() {
    setSnapshot(null);setStatus('login');setMessage('');
    try {await fetch('/api/internal/alpaca-paper/session',{method:'DELETE',credentials:'same-origin'});}
    catch{setMessage('Could not confirm sign-out with the server. Close this browser tab.');}
  }
  const restricted=!!snapshot&&(snapshot.account.accountBlocked||snapshot.account.tradingBlocked);
  return <section aria-label="Private Alpaca paper account" className="alpaca-view">
    {status!=='ready'&&<div className="panel-v2 owner-gate" id="owner-access">
      <div className="owner-gate-copy">
        <span className="owner-gate-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 2 2m-4 0 2 2"/></svg></span>
        <div><h2>Owner access</h2><p>Balances, positions and order controls are private. Unlock with the separate SportsEdge dashboard owner key.</p></div>
      </div>
      {status==='checking'&&<p role="status" className="quiet">Checking whether this browser has owner access…</p>}
      {status==='unconfigured'&&<div className="notice" role="status"><strong>Owner sign-in not set up yet.</strong> Add the SportsEdge dashboard owner key to this deployment&apos;s environment in Vercel, then redeploy.</div>}
      {(status==='login'||status==='error')&&<form onSubmit={signIn} className="owner-form" autoComplete="off">
        <label>Private SportsEdge dashboard owner key
          <input type="password" name="ownerKey" ref={ownerKeyRef} autoComplete="off" spellCheck={false} required placeholder="64-character SportsEdge owner key"/>
          <span className="field-hint">{OWNER_KEY_HINT} Surrounding spaces are ignored. The key is never saved in the browser.</span>
        </label>
        <button className="button" type="submit" disabled={working}>{working?'Checking…':'Unlock paper dashboard'}</button>
      </form>}
      {message&&<p role="alert" className="error">{message}</p>}
    </div>}

    {status==='ready'&&snapshot&&<>
      <div className="alpaca-bar">
        <div className="alpaca-bar-status"><span className="status-dot-v2 tone-positive" aria-hidden="true"/><span><strong>Read-only connection verified</strong><small>Snapshot captured {date(snapshot.capturedAt)}. Refresh for current broker values.</small></span></div>
        <div className="button-row">
          <button className="button button-secondary button-sm" disabled={working} onClick={()=>void refresh()}>{working?'Refreshing…':'Refresh snapshot'}</button>
          <button className="button button-ghost button-sm" onClick={()=>void signOut()}>Lock dashboard</button>
        </div>
      </div>
      {message&&<p role="alert" className="error">{message}</p>}
      <div className="stats-grid alpaca-kpis">
        <Stat label="Paper account equity" value={money(snapshot.account.equityUsd)} detail="Broker-reported simulated equity"/>
        <Stat label="Paper cash" value={money(snapshot.account.cashUsd)} detail="Broker-reported simulated cash"/>
        <Stat label="Paper buying power" value={money(snapshot.account.buyingPowerUsd)} detail="Not permission to place orders"/>
        <Stat label="Account status" value={snapshot.account.status} detail={restricted?'Trading restrictions present':'Paper account status only'}/>
      </div>
      {snapshot.warnings.length>0&&<div className="notice" role="status"><strong>Broker reconciliation warnings:</strong> {snapshot.warnings.join('; ')}</div>}

      <nav aria-label="Paper account sections" className="subnav">
        <a href="#paper-positions">Positions</a>
        <a href="#paper-orders">Orders</a>
        <a href="#alpaca-automation-heading">Automation readiness</a>
        <a href="#alpaca-staging-stop-title" className="subnav-stop">Emergency stop</a>
        <a href="#alpaca-one-order">One-order test</a>
        <a href="#alpaca-first-trade-draft">Draft first test</a>
        <a href="#paper-order-reconciliation-heading">Order history</a>
        <a href="#alpaca-performance-evidence">Performance evidence</a>
      </nav>

      <div className="split-1-1">
        <div className="panel-v2 is-flush" id="paper-positions">
          <div className="panel-head"><div className="panel-head-copy"><h2>Current paper positions</h2><p>{snapshot.positions.length} reported by Alpaca PAPER</p></div></div>
          {snapshot.positions.length===0?<Empty title="No paper positions">Alpaca reports no open stock positions in this snapshot.</Empty>:<div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Symbol</th><th scope="col">Side</th><th scope="col" className="num">Quantity</th><th scope="col" className="num">Market value</th></tr></thead><tbody>{snapshot.positions.map(p=><tr key={p.symbol}><th scope="row">{p.symbol}</th><td>{p.side}</td><td className="num">{p.qty}</td><td className="num">{money(p.marketValueUsd)}</td></tr>)}</tbody></table></div>}
        </div>
        <div className="panel-v2 is-flush" id="paper-orders">
          <div className="panel-head"><div className="panel-head-copy"><h2>Recent paper orders</h2><p>Latest {snapshot.recentOrders.length}, not the complete history</p></div></div>
          {snapshot.recentOrders.length===0?<Empty title="No recent paper orders">Alpaca returned no recent orders.</Empty>:<div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Symbol</th><th scope="col">Side</th><th scope="col">Status</th><th scope="col">Submitted</th></tr></thead><tbody>{snapshot.recentOrders.map(o=><tr key={o.id}><th scope="row">{o.symbol}</th><td>{o.side}</td><td><span className={`badge ${o.status==='filled'?'tone-positive':o.status==='rejected'?'tone-negative':o.status==='canceled'||o.status==='expired'?'tone-neutral':'tone-info'}`}>{o.status}</span></td><td>{date(o.createdAt)}</td></tr>)}</tbody></table></div>}
        </div>
      </div>

      <AlpacaPaperAutomationReadiness account={{
        status:snapshot.account.status,
        tradingBlocked:snapshot.account.tradingBlocked,
        accountBlocked:snapshot.account.accountBlocked,
        warnings:snapshot.warnings,
        capturedAt:snapshot.capturedAt,
        positionsCount:snapshot.positions.length,
        orderCount:snapshot.recentOrders.length
      }}/>
      <AlpacaStagingStopPanel/>
      <AlpacaPaperOneOrder/>
      <AlpacaPaperFirstTestDraft/>
      <AlpacaPaperReconciliationPanel/>
      <AlpacaPaperPerformanceEvidence capturedAt={snapshot.capturedAt}
        positionsCount={snapshot.positions.length} recentOrdersCount={snapshot.recentOrders.length}/>
    </>}
    <p className="alpaca-foot">This page reads your paper account. Only the dedicated owner-confirmed one-order test can submit a PAPER order, after independent release gates. No live trading. P&amp;L and strategy performance are never inferred from an account snapshot. <a className="text-link" href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noopener noreferrer">Open the official Alpaca paper dashboard</a></p>
  </section>;
}
