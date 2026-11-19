/** Whole-site answers from the shared briefing: today, money, health, improvement, opportunity and Monday readiness. Pure. */
import type {Briefing} from '../briefing/briefing.ts';
import {OP_STATES,briefingTime} from '../briefing/briefing.ts';
import type {Readiness} from '../briefing/monday.ts';
import type {Reply,Card} from './answer.ts';
import type {AssistantContext} from './understand.ts';
import type {AssistantTopic} from './domain.ts';

export type BriefingTopic=Extract<AssistantTopic,'today'|'money'|'health'|'improving'|'opportunity'|'ready'>;
export const BRIEFING_TOPICS:BriefingTopic[]=['today','money','health','improving','opportunity','ready'];

const MT=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const when=(iso:string)=>MT.format(new Date(iso));
const money=(c:number,signed=false)=>(c<0?'−':signed&&c>0?'+':'')+'$'+(Math.abs(c)/100).toFixed(2);
const pct=(x:number)=>(x*100).toFixed(1)+'%';
const links=(items:{label:string;href:string}[]):Card=>({kind:'links',items});
const SUGGEST:Record<BriefingTopic,string>={today:'What happened today?',health:'Is any automation broken?',money:'How much did we make this week?',
 improving:'How is the algorithm improving?',opportunity:'Most promising opportunity?',ready:'Are we ready for Monday?'};
const reply=(topic:BriefingTopic,text:string,cards:Card[]=[],extra:Partial<AssistantContext>={},privateData=false):Reply=>
 ({text,cards,suggestions:[...(Object.keys(SUGGEST) as BriefingTopic[]).filter(k=>k!==topic).map(k=>SUGGEST[k]).slice(0,3),'What needs my approval?'],
  context:{domain:'all',topic,...extra},private:privateData});

function systemsText(b:Briefing):string{
 return b.systems.map(s=>`- ${s.name}: ${OP_STATES[s.state].label}. ${s.reason}`).join('\n');
}

