/**
 * The owner's briefing: one pure read model that answers "is everything running, what happened today, what did it
 * earn, what is it learning, what is next and what needs me". Shared by the Overview page and Ask SportsEdge so both
 * say the same thing. Built only from receipts already loaded (props ledger, operations monitor, research summary);
 * missing inputs are reported as unavailable, never as zero, and planned times are never presented as runs.
 */
import {buildView,type Raw,type PropsView} from '../props/dashboard-view.ts';
import {collectionStatusFromRaw,type CollectionStatus} from '../props/collection-status.ts';
import {whyNoPicks,type NoPicks} from '../props/no-picks.ts';
import {nextRuns} from '../stocks/autopilot-view.ts';
import {propsSummary,whyLine} from '../props/summary.ts';
import type {OpsView,OpsJob} from '../ops/status.ts';
import type {ResearchView} from '../research/stock-summary.ts';

export type Tone='positive'|'warning'|'negative'|'neutral'|'info';

/** The eight operating states every system is reported in. A failure is never one of the healthy states. */
export type OpState='EXECUTING'|'NOTHING_QUALIFIES'|'WAITING_FOR_DATA'|'BUDGET_EXHAUSTED'|'OWNER_PAUSED'|'UNAVAILABLE'|'SAFETY_STOPPED'|'OWNER_ACTION';
export const OP_STATES:Record<OpState,{label:string;tone:Tone;meaning:string}>={
 EXECUTING:{label:'Working',tone:'positive',meaning:'Healthy and doing its job.'},
 NOTHING_QUALIFIES:{label:'Nothing qualifies',tone:'info',meaning:'Healthy; the data arrived but nothing met the rules.'},
 WAITING_FOR_DATA:{label:'Waiting for data',tone:'info',meaning:'Healthy; waiting for the next window or for the provider to post data.'},
 BUDGET_EXHAUSTED:{label:'Budget used up',tone:'warning',meaning:'The approved API credit cap is spent; it frees up on a rolling basis.'},
 OWNER_PAUSED:{label:'Paused by you',tone:'neutral',meaning:'Off because the owner control says so.'},
 UNAVAILABLE:{label:'Temporarily unavailable',tone:'negative',meaning:'A record or provider could not be read, or a step failed.'},
 SAFETY_STOPPED:{label:'Safety stop',tone:'negative',meaning:'An automatic safety rule stopped it; it never restarts itself.'},
 OWNER_ACTION:{label:'Needs you',tone:'warning',meaning:'Waiting on a step only the owner can take.'},
};
export type SystemState={id:'props'|'stocks';name:string;state:OpState;reason:string;href:string};

const NO_PICKS_STATE:Record<NoPicks['code'],OpState>={HAS_PICKS:'EXECUTING',LOCKED_AWAITING_RESULTS:'EXECUTING',PAUSED:'OWNER_PAUSED',
 WAITING_FOR_WINDOW:'WAITING_FOR_DATA',NO_GAMES_PLANNED:'WAITING_FOR_DATA',WAITING_FOR_COLLECTION:'WAITING_FOR_DATA',NO_LINES_POSTED:'WAITING_FOR_DATA',
 BUDGET_EXHAUSTED:'BUDGET_EXHAUSTED',NO_QUALIFYING_LINES:'NOTHING_QUALIFIES',CAPTURE_FAILED:'UNAVAILABLE',WINDOWS_MISSED:'UNAVAILABLE',UNKNOWN:'UNAVAILABLE'};

/** PrizePicks props: the owner control first (a safety-brake pause is a safety stop), then the no-picks receipt. */
export function propsState(x:{control:{state:string;reason:string}|null;noPicks:NoPicks|null}|null):SystemState{
 const base={id:'props' as const,name:'PrizePicks paper picks',href:'/paper-betting/props'};
 if(!x||!x.noPicks)return {...base,state:'UNAVAILABLE',reason:'The props ledger could not be read. Nothing is assumed.'};
 const c=x.control;
 if(c&&c.state!=='RUNNING'&&/^SAFETY_BRAKE/.test(c.reason))return {...base,state:'SAFETY_STOPPED',reason:c.reason.replace(/^SAFETY_BRAKE:\s*/,'Safety brake: ')+'. Only the owner can resume.'};
 const end=(t:string)=>/[.!?]$/.test(t)?t:t+'.';
 return {...base,state:NO_PICKS_STATE[x.noPicks.code],reason:end(x.noPicks.headline)+(x.noPicks.detail?' '+end(x.noPicks.detail):'')};
}

