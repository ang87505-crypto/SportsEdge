'use client';
import {useState} from 'react';
type Saved={
 intentId:string;environment:'SportsEdge Staging';status:'planned';accountKind:'paper';
 symbol:string;shares:1;limitCents:number;approved:false;
 executionPermitted:false;brokerCalls:0;gateHalted:true;
};
type PaperPreflight={
 status:'READ_ONLY_PREFLIGHT';environment:'Alpaca PAPER';symbol:string;shares:1;
 limitCents:number;checkedAt:string;marketOpen:boolean;
 quote:null|{feed:'iex';bidCents:number;askCents:number;observedAt:string};
 blockers:string[];staging:'HALTED'|'UNAVAILABLE';completedBrokerOrderPages:number;
 brokerOrderSubmitted:false;ownerApproved:false;executionPermitted:false;
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
 const [drafts,setDrafts]=useState<Array<{intentId:string;symbol:string;shares:1;limitCents:number;status:'planned';createdAt:string}>|null>(null);
 const [reviewMessage,setReviewMessage]=useState('');
 const [reviewing,setReviewing]=useState(false);
 const [preflightBusy,setPreflightBusy]=useState(false);
 const [preflight,setPreflight]=useState<PaperPreflight|null>(null);
 const [preflightMessage,setPreflightMessage]=useState('');
 const priceCents=parseCents(price);
 const valid=/^[A-Z]{1,5}$/.test(symbol)&&priceCents!==null;
 async function runPreflight(){
  if(!valid||priceCents===null||preflightBusy)return;
  setPreflightBusy(true);setPreflight(null);setPreflightMessage('');
  try{
   const params=new URLSearchParams({symbol,limitCents:String(priceCents)});
   const res=await fetch('/api/internal/alpaca-paper/preflight?'+params,{
    method:'GET',cache:'no-store',credentials:'same-origin'});
   const data:unknown=await res.json();
   if(!res.ok){
    setPreflightMessage(res.status===401?'Owner session expired. Unlock your private dashboard.':
     'Read-only Alpaca preflight is unavailable or market evidence could not be verified. No order has been placed.');
    return;
   }
   if(!data||typeof data!=='object'||Array.isArray(data)){
    setPreflightMessage('Invalid read-only preflight report.');return;
   }
   const x=data as Record<string,unknown>;
   if(x.status!=='READ_ONLY_PREFLIGHT'||x.environment!=='Alpaca PAPER'||
     x.symbol!==symbol||x.shares!==1||x.limitCents!==priceCents||
     x.brokerOrderSubmitted!==false||x.ownerApproved!==false||
     x.executionPermitted!==false||!Array.isArray(x.blockers)||
     !x.blockers.every(v=>typeof v==='string'&&v.length<=100)){
    setPreflightMessage('Preflight could not be verified. No order is authorized.');return;
   }
   setPreflight(x as PaperPreflight);
  }catch{
   setPreflightMessage('Preflight response unavailable. Nothing was submitted to Alpaca.');
  }finally{setPreflightBusy(false);}
 }
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
 async function inspectSaved(){
  if(reviewing)return;
  setReviewing(true);setReviewMessage('');
  try{
   const res=await fetch('/api/internal/alpaca-paper/drafts',{
    method:'GET',credentials:'same-origin',cache:'no-store'});
   const raw:unknown=await res.json();
   if(!res.ok){
    setDrafts(null);
    setReviewMessage(res.status===401?'Owner session expired. Unlock the dashboard again.':
     'Cannot verify saved drafts from staging. Do not assume a timed-out save failed or retry it blindly.');
    return;
   }
   if(!raw||typeof raw!=='object'||!('data'in raw)){
    setDrafts(null);setReviewMessage('Unable to verify staging inventory.');return;
   }
   const d=(raw as {data:unknown}).data;
   if(!d||typeof d!=='object'||Array.isArray(d)){
    setDrafts(null);setReviewMessage('Invalid staging inventory.');return;
   }
   const x=d as Record<string,unknown>;
   if(x.environment!=='SportsEdge Staging'||x.accountKind!=='paper'||
      x.gateHalted!==true||x.executionPermitted!==false||
      x.brokerCalls!==0||!Array.isArray(x.drafts)||x.drafts.length>20){
    setDrafts(null);setReviewMessage('Staging is not verifiably halted.');return;
   }
   setDrafts(x.drafts as Array<{intentId:string;symbol:string;shares:1;limitCents:number;status:'planned';createdAt:string}>);
   setReviewMessage('Read-only staging records verified. No broker order was submitted.');
  }catch{
   setDrafts(null);setReviewMessage('Could not inspect staging drafts. The storage result remains unknown.');
  }finally{setReviewing(false);}
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
     onChange={e=>{setSymbol(e.target.value.trim().toUpperCase());setPreflight(null);}} placeholder="F"
     autoComplete="off" style={{padding:12,borderRadius:9,color:'inherit',
      background:'rgba(15,34,21,.9)',border:'1px solid rgba(165,233,185,.26)'}}/>
   </label>
   <label style={{display:'grid',gap:7,minWidth:130}}>
    <span className="eyebrow">LIMIT PRICE IN USD</span>
    <input aria-label="Maximum share price for test draft" value={price} maxLength={6}
     onChange={e=>{setPrice(e.target.value);setPreflight(null);}} placeholder="12.50"
     inputMode="decimal" autoComplete="off" style={{padding:12,borderRadius:9,color:'inherit',
      background:'rgba(15,34,21,.9)',border:'1px solid rgba(165,233,185,.26)'}}/>
   </label>
   <div style={{display:'grid',gap:7,alignContent:'end'}}>
    <span className="eyebrow">QUANTITY</span><strong style={{fontSize:20,padding:'10px 0'}}>1 virtual share</strong>
   </div>
  </div>
  <p style={{fontSize:11,marginTop:12}}>This form does not check real-time prices or whether a ticker is tradeable. Invalid ticker or price details are rejected. The staging emergency STOP stays active.</p>
  <div style={{margin:'16px 0',padding:16,border:'1px solid rgba(165,233,185,.22)',borderRadius:12}}>
   <h3>Read-only Alpaca PAPER order preflight</h3>
   <p>Inspect Alpaca market clock, IEX quote, equity eligibility, virtual account and complete order history. This checks a proposed one-share test; it does not approve or send an order. A market-data or staging connection failure blocks the test.</p>
   <button type="button" className="button button-secondary" disabled={!valid||preflightBusy}
    onClick={()=>void runPreflight()}>{preflightBusy?'Checking paper account…':'Check Alpaca PAPER preflight'}</button>
   {preflightMessage&&<p className="notice" role="status">{preflightMessage}</p>}
   {preflight&&preflight.symbol===symbol&&preflight.limitCents===priceCents&&
    <div className="notice" role="status" style={{marginTop:12}}>
     <strong>{preflight.marketOpen?'Market clock verified open':'Market currently closed or unverified'}</strong>
     <p>Checked: {new Date(preflight.checkedAt).toLocaleString()}. Broker order submissions: 0. Owner approval: not granted.</p>
     {preflight.quote&&<p>IEX-only bid: USD {(preflight.quote.bidCents/100).toFixed(2)}; ask: USD {(preflight.quote.askCents/100).toFixed(2)}. Quote time: {new Date(preflight.quote.observedAt).toLocaleString()}.</p>}
     <p><strong>Execution blocked:</strong> {preflight.blockers.join(' · ')}</p>
     <p style={{fontSize:11}}>IEX quotes may not reflect the best price across all exchanges. This result expires quickly and is not a persistent approval.</p>
    </div>}
  </div>
  <button type="button" className="button button-secondary" disabled={!valid||working}
   onClick={()=>void save()}>{working?'Saving…':'Save unapproved staging draft'}</button>
  {message&&<p className="notice" role="status" style={{marginTop:15}}>{message}</p>}
  {result&&<div className="notice" style={{marginTop:12}}>
    <strong>Staging draft saved:</strong> {result.symbol}, 1 share, limit ${(result.limitCents/100).toFixed(2)}.
    No Alpaca order exists because of this action. No approval was recorded.
   </div>}
  <div style={{marginTop:16}}>
   <button type="button" className="button button-secondary" disabled={reviewing} onClick={()=>void inspectSaved()}>
    {reviewing?'Checking…':'Review saved staging drafts'}
   </button>
   <p style={{fontSize:11,marginTop:8}}>Use this to inspect stored draft IDs after an uncertain save. This checks the staging database only; it does not query Alpaca or approve a trade.</p>
   {reviewMessage&&<p className="notice" role="status">{reviewMessage}</p>}
   {drafts&&<div>
    <p>{drafts.length} unapproved staging draft{drafts.length===1?'':'s'} recorded (maximum 20). Execution is HALTED.</p>
    {drafts.length>0&&<div className="table-wrap"><table className="data-table">
     <thead><tr><th>Draft ID</th><th>Ticker</th><th>Quantity</th><th>Limit</th><th>Saved</th></tr></thead>
     <tbody>{drafts.map(d=><tr key={d.intentId}>
      <td><code>{d.intentId}</code></td><td>{d.symbol}</td><td>1 virtual share</td>
      <td>USD {(d.limitCents/100).toFixed(2)}</td><td>{new Date(d.createdAt).toLocaleString()}</td>
     </tr>)}</tbody>
    </table></div>}
   </div>}
  </div>
 </section>;
}
