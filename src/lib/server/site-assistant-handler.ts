/** Whole-site read-only orchestration. Domain failures are isolated; private data is never cached. */
import {handleAssistant,parseContext,cachedPropsRaw} from './assistant-handler.ts';
import {routeQuestion} from '../assistant/domain.ts';
import {stockAnswer,researchAnswer,type StockAccounts,type BrokerView} from '../assistant/stock-answer.ts';
import type {Reply} from '../assistant/answer.ts';
import type {Raw} from '../props/dashboard-view.ts';
import type {ResearchView} from '../research/stock-summary.ts';
import type {AssistantContext} from '../assistant/understand.ts';
import {understand} from '../assistant/understand.ts';
import {conversationalText} from '../assistant/colloquial.ts';
import {isNavigationQuestion,navigationAnswer,improvementAnswer,unsupportedQuestion} from '../assistant/knowledge-guide.ts';
import {propsStoreConfig} from './props-store.ts';
import {ownerSecret,validOwnerSession} from './alpaca-owner-session.ts';
import {handlePaperAutoGet} from './paper-auto-owner.ts';
import {getAlpacaPaperSnapshot} from './alpaca-paper-reader.ts';
import {loadStockResearch} from './stock-research-load.ts';
import {loadOpsStatus} from './ops-status-load.ts';
import {opsSummaryText,opsApprovalsText,type OpsView} from '../ops/status.ts';
import {buildBriefing,propsInput} from '../briefing/briefing.ts';
import {mondayReadiness} from '../briefing/monday.ts';
import {briefingAnswer,BRIEFING_TOPICS,type BriefingTopic} from '../assistant/briefing-answer.ts';
import type {PaperAutoLedger} from '../stocks/paper-auto-ledger.ts';
import {CHAT_ACTIONS,parseControlRequest,type ChatActionId} from '../assistant/actions.ts';
import {labAnswer} from '../assistant/lab-answer.ts';
import {kalshiPublicAnswer,type KalshiPublicResearch} from '../assistant/kalshi-answer.ts';
import {loadLatestIndependentWeather,loadLatestWeatherScorecard} from '../prediction-markets/kalshi/weather-memory-view.ts';
import {loadLab} from './lab-load.ts';
import type {LabView} from '../lab/view.ts';
type Env=Readonly<Record<string,string|undefined>>;
export type AssistantAccess={ownerAccess:boolean;ownerExpiresAt:number|null};
export function assistantAccess(cookie:string|undefined):AssistantAccess{
 const secret=ownerSecret(),ownerAccess=!!secret&&validOwnerSession(cookie,secret);
 return {ownerAccess,ownerExpiresAt:ownerAccess?Number(cookie!.split('.')[1]):null};
}
export type SiteRequest={url:string;contentType:string|null;origin:string|null;ownerCookie?:string;text:()=>Promise<string>};
export type SitePorts={access:AssistantAccess;sports:(nowIso:string)=>Promise<Raw>;
 accounts:()=>Promise<StockAccounts>;broker:()=>Promise<BrokerView>;research:(nowIso:string)=>Promise<ResearchView>;
 /** Public background-job status from the operations monitor. */
 ops?:(nowIso:string)=>Promise<OpsView>;
 /** AI Learning Lab view (public research evidence; no account data). */
 lab?:(nowIso:string)=>Promise<LabView>;
 /** Independently archived public NOAA research; never Kalshi market API. */
 kalshi?:(nowIso:string)=>Promise<KalshiPublicResearch>};
