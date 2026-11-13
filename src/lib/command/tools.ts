/**
 * Command Center 2.0: the read-only tool registry. Pure apart from the injected ports (the SAME loaders the pages and the
 * existing assistant use). Every tool:
 *  - has a strict JSON-schema input that is validated here before it runs (unknown keys, wrong types, out-of-range → refused);
 *  - declares who may call it ('public' or 'owner'); owner tools are refused without a validated owner session;
 *  - returns structured data, ready-made cards (tables/bars) and source links, capped at MAX_RESULT_BYTES;
 *  - can only READ. There is no tool that writes, places a bet or an order, changes a model, rule, budget or schedule.
 * A missing source is reported as unavailable, never as zero.
 */
import type {Raw} from '../props/dashboard-view.ts';
import {buildView,type PropsView} from '../props/dashboard-view.ts';
import {propsSummary,whyLine} from '../props/summary.ts';
import {rangeBounds,type Card} from '../assistant/answer.ts';
import type {OpsView} from '../ops/status.ts';
import type {ResearchView} from '../research/stock-summary.ts';
import {RESEARCH_NAMES} from '../research/stock-summary.ts';
import type {LabView} from '../lab/view.ts';
import type {StockAccounts} from '../assistant/stock-answer.ts';
import type {PaperAutoLedger} from '../stocks/paper-auto-ledger.ts';
import {buildBriefing,propsInput} from '../briefing/briefing.ts';
import {untrustedText,looksLikeInstruction} from '../research/discovery.ts';

export const MAX_RESULT_BYTES=8_000;
export type Access='public'|'owner';
type Schema={type:'object';properties:Record<string,{type:'string'|'integer';enum?:string[];minimum?:number;maximum?:number;description:string}>;
 required:string[];additionalProperties:false};
export type Source={label:string;href:string};
export type ToolResult={tool:string;input?:Record<string,unknown>;ok:boolean;
 /** Strings withheld because they read like instructions (prompt injection through recorded data). */
 withheld?:number;data:unknown;cards:Card[];sources:Source[];asOf:string;truncated:boolean;error?:string};
export type CommandPorts={nowIso:string;ownerAccess:boolean;
 sports:()=>Promise<Raw|null>;ops:()=>Promise<OpsView|null>;research:()=>Promise<ResearchView|null>;lab:()=>Promise<LabView|null>;
 /** Owner-only; never invoked unless the request carries a validated owner session. */
 accounts:()=>Promise<StockAccounts>;
 /** AI 2.0 learning engine registry and job history (research/engine/*.json); null until that work is deployed. */
 engine?:()=>Promise<{registry:unknown;jobs:unknown}|null>};
export type ToolDef={name:string;description:string;access:Access;input_schema:Schema;
 run:(input:Record<string,unknown>,p:CommandPorts)=>Promise<Omit<ToolResult,'tool'|'truncated'|'asOf'>>};

const PERIODS=['today','yesterday','last_7_days','prior_7_days','all'] as const;
export type Period=typeof PERIODS[number];
const PERIOD_LABEL:Record<Period,string>={today:'Today',yesterday:'Yesterday',last_7_days:'Last 7 days',prior_7_days:'The 7 days before',all:'Last 14 days (the loaded window)'};
const pct=(x:number|null)=>x===null?'—':(x*100).toFixed(1)+'%';
const usd=(c:number|null)=>c===null?'—':(c<0?'−':'')+'$'+(Math.abs(c)/100).toFixed(2);
const PICKS_SRC={label:'PrizePicks paper picks',href:'/paper-betting/props'};

