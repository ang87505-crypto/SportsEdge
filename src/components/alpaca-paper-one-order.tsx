'use client';
import {useState} from 'react';
import {parseOneOrderCheck,parsePaperPreflight,explainPaperRequestFailure,explainPaperBlocker,
 type PaperPreflightCheck,type SavedPaperStatus} from '@/lib/stocks/alpaca-paper-ui-diagnostics';
const ignore=new Set(['STAGING_EMERGENCY_STOP_ENGAGED',
 'NO_OWNER_APPROVED_EXECUTION_PATH','NO_DURABLE_BROKER_ORDER_RELEASE']);
function parsePrice(x:string){
 if(!/^(?:0?\.[0-9]{1,2}|[1-9][0-9]?(?:\.[0-9]{1,2})?)$/.test(x.trim()))return null;
 const [a,b='']=x.trim().split('.');
 const v=Number(a)*100+Number(b.padEnd(2,'0'));
 return v>=1&&v<=2500?v:null;
}
export function AlpacaPaperOneOrder(){
 const [ticker,setTicker]=useState(''),[price,setPrice]=useState('');
 const [check,setCheck]=useState<PaperPreflightCheck|null>(null),[approved,setApproved]=useState(false);
 const [used,setUsed]=useState(false),[busy,setBusy]=useState(false);
 const [released,setReleased]=useState(false),[state,setState]=useState<SavedPaperStatus|null>(null);
 const [info,setInfo]=useState('');
 const [statusCheckedAt,setStatusCheckedAt]=useState<string|null>(null);
 const limit=parsePrice(price);
 const valid=!!check&&check.quote!==null&&check.marketOpen&&
  check.staging==='HALTED'&&check.blockers.every(b=>ignore.has(b))&&
  check.symbol===ticker&&check.limitCents===limit&&
  released&&state?.gateHalted===true&&state.status==='not_authorized'&&!used;
 function edit(){setCheck(null);setApproved(false);}
 async function refreshStatus(){
  if(busy)return;
  setBusy(true);setInfo('');
  // Every check invalidates the old approval and quote; a stale success is never authority.
  setCheck(null);setApproved(false);
  setReleased(false);setState(null);setStatusCheckedAt(null);
  try{
   const response=await fetch('/api/internal/alpaca-paper/one-order',{
    method:'GET',cache:'no-store',credentials:'same-origin'});
   const body:unknown=await response.json();
   if(!response.ok){
    setInfo(explainPaperRequestFailure(response.status,body,'release'));return;
   }
   const parsed=parseOneOrderCheck(body);
   if(!parsed){
    setInfo('Unexpected release response. The previous result was cleared; trading remains disabled.');
    return;
   }
   setReleased(parsed.oneShotReleaseReady);
   setState(parsed.stage);
   setStatusCheckedAt(new Date().toISOString());
   if(!parsed.oneShotReleaseReady)
    setInfo('This Preview has not released the owner one-order test. No submission is allowed.');
   else if(!parsed.stage.gateHalted||parsed.stage.status!=='not_authorized')
    setInfo('Staging has an existing or unresolved order state. Reconcile before another submission.');
  }catch{
   setInfo('Release/status request failed. Previous results were cleared; submission remains disabled.');
  }finally{setBusy(false);}
 }
 async function preflight(){
  if(limit===null||busy)return;
  edit();setBusy(true);setInfo('');
  try{
   const params=new URLSearchParams({symbol:ticker,limitCents:String(limit)});
   const response=await fetch('/api/internal/alpaca-paper/preflight?'+params,{
    method:'GET',cache:'no-store',credentials:'same-origin'});
   const body:unknown=await response.json();
   if(!response.ok){
    setInfo(explainPaperRequestFailure(response.status,body,'preflight'));return;
   }
   const parsed=parsePaperPreflight(body,ticker,limit);
   if(!parsed){
    setInfo('Unexpected broker preflight response. No order is authorized.');
    return;
   }
   setCheck(parsed);
  }catch{
   setInfo('Read-only broker preflight request failed. No order was sent.');
  }finally{setBusy(false);}
 }
 async function submit(){
  if(!valid||!approved||busy||limit===null)return;
  if(!check||Date.now()-Date.parse(check.checkedAt)>=30000){setInfo('Preview expired. Please check the broker quote again.');edit();return;}
  setUsed(true);setBusy(true);setCheck(null);setApproved(false);setInfo('');
  try{
   const r=await fetch('/api/internal/alpaca-paper/one-order',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({symbol:ticker,limitCents:limit,
     confirm:'SUBMIT_ONE_ALPACA_PAPER_ORDER'})});
   const v:unknown=await r.json();
   if(!v||typeof v!=='object'||Array.isArray(v))throw Error();
   const x=v as Record<string,unknown>;
   setInfo(r.ok&&x.status==='paper_broker_acknowledged'&&x.gateHalted===true?
    'PAPER order accepted by Alpaca. Review its status; acknowledgment does not mean filled.':
    'Submission blocked or uncertain. DO NOT retry. Check staging and Alpaca broker history.');
  }catch{setInfo('Unknown outcome. NEVER retry without reconciling Alpaca history.');}
  finally{
   // Preserve the broker acknowledgment/uncertain-outcome warning for the owner.
   // Invalidate release evidence; require an explicit fresh status reconciliation.
   setBusy(false);setReleased(false);setState(null);setStatusCheckedAt(null);
  }
 }
 return <section className="glass panel" id="alpaca-one-order" style={{margin:'24px 0'}}>
  <div className="module-top"><span className="pill">ALPACA PAPER · ONE ORDER</span>
   <span className="pill pill-amber">Owner authorization required</span></div>
  <h2>Authorize the first simulated stock order</h2>
  <p>One share, BUY LIMIT DAY, with a maximum price of USD 25.00. No real money.
   This is an execution test, not an algorithmic stock recommendation.</p>
  <button className="button button-secondary" type="button" disabled={busy}
   onClick={()=>void refreshStatus()}>Check release and saved order status</button>
  <p>Dedicated one-order release: <strong>{released?'enabled on this Preview':'OFF until verified'}</strong></p>
  <p className="quiet" style={{fontSize:12}}>Release status: {statusCheckedAt?
   'Verified '+new Date(statusCheckedAt).toLocaleString():'Not currently verified'}. A previous successful check is never reused.</p>
  {state&&<p className="notice">Saved staging status: <strong>{state.status}</strong>.
   Emergency STOP {state.gateHalted?'engaged':'NOT engaged'}.
   {state.symbol&&<span> {state.symbol} 1 share; limit USD {(Number(state.limitCents)/100).toFixed(2)}.</span>}</p>}
  <div style={{display:'flex',gap:14,flexWrap:'wrap',margin:'12px 0'}}>
   <label>Ticker
    <input aria-label="Paper ticker" value={ticker} placeholder="F" maxLength={5}
     onChange={e=>{setTicker(e.target.value.trim().toUpperCase());edit();}}
     autoComplete="off" style={{padding:12,display:'block',background:'rgba(15,34,21,.9)',color:'inherit'}}/>
   </label>
   <label>Limit price (USD)
    <input aria-label="Paper limit price" value={price} placeholder="12.50" maxLength={6}
     inputMode="decimal" onChange={e=>{setPrice(e.target.value);edit();}} autoComplete="off"
     style={{padding:12,display:'block',background:'rgba(15,34,21,.9)',color:'inherit'}}/>
   </label>
   <span style={{alignSelf:'end',paddingBottom:10}}>Quantity: 1 virtual share</span>
  </div>
  <button className="button button-secondary" type="button" disabled={busy||
   limit===null||!/^[A-Z]{1,5}$/.test(ticker)} onClick={()=>void preflight()}>
   {busy?'Checking…':'Check broker quote and order safeguards'}</button>
  {check&&<div className="notice" style={{margin:'12px 0'}}>
   <strong>{check.marketOpen?'Paper market clock verified':'Market closed/unverified'}</strong>
   {check.quote?<p>IEX bid USD {(check.quote.bidCents/100).toFixed(2)},
    ask USD {(check.quote.askCents/100).toFixed(2)}.
    Observed {new Date(check.quote.observedAt).toLocaleString()}.</p>:<p>No fresh quote.</p>}
   <p>Safety blockers ({check.blockers.length}):</p>
   {check.blockers.length===0?<p>None reported; other independent order checks still apply.</p>:
    <ul style={{paddingLeft:22,margin:'8px 0'}}>{check.blockers.map(b=><li key={b}>
     <strong>{b}</strong> — {explainPaperBlocker(b)}</li>)}</ul>}
   <p>Expires in 30 seconds; the final authorization independently checks again.</p>
  </div>}
  <label style={{display:'flex',gap:9,alignItems:'start',margin:'14px 0'}}>
   <input type="checkbox" checked={approved} disabled={!valid||busy}
    onChange={e=>setApproved(e.target.checked)}/>
   <span>I specifically authorize ONE Alpaca PAPER buy of {ticker||'the chosen symbol'},
    quantity 1, with limit price USD {(limit??0)/100}. This submits a simulated
    brokerage order, not a real-money trade.</span>
  </label>
  <button className="button" type="button" disabled={!valid||!approved||busy}
   onClick={()=>void submit()}>AUTHORIZE AND SUBMIT ONE PAPER ORDER</button>
  {info&&<p className="notice" role="status">{info}</p>}
  <p style={{fontSize:11}}>One request per approval; never retry after a timeout.
   No scheduler, automated selection, or live brokerage orders are enabled.</p>
 </section>;
}
