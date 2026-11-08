'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Badge,Panel} from '@/components/ui';
import {answerProps,type ChatContext,type ChatData,type ChatReply} from '@/lib/props/conversation';
import {mtShort} from '@/lib/props/summary';
import type {Platform} from '@/lib/props/contract';

type Message={role:'you'|'bot';text:string;reply?:ChatReply};
const INITIAL:Message={role:'bot',text:'Ask me about your saved picks, results, odds or schedule. Try “who should I take tonight?” or “how did we do last night?”'};
const STARTERS=['Who should I take tonight?','How did we do last night?','What is my record?','Is automation running?'];

export function PropsConversation({data,initialPlatform}:{data:ChatData;initialPlatform:Platform}){
 const [chat,setChat]=useState<{messages:Message[];context:ChatContext}>({messages:[INITIAL],context:{platform:initialPlatform}});
 const [input,setInput]=useState('');
 const [copyStatus,setCopyStatus]=useState('');
 const log=useRef<HTMLDivElement>(null),field=useRef<HTMLInputElement>(null);
 const latest=chat.messages[chat.messages.length-1].reply;
 useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[chat.messages]);
 function ask(text:string){
  const question=text.trim().slice(0,300);if(!question)return;
  const reply=answerProps(question,chat.context,data,new Date().toISOString());
  setChat({context:reply.context,messages:[...chat.messages.slice(-37),{role:'you',text:question},{role:'bot',text:reply.text,reply}]});
  setInput('');setCopyStatus('');field.current?.focus();
 }
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();ask(input);}
 async function copy(){
  if(!latest?.copyText)return;
  const current=answerProps('copy lineup',latest.context,data,new Date().toISOString());
  if(current.copyText!==latest.copyText){setCopyStatus('This lineup is no longer available from the current records. Refresh status and ask for a lineup again.');return;}
  try{await navigator.clipboard.writeText(latest.copyText);setCopyStatus('Lineup text copied. Nothing was submitted.');}
  catch{setCopyStatus('Clipboard unavailable. Select and copy the lineup text above.');}
 }
 return <Panel title="Ask SportsEdge" id="props-conversation" className="mt-12 props-conversation" description="Ask in your own words. Answers come from the saved records on this page." actions={<Badge tone="accent">Free command bot</Badge>}>
  <div className="props-chat-log" role="log" aria-label="Props conversation" aria-live="polite" aria-relevant="additions" ref={log} tabIndex={0}>
   {chat.messages.map((m,i)=><div key={i} className={`props-chat-message props-chat-${m.role}`}><strong>{m.role==='you'?'You':'SportsEdge'}</strong><p>{m.text}</p>{m.reply&&<small className="quiet">Records read {mtShort(m.reply.asOf)}</small>}</div>)}
  </div>
  <div className="props-chat-suggestions" aria-label="Suggested questions">{(latest?.suggestions??STARTERS).map(q=><button key={q} type="button" className="button button-secondary" onClick={()=>ask(q)}>{q}</button>)}</div>
  {latest?.link&&<p><a className="text-link" href={latest.link.href}>{latest.link.label}</a></p>}
  {latest?.copyText&&<button type="button" className="button button-secondary" onClick={()=>void copy()}>Copy this lineup</button>}
  {copyStatus&&<p role="status" className="quiet small-print">{copyStatus}</p>}
  <form onSubmit={submit} className="props-chat-form">
   <label htmlFor="props-chat-input">Ask about your props</label>
   <div><input id="props-chat-input" ref={field} autoComplete="off" maxLength={300} value={input} onChange={e=>setInput(e.target.value)} placeholder="Who should I take tonight?"/><button type="submit" className="button" disabled={!input.trim()}>Ask</button></div>
  </form>
  <div className="props-chat-footer"><p className="quiet small-print">Read {mtShort(data.asOf)} · Mountain time. Results cover loaded picks from the last 14 days. Refresh status to update. Conversation stays in this page until you leave or clear it.</p>
   <button type="button" className="text-link" onClick={()=>{setChat({messages:[INITIAL],context:{platform:initialPlatform}});setCopyStatus('');setInput('');}}>Clear conversation</button></div>
 </Panel>;
}
