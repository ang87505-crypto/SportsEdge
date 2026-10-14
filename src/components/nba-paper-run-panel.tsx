'use client';
import {useState} from 'react';
type C={gameId:number;forecastId:number;quoteId:number;selection:string;
 opponent:string;sportsbook:string;americanOdds:number;expectedValue:number;
 modelProbability:number;noVigProbability:number;startsAt:string;
 observedAt:string;ingestedAt:string};
type P={mode:'VIRTUAL_ONLY';scope:'shared_nba_1pct_ledger';checkedAt:string;
 recordedCount:number;freshMarketGroups:number;candidate:C|null;
 realMoneyEnabled:false;automaticRunEnabled:false};
export function NbaPaperRunPanel(){
 const [key,setKey]=useState(''),[busy,setBusy]=useState(false);
 const [preview,setPreview]=useState<P|null>(null),[message,setMessage]=useState('');
 const [receipt,setReceipt]=useState<{positionId:number;selection:string;stakeCents:number}|null>(null);
 async function check(){
  setBusy(true);setPreview(null);setReceipt(null);setMessage('');
  try{
   const response=await fetch('/api/internal/nba-paper/run',{method:'GET',
    cache:'no-store',credentials:'same-origin'});
   const raw:unknown=await response.json();
   if(!response.ok){setMessage(response.status===401?
    'Unlock your private owner session to review candidate bets.':
    'Read-only NBA source/ledger verification is unavailable.');return;}
   if(!raw||typeof raw!=='object'||Array.isArray(raw)){setMessage('Invalid preflight response.');return;}
   const d=raw as Record<string,unknown>;
   if(d.mode!=='VIRTUAL_ONLY'||d.scope!=='shared_nba_1pct_ledger'||
    d.realMoneyEnabled!==false||d.automaticRunEnabled!==false||
    !Number.isSafeInteger(d.recordedCount)||!Number.isSafeInteger(d.freshMarketGroups)||
    (d.candidate!==null&&(!d.candidate||typeof d.candidate!=='object'))){
    setMessage('Preview could not be verified.');return;
   }
   setPreview(d as P);
   if(!d.candidate)setMessage('No qualifying fresh NBA market currently exists; no bet was recorded.');
  }catch{setMessage('Preflight unavailable. No virtual bet recorded.');}
  finally{setBusy(false);}
 }
 async function unlock(){
  if(!key)return;
  setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/internal/alpaca-paper/session',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerKey:key})});
   if(!r.ok){setMessage('Owner key not accepted.');return;}
   setKey('');
   setMessage('Owner session unlocked. You can check eligible NBA bets.');
  }catch{setMessage('Owner access could not be verified.');}
  finally{setBusy(false);}
 }
 async function record(){
  const c=preview?.candidate;if(!c||busy)return;
  setBusy(true);setMessage('');setReceipt(null);
  try{
   const response=await fetch('/api/internal/nba-paper/run',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({confirm:'RECORD_ONE_VIRTUAL_NBA_BET',
     gameId:c.gameId,forecastId:c.forecastId,quoteId:c.quoteId})});
   const raw:unknown=await response.json();
   setPreview(null); // Requires fresh review before any second attempt.
   if(!response.ok){setMessage(response.status===409?
    'The reviewed quote changed, expired, or was already recorded. Check again.':
    'Write result is uncertain. Inspect the ledger before trying again.');return;}
   if(!raw||typeof raw!=='object'||Array.isArray(raw)){setMessage('Receipt invalid; check ledger.');return;}
   const x=raw as Record<string,unknown>;
   if(x.status!=='RECORDED_VIRTUAL_POSITION'||x.realMoneyEnabled!==false||
    !Number.isSafeInteger(x.positionId)||!Number.isSafeInteger(x.stakeCents)||
    x.selection!==c.selection||x.forecastId!==c.forecastId||x.quoteId!==c.quoteId){
    setMessage('Receipt cannot be verified. Inspect the ledger.');return;
   }
   setReceipt({positionId:x.positionId as number,selection:x.selection as string,
    stakeCents:x.stakeCents as number});
   setMessage('One virtual paper position recorded. No sportsbook order was sent.');
  }catch{setPreview(null);setMessage('Uncertain save outcome. Inspect the ledger; do not blindly retry.');}
  finally{setBusy(false);}
 }
 return <section className="glass panel" aria-labelledby="nba-paper-run-once" style={{margin:'22px 0'}}>
  <div className="module-top"><span className="pill">VIRTUAL NBA RESEARCH</span><span className="pill pill-amber">One bet per approval</span></div>
  <h2 id="nba-paper-run-once">Review and record a virtual NBA bet</h2>
  <p>Only model-qualified moneylines with a complete, recent two-way sportsbook market can be recorded. This is the existing shared 1%-stake ledger, not the separate 100 × $10 study. No real wagers.</p>
  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end',marginTop:12}}>
   <label style={{display:'grid',gap:6}}><span className="eyebrow">PRIVATE DASHBOARD OWNER KEY</span>
    <input aria-label="Private owner key" type="password" autoComplete="off" value={key}
     onChange={e=>setKey(e.target.value)} placeholder="Owner key" spellCheck={false}
     style={{padding:12,borderRadius:8,maxWidth:260,color:'inherit',background:'rgba(15,34,21,.9)'}}/>
   </label>
   <button type="button" className="button button-secondary" disabled={busy||!key} onClick={()=>void unlock()}>Unlock owner access</button>
   <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check eligible NBA picks'}</button>
  </div>
  {message&&<p role="status" className="notice" style={{marginTop:12}}>{message}</p>}
  {preview&&<div className="notice" style={{marginTop:12}}>
   <p>Saved positions: {preview.recordedCount}. Fresh complete sportsbook markets: {preview.freshMarketGroups}.
    Checked: {new Date(preview.checkedAt).toLocaleString()}.</p>
   {preview.candidate?<div>
    <h3>{preview.candidate.selection} vs. {preview.candidate.opponent}</h3>
    <p>Odds: {preview.candidate.americanOdds>0?'+':''}{preview.candidate.americanOdds} at {preview.candidate.sportsbook}.
     Model estimated EV: {(preview.candidate.expectedValue*100).toFixed(1)}%.
     Probability: {(preview.candidate.modelProbability*100).toFixed(1)}%.</p>
    <p>Quote recorded {new Date(preview.candidate.observedAt).toLocaleString()}.
     Game scheduled {new Date(preview.candidate.startsAt).toLocaleString()}.</p>
    <button className="button" type="button" disabled={busy} onClick={()=>void record()}>
     Confirm and record ONE virtual bet</button>
   </div>:<p>No eligible model-and-odds pairing is available. No position will be created.</p>}
  </div>}
  {receipt&&<div className="notice">
   <strong>Virtual receipt #{receipt.positionId}</strong> — {receipt.selection},
   {' $'}{(receipt.stakeCents/100).toFixed(2)} in simulated stake.
   <button type="button" className="button button-secondary" onClick={()=>window.location.reload()}>Refresh account ledger</button>
  </div>}
  <p style={{fontSize:11,marginTop:10}}>Read-only market review does not call an odds provider. Saved odds are not a guaranteed executable offer. There is no scheduled betting or real-money connection.</p>
 </section>;
}
