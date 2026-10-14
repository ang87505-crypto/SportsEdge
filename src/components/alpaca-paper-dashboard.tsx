'use client';

import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Empty,Stat} from '@/components/ui';
import {AlpacaPaperAutomationReadiness} from '@/components/alpaca-paper-automation-readiness';
import {AlpacaPaperReconciliationPanel} from '@/components/alpaca-paper-reconciliation-panel';

type PaperSnapshot={
  state:'READ_ONLY_DIAGNOSTIC_NOT_EXECUTION_AUTHORIZATION';
  readOnly:true;
  automaticPaperOrdersEnabled:false;
  accountType:'paper';
  capturedAt:string;
  account:{
    status:string;
    cashUsd:string;
    equityUsd:string;
    portfolioValueUsd:string;
    buyingPowerUsd:string;
    tradingBlocked:boolean;
    accountBlocked:boolean;
  };
  positions:Array<{symbol:string;side:'long'|'short';qty:string;marketValueUsd:string}>;
  recentOrders:Array<{id:string;symbol:string;side:string;status:string;createdAt:string}>;
  warnings:string[];
};
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
function isPaperSnapshot(data:unknown):data is PaperSnapshot {
  if(!data||typeof data!=='object')return false;
  const x=data as Record<string,unknown>;
  return x.accountType==='paper'&&x.readOnly===true&&
    x.automaticPaperOrdersEnabled===false&&
    x.state==='READ_ONLY_DIAGNOSTIC_NOT_EXECUTION_AUTHORIZATION'&&
    !!x.account&&typeof x.account==='object'&&Array.isArray(x.positions)&&
    Array.isArray(x.recentOrders)&&Array.isArray(x.warnings);
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
    const ownerKey=ownerKeyRef.current?.value??'';
    if(ownerKeyRef.current)ownerKeyRef.current.value='';
    setWorking(true);setMessage('');
    try {
      const res=await fetch('/api/internal/alpaca-paper/session',{
        method:'POST',headers:{'Content-Type':'application/json'},
        cache:'no-store',credentials:'same-origin',body:JSON.stringify({ownerKey})
      });
      if(!res.ok){
        setMessage(res.status===401
          ? 'This key does not match the owner key in this Preview deployment. If you edited the Vercel Preview variable, deploy again and paste that exact 64-character key. Do not use your Alpaca or diagnostic keys.'
          : res.status===503
            ? 'Owner access is not configured in this Preview build. Check the variable name, 64-character hex value and Preview/branch scope, then deploy again.'
            : res.status===403
              ? 'Preview sign-in was blocked by an origin check. Open the exact Vercel Preview site rather than another domain.'
              : 'Owner access is temporarily unavailable. Check the protected Preview deployment.');
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
  return <section aria-label="Private Alpaca paper account">
    <div className="glass panel">
      <div className="module-top">
        <span className="pill">Alpaca · Paper account</span>
        <span className="pill pill-amber">Read-only · No trading</span>
      </div>
      <h2>Private paper trading overview</h2>
      <p>Broker-reported virtual balances and recent activity. Not the same as your manual practice journal or a historical backtest.</p>
      {status==='checking'&&<p role="status">Checking whether this browser has owner access…</p>}
      {status==='unconfigured'&&<div className="notice" role="status"><strong>Owner sign-in not set up yet.</strong> Add the separate dashboard owner key to the Preview environment in Vercel. Alpaca broker keys never belong in your browser.</div>}
      {(status==='login'||status==='error')&&<form onSubmit={signIn} className="form-grid" autoComplete="off">
        <label>Private SportsEdge dashboard owner key
          <input type="password" name="ownerKey" ref={ownerKeyRef} minLength={64} maxLength={64} autoComplete="off" spellCheck={false} required placeholder="64-character owner key"/>
        </label>
        <div className="full"><button className="button" type="submit" disabled={working}>{working?'Checking…':'Unlock paper dashboard'}</button></div>
        <p className="full" style={{fontSize:12}}>Use only the separate dashboard owner key, not your Alpaca credentials, Vercel bypass or SportsEdge diagnostic read token. The key is used for this request only, not saved in browser storage.</p>
      </form>}
      {message&&<p role="alert" className="error">{message}</p>}
      {status==='ready'&&snapshot&&<>
        <div className="button-row" style={{margin:'16px 0 19px'}}>
          <span className="pill">Paper connection verified</span>
          <button className="button button-secondary" disabled={working} onClick={()=>void refresh()}>{working?'Refreshing…':'Refresh snapshot ↻'}</button>
          <button className="button button-secondary" onClick={()=>void signOut()}>Lock dashboard</button>
        </div>
        <div className="stats-grid">
          <Stat label="Paper account equity" value={money(snapshot.account.equityUsd)} detail="Broker-reported simulated equity"/>
          <Stat label="Paper cash" value={money(snapshot.account.cashUsd)} detail="Broker-reported simulated cash"/>
          <Stat label="Paper buying power" value={money(snapshot.account.buyingPowerUsd)} detail="Not permission to place orders"/>
          <Stat label="Account status" value={snapshot.account.status} detail={snapshot.account.accountBlocked||snapshot.account.tradingBlocked?'Trading restrictions present':'Paper account status only'}/>
        </div>
        <p style={{fontSize:11,marginTop:14}}>Snapshot captured {date(snapshot.capturedAt)}. Refresh manually for current broker values. This is not a live price feed or performance claim.</p>
        {snapshot.warnings.length>0&&<div className="notice" role="status"><strong>Broker reconciliation warnings:</strong> {snapshot.warnings.join(' · ')}</div>}
        <AlpacaPaperAutomationReadiness account={{
          status:snapshot.account.status,
          tradingBlocked:snapshot.account.tradingBlocked,
          accountBlocked:snapshot.account.accountBlocked,
          warnings:snapshot.warnings,
          capturedAt:snapshot.capturedAt,
          positionsCount:snapshot.positions.length,
          orderCount:snapshot.recentOrders.length
        }}/>
        <AlpacaPaperReconciliationPanel/>
        <div className="section-title"><h2>Current paper positions</h2><span className="pill">{snapshot.positions.length} reported</span></div>
        {snapshot.positions.length===0?<Empty title="No paper positions">Alpaca reports no open stock positions in this snapshot.</Empty>:<div className="table-wrap"><table className="data-table"><thead><tr><th>Symbol</th><th>Side</th><th>Quantity</th><th>Market value</th></tr></thead><tbody>{snapshot.positions.map(p=><tr key={p.symbol}><td>{p.symbol}</td><td>{p.side}</td><td>{p.qty}</td><td>{money(p.marketValueUsd)}</td></tr>)}</tbody></table></div>}
        <div className="section-title"><h2>Recent paper orders</h2><span className="pill">Latest {snapshot.recentOrders.length}, not complete history</span></div>
        {snapshot.recentOrders.length===0?<Empty title="No recent paper orders">Alpaca returned no recent orders.</Empty>:<div className="table-wrap"><table className="data-table"><thead><tr><th>Symbol</th><th>Side</th><th>Order status</th><th>Submitted</th></tr></thead><tbody>{snapshot.recentOrders.map(o=><tr key={o.id}><td>{o.symbol}</td><td>{o.side}</td><td>{o.status}</td><td>{date(o.createdAt)}</td></tr>)}</tbody></table></div>}
      </>}
      <div className="button-row" style={{marginTop:24}}>
        <a href="https://app.alpaca.markets/paper/dashboard/overview" className="button button-secondary" target="_blank" rel="noopener noreferrer">Open official Alpaca paper dashboard ↗</a>
      </div>
      <p style={{fontSize:12,marginBottom:0}}>This page can only read your paper account. SportsEdge cannot submit, modify, or cancel Alpaca orders here. No live trading. P&amp;L and strategy performance are deliberately not inferred from an account snapshot.</p>
    </div>
  </section>;
}