/** Stock PAPER from public evidence only (the operations monitor); account details stay owner-only. */
export function stocksPublicState(ops:OpsView|null):SystemState{
 const base={id:'stocks' as const,name:'Stock PAPER autopilot',href:'/stocks/paper-auto'};
 const s=ops?.status;
 if(!s)return {...base,state:'UNAVAILABLE',reason:'The operations monitor has not published a status, so stock automation cannot be confirmed.'};
 const failing=s.jobs.filter(j=>j.area==='stocks'&&j.required&&['FAILING','STALE','DISABLED'].includes(j.status));
 if(failing.length)return {...base,state:'UNAVAILABLE',reason:failing.map(j=>`${j.label}: ${j.detail}`).join(' ')};
 const gate=s.blockers.find(b=>b.id==='stock-first-session');
 if(gate)return {...base,state:'OWNER_ACTION',reason:'Weekly plans are recorded; paper orders stay off until your supervised first session passes the release gate.'};
 return {...base,state:'EXECUTING',reason:'Stock jobs are healthy. Account details are owner-only.'};
}

const MT_DAY=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'});
export const mtDay=(iso:string)=>MT_DAY.format(new Date(iso));
const MT_TIME=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',hour:'numeric',minute:'2-digit'});
const mtTime=(iso:string)=>MT_TIME.format(new Date(iso));
const money=(c:number)=>(c<0?'−':'')+'$'+(Math.abs(c)/100).toFixed(2);

export type TodayItem={at:string;text:string;tone:Tone;href:string};
export type NextItem={at:string;what:string;href:string};
export type Briefing={
 asOf:string;
 health:{tone:Tone;headline:string;detail:string;checkedAt:string|null;stale:boolean;problems:string[];siteOk:boolean|null;deployment:string|null};
 systems:SystemState[];
 today:TodayItem[];
 money:{prizepicks:{balanceCents:number;startCents:number;netCents:number;weekNetCents:number;weekSettled:number;won:number;lost:number;openEntries:number;openStakeCents:number}|null;
  pick6:{settled:number;payoutUnknown:number;open:number}|null;preliminary:boolean;note:string};
 learning:{activeModel:string|null;lastTrainedAt:string|null;graded:number;hitRate:number|null;meanConfidence:number|null;brier:number|null;brierN:number;
  overconfident:boolean;challengers:{version:string;state:string;gradedLines:number}[];note:string}|null;
 research:{stocks:{overall:string;daily:string|null;generatedAt:string;saved:boolean}|null};
 /** Recorded picks that have not locked yet, most confident first (model output, not a recommendation). */
 upcoming:{player:string;side:'more'|'less';line:number;stat:string;probability:number;game:string;lockAt:string;why:string}[];
 next:NextItem[];
 approvals:{text:string;action:string}[];
};
export type BriefingInput={nowIso:string;
 props:{raw:Raw;pp:PropsView;p6:PropsView;collection:CollectionStatus|null;noPicks:NoPicks}|null;
 ops:OpsView|null;research:ResearchView|null;
 /** Planned schedule times (never runs), e.g. the weekly stock pick. */
 planned?:NextItem[]};

/** Sample sizes below these are reported as too early to support any profitability conclusion. */
export const MIN_SETTLED_ENTRIES=30,MIN_GRADED_PICKS=200;

