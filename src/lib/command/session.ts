/**
 * Command Center 2.0: conversation session. The server stores NOTHING: the browser keeps the conversation and sends a
 * bounded copy back with each question. Everything it sends is untrusted and validated here: sizes, roles, the legacy
 * assistant context, and the previous answer's tool calls (re-validated against the tool schemas before reuse).
 */
import {parseContext} from '../server/assistant-handler.ts';
import type {AssistantContext} from '../assistant/understand.ts';
import {toolByName,validateInput} from './tools.ts';
import {createHmac,timingSafeEqual} from 'node:crypto';

export const LIMITS={maxBodyBytes:16_000,maxMessage:500,maxTurns:10,maxTurnText:1500,maxLastCalls:4};
export type Turn={role:'user'|'assistant';text:string;
 /** Server HMAC over an assistant turn's text, issued with each reply. Forged or edited assistant turns fail it. */
 sig?:string};
export type ToolCall={tool:string;input:Record<string,unknown>};
export type Session={context:AssistantContext|null;last:ToolCall[]};
export type CommandRequest={message:string;history:Turn[];session:Session};

export function parseCommandRequest(raw:string):CommandRequest|null{
 if(new TextEncoder().encode(raw).length>LIMITS.maxBodyBytes)return null;
 let b:unknown;try{b=JSON.parse(raw);}catch{return null;}
 if(!b||typeof b!=='object'||Array.isArray(b))return null;
 const x=b as Record<string,unknown>;
 if(Object.keys(x).some(k=>!['message','history','session'].includes(k)))return null;
 if(typeof x.message!=='string'||!x.message.trim()||x.message.length>LIMITS.maxMessage)return null;
 const history:Turn[]=[];
 if(x.history!==undefined){
  if(!Array.isArray(x.history)||x.history.length>LIMITS.maxTurns*2)return null;
  for(const t of x.history){
   if(!t||typeof t!=='object'||Array.isArray(t))return null;
   const {role,text,sig,...rest}=t as Record<string,unknown>;
   if(Object.keys(rest).length||(role!=='user'&&role!=='assistant')||typeof text!=='string')return null;
   if(sig!==undefined&&(typeof sig!=='string'||!/^[0-9a-f]{64}$/.test(sig)))return null;
   history.push({role,text:text.slice(0,LIMITS.maxTurnText),...(typeof sig==='string'?{sig}:{})});
  }
 }
 let session:Session={context:null,last:[]};
 if(x.session!==undefined&&x.session!==null){
  if(typeof x.session!=='object'||Array.isArray(x.session))return null;
  const s=x.session as Record<string,unknown>;
  if(Object.keys(s).some(k=>k!=='context'&&k!=='last'))return null;
  const context=parseContext(s.context??null);if(context===undefined)return null;
  const last:ToolCall[]=[];
  if(s.last!==undefined){
   if(!Array.isArray(s.last)||s.last.length>LIMITS.maxLastCalls)return null;
   for(const c of s.last){
    const t=c&&typeof c==='object'?toolByName((c as {tool?:unknown}).tool):null;
    const v=t?validateInput(t,(c as {input?:unknown}).input):null;
    if(!t||!v?.ok)return null;
    last.push({tool:t.name,input:v.input});
   }
  }
  session={context,last};
 }
 return {message:x.message.trim(),history:history.slice(-LIMITS.maxTurns*2),session};
}

/**
 * The browser keeps the conversation, so it could forge "assistant" turns (e.g. a fake earlier answer saying the owner
 * approved something). Each assistant reply is signed with a server key; only verified assistant turns reach a language
 * model. User turns are the user's own words and need no signature. Without a key, no assistant turn is trusted.
 */
export function signTurn(key:string,text:string):string{return createHmac('sha256',key).update('command-turn-v1\n'+text).digest('hex');}
export function verifiedHistory(history:Turn[],key:string|null):{history:Turn[];dropped:number}{
 let dropped=0;
 const ok=(t:Turn)=>{
  if(t.role==='user')return true;
  if(!key||!t.sig)return false;
  const a=Buffer.from(signTurn(key,t.text),'hex'),b=Buffer.from(t.sig,'hex');
  return a.length===b.length&&timingSafeEqual(a,b);
 };
 const out=history.filter(t=>{const v=ok(t);if(!v)dropped++;return v;}).map(({role,text})=>({role,text}));
 return {history:out,dropped};
}