export function periodBounds(p:Period,nowIso:string):{from:number;to:number;label:string}{
 if(p==='prior_7_days'){const w=rangeBounds('week',nowIso);const span=Date.parse(w.to)-Date.parse(w.from);
  return {from:Date.parse(w.from)-span+86400_000,to:Date.parse(w.from),label:PERIOD_LABEL[p]};}
 // The dashboard loader reads the last 14 days only, so 'all' is that window and is labelled as such.
 if(p==='all')return {from:Date.parse(nowIso)-14*86400_000,to:Date.parse(nowIso)+86400_000,label:PERIOD_LABEL[p]};
 const r=rangeBounds(p==='last_7_days'?'week':p,nowIso);
 return {from:Date.parse(r.from),to:Date.parse(r.to),label:PERIOD_LABEL[p]};
}

/** Recorded picks and settled entries whose games locked inside the period. */
export function periodResults(v:PropsView,p:Period,nowIso:string){
 const b=periodBounds(p,nowIso),inP=(iso:string)=>{const t=Date.parse(iso);return t>=b.from&&t<b.to;};
 const picks=v.lines.filter(l=>l.decision==='recorded'&&inP(l.lockAt));
 const graded=picks.filter(l=>l.correct!==null),correct=graded.filter(l=>l.correct).length;
 const entries=v.entries.filter(e=>inP(e.lockAt));
 const settled=entries.filter(e=>e.settlement&&e.settlement.profitCents!==null);
 const net=settled.reduce((a,e)=>a+e.settlement!.profitCents!,0),staked=settled.reduce((a,e)=>a+e.stakeCents,0);
 return {period:p,label:b.label,from:new Date(b.from).toISOString(),to:new Date(b.to).toISOString(),
  picks:picks.length,graded:graded.length,correct,hitRate:graded.length?correct/graded.length:null,pending:picks.filter(l=>!l.result).length,
  meanConfidence:graded.length?graded.reduce((a,l)=>a+(l.side==='more'?l.pMore??0:l.pLess??0),0)/graded.length:null,
  entries:entries.length,settled:settled.length,open:entries.filter(e=>!e.settlement).length,netCents:settled.length?net:null,roi:staked>0?net/staked:null,
  rows:picks.slice(0,40).map(l=>({player:l.player,stat:l.stat,side:l.side,line:l.line,probability:l.side==='more'?l.pMore:l.pLess,
   result:l.result?.outcome??null,correct:l.correct,lockAt:l.lockAt}))};
}

const str=(description:string,e:readonly string[])=>({type:'string' as const,enum:[...e],description});
const obj=(properties:Schema['properties'],required:string[]=[]):Schema=>({type:'object',properties,required,additionalProperties:false});

async function views(p:CommandPorts){const raw=await p.sports();return raw?{raw,pp:buildView(raw,'prizepicks'),p6:buildView(raw,'pick6')}:null;}
const unavailable=(what:string)=>({ok:false,data:null,cards:[],sources:[],error:`${what} records are unavailable right now; that does not mean zero.`});