function health(ops:OpsView|null):Briefing['health']{
 const s=ops?.status;
 if(!s)return {tone:'warning',headline:'Status unknown',detail:'The operations monitor has not published a status. Nothing is assumed to be running.',
  checkedAt:null,stale:false,problems:[],siteOk:null,deployment:null};
 const bad=(j:OpsJob)=>['FAILING','STALE','DISABLED','UNKNOWN'].includes(j.status);
 // A run GitHub never started is a warning (the monitor's own rating), not a failure.
 const warn=(j:OpsJob)=>['MISSED_SLOT','RAN_LATE'].includes(j.status)||(j.stuckQueued??0)>0;
 const failing=s.jobs.filter(j=>j.required&&bad(j));
 const warnings=s.jobs.filter(j=>!failing.includes(j)&&(warn(j)||(!j.required&&bad(j))));
 const siteBad=s.site.checks.filter(c=>!c.ok);
 const problems=[...failing.map(j=>`${j.label}: ${j.detail}`),...siteBad.map(c=>`Live check failed: ${c.name}`),
  ...warnings.map(j=>`${j.label}: ${j.detail}`)];
 const dep=s.site.deployment&&s.site.deployment.state!=='UNKNOWN'?s.site.deployment.detail:null;
 const depBad=!!s.site.deployment&&!['MATCHES_MAIN','UNKNOWN'].includes(s.site.deployment.state);
 const tone:Tone=failing.length||siteBad.length?'negative':warnings.length||depBad||ops!.monitorStale?'warning':'positive';
 const headline=tone==='negative'?'Something needs attention':tone==='warning'?'Running, with warnings':'Everything is running';
 const detail=failing.length||siteBad.length?`${failing.length} required job${failing.length===1?'':'s'} failing; ${siteBad.length} live check${siteBad.length===1?'':'s'} failing.`:
  `${s.jobs.filter(j=>j.required&&j.status==='OK').length} of ${s.jobs.filter(j=>j.required).length} required jobs healthy; ${s.site.checks.length-siteBad.length} of ${s.site.checks.length} live site checks passed.`+
  (warnings.length?` ${warnings.length} warning${warnings.length===1?'':'s'}.`:'');
 return {tone,headline,detail:detail+(ops!.monitorStale?' This check is more than 8 hours old.':''),checkedAt:s.generatedAt,stale:ops!.monitorStale,problems,
  siteOk:s.site.ok,deployment:dep};
}

const RUN_FAIL=/^(FAILED|PROVIDER|ODDS_NOT|CAPTURE_SCHEMA|EVENTS_LIST)/;
function today(x:BriefingInput):TodayItem[]{
 const day=mtDay(x.nowIso),items:TodayItem[]=[];
 const isToday=(iso:string|null|undefined)=>!!iso&&Number.isFinite(Date.parse(iso))&&mtDay(iso)===day;
 const p=x.props;
 if(p){
  const props='/paper-betting/props';
  for(const c of p.raw.captures??[])if(isToday(c.claimed_at)){
   const plan=(p.raw.capturePlans??[]).find(g=>g.provider_event_id===c.provider_event_id);
   const game=plan?`${plan.away_team} @ ${plan.home_team}`:'a game';
   const ok=c.outcome==='stored';
   items.push({at:c.claimed_at,href:props,tone:ok?'positive':c.outcome==='budget_refused'?'warning':c.outcome==='no_dfs_lines'?'neutral':c.outcome?'negative':'neutral',
    text:ok?`Captured ${c.dfs_lines??0} PrizePicks/Pick6 lines for ${game} (${c.window_name} window)`:
     c.outcome==='budget_refused'?`Skipped ${game}: the API credit cap was used up`:
     c.outcome==='no_dfs_lines'?`Checked ${game}: no PrizePicks/Pick6 lines posted yet`:c.outcome?`Capture for ${game} did not complete (${c.outcome.replaceAll('_',' ')})`:
     `Capture for ${game} started; no result recorded yet`});
  }
  const ticks=p.raw.runs.filter(r=>isToday(r.started_at)&&r.slot_key.startsWith('collect-tick-'));
  const quiet=ticks.filter(r=>r.outcome==='NOTHING_DUE').length;
  if(quiet)items.push({at:ticks.filter(r=>r.outcome==='NOTHING_DUE').map(r=>r.started_at).sort().pop()!,href:props,tone:'neutral',
   text:`${quiet} capture check${quiet===1?'':'s'} ran with nothing due (no credits used)`});
  for(const r of p.raw.runs)if(isToday(r.started_at)){
   if(r.status==='failed'||r.status==='abandoned'||RUN_FAIL.test(r.outcome))items.push({at:r.started_at,href:props,tone:'negative',
    text:`A ${r.kind} run did not complete (${r.outcome.replaceAll('_',' ').toLowerCase()})`});
   else if(r.kind==='settle'&&r.status==='completed')items.push({at:r.finished_at??r.started_at,href:props,tone:'neutral',text:'Grading and settlement ran'});
   else if(r.outcome==='BUDGET_EXHAUSTED')items.push({at:r.started_at,href:props,tone:'warning',text:'A collection was refused: the API credit cap was used up'});
  }
  const picked=p.pp.lines.concat(p.p6.lines).filter(l=>l.decision==='recorded'&&isToday(l.ingestedAt));
  if(picked.length)items.push({at:picked.map(l=>l.ingestedAt).sort().pop()!,href:props,tone:'info',
   text:`Recorded ${picked.length} pick${picked.length===1?'':'s'} before tip-off`});
  for(const [v,name] of [[p.pp,'PrizePicks'],[p.p6,'Pick6']] as const){
   const made=v.entries.filter(e=>isToday(e.createdAt));
   if(made.length)items.push({at:made.map(e=>e.createdAt).sort().pop()!,href:props,tone:'info',
    text:`Made ${made.length} virtual ${name} entr${made.length===1?'y':'ies'} (${money(made.reduce((a,e)=>a+e.stakeCents,0))} staked)`});
   for(const e of v.entries)if(e.settlement&&isToday(e.settlement.settledAt))items.push({at:e.settlement.settledAt,href:props,
    tone:e.settlement.outcome==='won'?'positive':e.settlement.outcome==='lost'?'negative':'neutral',
    text:`${name} entry #${e.id} ${e.settlement.outcome}`+(e.settlement.profitCents===null?' (payout unknown)':` ${money(e.settlement.profitCents)}`)});
  }
 }
 // Props work is read from the ledger above; the monitor adds the other jobs' real GitHub runs.
 const LEDGER_JOBS=new Set(['props-daily','props-tick','ops-monitor','stock-kickoff','paper-release']);
 for(const j of x.ops?.status?.jobs??[]){
  if(LEDGER_JOBS.has(j.id))continue;
  const r=j.lastRun;
  if(r&&isToday(r.startedAt)&&r.status==='completed')items.push({at:r.startedAt!,href:r.url,tone:r.conclusion==='success'?'neutral':'negative',
   text:`${j.label}: ${r.conclusion==='success'?'ran successfully':'run '+(r.conclusion??'ended')}`});
 }
 return items.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,12);
}

