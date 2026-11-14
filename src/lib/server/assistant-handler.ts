/**
 * Read-only API for the props assistant. SERVER ONLY by use. It reads the same props ledger the
 * PrizePicks page reads (cached for a minute), understands the question and composes the reply.
 * Never writes, never calls an RPC, never stores or logs the message.
 */
import {propsStoreConfig} from './props-store.ts';
import {buildView,type Raw} from '../props/dashboard-view.ts';
import {PROPS_RELEASE,nextPlannedRuns,ticksReleased} from '../props/schedule.ts';
import {nextCollectionAt,collectionStatusFromRaw} from '../props/collection-status.ts';
import {slotStatus} from '../props/slot-status.ts';
import {STATS} from '../props/contract.ts';
import {understand,type AssistantContext,type Intent} from '../assistant/understand.ts';
import {answer,type Reply} from '../assistant/answer.ts';
import {RESEARCH_IDS,type ResearchId} from '../research/stock-summary.ts';

export const CACHE_MS=60_000;
const MAX_BODY=2000,MAX_MESSAGE=300;
const INTENTS:Intent[]=['picks','nopicks','budget','why','results','record','player','entries','lineup','status','model','mistakes','future','help','smalltalk','bet','unknown'];
const RANGE=/^(today|yesterday|week|all|date:\d{4}-\d\d-\d\d)$/;
type Env=Readonly<Record<string,string|undefined>>;

let cache:{at:number;raw:Raw}|null=null;
export function resetAssistantCache(){cache=null;}
/** The props ledger read shared by every chat path: at most one load per CACHE_MS, so public questions cannot
 * multiply database reads. A failed load clears the cache and is reported to the caller. */
export async function cachedPropsRaw(load:(nowIso:string)=>Promise<Raw>,nowIso:string):Promise<Raw>{
 const now=Date.parse(nowIso);
 if(!cache||now-cache.at>=CACHE_MS||now<cache.at){
  try{cache={at:now,raw:await load(nowIso)};}catch(e){cache=null;throw e;}
 }
 return cache.raw;
}

const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const bad=()=>json({status:'invalid_request'},400);
const unavailable:Reply={text:"I can't read the records right now. Try again in a minute.",cards:[],suggestions:['Try again','Help'],context:{}};

/** The previous turn's context, exactly in shape; anything else is refused. */
export function parseContext(v:unknown):AssistantContext|null|undefined{
 if(v===null||v===undefined)return null;
 if(typeof v!=='object'||Array.isArray(v))return undefined;
 const x=v as Record<string,unknown>;const out:AssistantContext={};
 for(const [k,val] of Object.entries(x)){
  if(k==='intent'&&typeof val==='string'&&(INTENTS as string[]).includes(val))out.intent=val as Intent;
  else if(k==='player'&&typeof val==='string'&&val.length>=1&&val.length<=120)out.player=val;
  else if(k==='stat'&&typeof val==='string'&&(STATS as readonly string[]).includes(val))out.stat=val as AssistantContext['stat'];
  else if(k==='range'&&typeof val==='string'&&RANGE.test(val))out.range=val as AssistantContext['range'];
  else if(k==='lastPickIds'&&Array.isArray(val)&&val.length<=10&&val.every(n=>Number.isSafeInteger(n)&&n>0))out.lastPickIds=val as number[];
  else if(k==='domain'&&['sports','stocks','research','kalshi','all'].includes(val as string))out.domain=val as AssistantContext['domain'];
  else if(k==='topic'&&['overview','performance','holdings','picks','automation','explain','controls','help','approvals','jobs','today','money','health','improving','opportunity','ready'].includes(val as string))out.topic=val as AssistantContext['topic'];
  else if(k==='symbol'&&typeof val==='string'&&/^[A-Z]{1,5}(\.[A-Z])?$/.test(val))out.symbol=val;
  else if(k==='strategyId'&&RESEARCH_IDS.includes(val as ResearchId))out.strategyId=val as ResearchId;
  else return undefined;
 }
 return out;
}

function configured(env:Env){
 if(env.SPORTSEDGE_PREVIEW_FIXTURES==='1')return false;
 try{propsStoreConfig(env);return true;}catch{return false;}
}

export async function handleAssistant(req:{contentType:string|null;text:()=>Promise<string>},env:Env,
 load:(nowIso:string)=>Promise<Raw>,nowIso:string):Promise<Response>{
 if(req.contentType?.split(';')[0]?.trim()!=='application/json')return bad();
 let body:unknown;
 try{const t=await req.text();if(t.length>MAX_BODY)return bad();body=JSON.parse(t);}catch{return bad();}
 if(!body||typeof body!=='object'||Array.isArray(body))return bad();
 const b=body as Record<string,unknown>;
 if(Object.keys(b).some(k=>k!=='message'&&k!=='context'))return bad();
 if(typeof b.message!=='string'||b.message.length>MAX_MESSAGE)return bad();
 const context=parseContext(b.context);
 if(context===undefined)return bad();

 let raw:Raw;
 try{
  if(!configured(env))return json({status:'ok',reply:unavailable});
  raw=await cachedPropsRaw(load,nowIso);
 }catch{cache=null;return json({status:'ok',reply:unavailable});}

 const pp=buildView(raw,'prizepicks'),p6=buildView(raw,'pick6');
 const running=PROPS_RELEASE.scheduledRunsEnabled&&raw.control?.state==='RUNNING';
 const next=nextPlannedRuns(nowIso,4);
 const players=[...new Set([...pp.lines,...p6.lines].map(l=>l.player))];
 const parsed=understand(b.message,context,players,nowIso);
 // Receipts for "why no picks" and "is the budget used up": the same slot table and credit rows the PrizePicks page shows.
 const slots=slotStatus(raw.runs,nowIso,1,raw.runCounts??null);
 const dayAgo=Date.parse(nowIso)-86400_000;
 const counted=raw.credits.filter(c=>Date.parse(c.reserved_at)>dayAgo&&Number(c.effective_credits??c.credits)>0).map(c=>Date.parse(c.reserved_at)).sort((a,b)=>a-b);
 const creditsRollOffAt=counted.length?new Date(counted[0]+86400_000).toISOString():null;
 let collection=null;try{collection=collectionStatusFromRaw(raw);}catch{collection=null;}
 const reply=answer(parsed,{nowIso,pp,p6,control:raw.control,context,slots,creditsRollOffAt,collection,
  nextCollect:running?nextCollectionAt({nowIso,ticksReleased:ticksReleased(),plans:raw.capturePlans,captures:raw.captures}):null,nextSettle:running?next.find(r=>r.kind==='settle')?.at??null:null});
 return json({status:'ok',reply});
}