export const TOOLS:ToolDef[]=[
 {name:'todays_activity',access:'public',input_schema:obj({}),
  description:'What happened today across SportsEdge: system states, today\'s recorded events, what runs next, and owner approvals waiting. Use for "what happened", "catch me up", "what needs me".',
  async run(_i,p){
   const [raw,ops,research]=await Promise.allSettled([p.sports(),p.ops(),p.research()]);
   const b=buildBriefing({nowIso:p.nowIso,props:propsInput(raw.status==='fulfilled'?raw.value:null),ops:ops.status==='fulfilled'?ops.value:null,
    research:research.status==='fulfilled'?research.value:null});
   return {ok:true,data:{health:b.health,systems:b.systems,today:b.today.slice(0,12),next:b.next.slice(0,8),approvals:b.approvals},
    cards:[{kind:'table',title:'Systems right now',columns:['System','State','Why'],rows:b.systems.map(s=>[s.name,s.state.replaceAll('_',' ').toLowerCase(),s.reason])}],
    sources:[{label:'Overview',href:'/'},{label:'Automation status',href:'/automation'}]};
  }},
 {name:'sports_results',access:'public',input_schema:obj({period:str('Which period (Mountain time days).',PERIODS)},['period']),
  description:'PrizePicks virtual pick results for one period: picks, graded, hit rate, mean stated confidence, settled entries and virtual net. Includes the individual picks.',
  async run(i,p){
   const v=await views(p);if(!v)return unavailable('Sports');
   const r=periodResults(v.pp,i.period as Period,p.nowIso);
   return {ok:true,data:{...r,rows:r.rows.slice(0,15)},
    cards:[{kind:'facts',items:[{label:`${r.label}: hit rate`,value:pct(r.hitRate),detail:`${r.correct} of ${r.graded} graded picks; ${r.pending} pending`},
     {label:'Virtual net (settled entries)',value:usd(r.netCents),detail:`${r.settled} settled, ${r.open} open`}]},
     ...(r.rows.length?[{kind:'table' as const,title:`${r.label}: picks`,columns:['Pick','Chance','Result'],
      rows:r.rows.slice(0,15).map(x=>[`${x.player} ${x.side==='less'?'Less':'More'} ${x.line} ${x.stat}`,pct(x.probability),x.result===null?'pending':x.correct?'hit':x.correct===false?'miss':x.result])}]:[])],
    sources:[PICKS_SRC]};
  }},
 {name:'compare_periods',access:'public',input_schema:obj({a:str('First period.',PERIODS),b:str('Second period.',PERIODS)},['a','b']),
  description:'Compare PrizePicks virtual results between two periods side by side (hit rate, confidence, net). Use for "compared with", "better or worse than last week".',
  async run(i,p){
   const v=await views(p);if(!v)return unavailable('Sports');
   const [a,b]=[periodResults(v.pp,i.a as Period,p.nowIso),periodResults(v.pp,i.b as Period,p.nowIso)];
   const row=(x:typeof a)=>[x.label,String(x.picks),`${x.correct}/${x.graded}`,pct(x.hitRate),pct(x.meanConfidence),usd(x.netCents)];
   const strip=(x:typeof a)=>{const c:Partial<typeof a>={...x};delete c.rows;return c;};
   return {ok:true,data:{a:strip(a),b:strip(b),note:'Small samples: a difference of a few picks is not evidence of improvement.'},
    cards:[{kind:'table',title:'Comparison',columns:['Period','Picks','Hits','Hit rate','Stated confidence','Virtual net'],rows:[row(a),row(b)]},
     {kind:'bars',title:'Hit rate vs stated confidence',items:[a,b].filter(x=>x.hitRate!==null).map(x=>({label:x.label,value:x.hitRate!,display:pct(x.hitRate),marker:x.meanConfidence}))}],
    sources:[PICKS_SRC]};
  }},
 {name:'upcoming_picks',access:'public',input_schema:obj({limit:{type:'integer',minimum:1,maximum:15,description:'How many (default 8).'}}),
  description:'Recorded virtual picks whose games have not locked yet, most confident first, with the model\'s stated reason. Model output, not a recommendation.',
  async run(i,p){
   const v=await views(p);if(!v)return unavailable('Sports');
   const up=propsSummary(v.pp).upcoming.slice(0,Number(i.limit??8));
   return {ok:true,data:up.map(u=>({player:u.player,side:u.side,line:u.line,stat:u.stat,probability:u.probability,game:u.game,lockAt:u.lockAt,why:whyLine(u)})),
    cards:up.length?[{kind:'table',title:'Upcoming picks',columns:['Pick','Chance','Why'],rows:up.map(u=>[`${u.player} ${u.side==='less'?'Less':'More'} ${u.line} ${u.stat}`,pct(u.probability),whyLine(u)])}]:[],
    sources:[PICKS_SRC]};
  }},
 {name:'virtual_bankroll',access:'public',input_schema:obj({}),
  description:'PrizePicks virtual bankroll (paper money): balance, realized net, ROI, record, open entries; Pick6 settlement counts.',
  async run(_i,p){
   const v=await views(p);if(!v)return unavailable('Sports');
   const s=propsSummary(v.pp),p6=propsSummary(v.p6);
   return {ok:true,data:{prizepicks:{balanceCents:s.balanceCents,netCents:s.netCents,roi:s.roi,record:s.record,openEntries:s.openEntries,hitRate:s.hitRate,graded:s.graded},
     pick6:{record:p6.record,openEntries:p6.openEntries},note:'Virtual money only; no real bets are placed.'},
    cards:[{kind:'facts',items:[{label:'Virtual balance',value:usd(s.balanceCents),detail:`Net ${usd(s.netCents)} · ROI ${pct(s.roi)}`},
     {label:'Entry record',value:`${s.record.won}–${s.record.lost}`,detail:`${s.record.refund} refunded, ${s.openEntries} open`}]}],
    sources:[PICKS_SRC]};
  }},
 {name:'learning_lab',access:'public',input_schema:obj({}),
  description:'AI Learning Lab: the active sports model, challengers under test, forward sample progress against the minimums, and which layers help or hurt.',
  async run(_i,p){
   const lab=await p.lab().catch(()=>null);if(!lab)return unavailable('Learning Lab');
   const f=lab.samples.forward;
   return {ok:true,data:{active:lab.active,testing:lab.testing,forwardStatus:lab.forwardStatus,forward:f,minimums:lab.samples.minimums,
     layers:lab.layers.map(l=>({layer:l.label,retro:l.retro.map(r=>r.verdict),forward:l.forward?.verdict??null}))},
    cards:[{kind:'table',title:'What each layer does',columns:['Layer','Historical','Forward'],rows:lab.layers.map(l=>[l.label,l.retro.map(r=>r.verdict.replaceAll('_',' ')).join(', ')||'—',l.forward?.verdict.replaceAll('_',' ')??'—'])},
     ...(f?[{kind:'bars' as const,title:'Forward sample vs minimums',items:[
      {label:'Graded lines',value:Math.min(1,f.graded/lab.samples.minimums.lines),display:`${f.graded}/${lab.samples.minimums.lines}`},
      {label:'Dates',value:Math.min(1,f.dates/lab.samples.minimums.dates),display:`${f.dates}/${lab.samples.minimums.dates}`},
      {label:'Games',value:Math.min(1,f.games/lab.samples.minimums.games),display:`${f.games}/${lab.samples.minimums.games}`}]}]:[])],
    sources:[{label:'AI Learning Lab',href:'/lab'}]};
  }},
 {name:'research_strategies',access:'public',input_schema:obj({}),
  description:'Stock strategy research (inactive candidates, never trading): historical verdicts, forward paper status, benchmark and limitations.',
  async run(_i,p){
   const r=await p.research().catch(()=>null);const s=r?.summary;if(!s)return unavailable('Stock research');
   return {ok:true,data:{overall:s.overall,generatedAt:s.generatedAt,mode:r!.mode,candidates:s.candidates.map(c=>({id:c.id,name:RESEARCH_NAMES[c.id],active:c.active,
     verdict:c.historical?.verdict??null,forward:c.forward})),daily:s.daily?{overall:s.daily.overall}:null,limitations:s.limitations.slice(0,5)},
    cards:[{kind:'table',title:'Strategy candidates (inactive)',columns:['Strategy','Historical','Forward'],
     rows:s.candidates.map(c=>[RESEARCH_NAMES[c.id],c.historical?.verdict??'—',`${c.forward.status} (${c.forward.sessions} sessions)`])}],
    sources:[{label:'Stock research',href:'/stocks/research'}]};
  }},
 {name:'automation_health',access:'public',input_schema:obj({}),
  description:'Background job health from the operations monitor: each job\'s last state, failures, blockers, and whether the monitor itself is stale.',
  async run(_i,p){
   const o=await p.ops().catch(()=>null);if(!o||!o.status)return unavailable('Automation status');
   const jobs=o.status.jobs.map(j=>({label:j.label,area:j.area,required:j.required,status:j.status,detail:j.detail}));
   return {ok:true,data:{monitorStale:o.monitorStale,checkedAt:o.checkedAt,generatedAt:o.status.generatedAt,jobs,blockers:o.status.blockers},
    cards:[{kind:'table',title:'Background jobs',columns:['Job','State','Detail'],rows:jobs.slice(0,20).map(j=>[j.label,j.status.toLowerCase(),j.detail])}],
    sources:[{label:'Automation status',href:'/automation'}]};
  }},
 {name:'stock_status',access:'owner',input_schema:obj({}),
  description:'OWNER ONLY. The stock PAPER autopilot: gate mode, last check, blockers, latest decision, open intents, alerts and equity marks. Read-only.',
  async run(_i,p){
   const a=await p.accounts();
   if(a.state!=='ready')return {ok:false,data:{state:a.state},cards:[],sources:[{label:'Stock autopilot',href:'/stocks/paper-auto'}],error:'The stock ledger is unavailable right now; that does not mean zero.'};
   const l=a.ledgers.find((x):x is PaperAutoLedger=>x.registered);
   if(!l)return {ok:true,data:{registered:false},cards:[],sources:[{label:'Stock autopilot',href:'/stocks/paper-auto'}]};
   const marks=l.daily.slice(-10),last=l.decisions.at(-1)??null;
   return {ok:true,data:{experimentId:l.experimentId,gateMode:l.status.gateMode,state:l.status.state,lastCheckAt:l.status.lastCheckAt,lastCheckOk:l.status.lastCheckOk,
     blockers:l.status.lastCheckBlockers,unresolvedIntents:l.status.unresolvedIntents,criticalAlerts:l.status.unacknowledgedCriticalAlerts,
     startingEquityCents:l.experiment.startingEquityCents,lastDecision:last&&{session:last.session,outcome:last.outcome,targets:last.targets,reasons:last.reasons.slice(0,4)},
     marks,brokerWritesEnabled:a.brokerWritesEnabled},
    cards:[{kind:'facts',items:[{label:'Autopilot gate',value:l.status.gateMode,detail:l.status.gateReason},
     {label:'Last check',value:l.status.lastCheckOk===null?'not yet':l.status.lastCheckOk?'passed':'blocked',detail:l.status.lastCheckBlockers.join(', ')||undefined}]}],
    sources:[{label:'Stock autopilot',href:'/stocks/paper-auto'}]};
  }},
];