function moneyOf(x:BriefingInput):Briefing['money']{
 const p=x.props;
 if(!p)return {prizepicks:null,pick6:null,preliminary:true,note:'The props ledger could not be read, so no virtual result is shown.'};
 const weekAgo=Date.parse(x.nowIso)-7*86400_000;
 const v=p.pp,b=v.bankroll;
 const week=v.entries.filter(e=>e.settlement&&e.settlement.profitCents!==null&&Date.parse(e.settlement.settledAt)>=weekAgo);
 const pp=b?{balanceCents:b.balanceCents,startCents:b.initialCents,netCents:b.realizedProfitCents,
  weekNetCents:week.reduce((a,e)=>a+e.settlement!.profitCents!,0),weekSettled:week.length,
  won:v.entryStats.won,lost:v.entryStats.lost,openEntries:v.entryStats.open,openStakeCents:b.openStakeCents}:null;
 const p6=p.p6.entries.length?{settled:p.p6.entryStats.settled,payoutUnknown:p.p6.entryStats.payoutUnknown,open:p.p6.entryStats.open}:null;
 const settledKnown=b?.settledKnown??0;
 const preliminary=settledKnown<MIN_SETTLED_ENTRIES||v.accuracy.graded<MIN_GRADED_PICKS;
 const note=preliminary?`Too early to judge profitability: ${settledKnown} settled PrizePicks entr${settledKnown===1?'y':'ies'} and ${v.accuracy.graded} graded picks `+
  `(at least ${MIN_SETTLED_ENTRIES} and ${MIN_GRADED_PICKS} are needed before any conclusion). Pick6 payouts are unknown and are never added to this total.`:
  'PrizePicks virtual results only. Pick6 payouts are unknown and are never added to this total.';
 return {prizepicks:pp,pick6:p6,preliminary,note};
}

