/**
 * Answers for the props assistant. Pure: parsed question + loaded ledger views → reply text, cards and
 * suggestions. Every number comes from the same view the PrizePicks page renders; nothing is guessed.
 * "Not graded yet" (lines exist, no result) is kept distinct from "no data" (no lines at all).
 */
import type {PropsView} from '../props/dashboard-view.ts';
import {propsSummary,whyLine,mtShort} from '../props/summary.ts';
import {PLATFORM_LABEL} from '../props/contract.ts';
import {playerKey} from '../props/identity.ts';
import {pct,usdCents} from '../format.ts';
import type {AssistantContext,Parsed,RangeKey} from './understand.ts';
import type {SlotRow} from '../props/slot-status.ts';
import type {CollectionStatus} from '../props/collection-status.ts';
import {whyNoPicks} from '../props/no-picks.ts';
import {canSpend,EVENTS_LIST_COST,eventOddsWorstCost} from '../props/budget.ts';

export type AssistantData={nowIso:string;pp:PropsView;p6:PropsView;control:{state:string;reason:string}|null;
 nextCollect:string|null;nextSettle:string|null;
 /** Scheduled slots joined to their runs (src/lib/props/slot-status.ts), newest first. Absent = not loaded. */
 slots?:SlotRow[];
 /** When the oldest credit counted in the rolling 24 hours rolls off (frees budget), or null. */
 creditsRollOffAt?:string|null;
 /** Capture-window and budget status (src/lib/props/collection-status.ts); absent = not loaded. */
 collection?:CollectionStatus|null;
 /** The previous turn's context, so "why?" can refer to the last answer's picks. */
 context?:AssistantContext|null};
export type Card={kind:'picks';items:{id:number;text:string;detail:string}[]}|{kind:'entries';items:{id:number;text:string;detail:string}[]}|
 {kind:'lineup';text:string}|{kind:'links';items:{label:string;href:string}[]}|
 {kind:'facts';items:{label:string;value:string;detail?:string}[]};
export type Reply={text:string;cards:Card[];suggestions:string[];context:AssistantContext;private?:boolean};
type Line=PropsView['lines'][number];

