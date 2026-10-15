'use client';
import {useState} from 'react';
type Audit={
 status:'read_only_enumeration';source:'Alpaca Paper API';
 checkedAt:string;pagesRead:number;ordersExamined:number;openOrders:number;
 historyPaginationExhausted:true;accountType:'paper';
 automaticPaperOrdersEnabled:false;realMoneyOrdersEnabled:false;
 safeForExecution:false;receiptDatabaseLinked:false;caveat:string;
};
export function AlpacaPaperReconciliationPanel(){
 const [working,setWorking]=useState(false);
 const [outcome,setOutcome]=useState<Audit|null>(null);
 const [notice,setNotice]=useState('');
 async function inspect(){
  if(working)return;
  setWorking(true);setNotice('');setOutcome(null);
  try{
   const res=await fetch('/api/internal/alpaca-paper/reconciliation',
    {method:'GET',credentials:'same-origin',cache:'no-store'});
   const body:unknown=await res.json();
   if(!res.ok){
    const error=body&&typeof body==='object'&&'reason'in body?
     String((body as {reason?:unknown}).reason):'UNAVAILABLE';
    setNotice(`Read-only reconciliation could not be completed (${error.slice(0,48)}). No broker order was placed and automation stays disabled.`);
    return;
   }
   if(!body||typeof body!=='object'){
    setNotice('Could not verify the broker reconciliation response.');return;
   }
   const a=body as Partial<Audit>;
   if(a.status!=='read_only_enumeration'||a.accountType!=='paper'||
      a.automaticPaperOrdersEnabled!==false||a.safeForExecution!==false||
      a.historyPaginationExhausted!==true||a.receiptDatabaseLinked!==false||
      !Number.isSafeInteger(a.ordersExamined)||!Number.isSafeInteger(a.pagesRead)||
      !Number.isSafeInteger(a.openOrders)||typeof a.checkedAt!=='string'){
    setNotice('Unexpected read-only audit response. No result was accepted.');return;
   }
   setOutcome(a as Audit);
  }catch{
   setNotice('The broker read-only inventory request failed. Your account and orders were not modified.');
  }finally{setWorking(false);}
 }
 return <section className="glass panel" aria-labelledby="paper-order-reconciliation-heading" style={{margin:'24px 0'}}>
  <div className="module-top" style={{marginBottom:14}}>
   <span className="pill">PAPER ACCOUNT / READ-ONLY AUDIT</span>
   <span className="pill pill-amber">No execution</span>
  </div>
  <h2 id="paper-order-reconciliation-heading">Inspect broker order history</h2>
  <p>Check Alpaca PAPER order pages on demand. The usual dashboard displays only 25 recent orders; this audit follows more pages and stops safely if history cannot be fully enumerated within its limits.</p>
  <button type="button" className="button button-secondary" onClick={()=>void inspect()} disabled={working}>
   {working?'Checking history…':'Check paper order history (read-only)'}
  </button>
  <p style={{fontSize:11,marginTop:12}}>This can request several pages from Alpaca. It is not scheduled or refreshed automatically.</p>
  {notice&&<p role="alert" className="notice">{notice}</p>}
  {outcome&&<div role="status" aria-live="polite" style={{marginTop:17}}>
   <div className="stats-grid">
    <div className="glass panel"><span className="eyebrow">ORDERS ENUMERATED</span><h3>{outcome.ordersExamined}</h3></div>
    <div className="glass panel"><span className="eyebrow">ORDER PAGES</span><h3>{outcome.pagesRead}</h3></div>
    <div className="glass panel"><span className="eyebrow">REPORTED OPEN ORDERS</span><h3>{outcome.openOrders}</h3></div>
    <div className="glass panel"><span className="eyebrow">EXECUTION</span><h3>Locked</h3></div>
   </div>
   <p style={{fontSize:11}}>Checked {new Date(outcome.checkedAt).toLocaleString()}. Pagination was exhausted within the safety cap; this is not an atomic broker snapshot.</p>
   <div className="notice"><strong>No trading authorization:</strong> This checks broker inventory only. It does not reconcile staging receipts, verify the algorithm's signals, or release any order; use the separate owner and STOP checks.</div>
  </div>}
 </section>;
}
