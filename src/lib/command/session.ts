/**
 * Command Center 2.0: conversation session. The server stores NOTHING: the browser keeps the conversation and sends a
 * bounded copy back with each question. Everything it sends is untrusted and validated here: sizes, roles, the legacy
 * assistant context, and the previous answer's tool calls (re-validated against the tool schemas before reuse).
 */
import {parseContext} from '../server/assistant-handler.ts';
import type {AssistantContext} from '../assistant/understand.ts';
import {toolByName,validateInput} from './tools.ts';

export const LIMITS={maxBodyBytes:16_000,maxMessage:500,maxTurns:10,maxTurnText:1500,maxLastCalls:4};
export type Turn={role:'user'|'assistant';text:string};
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
   const {role,text,...rest}=t as Record<string,unknown>;
   if(Object.keys(rest).length||(role!=='user'&&role!=='assistant')||typeof text!=='string')return null;
   history.push({role,text:text.slice(0,LIMITS.maxTurnText)});
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