const DAY=86400_000;
const mtDate=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
/** UTC instant of midnight in New Mexico on a YYYY-MM-DD date (daylight saving handled by probing both offsets). */
function mtMidnight(date:string):number{
 const [y,m,d]=date.split('-').map(Number);
 for(const off of [6,7]){const t=Date.UTC(y,m-1,d,off);if(mtDate(t)===date&&mtDate(t-1)!==date)return t;}
 return Date.UTC(y,m-1,d,7);
}
const shift=(date:string,days:number)=>mtDate(mtMidnight(date)+days*DAY+12*3600_000);
const shortDate=(date:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z'));

export function rangeBounds(r:RangeKey,nowIso:string):{from:string;to:string;label:string}{
 const today=mtDate(Date.parse(nowIso));
 const span=(a:string,b:string,label:string)=>({from:new Date(mtMidnight(a)).toISOString(),to:new Date(mtMidnight(b)).toISOString(),label});
 if(r==='today')return span(today,shift(today,1),'Tonight');
 if(r==='yesterday')return span(shift(today,-1),today,'Last night');
 if(r==='week')return span(shift(today,-6),shift(today,1),'This week');
 if(r==='all')return {from:'1970-01-01T00:00:00.000Z',to:'9999-12-31T00:00:00.000Z',label:'All time'};
 const d=r.slice(5);
 return span(d,shift(d,1),shortDate(d));
}

const sideWord=(s:'more'|'less'|null)=>s==='less'?'Less':'More';
const pickText=(l:{player:string;side:'more'|'less'|null;line:number;stat:string})=>`${l.player} ${sideWord(l.side)} ${l.line} ${l.stat}`;
const inRange=(iso:string,b:{from:string;to:string})=>iso>=b.from&&iso<b.to;
const viewFor=(p:Parsed,d:AssistantData)=>p.platform==='pick6'?d.p6:d.pp;
const ctx=(p:Parsed,extra:Partial<AssistantContext>={}):AssistantContext=>({intent:p.intent==='unknown'?undefined:p.intent,
 player:p.player&&'name' in p.player?p.player.name:undefined,stat:p.stat??undefined,range:p.range??undefined,...extra});
const reply=(text:string,suggestions:string[],context:AssistantContext,cards:Card[]=[]):Reply=>({text,cards,suggestions:suggestions.slice(0,4),context});

/** "last night", "this week", "on Nov 7": a range label inside a sentence. */
const inWords=(label:string)=>/^\w+ \d+$/.test(label)?`on ${label}`:label.toLowerCase();
const possessiveOf=(label:string)=>`${label}'s`;
const sideProb=(l:Line)=>(l.side==='less'?l.pLess:l.pMore)??0;
/** Tonight's recorded picks that have already locked, most confident first (optionally one stat). */
function lockedTonight(v:PropsView,stat:string|null,nowIso:string):Line[]{
 const today=rangeBounds('today',nowIso);
 return v.lines.filter(l=>l.decision==='recorded'&&l.locked&&inRange(l.lockAt,today)&&(!stat||l.stat===stat))
  .sort((a,b)=>sideProb(b)-sideProb(a)||a.id-b.id);
}

/** Recorded, not-yet-locked picks, most confident first (optionally one stat). */
function upcoming(v:PropsView,stat:string|null){
 return propsSummary(v).upcoming.filter(u=>!stat||u.stat===stat);
}
/** The best two from different games, for a two-pick entry. */
function bestPair<T extends {game:string}>(xs:T[]):T[]{
 const first=xs[0];if(!first)return [];
 const second=xs.find(x=>x.game!==first.game);
 return second?[first,second]:[first];
}

function picks(p:Parsed,d:AssistantData):Reply{
 const v=viewFor(p,d);
 const list=upcoming(v,p.stat);
 const sugg=['Why the top pick?','Give me a lineup','How did last night go?'];
 if(!list.length){
  const locked=lockedTonight(v,p.stat,d.nowIso);
  if(locked.length)return reply(`Tonight's ${p.stat?`${p.stat} `:''}picks have locked: ${locked.map(l=>`${pickText(l)} (${pct(sideProb(l),0)})`).join(', ')}. Results come after the morning grading run.`,
   ['How did last night go?',"What's my record?",'Is it running?'],ctx(p,{lastPickIds:locked.map(l=>l.id)}),
   [{kind:'picks',items:locked.map(l=>({id:l.id,text:`${pickText(l)} · ${pct(sideProb(l),0)}`,detail:`${l.game} · locked ${mtShort(l.lockAt)}`}))}]);
  const today=rangeBounds('today',d.nowIso);
  const collected=v.lines.some(l=>inRange(l.lockAt,today));
  const text=collected?`No line passed the pick rules${p.stat?` for ${p.stat}`:''} tonight (60–80% model confidence).`
   :`No picks for tonight yet. The next line collection is ${d.nextCollect?mtShort(d.nextCollect):'not scheduled right now'}.`;
  return reply(text,['How did last night go?',"What's my record?",'Is it running?'],ctx(p,{lastPickIds:[]}));
 }
 const fmt=(u:typeof list[number])=>`${pickText(u)} (${pct(u.probability,0)})`;
 // With a stat filter, the two most confident of that stat; otherwise the best pair from different games.
 const shown=p.stat?list.slice(0,2):bestPair(list);
 const text=shown.length<2?`Tonight's only pick${p.stat?` for ${p.stat}`:''}: ${fmt(shown[0])}.`
  :p.stat?`Top ${p.stat} picks for tonight: ${fmt(shown[0])} and ${fmt(shown[1])}.`
  :`Top two for tonight: ${fmt(shown[0])} and ${fmt(shown[1])}. Different games, so they fit one entry.`;
 return reply(text,sugg,ctx(p,{lastPickIds:shown.map(u=>u.id)}),
  [{kind:'picks',items:list.map(u=>({id:u.id,text:`${pickText(u)} · ${pct(u.probability,0)}`,detail:`${u.game} · locks ${mtShort(u.lockAt)}`}))}]);
}

function findLine(p:Parsed,d:AssistantData):Line|null{
 const all=[...d.pp.lines,...d.p6.lines];
 const id=d.context?.lastPickIds?.[0];
 if(p.player&&'name' in p.player){
  const key=playerKey(p.player.name);
  const mine=all.filter(l=>playerKey(l.player)===key&&(!p.stat||l.stat===p.stat));
  return mine.find(l=>l.decision==='recorded'&&!l.locked)??mine.find(l=>l.decision==='recorded')??mine[0]??null;
 }
 return id!==undefined?all.find(l=>l.id===id)??null:null;
}

function why(p:Parsed,d:AssistantData):Reply{
 const l=findLine(p,d);
 if(!l||l.pMore===null||l.pLess===null)return reply("Ask about tonight's picks first, then ask why.",["Tonight's picks",'How did last night go?'],ctx(p));
 const side=l.side??(l.pMore>=l.pLess?'more':'less');
 const prob=side==='more'?l.pMore:l.pLess;
 const reason=whyLine(l);
 const note=prob>0.7?' Heads-up: above 70% the model has been overconfident in past seasons, so treat it as less certain than it looks.':'';
 return reply(`${pickText({...l,side})}: ${pct(prob,0)}.${reason?` ${reason}.`:''}${note}`,["Tonight's picks",'Give me a lineup',`${l.player} results`],
  ctx(p,{player:l.player,lastPickIds:[l.id]}));
}

function results(p:Parsed,d:AssistantData):Reply{
 const v=viewFor(p,d);
 const b=rangeBounds(p.range??'yesterday',d.nowIso);
 const lines=v.lines.filter(l=>inRange(l.lockAt,b)&&(!p.stat||l.stat===p.stat));
 const graded=lines.filter(l=>l.decision==='recorded'&&l.correct!==null);
 const entries=v.entries.filter(e=>inRange(e.lockAt,b));
 const settled=entries.filter(e=>e.settlement).sort((a,c)=>a.id-c.id);
 const sugg=["What's my record?","Tonight's picks",'Show my entries'];
 const label=b.label;
 if(!lines.length&&!entries.length)return reply(`I don't have any lines for ${label.toLowerCase()}.`,sugg,ctx(p));
 const later='Results usually appear after the morning grading run.';
 // Entries mix stats, so a one-stat question is answered from that stat's picks alone, and says so.
 if(p.stat){
  if(!lines.some(l=>l.decision==='recorded'))return reply(`No ${p.stat} picks ${inWords(label)}.`,sugg,ctx(p));
  if(!graded.length)return reply(`${possessiveOf(label)} ${p.stat} picks aren't graded yet. ${later}`,sugg,ctx(p));
  const c=graded.filter(l=>l.correct).length;
  return reply(`${label}, ${p.stat} picks hit ${c} of ${graded.length} (${pct(c/graded.length,0)}).`,sugg,ctx(p));
 }
 if(!graded.length&&!settled.length)return reply(`${possessiveOf(label)} games aren't graded yet. ${later}`,sugg,ctx(p));
 const won=settled.filter(e=>e.settlement!.outcome==='won').length,lost=settled.filter(e=>e.settlement!.outcome==='lost').length;
 const each=settled.map(e=>{const s=e.settlement!;
  return s.profitCents===null?`#${e.id} ${s.wins} of ${s.wins+s.losses} legs hit (payout unknown)`:
   `#${e.id} ${s.outcome==='won'?'won':s.outcome==='lost'?'lost':'refunded'} ${usdCents(s.profitCents,{signed:true})}`;});
 const correct=graded.filter(l=>l.correct).length;
 const parts=[settled.length?`${label} went ${won}–${lost} on entries: ${each.join(', ')}.`:`${label}: no settled entries.`];
 if(graded.length)parts.push(`Picks hit ${correct} of ${graded.length} (${pct(correct/graded.length,0)}).`);
 if(v.bankroll)parts.push(`Balance ${usdCents(v.bankroll.balanceCents)}.`);
 return reply(parts.join(' '),sugg,ctx(p));
}

function record(p:Parsed,d:AssistantData):Reply{
 const v=viewFor(p,d);
 const sugg=['How did last night go?',"Tonight's picks",'Is it running?'];
 if(p.range&&p.range!=='all'){
  const b=rangeBounds(p.range,d.nowIso);
  const settled=v.entries.filter(e=>inRange(e.lockAt,b)&&e.settlement);
  const graded=v.lines.filter(l=>inRange(l.lockAt,b)&&l.decision==='recorded'&&l.correct!==null);
  const won=settled.filter(e=>e.settlement!.outcome==='won').length,lost=settled.filter(e=>e.settlement!.outcome==='lost').length;
  const net=settled.every(e=>e.settlement!.profitCents!==null)?settled.reduce((a,e)=>a+e.settlement!.profitCents!,0):null;
  const c=graded.filter(l=>l.correct).length;
  return reply([settled.length?`${b.label}: entries ${won}–${lost}${net===null?'':` (${usdCents(net,{signed:true})})`}.`:`${b.label}: no settled entries yet.`,
   graded.length?`Picks hit ${c} of ${graded.length} (${pct(c/graded.length,0)}).`:'No graded picks yet.'].join(' '),sugg,ctx(p));
 }
 const s=propsSummary(v);
 const parts:string[]=[];
 if(s.balanceCents!==null&&v.bankroll)parts.push(`Balance ${usdCents(s.balanceCents)} (${usdCents(s.netCents,{signed:true})} since the ${usdCents(v.bankroll.initialCents)} start).`);
 else parts.push(`${PLATFORM_LABEL[v.platform]} payouts depend on other entrants, so there is no balance.`);
 parts.push(`Entries ${s.record.won}–${s.record.lost}.`);
 parts.push(s.hitRate===null?'No graded picks yet.':`Picks hit ${s.correct} of ${s.graded} (${pct(s.hitRate,1)}) over the last two weeks.`);
 return reply(parts.join(' '),sugg,ctx(p));
}

function player(p:Parsed,d:AssistantData):Reply{
 const name=p.player&&'name' in p.player?p.player.name:null;
 if(!name)return reply('Which player? Try a name like "Jokic rebounds".',["Tonight's picks",'Help'],ctx(p));
 const key=playerKey(name);
 const lines=[...d.pp.lines,...d.p6.lines].filter(l=>playerKey(l.player)===key&&(!p.stat||l.stat===p.stat))
  .sort((a,b)=>b.lockAt.localeCompare(a.lockAt)||(a.id-b.id)).slice(0,4);
 if(!lines.length)return reply(`I don't see a line for ${name}${p.stat?` ${p.stat}`:''} in the last two weeks.`,["Tonight's picks",'Help'],ctx(p));
 const platformOf=(l:Line)=>d.pp.lines.includes(l)?'prizepicks':'pick6';
 const each=lines.map(l=>{
  const est=l.pMore===null?'no model estimate':`model More ${pct(l.pMore,0)}`;
  const dec=l.decision==='recorded'?`picked ${sideWord(l.side)}`:'skipped';
  const res=l.result?(l.result.outcome==='more'||l.result.outcome==='less'?`went ${l.result.actual} (${sideWord(l.result.outcome)})`:
   l.result.outcome==='tie'?`tied at ${l.result.actual}`:'void')
   :l.locked?'not graded yet':`locks ${mtShort(l.lockAt)}`;
  return `${PLATFORM_LABEL[platformOf(l)]} ${l.stat} ${l.line}: ${est}, ${dec}; ${res}.`;
 });
 const recorded=lines.find(l=>l.decision==='recorded');
 return reply(`${name}: ${each.join(' ')}`,['Why?',"Tonight's picks",'How did last night go?'],
  ctx(p,{player:name,lastPickIds:recorded?[recorded.id]:[]}));
}

function entries(p:Parsed,d:AssistantData):Reply{
 const v=viewFor(p,d);
 if(!v.entries.length)return reply('No entries yet.',["Tonight's picks",'Give me a lineup'],ctx(p));
 const open=v.entries.filter(e=>!e.settlement),settled=v.entries.filter(e=>e.settlement);
 const items=[...open,...settled].slice(0,8).map(e=>({id:e.id,
  text:`#${e.id} · ${usdCents(e.stakeCents)} · ${!e.settlement?'open':e.settlement.profitCents===null?'payout unknown':`${e.settlement.outcome} ${usdCents(e.settlement.profitCents,{signed:true})}`}`,
  detail:e.legs.map(l=>pickText(l)).join('; ')}));
 return reply(`${open.length} open entr${open.length===1?'y':'ies'}, ${settled.length} settled.`,['How did last night go?',"What's my record?"],ctx(p),[{kind:'entries',items}]);
}

function lineup(p:Parsed,d:AssistantData):Reply{
 const pair=bestPair(upcoming(d.pp,p.stat));
 if(!pair.length&&lockedTonight(d.pp,p.stat,d.nowIso).length)
  return reply("Tonight's picks have locked, so there's no lineup left to enter.",['How did last night go?',"What's my record?"],ctx(p));
 if(pair.length<2)return reply('Not enough picks from different games tonight for a two-pick lineup yet.',["Tonight's picks",'Is it running?'],ctx(p));
 const text=pair.map(u=>pickText(u)).join('; ');
 return reply("Here's a two-pick lineup from tonight's top picks. Enter it in PrizePicks yourself:",['Why the top pick?','How did last night go?'],
  ctx(p,{lastPickIds:pair.map(u=>u.id)}),[{kind:'lineup',text}]);
}

const HELP_SUGGESTIONS=["Tonight's picks",'How did last night go?',"What's my record?",'Is it running?'];
const CAN_DO="I can tell you tonight's picks and why, how a night or week went, your record, a player's lines, your entries, a copy-ready lineup, and whether the system and model are running.";
function help(p:Parsed):Reply{
 return reply(p.intent==='unknown'?`I'm not sure what you mean. ${CAN_DO}`:CAN_DO,HELP_SUGGESTIONS,ctx(p));
}

const modelName=(v:string|null|undefined)=>!v||v==='props-nb-minutes-rate-v1'?'the stats model':v.replace(/^props-learn-v/,'Learning model v');
const cap=(t:string)=>t.charAt(0).toUpperCase()+t.slice(1);

function status(p:Parsed,d:AssistantData):Reply{
 const sugg=["Tonight's picks",'Which model is active?','How did last night go?'];
 const c=d.control;
 if(!c)return reply("I can't tell whether picking is running right now.",sugg,ctx(p));
 if(c.state==='PAUSED'&&c.reason.startsWith('SAFETY_BRAKE:'))
  return reply(`Picking is paused by the safety brake: ${c.reason.slice('SAFETY_BRAKE:'.length).trim()}. Grading still runs. Press Resume on the PrizePicks page when you are ready.`,
   ["What went wrong?","What's my record?"],ctx(p));
 if(c.state!=='RUNNING')
  return reply(`Picking is ${c.state==='PAUSED'?'paused':'stopped'} (${c.reason}). Nothing new runs until you press Resume on the PrizePicks page.`,sugg,ctx(p));
 const last=d.pp.automation.lastCollect?.finished_at??null;
 return reply(`Picking is running. Last line collection ${last?mtShort(last):'not recorded yet'}. Next collection ${d.nextCollect?mtShort(d.nextCollect):'not scheduled'}; next grading ${d.nextSettle?mtShort(d.nextSettle):'not scheduled'}.`,
  sugg,ctx(p));
}

const SLOT_OUTCOME:Record<string,string>={
 BUDGET_EXHAUSTED:'skipped: the rolling 24-hour Odds API credit cap was already used, so nothing was spent',
 SKIPPED_LATE:'skipped: it started too late for its slot, so it spent nothing',
 CONTROL_PAUSED:'skipped: paused by the owner control',CONTROL_STOPPED:'skipped: stopped by the owner control',
 SCHEDULED_RUNS_RELEASED_OFF:'skipped: scheduled runs are released off',ODDS_NOT_CONFIGURED:'failed: the Odds API key is not configured',
 SUPERSEDED_BY_TICK:'stood down for the event-aware capture ticks',
};
function slotSentence(s:SlotRow):string{
 const when=mtShort(s.scheduledFor);
 if(s.state==='NO_RUN_RECORDED')return `${when}: no run recorded (GitHub and the backup did not start it, or it is still late).`;
 if(s.state==='RUNNING')return `${when}: running now.`;
 if(s.state==='FAILED')return `${when}: failed (${s.outcome??'unknown outcome'}).`;
 if(s.state==='SKIPPED')return `${when}: ${SLOT_OUTCOME[s.outcome??'']??'skipped ('+s.outcome+')'}.`;
 const counts=s.decisions===null?'counts not recorded':
  `${s.decisions} line decision${s.decisions===1?'':'s'}, ${s.qualifyingPicks??'unknown'} qualifying pick${s.qualifyingPicks===1?'':'s'}, ${s.entriesCreated??'unknown'} entr${s.entriesCreated===1?'y':'ies'}`;
 const why=s.noEntryReasons.length?' No entry: '+s.noEntryReasons.map(r=>`${PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL]??r.platform} — ${r.text}`).join(' '):'';
 const out=s.outcome&&s.outcome!=='COMPLETED'?` (${SLOT_OUTCOME[s.outcome]??s.outcome})`:'';
 return `${when}: collected${out} — ${counts}.${why}`;
}
/** Why there are (or are not) picks today: each of today's collection slots from its receipt, newest first. */
function nopicks(p:Parsed,d:AssistantData):Reply{
 const sugg=["Tonight's picks",'Is the Odds API budget used up?','Is it running?'];
 // Capture ticks: the same receipt-based reason the PrizePicks page shows.
 if(d.collection?.mode==='ticks'){
  const w=whyNoPicks({view:d.pp,status:d.collection,nowIso:d.nowIso,control:d.control});
  const slate=d.collection.slates[0];
  const games=slate?slate.games.map(g=>`- ${g.matchup}: ${g.state.toLowerCase().replace(/_/g,' ')} (${String(g.arm).toUpperCase()} window ${mtShort(g.window.from)} to ${mtShort(g.window.to)})`).join('\n'):'';
  return reply(`${w.headline}.${w.detail?' '+w.detail:''}${games?`\nSelected games for ${slate!.date}:\n${games}`:''}`,sugg,ctx(p),
   [{kind:'links',items:[{label:'Capture receipts',href:'/paper-betting/props'}]}]);
 }
 const c=d.control;
 if(c&&c.state!=='RUNNING')return reply(`Picking is ${c.state==='PAUSED'?'paused':'stopped'} (${c.reason}), so no new picks are made until it is resumed on the PrizePicks page.`,sugg,ctx(p));
 const queued=upcoming(d.pp,null).length;
 if(!d.slots)return reply(`I can't read today's collection receipts. ${queued?`There are ${queued} queued picks for tonight.`:''}`.trim(),sugg,ctx(p));
 const today=rangeBounds('today',d.nowIso);
 const mine=d.slots.filter(s=>s.kind==='collect'&&s.scheduledFor>=today.from&&s.scheduledFor<today.to&&s.state!=='PLANNED');
 const head=queued?`There ${queued===1?'is 1 queued pick':`are ${queued} queued picks`} for tonight.`:'No picks are queued for tonight.';
 const next=`Next collection ${d.nextCollect?mtShort(d.nextCollect):'not scheduled'} (planned, not yet run).`;
 if(!mine.length)return reply(`${head} No collection slot has come due yet today. ${next}`,sugg,ctx(p));
 return reply(`${head} Today's collection slots:\n${mine.map(s=>'- '+slotSentence(s)).join('\n')}\n${next}`,sugg,ctx(p),
  [{kind:'links',items:[{label:'Collection receipts',href:'/paper-betting/props'}]}]);
}

/** The Odds API props budget: rolling 24 h and 30 day use against the reviewed limits, and the provider's own count. */
function budget(p:Parsed,d:AssistantData):Reply{
 const b=d.pp.automation.budget;
 const sugg=["Why no picks today?",'Is it running?',"Tonight's picks"];
 const state={used24h:b.used24h,used30d:b.used30d,providerRemaining:b.providerRemaining};
 const need=EVENTS_LIST_COST+eventOddsWorstCost();
 const can=canSpend({version:b.policyVersion,dailyCredits:b.daily,monthlyCredits:b.monthly,providerFloor:b.floor,maxEventsPerRun:0},state,need);
 const WHY:Record<string,string>={DAILY_CAP:'the rolling 24-hour cap is used up',MONTHLY_CAP:'the rolling 30-day cap is used up',
  PROVIDER_FLOOR:"the provider's remaining credits are at the reserve floor",INVALID:'the budget records are inconsistent'};
 const used=`${b.used24h} of ${b.daily} credits used in the last 24 hours and ${b.used30d} of ${b.monthly} in 30 days`;
 const provider=b.providerRemaining===null?'The provider has not reported its remaining credits yet.':
  `The Odds API last reported ${b.providerRemaining} credits remaining (reserve floor ${b.floor}).`;
 const acct=b.countsProviderActuals?'Provider-confirmed charges are counted; unknown charges stay reserved in full.':'Every request is counted at its worst-case cost.';
 const verdict=can.allowed?`Not exhausted: a collection can still spend (it needs up to ${need}).`:
  `Exhausted for now: ${WHY[can.reason]}, so collections spend nothing.${can.reason==='DAILY_CAP'&&d.creditsRollOffAt?` The oldest counted credits roll off ${mtShort(d.creditsRollOffAt)}.`:''}`;
 return reply(`${verdict} ${used} (policy ${b.policyVersion}). ${provider} ${acct}`,sugg,ctx(p));
}

function model(p:Parsed,d:AssistantData):Reply{
 const m=d.pp.model;
 const sugg=["What went wrong this week?","Tonight's picks",'Is it running?'];
 if(!m)return reply("The learning layer isn't set up yet; the stats model makes every pick.",sugg,ctx(p));
 const STATE:Record<string,string>={shadow_start:'shadowing',eligible:'eligible',created:'replaying'};
 const ch=m.challengers.filter(c=>c.version!==m.active&&STATE[c.state]).map(c=>`${cap(modelName(c.version))} ${STATE[c.state]}`);
 return reply(`Active model: ${cap(modelName(m.active))}. Learning is ${m.learningEnabled?'on':'off'}; auto-switch is ${m.autoSwitchEnabled?'on':'off'}. ${ch.length?`Challengers: ${ch.join(', ')}.`:'No challengers right now.'}`,
  sugg,ctx(p));
}

const CAUSE:Record<string,string>={minutes_collapse:'playing time collapsed',books_were_right:'the sportsbooks were right',matchup:'the matchup',
 overconfidence:'too sure in one confidence range',other:'no single cause'};
function mistakes(p:Parsed,d:AssistantData):Reply{
 const r=d.pp.report;
 const sugg=['Which model is active?',"Tonight's picks","What's my record?"];
 if(!r)return reply('No weekly review yet; the first comes after a Sunday learning run.',sugg,ctx(p));
 const misses=Object.entries(r.report.misses).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
 const total=misses.reduce((a,[,n])=>a+n,0);
 const top=misses.filter(([k])=>k!=='other').slice(0,3).map(([k,n])=>`${CAUSE[k]??k} (${n})`);
 return reply(`${shortDate(r.period_from)} to ${shortDate(r.period_to)}: ${total} missed pick${total===1?'':'s'}.${top.length?` Most common: ${top.join(', ')}.`:''}`,sugg,ctx(p));
}

function future(p:Parsed,d:AssistantData):Reply{
 const queued=upcoming(d.pp,null);
 const runs=`Next: line collection ${d.nextCollect?mtShort(d.nextCollect):'not scheduled'}, then grading ${d.nextSettle?mtShort(d.nextSettle):'not scheduled'}.`;
 const who=`${cap(modelName(d.pp.model?.active))} makes the picks.`;
 const q=queued.length?`Already queued: ${queued.map(u=>`${pickText(u)} (${pct(u.probability,0)})`).join(', ')}.`:'Nothing queued yet.';
 return reply(`${runs} ${who} ${q}`,["Tonight's picks",'Is it running?','Which model is active?'],ctx(p,{lastPickIds:queued.map(u=>u.id)}));
}

function bet(p:Parsed,d:AssistantData):Reply{
 const pair=bestPair(upcoming(d.pp,null));
 const base="I can't place entries — PrizePicks doesn't allow apps to, and SportsEdge is paper-only.";
 if(pair.length<2)return reply(`${base} There's no lineup from tonight's picks yet.`,["Tonight's picks",'Is it running?'],ctx(p));
 return reply(`${base} Here's a lineup you can enter yourself:`,['Why the top pick?','How did last night go?'],ctx(p,{lastPickIds:pair.map(u=>u.id)}),
  [{kind:'lineup',text:pair.map(u=>pickText(u)).join('; ')}]);
}

const listOr=(xs:string[])=>xs.length<=2?xs.join(' or '):`${xs.slice(0,-1).join(', ')} or ${xs[xs.length-1]}`;

export function answer(p:Parsed,d:AssistantData):Reply{
 // Never guess between players, and never invent one the data does not know.
 if(p.player&&'ambiguous' in p.player)return reply(`Did you mean ${listOr(p.player.ambiguous)}?`,p.player.ambiguous.slice(0,4),ctx(p));
 if(p.player&&'unknown' in p.player&&p.intent!=='bet')return reply(`I don't see a line for ${p.player.unknown} in the last two weeks.`,["Tonight's picks",'Help'],ctx(p));
 switch(p.intent){
  case 'picks':return p.range&&p.range!=='today'?results(p,d):picks(p,d);
  case 'why':return why(p,d);
  case 'results':return results(p,d);
  case 'record':return record(p,d);
  case 'player':return player(p,d);
  case 'entries':return entries(p,d);
  case 'lineup':return lineup(p,d);
  case 'status':return status(p,d);
  case 'nopicks':return nopicks(p,d);
  case 'budget':return budget(p,d);
  case 'model':return model(p,d);
  case 'mistakes':return mistakes(p,d);
  case 'future':return future(p,d);
  case 'bet':return bet(p,d);
  case 'smalltalk':return reply("Happy to help. Ask me about tonight's picks, last night's results, or your record.",["Tonight's picks",'How did last night go?',"What's my record?"],ctx(p));
  default:return help(p);
 }
}