export type EngineExperiment={id:string;domain:'sports'|'stocks';status:string;hypothesis:string;disposition:string|null;lastReason:string;
 forward:{candidate:string;baseline:string}|null;result:{observations:number;dates:number|null;clusters:number|null;decisions:number|null}|null;
 minimums:{observations:number;dates:number|null;clusters:number|null;decisions:number|null}};
const ENGINE_STATUSES=['PROPOSED','RUNNING','INSUFFICIENT_DATA','FAILED','PROMISING','READY_FOR_REVIEW','REJECTED'];
/** Strict reader for the learning-engine registry (schema sportsedge-learning-registry-v1). Malformed → null, never guessed. */
export function parseEngineRegistry(v:unknown):EngineExperiment[]|null{
 const r=v as {schema?:unknown;experiments?:unknown};
 if(!r||r.schema!=='sportsedge-learning-registry-v1'||!Array.isArray(r.experiments)||r.experiments.length>500)return null;
 const num=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?x:null;
 const out:EngineExperiment[]=[];
 for(const e of r.experiments as Record<string,unknown>[]){
  if(!e||typeof e.id!=='string'||(e.domain!=='sports'&&e.domain!=='stocks')||typeof e.status!=='string'||!ENGINE_STATUSES.includes(e.status))return null;
  const hist=Array.isArray(e.history)?e.history as {reason?:unknown}[]:[];
  const res=e.result as Record<string,unknown>|null,sr=(e.sampleRequirements??{}) as Record<string,unknown>,f=e.forward as Record<string,unknown>|undefined;
  out.push({id:e.id,domain:e.domain,status:e.status,hypothesis:String(e.hypothesis??''),disposition:typeof e.disposition==='string'?e.disposition:null,
   lastReason:String(hist.at(-1)?.reason??''),forward:f&&typeof f.candidate==='string'&&typeof f.baseline==='string'?{candidate:f.candidate,baseline:f.baseline}:null,
   result:res&&num(res.observations)!==null?{observations:num(res.observations)!,dates:num(res.dates),clusters:num(res.clusters),decisions:num(res.decisions)}:null,
   minimums:{observations:num(sr.minObservations)??0,dates:num(sr.minDates),clusters:num(sr.minClusters),decisions:num(sr.minDecisions)}});
 }
 return out;
}
TOOLS.push({name:'research_experiments',access:'public',input_schema:obj({status:str('Optional filter.',['active','rejected','ready_for_review','all'])}),
 description:'AI 2.0 learning engine: every registered research experiment (sports and stocks) with its lifecycle status, forward-test progress against its registered minimums, and why ideas were rejected. Nothing here is promoted automatically.',
 async run(i,p){
  const e=p.engine?await p.engine().catch(()=>null):null;
  const list=e?parseEngineRegistry(e.registry):null;
  if(!list)return {ok:false,data:null,cards:[],sources:[{label:'AI Learning Lab',href:'/lab'}],error:'The learning-engine registry is not connected here (it ships with the AI 2.0 research work, not yet deployed).'};
  const f=String(i.status??'all');
  const sel=list.filter(x=>f==='all'?true:f==='active'?!['REJECTED','READY_FOR_REVIEW'].includes(x.status):f==='rejected'?x.status==='REJECTED':x.status==='READY_FOR_REVIEW');
  const counts=Object.fromEntries(ENGINE_STATUSES.map(s=>[s,list.filter(x=>x.status===s).length]));
  const fwd=list.filter(x=>x.forward);
  const jobs=Array.isArray(e!.jobs)?(e!.jobs as {at?:unknown;job?:unknown;status?:unknown;summary?:unknown}[]).slice(-5).map(j=>({at:String(j.at),job:String(j.job),status:String(j.status),summary:String(j.summary)})):[];
  return {ok:true,data:{counts,readyForReview:list.filter(x=>x.status==='READY_FOR_REVIEW').map(x=>x.id),
    forwardTests:fwd.map(x=>({id:x.id,candidate:x.forward!.candidate,baseline:x.forward!.baseline,status:x.status,progress:x.result,minimums:x.minimums})),
    experiments:sel.slice(0,25).map(x=>({id:x.id,domain:x.domain,status:x.status,why:(x.disposition??x.lastReason).slice(0,200)})),recentJobs:jobs},
   cards:[{kind:'table',title:'Research experiments',columns:['Experiment','Domain','Status'],rows:sel.slice(0,15).map(x=>[x.id,x.domain,x.status.replaceAll('_',' ').toLowerCase()])},
    ...fwd.filter(x=>x.result).map(x=>({kind:'bars' as const,title:`Forward test: ${x.forward!.candidate} vs ${x.forward!.baseline}`,items:[
     {label:'Paired lines',value:Math.min(1,x.result!.observations/Math.max(1,x.minimums.observations)),display:`${x.result!.observations}/${x.minimums.observations}`},
     ...(x.minimums.dates?[{label:'Dates',value:Math.min(1,(x.result!.dates??0)/x.minimums.dates),display:`${x.result!.dates??0}/${x.minimums.dates}`}]:[]),
     ...(x.minimums.clusters?[{label:'Games',value:Math.min(1,(x.result!.clusters??0)/x.minimums.clusters),display:`${x.result!.clusters??0}/${x.minimums.clusters}`}]:[])]}))],
   sources:[{label:'AI Learning Lab',href:'/lab'}]};
 }});

