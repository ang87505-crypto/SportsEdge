'use client';
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import type {Card,Reply} from '@/lib/assistant/answer';
import type {AssistantContext} from '@/lib/assistant/understand';
import {currentOwnerAccess} from '@/lib/assistant/session';
import {chatActionRequest} from '@/lib/assistant/actions';

type Mode='language-model'|'tools'|'assistant';
type Msg={role:'user'|'bot';text:string;cards?:Card[];private?:boolean;suggestions?:string[];mode?:Mode;sig?:string};
type ToolCall={tool:string;input:Record<string,unknown>};
const MODE_LABEL:Record<Mode,string>={'language-model':'AI model over SportsEdge records','tools':'SportsEdge records (built-in planner)','assistant':'SportsEdge records (built-in answers)'};
type Access={ownerAccess:boolean;ownerExpiresAt:number|null};
const STARTERS=["Tonight's picks",'Stock results','Research results','Is everything running?'];
const OPENING:Msg={role:'bot',text:'Ask about sports picks, stock paper accounts, research results, or automation.',suggestions:STARTERS};
const NO_ACCESS:Access={ownerAccess:false,ownerExpiresAt:null};

/** Lets any button on the page ask the conversation a question (the homepage summary strip uses it). */
export const ASK_EVENT='sportsedge:ask';
export function AskButton({question,className,children}:{question:string;className?:string;children:ReactNode}){
 return <button type="button" className={className} onClick={()=>window.dispatchEvent(new CustomEvent(ASK_EVENT,{detail:question}))}>{children}</button>;
}