export function briefingAnswer(topic:BriefingTopic,b:Briefing,extra:{readiness?:Readiness|null;stockText?:string|null;range?:AssistantContext['range']}={}):Reply{
 const checked=b.health.checkedAt?` (operations check ${when(b.health.checkedAt)}${b.health.stale?', which is old':''})`:'';
 if(topic==='today'){
  const lines=[`${b.health.headline}${checked}. ${b.health.detail}`,systemsText(b)];
  lines.push(b.today.length?'Today so far (Mountain time):\n'+b.today.slice(0,8).map(t=>`- ${briefingTime(t.at)}: ${t.text}`).join('\n'):
   'Nothing has been recorded yet today. Planned times below are plans, not runs.');
  if(b.next.length)lines.push('Next planned (not yet run):\n'+b.next.slice(0,3).map(n=>`- ${when(n.at)}: ${n.what}`).join('\n'));
  lines.push(b.approvals.length?`${b.approvals.length} item${b.approvals.length===1?'':'s'} need${b.approvals.length===1?'s':''} you — ask "What needs my approval?".`:'Nothing is waiting on you.');
  return reply(topic,lines.join('\n\n'),[links([{label:'Overview',href:'/'},{label:'Automation status',href:'/automation'}])]);
 }
 if(topic==='money'){
  const m=b.money,pp=m.prizepicks,parts:string[]=[];
  if(!pp)parts.push(m.note);
  else{
   if(extra.range==='yesterday')parts.push(pp.yesterdaySettled||pp.yesterdayOpen?
    `Yesterday's slate (${pp.yesterdayDate}, Mountain time): ${money(pp.yesterdayNetCents,true)} on ${pp.yesterdaySettled} settled PrizePicks entr${pp.yesterdaySettled===1?'y':'ies'}${pp.yesterdayOpen?`; ${pp.yesterdayOpen} not settled yet`:''}.`:
    `No PrizePicks virtual entry was made for yesterday's slate (${pp.yesterdayDate}, Mountain time), so nothing was won or lost.`);
   if(extra.range==='week')parts.push(`PrizePicks virtual entries, last 7 days: ${money(pp.weekNetCents,true)} on ${pp.weekSettled} settled entr${pp.weekSettled===1?'y':'ies'}.`);
   parts.push(`PrizePicks virtual balance ${money(pp.balanceCents)} (started at ${money(pp.startCents)}; net ${money(pp.netCents,true)}; ${pp.won} won, ${pp.lost} lost; ${pp.openEntries} open with ${money(pp.openStakeCents)} at stake).`);
   if(m.pick6)parts.push(`Pick6: ${m.pick6.settled} settled entr${m.pick6.settled===1?'y':'ies'} with unknown payouts (${m.pick6.payoutUnknown}) and ${m.pick6.open} open. They are not counted in any dollar figure.`);
   parts.push(m.note);
  }
  if(extra.stockText)parts.push('Stocks: '+extra.stockText);
  parts.push('All figures are virtual or PAPER. No real money is involved.');
  return reply(topic,parts.join('\n\n'),[links([{label:'PrizePicks results',href:'/paper-betting/props'},{label:'Stock paper account',href:'/stocks/paper-auto'}])],{range:extra.range},!!extra.stockText);
 }
 if(topic==='health'){
  const h=b.health,parts=[`${h.headline}${checked}. ${h.detail}`];
  if(h.problems.length)parts.push('Details:\n'+h.problems.map(p=>'- '+p).join('\n'));
  parts.push(systemsText(b));
  if(h.deployment)parts.push('Deployment: '+h.deployment);
  parts.push('A green job means the workflow ran; it is not proof that a pick, entry or order was made. Those are listed under "What happened today?".');
  return reply(topic,parts.join('\n\n'),[links([{label:'Automation status',href:'/automation'}])]);
 }
 if(topic==='improving'){
  const l=b.learning,parts:string[]=[];
  if(!l)parts.push('The sports model records could not be read, so I cannot say how it is doing.');
  else{
   parts.push(`Sports props: the active model is ${l.activeModel??'the stats model'}${l.lastTrainedAt?`, last trained ${when(l.lastTrainedAt)}`:''}. ${l.note}`);
   if(l.brier!==null)parts.push(`Probability quality (Brier score, lower is better) across ${l.brierN} scored lines: ${l.brier.toFixed(3)}. A coin flip scores 0.250.`);
   parts.push(l.challengers.length?'Challengers (tested only on games after they were registered):\n'+l.challengers.map(c=>`- ${c.version}: ${c.state.replaceAll('_',' ')}, ${c.gradedLines} graded lines`).join('\n'):
    'No challenger is in shadow testing right now.');
   parts.push('Nothing is promoted until it passes the registered forward test; small samples are reported as small.');
  }
  const r=b.research.stocks;
  parts.push(r?`Stock strategy research (${r.saved?'saved report':'published'} ${when(r.generatedAt)}): ${r.overall.toLowerCase()}${r.daily?`; daily strategies: ${r.daily.toLowerCase()}`:''}. No research candidate is active.`:
   'Stock strategy research is unavailable right now.');
  return reply(topic,parts.join('\n\n'),[links([{label:'Sports model',href:'/paper-betting/props#model'},{label:'Stock research',href:'/stocks/research'}])]);
 }
 if(topic==='opportunity'){
  const parts=['These are model outputs for PAPER testing, not recommendations or predictions of profit.'];
  const sys=b.systems.find(s=>s.id==='props');
  const top=b.upcoming[0];
  if(top)parts.push(`Sports props — highest-confidence recorded pick not yet locked: ${top.player} ${top.side==='more'?'More':'Less'} ${top.line} ${top.stat} `+
   `(${top.game}, locks ${when(top.lockAt)}), model probability ${pct(top.probability)}.${top.why?' Why: '+top.why+'.':''}`+
   (b.upcoming.length>1?` Next: ${b.upcoming.slice(1,3).map(u=>`${u.player} ${u.side==='more'?'More':'Less'} ${u.line} ${u.stat} (${pct(u.probability)})`).join('; ')}.`:''));
  else parts.push(sys?`Sports props: no upcoming pick. ${OP_STATES[sys.state].label}: ${sys.reason}`:'Sports props are unavailable.');
  if(b.learning?.overconfident)parts.push(`Caution: so far the model's stated confidence has run above its actual hit rate (${b.learning.hitRate!==null?pct(b.learning.hitRate):'—'} vs ${b.learning.meanConfidence!==null?pct(b.learning.meanConfidence):'—'}).`);
  if(extra.stockText)parts.push('Stocks: '+extra.stockText);
  else parts.push(`Stocks: ${b.research.stocks?`research reports ${b.research.stocks.overall.toLowerCase()}; no research candidate is active.`:'research is unavailable.'} The weekly autopilot's picks are owner-only.`);
  return reply(topic,parts.join('\n\n'),[links([{label:"Tonight's picks",href:'/paper-betting/props'},{label:'Stock research',href:'/stocks/research'}])],{},!!extra.stockText);
 }
 // ready
 const r=extra.readiness;
 if(!r)return reply(topic,'I cannot check Monday readiness right now. Nothing is assumed to be ready.');
 const mark={READY:'✔',NOT_YET:'…',BLOCKED:'✖',ON_THE_DAY:'◷',OWNER_ONLY:'🔒'} as const;
 const text=[r.verdict,r.items.map(i=>`${mark[i.state]} ${i.label}: ${i.detail}`).join('\n'),
  '✔ ready · … not yet · ✖ blocked · ◷ verified on the day · 🔒 owner sign-in needed. PR #102 stays unmerged until every item passes with real receipts.'].join('\n\n');
 return reply(topic,text,[links([{label:'Stock autopilot',href:'/stocks/paper-auto'},{label:'Session checklist',href:'https://github.com/ang87505-crypto/SportsEdge/blob/main/docs/AUTOMATION_OPERATIONS_2026_11_10.md#first-supervised-stock-paper-session-needs-the-owner'}])],{},r.items.some(i=>i.state!=='OWNER_ONLY'&&['account','arm','check','protections','decision','fills'].includes(i.id)));
}