export function sitePorts(req:SiteRequest,env:Env,sports:SitePorts['sports']):SitePorts{
 const access=assistantAccess(req.ownerCookie);
 return {access,sports,research:loadStockResearch,ops:loadOpsStatus,lab:loadLab,
  async kalshi(nowIso){
   const [weather,scorecard]=await Promise.all([
    loadLatestIndependentWeather(nowIso),loadLatestWeatherScorecard(nowIso)]);
   return {checkedAt:nowIso,weather,scorecard};
  },
  async accounts(){
   if(!access.ownerAccess)return {state:'owner_required',ledgers:[],brokerWritesEnabled:null};
   const response=await handlePaperAutoGet({...req,ownerCookie:req.ownerCookie},env);
   const body=await response.json();
   if(!response.ok||body.status!=='ok')return {state:'unavailable',ledgers:[],brokerWritesEnabled:null};
   return {state:'ready',ledgers:body.experiments,brokerWritesEnabled:typeof body.release?.brokerWritesEnabled==='boolean'?body.release.brokerWritesEnabled:null};
  },
  async broker(){
   if(!access.ownerAccess)return {state:'owner_required'};
   if(!env.ALPACA_PAPER_KEY_ID||!env.ALPACA_PAPER_SECRET_KEY)return {state:'unavailable'};
   try{return {state:'ready',snapshot:await getAlpacaPaperSnapshot({keyId:env.ALPACA_PAPER_KEY_ID,secretKey:env.ALPACA_PAPER_SECRET_KEY})};}
   catch{return {state:'unavailable'};}
  }};
}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}});
const simple=(text:string,context:AssistantContext={}):Reply=>({text,cards:[],suggestions:["Tonight's picks",'Stock results','Kalshi weather research','Is everything running?'],context});
export async function handleSiteAssistant(req:Pick<SiteRequest,'contentType'|'text'>,env:Env,nowIso:string,ports:SitePorts):Promise<Response>{
 if(req.contentType?.split(';')[0]?.trim()!=='application/json')return json({status:'invalid_request'},400);
 let body:unknown;
 try{const raw=await req.text();if(new TextEncoder().encode(raw).length>2000)return json({status:'invalid_request'},400);body=JSON.parse(raw);}
 catch{return json({status:'invalid_request'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body))return json({status:'invalid_request'},400);
 const b=body as Record<string,unknown>;
 if(Object.keys(b).some(k=>k!=='message'&&k!=='context')||typeof b.message!=='string'||b.message.length>300)return json({status:'invalid_request'},400);
 const context=parseContext(b.context);
 if(context===undefined)return json({status:'invalid_request'},400);
 const message=b.message,understood=conversationalText(message),q=routeQuestion(message,context);
 const respond=(reply:Reply)=>json({status:'ok',reply,...ports.access});
 if(isNavigationQuestion(message))return respond(navigationAnswer(message,q));
 if(!q.domain)return respond(unsupportedQuestion(q));
 if(q.topic==='improving'&&q.domain!=='all')return respond(improvementAnswer(q));
 if(q.topic==='help')return respond({...simple('I can explain sports picks and entry results, the signed-in stock paper-account, strategy research, independent Kalshi weather research, and the last recorded automation status. No real bets or orders can be placed by asking.',{domain:'all',topic:'help'}),
  cards:[{kind:'links',items:[{label:'Sports picks',href:'/paper-betting/props'},{label:'Stock paper account / owner sign-in',href:'/stocks/alpaca'},{label:'Stock research',href:'/stocks/research'},{label:'Independent Kalshi research',href:'/prediction-markets/kalshi'}]}]});
 async function sports():Promise<Reply>{
  try{
   const safeContext=context?.domain&&context.domain!=='sports'?null:context;
   const r=await handleAssistant({contentType:'application/json',text:async()=>JSON.stringify({message:understood,context:safeContext})},env,ports.sports,nowIso);
   const out=await r.json() as {reply:Reply};
   return {...out.reply,context:{...out.reply.context,domain:'sports'}};
  }catch{return {...simple('Sports records are unavailable right now; I cannot infer whether any picks won or lost.',{domain:'sports'}),cards:[{kind:'links',items:[{label:'Sports picks and results',href:'/paper-betting/props'}]}]};}
 }
 async function stocks():Promise<Reply>{
  const ownerRequired:StockAccounts={state:'owner_required',ledgers:[],brokerWritesEnabled:null};
  if(!ports.access.ownerAccess)return stockAnswer({...q,domain:'stocks'},ownerRequired,null,nowIso);
  // Do not even invoke private loaders unless this request has a validated owner session.
  const [a,p]=await Promise.allSettled([ports.accounts(),q.topic==='holdings'?ports.broker():Promise.resolve(null)]);
  const accounts=a.status==='fulfilled'?a.value:{state:'unavailable' as const,ledgers:[],brokerWritesEnabled:null};
  const broker=p.status==='fulfilled'?p.value:{state:'unavailable' as const};
  const range=understand(understood,null,[],nowIso).range??(q.domain===context?.domain?context?.range:undefined);
  return stockAnswer({...q,domain:'stocks'},accounts,broker,nowIso,range??undefined);
 }
 async function research():Promise<Reply>{
  try{return researchAnswer({...q,domain:'research'},await ports.research(nowIso));}
  catch{return {...simple('Research records are unavailable; I cannot infer a model win or a stock return. Stock account and sports records remain separate.',{domain:'research'}),cards:[{kind:'links',items:[{label:'Stock strategy research',href:'/stocks/research'}]}]};}
 }
 async function kalshi():Promise<Reply>{
  if(!ports.kalshi)return simple('Independent Kalshi weather research is unavailable here. No exchange data is connected.',{domain:'kalshi'});
  try{return kalshiPublicAnswer({...q,domain:'kalshi'},await ports.kalshi(nowIso));}
  catch{return {...simple('Independent NOAA research could not be checked. That does not prove zero forecasts or any Kalshi bets. Exchange market access remains unverified.',{domain:'kalshi'}),cards:[{kind:'links',items:[{label:'Kalshi research',href:'/prediction-markets/kalshi'},{label:'NOAA collector receipts',href:'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/kalshi-independent-weather-memory.yml'}]}]};}
 }
 // A Kalshi request can NEVER be translated into a props or stock owner action.
 if(q.domain==='kalshi'&&q.topic==='controls')return respond({
  ...simple('Kalshi API access and trading cannot be enabled from chat. Nothing was changed. No authorized live Kalshi orders or prices are connected.',{domain:'kalshi',topic:'controls'}),
  cards:[{kind:'links',items:[{label:'Research only',href:'/prediction-markets/kalshi'}]}]});
 // Owner controls: chat can only PROPOSE an allowlisted change; the confirm button calls the existing owner endpoint.
 if(q.topic==='controls'){
  const c=parseControlRequest(message);
  if(c&&c.verb!=='trade')return respond(await controlProposal(c));
 }
 async function controlProposal(c:NonNullable<ReturnType<typeof parseControlRequest>>):Promise<Reply>{
  const ctx:AssistantContext={domain:'all',topic:'controls'};
  if(!c.target)return {...simple('Which one should change: the PrizePicks paper picks or the stock PAPER autopilot? Nothing has changed.',ctx),
   suggestions:[`${c.verb==='start'?'Resume':c.verb[0].toUpperCase()+c.verb.slice(1)} PrizePicks picks`,`${c.verb==='start'||c.verb==='resume'?'Start':c.verb[0].toUpperCase()+c.verb.slice(1)} the stock autopilot`]};
  if(!ports.access.ownerAccess)return {...simple('Only the signed-in owner can change controls. Sign in on the Paper account page, then ask again. Nothing has changed.',ctx),
   cards:[{kind:'links',items:[{label:'Owner sign-in',href:'/stocks/alpaca'}]}]};
  const propose=(id:ChatActionId,from:string|null,experimentId?:string):Reply=>{
   const a=CHAT_ACTIONS[id];
   if(from===a.to)return {...simple(`${a.label.replace(/^(Pause|Resume|Stop) /,'')} is already ${a.to.toLowerCase()}. Nothing to change.`,ctx),private:true};
   return {text:`Proposed change: ${a.label}.${from?` Now: ${from.toLowerCase()} → ${a.to.toLowerCase()}.`:''} ${a.effect}\n\nNothing has changed yet. Press Confirm to apply it; the server re-checks your owner session, applies its own validation and records the change.`,
    cards:[{kind:'action',action:id,label:a.label,effect:a.effect,from,to:a.to,...(experimentId?{experimentId}:{})}],suggestions:['Is everything running?'],context:ctx,private:true};
  };
  if(c.target==='props'){
   const verb=c.verb==='start'?'resume':c.verb;
   let from:string|null=null;
   try{from=(await cachedPropsRaw(ports.sports,nowIso)).control?.state??null;}catch{from=null;}
   return propose(`props-${verb}` as ChatActionId,from);
  }
  if(c.verb==='start'||c.verb==='resume')return {...simple('Starting the stock autopilot re-checks the Alpaca PAPER account and re-arms paper orders, so it is only done on the Autopilot page, never from chat. Nothing has changed.',ctx),
   cards:[{kind:'links',items:[{label:'Stock autopilot',href:'/stocks/paper-auto'}]}],private:true};
  const a=await ports.accounts().catch(()=>({state:'unavailable' as const,ledgers:[],brokerWritesEnabled:null}));
  const l=a.state==='ready'?a.ledgers.find((x):x is PaperAutoLedger=>x.registered):undefined;
  if(!l)return {...simple('The stock autopilot record is unavailable right now, so I cannot propose a change. Use the Autopilot page; its Stop button always works. Nothing has changed.',ctx),
   cards:[{kind:'links',items:[{label:'Stock autopilot',href:'/stocks/paper-auto'}]}],private:true};
  return propose(c.verb==='pause'?'stock-pause':'stock-stop',l.status.gateMode==='ARMED'?'RUNNING':l.status.gateMode,l.experimentId);
 }
 // Learning Lab and staking questions: lab reports plus the saved props snapshot; each source fails on its own.
 if(q.topic==='lab'){
  if(!ports.lab)return respond(simple('The AI Learning Lab is not connected here.',{domain:'all',topic:'lab'}));
  const propsConfigured=env.SPORTSEDGE_PREVIEW_FIXTURES!=='1'&&(()=>{try{propsStoreConfig(env);return true;}catch{return false;}})();
  const [lab,raw]=await Promise.allSettled([ports.lab(nowIso),propsConfigured?cachedPropsRaw(ports.sports,nowIso):Promise.resolve(null)]);
  if(lab.status!=='fulfilled')return respond(simple('Learning Lab records are unavailable right now; nothing is assumed.',{domain:'all',topic:'lab'}));
  return respond(labAnswer(understood,lab.value,raw.status==='fulfilled'?raw.value:null,nowIso));
 }
 if(q.domain==='sports')return respond(await sports());
 if(q.domain==='stocks')return respond(await stocks());
 if(q.domain==='research')return respond(await research());
 if(q.domain==='kalshi')return respond(await kalshi());
 async function jobs():Promise<Reply>{
  if(!ports.ops)return simple('Background job status is not connected here.',{domain:'all'});
  try{return simple(opsSummaryText(await ports.ops(nowIso)),{domain:'all'});}
  catch{return {...simple('Background job status is unavailable right now. Planned schedules are not evidence of a run.',{domain:'all'}),cards:[{kind:'links',items:[{label:'Automation monitoring',href:'/automation'}]}]};}
 }
 if(q.topic==='jobs')return respond(await jobs());
 if((BRIEFING_TOPICS as string[]).includes(q.topic)){
  const topic=q.topic as BriefingTopic;
  // Each source fails on its own; a missing one is reported as unavailable, never as zero.
  const propsConfigured=env.SPORTSEDGE_PREVIEW_FIXTURES!=='1'&&(()=>{try{propsStoreConfig(env);return true;}catch{return false;}})();
  const [raw,ops,research]=await Promise.allSettled([propsConfigured?cachedPropsRaw(ports.sports,nowIso):Promise.resolve(null),
   ports.ops?ports.ops(nowIso):Promise.resolve(null),ports.research(nowIso)]);
  const b=buildBriefing({nowIso,props:propsInput(raw.status==='fulfilled'?raw.value:null),ops:ops.status==='fulfilled'?ops.value:null,
   research:research.status==='fulfilled'?research.value:null});
  // Owner-only stock details are read only with a validated owner session.
  let stockText:string|null=null,ledger:PaperAutoLedger|null=null;
  if(ports.access.ownerAccess&&(topic==='money'||topic==='opportunity'||topic==='ready')){
   const a=await ports.accounts().catch(()=>({state:'unavailable' as const,ledgers:[],brokerWritesEnabled:null}));
   ledger=a.state==='ready'?(a.ledgers.find((l):l is PaperAutoLedger=>l.registered)??null):null;
   if(topic!=='ready')stockText=a.state==='ready'?stockAnswer({domain:'stocks',topic:topic==='money'?'performance':'picks'},a,null,nowIso).text:
    'The stock ledger is unavailable right now; that does not mean zero.';
  }
  const range=understand(message,null,[],nowIso).range??(context?.topic===topic?context?.range:undefined)??undefined;
  const readiness=topic==='ready'?mondayReadiness({nowIso,ops:ops.status==='fulfilled'?ops.value:null,ledger,ownerSignedIn:ports.access.ownerAccess}):null;
  const out=briefingAnswer(topic,b,{readiness,stockText,range});
  if(topic==='money'&&!ports.access.ownerAccess)out.text=out.text.replace('All figures are virtual','Stock PAPER results are owner-only; sign in to include them. All figures are virtual');
  return respond(out);
 }
 if(q.topic==='approvals'){
  if(!ports.ops)return respond(simple('Background job status is not connected here, so I cannot list what is waiting on you.',{domain:'all',topic:'approvals'}));
  try{return respond({...simple(opsApprovalsText(await ports.ops(nowIso)),{domain:'all',topic:'approvals'}),
   cards:[{kind:'links',items:[{label:'Automation status',href:'/automation'}]}]});}
  catch{return respond(simple('Background job status is unavailable right now, so I cannot list what is waiting on you.',{domain:'all',topic:'approvals'}));}
 }
 // Only fetch the separate public NOAA archive when the question explicitly names
 // Kalshi/weather. Ordinary whole-site summaries keep their old latency and source set.
 const withKalshi=/\b(kalshi|noaa|nws|weather|prediction markets?)\b/i.test(message);
 const results=await Promise.allSettled([sports(),stocks(),research(),jobs(),...(withKalshi?[kalshi()]:[])]);
 const names=['Sports','Stock account','Stock research','Background jobs',...(withKalshi?['Independent Kalshi research']:[])];
 const replies=results.map((r,i)=>r.status==='fulfilled'?r.value:simple(names[i]+' records are unavailable.'));
 return respond({text:replies.map((r,i)=>names[i]+'\n'+r.text).join('\n\n'),cards:replies.flatMap(r=>r.cards),
  suggestions:["Tonight's picks",'Stock results','Kalshi weather research','Is everything running?'],context:{domain:'all',topic:q.topic},private:replies.some(r=>r.private)});
}