/** One conversation. Private replies are ephemeral and hidden whenever owner access is uncertain. */
/** `endpoint='/api/command'` adds multi-turn history, references to earlier answers and (if the owner enabled it) an AI model. */
export function AssistantChat({starters,intro,endpoint='/api/assistant'}:{starters?:string[];intro?:string;endpoint?:'/api/assistant'|'/api/command'}={}){
 const opening:Msg=starters?{role:'bot',text:intro??OPENING.text,suggestions:starters}:OPENING;
 const [msgs,setMsgs]=useState<Msg[]>([opening]);
 const [context,setContext]=useState<AssistantContext|null>(null);
 const [lastCalls,setLastCalls]=useState<ToolCall[]>([]);
 const [input,setInput]=useState(''),[busy,setBusy]=useState(false);
 const [access,setAccess]=useState<Access>(NO_ACCESS),[checking,setChecking]=useState(true);
 const end=useRef<HTMLDivElement>(null),lastAsked=useRef(''),follow=useRef(false),owner=useRef(false);
 const requestId=useRef(0);
 function applyAccess(a:Access){
  const valid=currentOwnerAccess(a).ownerAccess;
  if(!valid&&owner.current){
   // A reply authorized before logout must not resurrect private content afterward.
   requestId.current++;setBusy(false);setMsgs(m=>m.filter(x=>!x.private));setContext(null);setLastCalls([]);
  }
  owner.current=valid;setAccess(valid?a:NO_ACCESS);
 }
 useEffect(()=>{
  // Remove the old sports-only browser cache; private replies are never persisted.
  try{sessionStorage.removeItem('sportsedge-assistant-v1');}catch{/* optional browser storage */}
  let live=true;
  async function check(){
   if(document.visibilityState==='hidden')return;
   setChecking(true);
   try{const res=await fetch('/api/assistant',{cache:'no-store'});const a=await res.json();
    if(live)applyAccess(res.ok&&typeof a.ownerAccess==='boolean'?a:NO_ACCESS);
   }catch{if(live)applyAccess(NO_ACCESS);}
   finally{if(live)setChecking(false);}
  }
  void check();
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  return()=>{live=false;window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
 },[]);
 useEffect(()=>{
  if(!access.ownerAccess||!access.ownerExpiresAt)return;
  const timer=setTimeout(()=>applyAccess(NO_ACCESS),Math.max(0,access.ownerExpiresAt-Date.now()));
  return()=>clearTimeout(timer);
 },[access.ownerAccess,access.ownerExpiresAt]);
 useEffect(()=>{if(follow.current)end.current?.scrollIntoView({block:'nearest'});},[msgs,busy]);
 const sendRef=useRef<(q:string)=>void>(()=>{});
 useEffect(()=>{sendRef.current=q=>void send(q);});
 useEffect(()=>{
  const on=(e:Event)=>{const q=(e as CustomEvent<string>).detail;if(typeof q==='string')sendRef.current(q);};
  window.addEventListener(ASK_EVENT,on);return()=>window.removeEventListener(ASK_EVENT,on);
 },[]);
 async function send(raw:string){
  const text=(raw==='Try again'?lastAsked.current:raw).trim().slice(0,300);
  if(!text||busy)return;
  const id=++requestId.current;
  lastAsked.current=text;follow.current=true;
  setMsgs(m=>[...m,{role:'user' as const,text}].slice(-40));setInput('');setBusy(true);
  try{
   const command=endpoint==='/api/command';
   // Bounded history so follow-ups can refer back; private replies are only sent while owner access is valid.
   const history=msgs.filter(m=>m!==opening&&(!m.private||owner.current)).slice(-10).map(m=>({role:m.role==='user'?'user':'assistant',text:m.text.slice(0,1500),...(m.role==='bot'&&m.sig?{sig:m.sig}:{})}));
   const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(command?{message:text,history,session:{context,last:lastCalls}}:{message:text,context})});
   if(res.status===429){if(id===requestId.current)setMsgs(m=>[...m,{role:'bot',text:'Too many questions in a minute. Wait a moment and try again.',suggestions:['Try again']}]);return;}
   const data=await res.json().catch(()=>null) as {reply?:Reply;mode?:Mode;sig?:string;session?:{last?:ToolCall[]};ownerAccess?:boolean;ownerExpiresAt?:number|null}|null;
   if(id!==requestId.current)return;
   if(res.ok&&data?.reply){
    const valid=currentOwnerAccess(data).ownerAccess;
    applyAccess({ownerAccess:valid,ownerExpiresAt:valid?data.ownerExpiresAt!:null});setChecking(false);
    const r=data.reply;
    if(r.private&&!valid){setMsgs(m=>[...m,{role:'bot',text:'Your owner session expired. Sign in on the Paper account page and ask again.'}]);setContext(null);}
    else {
     setMsgs(m=>[...m.map((x,i)=>i===m.length-1?{...x,private:r.private}:x),{role:'bot' as const,text:r.text,cards:r.cards,suggestions:r.suggestions,private:r.private,mode:data.mode,sig:typeof data.sig==='string'&&/^[0-9a-f]{64}$/.test(data.sig)?data.sig:undefined}].slice(-40));
     setContext(r.context);setLastCalls(Array.isArray(data.session?.last)?data.session!.last!.slice(0,4):[]);
    }
   }else setMsgs(m=>[...m,{role:'bot',text:'Try a shorter question or choose a topic.',suggestions:STARTERS}]);
  }catch{if(id===requestId.current)setMsgs(m=>[...m,{role:'bot',text:'I cannot reach the server right now.',suggestions:['Try again']}]);}
  finally{if(id===requestId.current)setBusy(false);}
 }
 function submit(e:FormEvent){e.preventDefault();void send(input);}
 function reset(){requestId.current++;setBusy(false);setMsgs([opening]);setContext(null);setLastCalls([]);}
 const last=msgs[msgs.length-1];
 return <div className="chat">
  <div className="chat-chips" role="group" aria-label="Chat topics">
   {STARTERS.map((s,i)=><button key={s} type="button" className="chat-chip" disabled={busy} onClick={()=>void send(s)}>{['Sports','Stocks','Research','All systems'][i]}</button>)}
  </div>
  <p className="quiet small-print">{checking?'Checking owner access…':access.ownerAccess?'Owner stock access is active for this tab.':'Stock account details require owner sign-in.'} <a href="/stocks/alpaca">Paper account / sign in</a></p>
  <div className="chat-thread" role="log" aria-live="polite" aria-label="Conversation">
   {msgs.map((m,i)=><div key={i} className={`chat-msg ${m.role}`}>
    {m.private&&(checking||!access.ownerAccess)?<p>Private stock reply hidden. Sign in to view account details.</p>:<>
     <p style={{whiteSpace:'pre-line'}}>{m.text}</p>
     {m.mode&&<p className="chat-source quiet small-print">Answered from: {MODE_LABEL[m.mode]}</p>}
     {m.cards?.map((c,j)=><ChatCard key={j} card={c} owner={access.ownerAccess&&!checking}/>)}
    </>}
   </div>)}
   {busy&&<div className="chat-msg bot pending"><p>Reading the records…</p></div>}
   <div ref={end}/>
  </div>
  {!busy&&last?.role==='bot'&&last.suggestions?.length?<div className="chat-chips" role="group" aria-label="Suggestions">
   {last.suggestions.map(s=><button key={s} type="button" className="chat-chip" onClick={()=>void send(s)}>{s}</button>)}
  </div>:null}
  <form className="chat-form" onSubmit={submit}>
   <label className="sr-only" htmlFor="chat-input">Ask SportsEdge</label>
   <input id="chat-input" value={input} onChange={e=>setInput(e.target.value)} maxLength={300} autoComplete="off" placeholder="Ask about sports, stocks, research…"/>
   <button type="submit" className="button" disabled={busy||!input.trim()}>Send</button>
   <button type="button" className="button button-secondary" onClick={reset}>New chat</button>
  </form>
  <p className="quiet small-print">{msgs.some(m=>m.mode==='language-model')
   ?'Answers use recorded evidence. Some answers in this chat were written by an AI model from read-only SportsEdge records (owner-enabled, budget-capped); tables and links come from the records themselves.'
   :'Answers use recorded evidence: SportsEdge reads its own records with built-in read-only tools; no external AI model is called.'} Chat cannot place bets or stock orders; it can only propose Pause or Stop for you to confirm. This conversation stays in this tab.</p>
 </div>;
}
/**
 * Owner control proposal. The button sends only the allowlisted request for this action id to the existing owner
 * endpoint, which re-checks the session, validates and records the change; the reply shown is that endpoint's.
 */