function learningOf(x:BriefingInput):Briefing['learning']{
 const p=x.props;
 if(!p)return null;
 const v=p.pp,graded=v.lines.filter(l=>l.decision==='recorded'&&l.correct!==null&&l.pMore!==null&&l.pLess!==null);
 const conf=graded.length?graded.reduce((a,l)=>a+(l.side==='less'?l.pLess!:l.pMore!),0)/graded.length:null;
 const hit=v.accuracy.hitRate;
 // Overconfident: the model's average stated confidence is clearly above what it actually hit (two standard errors).
 const se=hit!==null&&graded.length?Math.sqrt(Math.max(hit*(1-hit),0.01)/graded.length):null;
 const overconfident=conf!==null&&hit!==null&&se!==null&&conf-hit>2*se;
 const m=v.model;
 const challengers=(m?.challengers??[]).filter(c=>c.version!==m?.active).map(c=>({version:c.version,state:c.state,gradedLines:c.gradedLines}));
 const parts:string[]=[];
 if(hit!==null&&conf!==null)parts.push(`Recorded picks hit ${(hit*100).toFixed(1)}% (${v.accuracy.correct} of ${v.accuracy.graded}) against an average stated confidence of ${(conf*100).toFixed(1)}%.`);
 else parts.push('No graded picks yet.');
 if(overconfident)parts.push('The model has been overconfident so far; challengers are being tested on later games before anything can change.');
 if(v.accuracy.graded<MIN_GRADED_PICKS)parts.push(`The sample is small (${v.accuracy.graded} graded); a few results can swing these numbers.`);
 return {activeModel:m?.active??null,lastTrainedAt:m?.lastTrainedAt??null,graded:v.accuracy.graded,hitRate:hit,meanConfidence:conf,
  brier:v.accuracy.brierAllScored,brierN:v.accuracy.brierN,overconfident,challengers,note:parts.join(' ')};
}

function nextOf(x:BriefingInput):NextItem[]{
 const now=Date.parse(x.nowIso),out:NextItem[]=[];
 const c=x.props?.collection?.next;
 if(c)out.push({at:c.at,what:`PrizePicks: ${c.what}`,href:'/paper-betting/props'});
 // Stock decision/worker workflows run on weekday slots; the meaningful plan is the weekly pick added below.
 const pick=new Set(['props-daily','props-learn','research-collect','research-evaluate']);
 for(const j of x.ops?.status?.jobs??[])if(pick.has(j.id)&&j.nextPlanned[0])out.push({at:j.nextPlanned[0],what:j.label,href:j.historyUrl});
 const weekly=nextRuns(now).pick;
 if(Number.isFinite(weekly))out.push({at:new Date(weekly).toISOString(),what:'Stock PAPER: weekly pick (8:00 AM ET Monday)',href:'/stocks/paper-auto'});
 for(const p of x.planned??[])out.push(p);
 const seen=new Set<string>();
 return out.filter(n=>Date.parse(n.at)>now&&!seen.has(n.what)&&seen.add(n.what)).sort((a,b)=>a.at.localeCompare(b.at)).slice(0,6);
}

export function buildBriefing(x:BriefingInput):Briefing{
 const r=x.research?.summary;
 return {asOf:x.nowIso,health:health(x.ops),
  systems:[propsState(x.props?{control:x.props.raw.control,noPicks:x.props.noPicks}:null),stocksPublicState(x.ops)],
  today:today(x),money:moneyOf(x),learning:learningOf(x),
  research:{stocks:r?{overall:r.overall,daily:r.daily?.overall??null,generatedAt:r.generatedAt,saved:x.research?.mode==='saved'}:null},
  upcoming:x.props?propsSummary(x.props.pp).upcoming.slice(0,5).map(u=>({player:u.player,side:u.side,line:u.line,stat:u.stat,probability:u.probability,game:u.game,lockAt:u.lockAt,
   why:whyLine(u)})):[],
  next:nextOf(x),
  approvals:(x.ops?.status?.blockers??[]).map(b=>({text:b.text,action:b.action}))};
}

/** The props part of the briefing from a loaded ledger (null when it is not configured or could not be read). */
export function propsInput(raw:Raw|null):BriefingInput['props']{
 if(!raw)return null;
 const pp=buildView(raw,'prizepicks'),p6=buildView(raw,'pick6');
 let collection:CollectionStatus|null=null;
 try{collection=collectionStatusFromRaw(raw);}catch{collection=null;}
 return {raw,pp,p6,collection,noPicks:whyNoPicks({view:pp,status:collection,nowIso:raw.nowIso,control:raw.control})};
}

/** "3:07 PM" in New Mexico time, for list rows. */
export const briefingTime=mtTime;
