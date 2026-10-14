'use client';
import {useState} from 'react';
type Saved={
 intentId:string;environment:'SportsEdge Staging';status:'planned';accountKind:'paper';
 symbol:string;shares:1;limitCents:number;approved:false;
 executionPermitted:false;brokerCalls:0;gateHalted:true;
};
function parseCents(input:string):number|null{
 const s=input.trim();
 if(!/^(?:0?\.[0-9]{1,2}|[1-9][0-9]?(?:\.[0-9]{1,2})?)$/.test(s))return null;
 const [whole,fraction='']=s.split('.');
 const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return cents>=1&&cents<=2500?cents:null;
}
export function AlpacaPaperFirstTestDraft(){
 const [symbol,setSymbol]=useState('');
 const [price,setPrice]=useState('');
 const [working,setWorking]=useState(false);
 const [result,setResult]=useState<Saved|null>(null);
 const [message,setMessage]=useState('');
 const priceCents=parseCents(price);
 const valid=/^[A-Z]{1,5}$/.test(symbol)&&priceCents!==null;
 async function save(){
  if(!valid||priceCents===null||working)return;
  setWorking(true);setResult(null);setMessage('');
  try{
   const res=await fetch('/api/internal/alpaca-paper/draft',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({symbol,shares:1,limitCents:priceCents})
   });
   const raw:unknown=await res.json();
   if(!res.ok){
    setMessage(res.status===401?'Owner session expired. Unlock the private dashboard again.':
     'The staging draft service is unavailable. No Alpaca order was sent. If the request timed out, do not automatically retry; check staging records first.');
    return;
   }
   if(!raw||typeof raw!=='object'||!('draft'in raw)){
    setMessage('Unexpected response: draft could not be confirmed.');return;
   }
   const d=(raw as {draft:unknown}).draft;
   if(!d||typeof d!=='object'){setMessage('Unverified staging draft response.');return;}
   const a=d as Record<string,unknown>;
   if(a.status!=='planned'||a.environment!=='SportsEdge Staging'||
     a.accountKind!=='paper'||a.symbol!==symbol||a.shares!==1||
     a.limitCents!==priceCents||a.approved!==false||a.executionPermitted!==false||
     a.brokerCalls!==0||a.gateHalted!==true||
     typeof a.intentId!=='string'||!/^preview-[a-f0-9]{32}$/.test(a.intentId)){
    setMessage('Draft response was not verified. No order is authorized.');return;
   }
   setResult(a as Saved);
   setMessage('A draft was saved in the locked staging database. It is NOT an approved or submitted trade.');
  }catch{
   setMessage('Staging response was unavailable; the result is uncertain. Do not blindly retry. No broker order is authorized.');
  }finally{setWorking(false);}
 }
 return <section className="glass panel" id="alpaca-first-trade-draft" aria-labelledby="alpaca-first-trade-heading" style={{margin:'24px 0'}}>
  <div className="module-top" style={{marginBottom:14}}>
   <span className="pill">ONE-TRADE TEST / STAGING ONLY</span>
   <span className="pill pill-amber">Not an order</span>
  </div>
  <h2 id="alpaca-first-trade-heading">Prepare your first paper-trade test</h2>
  <p>Save an unapproved test ticket for one share at a maximum limit price of $25.00. This is a manual planning record—not a market quote, signal, approval, purchase, or automatically scheduled trade.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:14,marginTop:18}}>
   <label style={{display:'grid',gap:7,minWidth:130}}>
    <span className="eyebrow">STOCK TICKER</span>
    <input aria-label="Ticker symbol for test draft" value={symbol} maxLength={5}
     onChange={e=>setSymbol(e.target.value.trim().toUpperCase())} placeholder="F"
     autoComplete="off" style={{padding:12,borderRadius:9,color:'inherit',
      background:'rgba(15,34,21,.9)',border:'1px solid rgba(165,233,185,.26)'}}/>
   </label>
   <label style={{display:'grid',gap:7,minWidth:130}}>
    <span className="eyebrow">LIMIT PRICE IN USD</span>
    <input aria-label="Maximum share price for test draft" value={price} maxLength={6}
     onChange={e=>setPrice(e.target.value)} placeholder="12.50"
     inputMode="decimal" autoComplete="off" style={{padding:12,borderRadius:9,color:'inherit',
      background:'rgba(15,34,21,.9)',border:'1px solid rgba(165,233,185,.26)'}}/>
   </label>
   <div style={{display:'grid',gap:7,alignContent:'end'}}>
    <span className="eyebrow">QUANTITY</span><strong style={{fontSize:20,padding:'10px 0'}}>1 virtual share</strong>
   </div>
  </div>
  <p style={{fontSize:11,marginTop:12}}>This form does not check real-time prices or whether a ticker is tradeable. Invalid ticker or price details are rejected. The staging emergency STOP stays active.</p>
  <button type="button" className="button button-secondary" disabled={!valid||working}
   onClick={()=>void save()}>{working?'Saving…':'Save unapproved staging draft'}</button>
  {message&&<p className="notice" role="status" style={{marginTop:15}}>{message}</p>}
  {result&&<div className="notice" style={{marginTop:12}}>
    <strong>Staging draft saved:</strong> {result.symbol}, 1 share, limit ${(result.limitCents/100).toFixed(2)}.
    No Alpaca order exists because of this action. No approval was recorded.
   </div>}
 </section>;
}