function ActionCard({card,owner}:{card:Extract<Card,{kind:'action'}>;owner:boolean}){
 const [state,setState]=useState<'idle'|'working'|'done'|'failed'|'cancelled'>('idle');
 const [note,setNote]=useState('');
 async function confirm(){
  const req=chatActionRequest(card.action,card.experimentId);
  if(!req||!owner||state!=='idle')return;
  setState('working');
  try{
   const res=await fetch(req.endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body)});
   const d=await res.json().catch(()=>null) as {status?:string;code?:string}|null;
   if(res.status===401){setState('failed');setNote('Your owner session expired. Nothing was changed. Sign in and ask again.');return;}
   if(!res.ok){setState('failed');setNote(d?.status==='outcome_unknown'?'The database did not confirm the change. Check the status page; retrying is safe.':`Not changed${d?.code?` (${d.code})`:d?.status?` (${d.status})`:''}.`);return;}
   // Read the state back from the same owner endpoint: the receipt is what the server now reports.
   let now='';
   try{
    const g=await fetch(req.endpoint,{cache:'no-store',credentials:'same-origin'});const x=await g.json();
    now=req.endpoint.includes('props')?x?.control?.state??'':(x?.experiments?.find((e:{experimentId?:string})=>e.experimentId===card.experimentId)?.status?.gateMode??'');
   }catch{now='';}
   setState('done');setNote(`Done. The server recorded the change${now?`; it now reports ${String(now).toLowerCase()}`:''}.`);
  }catch{setState('failed');setNote('The request did not complete. Check the status page; retrying is safe.');}
 }
 return <div className="chat-card">
  <p><strong>{card.label}</strong>{card.from?<> · now {card.from.toLowerCase()} → {card.to.toLowerCase()}</>:null}</p>
  <p className="quiet small-print">{card.effect}</p>
  {state==='idle'||state==='working'?<div className="button-row">
   <button type="button" className="button" disabled={!owner||state==='working'} onClick={()=>void confirm()}>{state==='working'?'Applying…':'Confirm'}</button>
   <button type="button" className="button button-secondary" disabled={state==='working'} onClick={()=>{setState('cancelled');setNote('Cancelled. Nothing was changed.');}}>Cancel</button>
  </div>:<p role="status" className={state==='done'?'tone-text-positive':state==='failed'?'tone-text-warning':'quiet'}>{note}</p>}
  {!owner&&state==='idle'&&<p className="quiet small-print">Owner sign-in is needed to confirm.</p>}
 </div>;
}

