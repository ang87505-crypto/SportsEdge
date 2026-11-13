/**
 * Command Center 2.0 endpoint logic (POST /api/command). Read-only. Order of precedence for a question:
 *  1 control requests ("pause the picks", "buy OXY") → the existing assistant, which can only PROPOSE an allowlisted
 *    Pause/Stop for the owner to confirm, and refuses trades; a language model never sees these;
 *  2 the optional language model (owner session + explicitly configured provider and daily budget) over read-only tools;
 *  3 the deterministic tool planner (follow-ups, comparisons, bankroll, experiments, job health);
 *  4 the existing SportsEdge assistant (fallback for everything else).
 * Messages are not stored. Rate-limited per client; private (owner) replies are marked so the UI hides them on logout.
 */
import {parseCommandRequest,type ToolCall} from '../command/session.ts';
import {plan,compose,suggestionsFor} from '../command/planner.ts';
import {callTool,type CommandPorts,type ToolResult} from '../command/tools.ts';
import {runConversation,type LanguageModel} from '../command/llm.ts';
import {RateLimiter,DailyBudget,llmConfig} from '../command/budget.ts';
import {parseControlRequest} from '../assistant/actions.ts';
import type {Card,Reply} from '../assistant/answer.ts';
import type {AssistantContext} from '../assistant/understand.ts';

type Env=Readonly<Record<string,string|undefined>>;
export type CommandDeps={ports:CommandPorts;
 /** The existing assistant (handleSiteAssistant), called with its own validated request shape. */
 legacy:(message:string,context:AssistantContext|null)=>Promise<Reply|null>;
 /** Builds the language model; only called when llmConfig(env) enabled it and the session is the owner's. */
 model?:()=>Promise<LanguageModel>};
export type Mode='language-model'|'tools'|'assistant';

const limiter=new RateLimiter(20),llmLimiter=new RateLimiter(6);
let budget:DailyBudget|null=null;
export function resetCommandState(){budget=null;}

const HEADERS={'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:HEADERS});

function withSources(cards:Card[],results:ToolResult[]):Card[]{
 const seen=new Set<string>(),items=results.flatMap(r=>r.sources).filter(s=>!seen.has(s.href)&&seen.add(s.href));
 return items.length?[...cards,{kind:'links',items}]:cards;
}

export async function handleCommand(req:{contentType:string|null;text:()=>Promise<string>;clientKey:string},env:Env,deps:CommandDeps):Promise<Response>{
 const nowIso=deps.ports.nowIso,nowMs=Date.parse(nowIso);
 if(req.contentType?.split(';')[0]?.trim()!=='application/json')return json({status:'invalid_request'},400);
 if(!limiter.allow(req.clientKey,nowMs))return json({status:'rate_limited',retryAfterSeconds:60},429);
 let raw:string;try{raw=await req.text();}catch{return json({status:'invalid_request'},400);}
 const r=parseCommandRequest(raw);
 if(!r)return json({status:'invalid_request'},400);
 const owner=deps.ports.ownerAccess;
 const respond=(reply:Reply,mode:Mode,last:ToolCall[],extra:Record<string,unknown>={})=>
  json({status:'ok',mode,reply,session:{context:reply.context??null,last},ownerAccess:owner,...extra});
 const legacy=async(note?:string)=>{
  const out=await deps.legacy(r.message,r.session.context).catch(()=>null);
  if(!out)return respond({text:'The records are unavailable right now.',cards:[],suggestions:['Is everything running?'],context:{}},'assistant',[]);
  return respond(note?{...out,text:out.text+'\n\n'+note}:out,'assistant',[]);
 };

 // 1. Controls never reach a language model or a tool: proposals only, through the existing allowlist.
 if(parseControlRequest(r.message))return legacy();

 // 2. Optional language model.
 const cfg=llmConfig(env);
 let fallbackNote:string|undefined;
 if(cfg&&owner&&deps.model){
  if(!llmLimiter.allow(req.clientKey,nowMs))fallbackNote='(The AI model is rate-limited for a minute; this answer uses the built-in planner.)';
  else{
   budget??=new DailyBudget(cfg.dailyCapUsd);
   let model:LanguageModel|null=null;try{model=await deps.model();}catch{model=null;}
   if(model){
    const o=await runConversation(model,{history:r.history,message:r.message,ports:deps.ports,budget,
     maxOutputTokens:cfg.maxOutputTokens,maxToolRounds:cfg.maxToolRounds,maxInputTokensEstimate:cfg.maxInputTokensEstimate});
    if(o.ok){
     const cards=withSources(o.results.flatMap(x=>x.cards).slice(0,6),o.results);
     const calls=o.results.filter(x=>x.ok&&x.input).slice(0,4).map(x=>({tool:x.tool,input:x.input!}));
     return respond({text:o.text,cards,suggestions:suggestionsFor(calls),context:r.session.context??{},
      private:o.results.some(x=>x.tool==='stock_status'&&x.ok)},'language-model',calls,{usage:{usd:Number(o.usd.toFixed(4)),model:o.model}});
    }
    fallbackNote=o.reason==='BUDGET_EXHAUSTED'?'(Today\'s AI budget is used up; this answer uses the built-in planner.)':'(The AI model could not answer; this answer uses the built-in planner.)';
   }
  }
 }

 // 3. Deterministic tool planner.
 const p=plan(r.message,r.session.last);
 if(p){
  const results=await Promise.all(p.calls.map(c=>callTool(c.tool,c.input,deps.ports)));
  const text=compose(results,p.filter)+(fallbackNote?'\n\n'+fallbackNote:'');
  let cards=results.flatMap(x=>x.cards);
  if(p.filter)cards=([] as Card[]).concat(cards.filter(c=>c.kind!=='table'),results.flatMap((x):Card[]=>{
   const rows=((x.data as {rows?:{player:string;side:string;line:number;stat:string;correct:boolean|null;probability:number|null}[]}|null)?.rows??[])
    .filter(row=>row.correct===(p.filter==='hits'));
   return rows.length?[{kind:'table' as const,title:p.filter==='misses'?'Misses':'Hits',columns:['Pick','Chance'],
    rows:rows.slice(0,15).map(row=>[`${row.player} ${row.side==='less'?'Less':'More'} ${row.line} ${row.stat}`,row.probability===null?'—':(row.probability*100).toFixed(1)+'%'])}]:[];
  }));
  return respond({text,cards:withSources(cards,results),suggestions:suggestionsFor(p.calls),context:r.session.context??{},
   private:results.some(x=>x.tool==='stock_status'&&x.ok)},'tools',p.calls);
 }
 // 4. Existing assistant.
 return legacy(fallbackNote);
}