export const toolByName=(n:unknown)=>typeof n==='string'?TOOLS.find(t=>t.name===n)??null:null;
export const toolsFor=(owner:boolean)=>TOOLS.filter(t=>t.access==='public'||owner);

/** Strict validation against the tool's schema. Returns the cleaned input or an error code. */
export function validateInput(t:ToolDef,input:unknown):{ok:true;input:Record<string,unknown>}|{ok:false;error:string}{
 if(input===undefined||input===null)input={};
 if(typeof input!=='object'||Array.isArray(input))return {ok:false,error:'INPUT_NOT_OBJECT'};
 const x=input as Record<string,unknown>,s=t.input_schema;
 for(const k of Object.keys(x))if(!Object.hasOwn(s.properties,k))return {ok:false,error:'UNKNOWN_FIELD_'+k.slice(0,40)};
 for(const k of s.required)if(x[k]===undefined)return {ok:false,error:'MISSING_'+k};
 for(const [k,v] of Object.entries(x)){
  const d=s.properties[k];
  if(d.type==='string'&&(typeof v!=='string'||v.length>40||(d.enum&&!d.enum.includes(v))))return {ok:false,error:'BAD_'+k};
  if(d.type==='integer'&&(!Number.isInteger(v)||(d.minimum!==undefined&&(v as number)<d.minimum)||(d.maximum!==undefined&&(v as number)>d.maximum)))return {ok:false,error:'BAD_'+k};
 }
 return {ok:true,input:x};
}

