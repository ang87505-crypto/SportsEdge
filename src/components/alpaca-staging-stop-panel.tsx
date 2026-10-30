'use client';
import {useState} from 'react';
type Stage={
 environment:'SportsEdge Staging';accountKind:'paper';halted:true;
 gateConfigured:boolean;storedIntentCount:number;unresolvedReceiptCount:number;
 haltAuditEvents:number;executionPermitted:false;
 automaticOrdersEnabled:false;realMoneyOrdersEnabled:false;
};
function valid(data:unknown):data is Stage{
 if(!data||typeof data!=='object')return false;
 const x=data as Record<string,unknown>;
 return x.environment==='SportsEdge Staging'&&x.accountKind==='paper'&&
  x.halted===true&&x.executionPermitted===false&&
  x.automaticOrdersEnabled===false&&x.realMoneyOrdersEnabled===false&&
  typeof x.gateConfigured==='boolean'&&
  ['storedIntentCount','unresolvedReceiptCount','haltAuditEvents']
   .every(k=>Number.isSafeInteger(x[k])&&(x[k] as number)>=0);
}
export function AlpacaStagingStopPanel(){
 const [working,setWorking]=useState(false);
 const [stage,setStage]=useState<Stage|null>(null);
 const [notice,setNotice]=useState('');
 async function run(action:'inspect'|'halt'){
  if(working)return;
  setWorking(true);setNotice('');
  try{
   const res=await fetch('/api/internal/alpaca-paper/staging',{
    method:action==='halt'?'POST':'GET',credentials:'same-origin',cache:'no-store',
    ...(action==='halt'?{headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'halt'})}:{})
   });
   const payload:unknown=await res.json();
   if(!res.ok){setStage(null);setNotice(res.status===401?
    'Private owner session expired. Unlock the paper dashboard again.':
    'The staging stop service is not connected or is unavailable. Broker order submission remains disabled.');return;}
   if(!payload||typeof payload!=='object'||!('data'in payload)||
      !valid((payload as {data:unknown}).data)){
    setStage(null);setNotice('Staging did not return an independently verifiable HALTED status.');return;
   }
   const verified=(payload as {data:Stage}).data;
   setStage(verified);
   setNotice(action==='halt'?'A new staging emergency HALT was recorded. This did not contact Alpaca.':
    'Private staging control status verified; this is not a trading-system release.');
  }catch{
   setStage(null);setNotice('Could not reach staging controls. Broker order submission remains disabled.');
  }finally{setWorking(false);}
 }
 return <section className="glass panel" aria-labelledby="alpaca-staging-stop-title" style={{margin:'24px 0'}}>
  <div className="module-top" style={{marginBottom:14}}>
   <span className="pill">STAGING DATABASE / OWNER-ONLY</span><span className="pill pill-amber">HALTED BY DESIGN</span>
  </div>
  <h2 id="alpaca-staging-stop-title">Paper automation emergency stop</h2>
  <p>Inspect the separate SportsEdge Staging receipt database, or record another one-way STOP. This does not start, submit, or cancel Alpaca orders. A separate owner-confirmed one-order path may use the staging gate only after independent checks; recurring automation remains disabled.</p>
  <div className="button-row" style={{marginTop:15}}>
   <button type="button" className="button button-secondary" disabled={working} onClick={()=>void run('inspect')}>
    {working?'Checking…':'Check staging safety status'}
   </button>
   <button type="button" className="button button-secondary" disabled={working}
    onClick={()=>void run('halt')}>Record staging emergency STOP</button>
  </div>
  {notice&&<p role="status" className="notice" style={{marginTop:16}}>{notice}</p>}
  {stage&&<div style={{marginTop:16}}>
   <div className="stats-grid">
    <div className="glass panel"><span className="eyebrow">EXECUTION GATE</span><h3>HALTED</h3></div>
    <div className="glass panel"><span className="eyebrow">STAGING INTENTS</span><h3>{stage.storedIntentCount}</h3></div>
    <div className="glass panel"><span className="eyebrow">UNRESOLVED RECEIPTS</span><h3>{stage.unresolvedReceiptCount}</h3></div>
    <div className="glass panel"><span className="eyebrow">STOP AUDIT EVENTS</span><h3>{stage.haltAuditEvents}</h3></div>
   </div>
   <p style={{fontSize:11}}>Only staging controls are shown. This is the staging gate status at the time of inspection; it is not proof of future scheduler or broker cancellation controls.</p>
  </div>}
  <p style={{fontSize:11,marginTop:15}}>If the protected Preview has not been configured with a separate staging service credential, this panel remains unavailable and defaults to a non-trading state. Never paste database credentials into the browser.</p>
 </section>;
}
