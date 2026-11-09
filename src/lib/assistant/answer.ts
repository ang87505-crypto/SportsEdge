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

export type AssistantData={nowIso:string;pp:PropsView;p6:PropsView;control:{state:string;reason:string}|null;
 nextCollect:string|null;nextSettle:string|null;
 /** The previous turn's context, so "why?" can refer to the last answer's picks. */
 context?:AssistantContext|null};
export type Card={kind:'picks';items:{id:number;text:string;detail:string}[]}|{kind:'entries';items:{id:number;text:string;detail:string}[]}|
 {kind:'lineup';text:string};
export type Reply={text:string;cards:Card[];suggestions:string[];context:AssistantContext};
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
 if(!graded.length&&!settled.length){
  const possessive=label==='Last night'?"Last night's":label==='Tonight'?"Tonight's":`${label}'s`;
  return reply(`${possessive} games aren't graded yet. Results usually appear after the morning grading run.`,sugg,ctx(p));
 }
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
 const s=propsSummary(v);
 const parts:string[]=[];
 if(s.balanceCents!==null&&v.bankroll)parts.push(`Balance ${usdCents(s.balanceCents)} (${usdCents(s.netCents,{signed:true})} since the ${usdCents(v.bankroll.initialCents)} start).`);
 else parts.push(`${PLATFORM_LABEL[v.platform]} payouts depend on other entrants, so there is no balance.`);
 parts.push(`Entries ${s.record.won}–${s.record.lost}.`);
 parts.push(s.hitRate===null?'No graded picks yet.':`Picks hit ${s.correct} of ${s.graded} (${pct(s.hitRate,1)}) over the last two weeks.`);
 return reply(parts.join(' '),['How did last night go?',"Tonight's picks",'Is it running?'],ctx(p));
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
 if(pair.length<2)return reply('Not enough picks from different games tonight for a two-pick lineup yet.',["Tonight's picks",'Is it running?'],ctx(p));
 const text=pair.map(u=>pickText(u)).join('; ');
 return reply("Here's a two-pick lineup from tonight's top picks. Enter it in PrizePicks yourself:",['Why the top pick?','How did last night go?'],
  ctx(p,{lastPickIds:pair.map(u=>u.id)}),[{kind:'lineup',text}]);
}

const HELP_SUGGESTIONS=["Tonight's picks",'How did last night go?',"What's my record?",'Is it running?'];
function help(p:Parsed):Reply{
 return reply("I can tell you tonight's picks and why, how a night or week went, your record, a player's lines, your entries, a copy-ready lineup, and whether the system and model are running.",
  HELP_SUGGESTIONS,ctx(p));
}

export function answer(p:Parsed,d:AssistantData):Reply{
 switch(p.intent){
  case 'picks':return p.range&&p.range!=='today'?results(p,d):picks(p,d);
  case 'why':return why(p,d);
  case 'results':return results(p,d);
  case 'record':return record(p,d);
  case 'player':return player(p,d);
  case 'entries':return entries(p,d);
  case 'lineup':return lineup(p,d);
  default:return help(p);
 }
}