function ChatCard({card,owner}:{card:Card;owner:boolean}){
 const [copied,setCopied]=useState(false);
 if(card.kind==='action')return <ActionCard card={card} owner={owner}/>;
 if(card.kind==='links')return <div className="chat-chips">{card.items.map(it=><a key={it.href} className="chat-chip" href={it.href}>{it.label}</a>)}</div>;
 if(card.kind==='facts')return <dl className="chat-card">{card.items.map(it=><div key={it.label} className="mb-3"><dt>{it.label}</dt><dd><strong>{it.value}</strong>{it.detail&&<p className="quiet small-print">{it.detail}</p>}</dd></div>)}</dl>;
 if(card.kind==='lineup'){
  async function copy(){try{await navigator.clipboard.writeText(card.kind==='lineup'?card.text:'');setCopied(true);}catch{setCopied(false);}}
  return <div className="chat-card"><code>{card.text}</code><button type="button" className="button button-secondary" onClick={()=>void copy()}>{copied?'Copied':'Copy lineup'}</button></div>;
 }
 if(card.kind==='table')return <div className="chat-card chat-table-wrap">
  <p className="chat-card-title">{card.title}</p>
  <div className="chat-table-scroll"><table className="chat-table">
   <thead><tr>{card.columns.map(c=><th key={c} scope="col">{c}</th>)}</tr></thead>
   <tbody>{card.rows.map((r,i)=><tr key={i}>{r.map((c,j)=>j===0?<th key={j} scope="row">{c}</th>:<td key={j}>{c}</td>)}</tr>)}</tbody>
  </table></div>
 </div>;
 if(card.kind==='bars'){
  const max=Math.max(1e-9,...card.items.map(i=>Math.max(i.value,i.marker??0)));
  return <div className="chat-card">
   <p className="chat-card-title">{card.title}</p>
   <ul className="chat-bars">{card.items.map(it=><li key={it.label}>
    <span className="chat-bar-label">{it.label}</span>
    <span className="chat-bar-track" aria-hidden="true">
     <span className="chat-bar-fill" style={{width:`${(it.value/max)*100}%`}}/>
     {typeof it.marker==='number'&&<span className="chat-bar-marker" style={{left:`${(it.marker/max)*100}%`}} title="Stated confidence"/>}
    </span>
    <span className="chat-bar-value">{it.display}</span>
   </li>)}</ul>
   {card.items.some(i=>typeof i.marker==='number')&&<p className="quiet small-print">Bar: observed. Tick: stated confidence.</p>}
  </div>;
 }
 return <ul className="chat-card chat-list">{card.items.map(it=><li key={it.id}><strong>{it.text}</strong><small>{it.detail}</small></li>)}</ul>;
}