/** Authorize, validate, run, and cap one tool call. Never throws. */
export async function callTool(name:unknown,input:unknown,p:CommandPorts):Promise<ToolResult>{
 const t=toolByName(name);
 const fail=(error:string):ToolResult=>({tool:String(name).slice(0,40),ok:false,data:null,cards:[],sources:[],asOf:p.nowIso,truncated:false,error});
 if(!t)return fail('UNKNOWN_TOOL');
 if(t.access==='owner'&&!p.ownerAccess)return fail('OWNER_REQUIRED: sign in on the Paper account page to see stock account details.');
 const v=validateInput(t,input);if(!v.ok)return fail('INVALID_INPUT_'+v.error);
 let r;
 try{r=await t.run(v.input,p);}catch{return fail(`${t.name} failed to read its records; nothing is assumed.`);}
 const s=sanitize(r.data);
 const out:ToolResult={tool:t.name,input:v.input,asOf:p.nowIso,truncated:false,...r,data:s.value,withheld:s.withheld,
  cards:r.cards.map(c=>sanitize(c).value as Card)};
 if(JSON.stringify(out.data).length>MAX_RESULT_BYTES)return {...out,data:{summary:'Result too large; showing tables only.'},truncated:true};
 return out;
}

export const WITHHELD='[withheld: text in the records reads like an instruction]';
/**
 * Every string that comes out of a record (player names, job details, research text, model notes) is treated as
 * untrusted: control and direction-override characters removed, length capped, and text that reads like an instruction
 * to an AI or operator replaced by a marker. Structure is bounded (depth 6, 60 items per array, 60 keys per object).
 */
export function sanitize(x:unknown,depth=0):{value:unknown;withheld:number}{
 let withheld=0;
 const walk=(v:unknown,d:number):unknown=>{
  if(typeof v==='string'){const t=untrustedText(v,500);if(looksLikeInstruction(t)){withheld++;return WITHHELD;}return t;}
  if(v===null||typeof v!=='object')return typeof v==='number'&&!Number.isFinite(v)?null:v;
  if(d>=6)return '[truncated]';
  if(Array.isArray(v))return v.slice(0,60).map(e=>walk(e,d+1));
  return Object.fromEntries(Object.entries(v).slice(0,60).map(([k,e])=>[untrustedText(k,60),walk(e,d+1)]));
 };
 const value=walk(x,depth);
 return {value,withheld};
}
