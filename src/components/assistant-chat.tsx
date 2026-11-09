'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Card,Reply} from '@/lib/assistant/answer';
import type {AssistantContext} from '@/lib/assistant/understand';

type Msg={role:'user'|'bot';text:string;cards?:Card[];suggestions?:string[]};
const KEY='sportsedge-assistant-v1';
const STARTERS=["Tonight's picks",'How did last night go?',"What's my record?",'Is it running?'];
const OPENING:Msg={role:'bot',text:"Ask me about tonight's picks, last night's results, a player, or the model.",suggestions:STARTERS};

/** A free, rule-based chat about the PrizePicks paper test. Reads only; nothing typed here is stored on the server. */
export function AssistantChat(){
 const [msgs,setMsgs]=useState<Msg[]>([OPENING]);
 const [context,setContext]=useState<AssistantContext|null>(null);
 const [input,setInput]=useState('');
 const [busy,setBusy]=useState(false);
 const end=useRef<HTMLDivElement>(null);
 const lastAsked=useRef<string>('');
 const follow=useRef(false);

 // Restore this browser session's conversation (a convenience only; it may be unavailable).
 useEffect(()=>{
  try{const saved=JSON.parse(sessionStorage.getItem(KEY)??'null') as {msgs:Msg[];context:AssistantContext|null}|null;
   if(saved?.msgs?.length){const t=setTimeout(()=>{setMsgs(saved.msgs);setContext(saved.context);},0);return()=>clearTimeout(t);}}catch{/* storage blocked */}
 },[]);
 useEffect(()=>{try{sessionStorage.setItem(KEY,JSON.stringify({msgs:msgs.slice(-40),context}));}catch{/* storage blocked */}
  // Follow the newest message only once someone has asked something, so the page opens at the top.
  if(follow.current)end.current?.scrollIntoView({block:'end'});},[msgs,context,busy]);

 async function send(raw:string){
  const text=(raw==='Try again'?lastAsked.current:raw).trim().slice(0,300);
  if(!text||busy)return;
  lastAsked.current=text;follow.current=true;
  setMsgs(m=>[...m,{role:'user',text}]);setInput('');setBusy(true);
  try{
   const r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,context})});
   const d=await r.json().catch(()=>null) as {status?:string;reply?:Reply}|null;
   if(r.ok&&d?.reply){const reply=d.reply;setMsgs(m=>[...m,{role:'bot',text:reply.text,cards:reply.cards,suggestions:reply.suggestions}]);setContext(reply.context);}
   else setMsgs(m=>[...m,{role:'bot',text:'Try a shorter question, like "tonight\'s picks".',suggestions:STARTERS}]);
  }catch{setMsgs(m=>[...m,{role:'bot',text:"I can't reach the server right now.",suggestions:['Try again']}]);}
  finally{setBusy(false);}
 }
 function submit(e:FormEvent){e.preventDefault();void send(input);}
 function reset(){setMsgs([OPENING]);setContext(null);try{sessionStorage.removeItem(KEY);}catch{/* storage blocked */}}

 const last=msgs[msgs.length-1];
 return <div className="chat">
  <div className="chat-thread" aria-live="polite">
   {msgs.map((m,i)=><div key={i} className={`chat-msg ${m.role}`}>
    <p>{m.text}</p>
    {m.cards?.map((c,j)=><ChatCard key={j} card={c}/>)}
   </div>)}
   {busy&&<div className="chat-msg bot pending"><p>Thinking…</p></div>}
   <div ref={end}/>
  </div>
  {!busy&&last.role==='bot'&&last.suggestions?.length?<div className="chat-chips" role="group" aria-label="Suggestions">
   {last.suggestions.map(s=><button key={s} type="button" className="chat-chip" onClick={()=>void send(s)}>{s}</button>)}
  </div>:null}
  <form className="chat-form" onSubmit={submit}>
   <label className="sr-only" htmlFor="chat-input">Ask a question</label>
   <input id="chat-input" value={input} onChange={e=>setInput(e.target.value)} maxLength={300} autoComplete="off" placeholder="Ask about picks, results, a player…"/>
   <button type="submit" className="button" disabled={busy||!input.trim()}>Send</button>
   <button type="button" className="button button-secondary" onClick={reset}>New chat</button>
  </form>
  <p className="quiet small-print">Answers come from your saved SportsEdge records. Nothing here can place a bet, and your questions aren&apos;t stored.</p>
 </div>;
}

function ChatCard({card}:{card:Card}){
 const [copied,setCopied]=useState(false);
 if(card.kind==='lineup'){
  async function copy(){try{await navigator.clipboard.writeText(card.kind==='lineup'?card.text:'');setCopied(true);}catch{setCopied(false);}}
  return <div className="chat-card"><code>{card.text}</code><button type="button" className="button button-secondary" onClick={()=>void copy()}>{copied?'Copied':'Copy lineup'}</button></div>;
 }
 return <ul className="chat-card chat-list">{card.items.map(it=><li key={it.id}><strong>{it.text}</strong><small>{it.detail}</small></li>)}</ul>;
}
