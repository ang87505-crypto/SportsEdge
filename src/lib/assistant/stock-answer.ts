/** Pure answers over existing stock dashboard read models. No orders or network. */
import type {PaperAutoLedger,UnregisteredLedger} from '../stocks/paper-auto-ledger.ts';
import {forwardPerformance} from '../stocks/paper-auto-performance.ts';
import {usdCents,pct} from '../format.ts';
import type {normalizePaperSnapshot} from '../server/alpaca-paper-reader.ts';
import type {Reply,Card} from './answer.ts';
import {rangeBounds} from './answer.ts';
import type {AssistantContext} from './understand.ts';
import type {QuestionRoute} from './domain.ts';
import {RESEARCH_NAMES,RESEARCH_REPORT_URL,type ResearchView} from '../research/stock-summary.ts';
export type StockAccounts={state:'ready'|'owner_required'|'unavailable';ledgers:(PaperAutoLedger|UnregisteredLedger)[];brokerWritesEnabled:boolean|null};
export type PaperSnapshot=ReturnType<typeof normalizePaperSnapshot>;
export type BrokerView={state:'ready';snapshot:PaperSnapshot}|{state:'owner_required'|'unavailable'};
const stamp=(s:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(s));
const links=(items:{label:string;href:string}[]):Card=>({kind:'links',items});
const stockLinks=()=>links([{label:'Paper autopilot',href:'/stocks/paper-auto'},{label:'Paper account and positions',href:'/stocks/alpaca'},{label:'Strategy research',href:'/stocks/research'}]);
const context=(q:QuestionRoute):AssistantContext=>({domain:q.domain??undefined,topic:q.topic,symbol:q.symbol,strategyId:q.strategyId});
const reply=(q:QuestionRoute,text:string,cards:Card[]=[],privateData=false):Reply=>({text,cards,suggestions:['Stock results','Stock bot status','Research results',"Tonight's picks"],context:context(q),private:privateData});
export function stockAnswer(q:QuestionRoute,accounts:StockAccounts,broker:BrokerView|null,nowIso:string,range:AssistantContext['range']=undefined):Reply{
 if(q.topic==='controls')return reply(q,'Use the owner controls to review and confirm a paper action. Chat is read-only and has not submitted an order or changed the bot.',[stockLinks()]);
 if(accounts.state==='owner_required'&&broker?.state!=='ready')return reply(q,'Sign in with your existing owner key on the Paper account page to see stock account details here. Public strategy research is available without account access.',[stockLinks()]);
 if(q.topic==='holdings'&&broker?.state==='ready'){
  const s=broker.snapshot,positions=q.symbol?s.positions.filter(p=>p.symbol===q.symbol):s.positions;
  const money=(v:string)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v));
  return reply(q,`Connected Alpaca PAPER account, captured ${stamp(s.capturedAt)}: equity ${money(s.account.equityUsd)}, cash ${money(s.account.cashUsd)}. ${positions.length?positions.map(p=>`${p.symbol}: ${p.qty} ${p.side} shares, market value ${money(p.marketValueUsd)}`).join('; '):q.symbol?`No ${q.symbol} position in this account.`:'No open positions.'} This is an account snapshot, not a strategy profit calculation.`,[stockLinks()],true);
 }
 if(q.topic==='holdings')return reply(q,'I cannot verify current broker positions right now. Planned targets and fill records do not establish the complete current holdings. Open the Paper account page for connection status.',[stockLinks()],accounts.state==='ready');
 if(accounts.state!=='ready')return reply(q,'The stock ledger is unavailable right now. That does not mean the portfolio is empty or its profit is zero. Research results can still be read separately.',[stockLinks()]);
 const parts:string[]=[];
 const facts:{label:string;value:string;detail?:string}[]=[];
 for(const l of accounts.ledgers){
  if(!l.registered){parts.push(`${l.experimentId}: not registered.`);continue;}
  if(q.topic==='performance'){
   const p=forwardPerformance(l.experiment.startingEquityCents,l.experiment.registeredAt,l.daily);
   if(range&&range!=='all'){
    const b=rangeBounds(range,nowIso);
    const day=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
    const from=day(b.from),to=day(b.to);
    const inside=p.marks.filter(m=>m.session>=from&&m.session<to);
    if(!inside.length||inside.some(m=>m.verdict!=='VERIFIED'))parts.push(`${l.experimentId}: no complete verified marks for ${b.label.toLowerCase()}. Missing marks do not mean zero profit.`);
    else {
     const first=inside[0],last=inside[inside.length-1];
     const preceding=p.marks.filter(m=>m.session<first.session);
     const prior=preceding[preceding.length-1];
     if(prior&&prior.verdict!=='VERIFIED')parts.push(`${l.experimentId}: the prior mark is unreconciled; this period's change is unknown.`);
     else {
      const base=prior?.equityCents??l.experiment.startingEquityCents;
      parts.push(`${l.experimentId}: recorded paper equity changed ${usdCents(last.equityCents-base,{signed:true})}, from ${prior?.session??'registration'} to ${last.session}. This is the change between those recorded marks; intervening sessions are not calendar-verified.`);
     }
    }
   }else if(p.verified.pnlCents===null)parts.push(`${l.experimentId}: no verified after-close profit measurement yet.`);
   else {
    parts.push(`${l.experimentId}: verified recorded paper result ${usdCents(p.verified.pnlCents,{signed:true})} (${pct(p.verified.cumulativeReturn,1)}) since registration, through ${p.verified.throughSession}. ${p.verified.state==='ENDED'?'Measurement ended after account contamination. ':''}${p.verified.skippedMarks?'Some unreconciled marks were skipped. ':''}`);
    facts.push({label:l.experimentId,value:usdCents(p.verified.pnlCents,{signed:true}),detail:`Realized: ${p.verified.realizedPlCents===null?'unknown':usdCents(p.verified.realizedPlCents,{signed:true})}; unrealized: ${p.verified.unrealizedPlCents===null?'unknown':usdCents(p.verified.unrealizedPlCents,{signed:true})}. Not annualized.`});
   }
  }else if(q.topic==='picks'){
   const d=[...l.decisions].sort((a,b)=>b.decisionAt.localeCompare(a.decisionAt))[0];
   parts.push(d?`${l.experimentId}: last decision ${d.session} was ${d.outcome}. Planned targets: ${d.targets.join(', ')||'none'}. This is a plan, not proof of a purchase. ${l.intents.filter(i=>Number(i.filledQty)>0).length} recent intent records report fills.`:`${l.experimentId}: no decision recorded yet.`);
  }else if(q.topic==='explain'){
   parts.push(`${l.experimentId} uses ${l.status.modelVersion}. The weekly momentum model evaluates completed history, skips the latest month and checks the long-term trend. Last recorded blockers: ${l.status.lastCheckBlockers.join(', ')||'none reported'}. Research challengers have separate evidence and are not this account's results.`);
  }else{
   const run=[...l.runs].sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
   parts.push(`${l.experimentId}: ${l.status.state}, gate ${l.status.gateMode} (${l.status.gateReason}), checked ${stamp(l.status.checkedAt)}. ${run?`Last recorded ${run.kind} run: ${run.status}${run.finishedAt?' at '+stamp(run.finishedAt):''}. `:''}Blockers: ${l.status.lastCheckBlockers.join(', ')||'none reported'}. ${l.status.unresolvedIntents} unresolved intents; ${l.status.unacknowledgedCriticalAlerts} unacknowledged critical alerts.`);
  }
 }
 if(!parts.length)parts.push('No configured stock experiments were returned.');
 if(q.topic!=='performance')parts.push(`Paper broker writes: ${accounts.brokerWritesEnabled===null?'not reported':accounts.brokerWritesEnabled?'enabled':'disabled'}. A planned schedule does not prove a successful run.`);
 const out=reply(q,parts.join('\n\n'),[...(facts.length?[{kind:'facts' as const,items:facts}]:[]),stockLinks()],true);
 out.context.range=range;return out;
}
const checkNames:Record<string,string>={max_drawdown_within_35pct:'drawdown exceeded 35%',sharpe_above_spy_buy_and_hold:'risk-adjusted return did not beat SPY',cagr_above_exposure_matched_spy:'return did not beat exposure-matched SPY',sharpe_above_weekly:'risk-adjusted return did not beat the weekly strategy'};
export function researchAnswer(q:QuestionRoute,view:ResearchView):Reply{
 const s=view.summary;
 if(!s)return reply(q,'Stock research is not connected yet. No return is inferred from missing results.',[links([{label:'Research',href:'/stocks/research'}])]);
 const mode=view.mode==='saved'?'Saved research report; live feed unavailable.':'Published research summary.';
 const parts=[`${mode} Updated ${stamp(s.generatedAt)}. Overall: ${s.overall}. No research candidate is activated.`];
 if(q.topic==='automation')return reply(q,[...parts,
  'Last recorded source checks: '+s.sources.map(x=>`${x.id}: ${x.status} at ${stamp(x.retrievedAt)}`).join('; ')+'.',
  s.candidates.map(c=>`${RESEARCH_NAMES[c.id]}: ${c.forward.sessions} forward sessions; ${c.forward.status.replaceAll('_',' ')}.`).join(' '),
  'These are saved observations, not proof that a future scheduled run will succeed.'].join('\n\n'),
  [links([{label:'Research dashboard',href:'/stocks/research'},{label:'Published report',href:RESEARCH_REPORT_URL}])]);
 const facts:{label:string;value:string;detail?:string}[]=[];
 for(const c of s.candidates.filter(c=>!q.strategyId||c.id===q.strategyId)){
  const name=RESEARCH_NAMES[c.id],h=c.historical,f=c.forward;
  if(h){
   parts.push(`${name}: ${h.verdict}. Historical continuous return ${pct(h.continuous.cagr,1)} annualized at ${h.costBps} bps per side; drawdown ${pct(h.continuous.max_drawdown,1)}. With the safety halt enforced, CAGR was ${pct(h.asLive.cagr,1)}. Failed checks: ${h.failedChecks.map(k=>checkNames[k]??k.replaceAll('_',' ')).join('; ')||'none'}.`);
   facts.push({label:name,value:`${pct(h.continuous.cagr,1)} historical CAGR`,detail:`${h.verdict} · continuous simulation · ${h.costBps} bps per side`});
  }else parts.push(`${name}: no historical follower performance; reliable old holdings snapshots are unavailable.`);
  parts.push(`${name} forward paper: ${f.status.replaceAll('_',' ')}; ${f.sessions} measured sessions. ${f.totalReturn===null?'No forward return measured yet.':`Cumulative return ${pct(f.totalReturn,1)}.`}`);
 }
 if(s.window)parts.push(`Historical window ${s.window.join(' to ')}; SPY buy-and-hold CAGR ${pct(s.benchmark.cagr,1)} with dividends before investor costs. This previously inspected, survivorship-biased history is exploratory; it is not profit in your account.`);
 if(q.topic==='holdings'||q.topic==='explain')parts.push('Last recorded source checks: '+s.sources.map(x=>`${x.id}: ${x.status} at ${stamp(x.retrievedAt)}`).join('; ')+'.');
 return reply(q,parts.join('\n\n'),[...(facts.length?[{kind:'facts' as const,items:facts}]:[]),links([{label:'Research dashboard',href:'/stocks/research'},{label:'Full published research report',href:RESEARCH_REPORT_URL},{label:'QMOM disclosed holdings',href:'https://funds.alphaarchitect.com/qmom/'}])]);
}
