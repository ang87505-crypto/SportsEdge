'use client';

import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Badge,Callout,Details,Empty,Metric,MetricGrid,Panel,Segmented,StatusDot} from '@/components/ui';
import {isOwnerStopAlert,OPERATOR_STATES,type PaperAutoLedger,type UnregisteredLedger} from '@/lib/stocks/paper-auto-ledger';
import {forwardPerformance,PAPER_AUTO_PERFORMANCE_LABELS,type MarkVerdict} from '@/lib/stocks/paper-auto-performance';
import {evaluateStockForward,type FunnelStage} from '@/lib/stocks/paper-auto-evaluation';
import {stockResearchTracking,type TargetStatus} from '@/lib/stocks/paper-auto-tracking';
import {activity,combined,headline,holdings,latestPicks,nextRuns,overall,strategy,type CombinedRow} from '@/lib/stocks/autopilot-view';
import {paperRisk} from '@/lib/stocks/paper-risk';
import {ownerKeyInput,ownerSignInError,OWNER_KEY_HINT} from '@/lib/owner-sign-in';

type View='checking'|'login'|'unconfigured'|'error'|'ready';
type Release={paperOnly:true;brokerWritesEnabled:boolean;scheduledRunsEnabled:boolean;realMoneyEnabled:false};
type Ledger=PaperAutoLedger|UnregisteredLedger;
type Act=(body:Record<string,unknown>,confirmText:string)=>Promise<void>;
const START_PAGE='https://github.com/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-owner.yml';
const RUNS_PAGE='https://github.com/ang87505-crypto/SportsEdge/actions';
const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const money=(c:number|null)=>c===null?'—':usd.format(c/100);
const pct=(r:number|null)=>r===null?'—':`${r>=0?'+':''}${(r*100).toFixed(2)}%`;
const dd=(r:number|null)=>r===null?'—':`${(r*100).toFixed(2)}%`;
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString():'—';
const trim=(v:string)=>v.includes('.')?v.replace(/\.?0+$/,''):v;
const toneOf=(t:string)=>t==='positive'?'positive':t==='warning'?'warning':t==='info'?'info':'neutral';
const VERDICT_TEXT:Record<MarkVerdict,string>={VERIFIED:'Verified',UNRECONCILED_SKIPPED:'Unreconciled (skipped)',
 CONTAMINATED:'Contaminated (chain ends)',AFTER_CONTAMINATION:'After contamination'};
/** Planned vs filled, fill price vs limit, exposure and concentration, and what did not trade. From the ledger only. */
function RiskPanel({l,practice}:{l:PaperAutoLedger;practice:boolean}){
 const r=paperRisk(l);
 const bps=(x:number|null)=>x===null?'—':`${x>0?'+':''}${x.toFixed(1)} bps`;
 const skipped=Object.entries(r.skippedRuns);
 return <Panel title="Risk and execution" description="From the autopilot's own records. A plan or an unfilled order is never counted as a fill.">
  <MetricGrid columns={4}>
   <Metric label="Orders this week" value={r.planned?`${r.filled} of ${r.planned} filled`:'None'}
    detail={r.planned?`${r.partial} partly filled · ${r.unfilled} not filled${r.latestSession?` · since ${r.latestSession}`:''}`:practice?'Paper orders are off; runs record plans only':'Orders appear after a TARGETS pick'}/>
   <Metric label="Fill vs limit price" value={bps(r.fillVsLimitBps)} detail={r.fillVsLimitBps===null?'No fills yet':'Share-weighted; negative is better than the limit'}/>
   <Metric label="Invested" value={r.exposure?`${(r.exposure.share*100).toFixed(1)}%`:'—'}
    detail={r.exposure?`${money(r.exposure.stocksCents)} of ${money(r.exposure.equityCents)} at the ${r.exposure.session} close`:'Needs a verified after-close result'}/>
   <Metric label="Largest position" value={r.concentration[0]?`${r.concentration[0].symbol} ${(r.concentration[0].share*100).toFixed(0)}%`:'—'}
    detail={r.concentration[0]?`Of holdings at cost, ${r.concentration.length} stock${r.concentration.length===1?'':'s'}`:'No holdings'}/>
  </MetricGrid>
  {(r.notTraded.length>0||skipped.length>0||r.openIssues.unresolvedIntents>0||r.openIssues.criticalAlerts>0)&&<ul className="quiet mt-12">
   {r.notTraded.map(d=><li key={d.session}>{d.session}: no trade ({d.outcome.replaceAll('_',' ').toLowerCase()}){d.reasons.length?` — ${d.reasons.slice(0,2).join('; ')}`:''}</li>)}
   {skipped.length>0&&<li>Runs that did not trade: {skipped.map(([k,n])=>`${k.replaceAll('_',' ').toLowerCase()} ×${n}`).join(', ')}</li>}
   {r.openIssues.unresolvedIntents>0&&<li>{r.openIssues.unresolvedIntents} order(s) waiting to be confirmed with Alpaca: new orders are blocked until reconciled.</li>}
   {r.openIssues.criticalAlerts>0&&<li>{r.openIssues.criticalAlerts} critical alert(s) to review.</li>}
  </ul>}
  <p className="quiet small-print">Alpaca PAPER fills are simulated (no market impact or queue position). Realized and unrealized results, the SPY comparison and drawdown are above and under Technical details; nothing here is annualized.</p>
 </Panel>;
}

function nyTime(t:number){
 if(!Number.isFinite(t))return '—';
 const et=new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',
  hour:'numeric',minute:'2-digit'});
 const local=new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 return `${et} ET (${local} your time)`;
}

function viewOk(data:unknown):data is {release:Release;start?:{oneClick:boolean};experiments:Ledger[]}{
 if(!data||typeof data!=='object')return false;
 const x=data as Record<string,unknown>,r=x.release as Record<string,unknown>|undefined;
 return x.status==='ok'&&!!r&&r.paperOnly===true&&r.realMoneyEnabled===false&&Array.isArray(x.experiments)&&
  typeof r.brokerWritesEnabled==='boolean'&&typeof r.scheduledRunsEnabled==='boolean'&&
  x.experiments.every(e=>!!e&&typeof e==='object'&&((e as Ledger).registered===false||
   ((e as PaperAutoLedger).registered===true&&
    (OPERATOR_STATES as readonly string[]).includes((e as PaperAutoLedger).status?.state))));
}

export function PaperAutoOperations(){
 const [view,setView]=useState<View>('checking');
 const [release,setRelease]=useState<Release|null>(null);
 const [oneClick,setOneClick]=useState(false);
 const [ledgers,setLedgers]=useState<Ledger[]>([]);
 const [notice,setNotice]=useState<{tone:'positive'|'warning'|'info';text:string}|null>(null);
 const [working,setWorking]=useState(false);
 const [starting,setStarting]=useState<string|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const poll=useRef<number|null>(null);
 const refresh=useCallback(async():Promise<Ledger[]>=>{
  // The top-bar badge caches the status for a minute; a fresh read here replaces it.
  try{sessionStorage.removeItem('sportsedge-autopilot-summary-v2');}catch{/* optional cache */}
  try{
   const res=await fetch('/api/internal/paper-auto',{method:'GET',cache:'no-store',credentials:'same-origin'});
   const data:unknown=await res.json();
   if(res.status===401){setView('login');setLedgers([]);return [];}
   if(res.status===503&&(data as {status?:unknown})?.status==='paper_auto_not_configured'){
    setView('unconfigured');setLedgers([]);return [];}
   if(!res.ok||!viewOk(data)){setView('error');setLedgers([]);return [];}
   setRelease(data.release);setOneClick(data.start?.oneClick===true);setLedgers(data.experiments);setView('ready');
   return data.experiments;
  }catch{setView('error');setLedgers([]);return [];}
 },[]);
 useEffect(()=>{
  const read=()=>{if(document.visibilityState==='visible')void refresh();};
  const t=window.setTimeout(read,0),timer=window.setInterval(read,60_000);
  document.addEventListener('visibilitychange',read);
  return()=>{window.clearTimeout(t);window.clearInterval(timer);document.removeEventListener('visibilitychange',read);
   if(poll.current)window.clearInterval(poll.current);};
 },[refresh]);

 // After Start, re-read every 8 s for up to 3 minutes until the database reports the gate armed.
 const watchStart=(id:string)=>{
  setStarting(id);let tries=0;
  if(poll.current)window.clearInterval(poll.current);
  poll.current=window.setInterval(async()=>{
   tries++;
   const ls=await refresh();
   const l=ls.find(x=>x.experimentId===id);
   const armed=!!l&&l.registered&&l.status.gateMode==='ARMED';
   if(armed||tries>=22){
    if(poll.current)window.clearInterval(poll.current);poll.current=null;setStarting(null);
    setNotice(armed?{tone:'positive',text:'Account check complete. The status below shows whether paper orders are released.'}:{tone:'warning',text:
     'Start has not been confirmed after 3 minutes. Check the refreshed status and GitHub run before trying again.'});
   }
  },8000);
 };
 const act:Act=async(body,confirmText)=>{
  if(working||!window.confirm(confirmText))return;
  setWorking(true);setNotice(null);
  try{
   const res=await fetch('/api/internal/paper-auto',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await res.json() as {status?:string;code?:string};
   if(res.status===401)setNotice({tone:'warning',text:'Your owner session expired. Unlock again below.'});
   else if(data.status==='started'){setNotice({tone:'info',text:'Starting: checking your Alpaca paper account, about a minute.'});
    watchStart(String(body.experimentId));}
   else if(data.status==='recorded'){
    if(body.action==='stop'||body.action==='pause'){
     if(poll.current)window.clearInterval(poll.current);poll.current=null;setStarting(null);
    }
    setNotice({tone:'positive',text:body.action==='stop'?'Stopped. No new orders will be placed.':
     body.action==='pause'?'Paused. No new orders until you use Start again.':`Done: ${String(body.action)}.`});
   }
   else if(data.status==='refused')setNotice({tone:'warning',text:data.code==='ALREADY_RUNNING'?'Autopilot is already on.':
    `Not done (${data.code??'refused'}). Nothing changed.`});
   else if(data.status==='start_not_configured')setNotice({tone:'warning',text:'One-click Start is not set up on this site yet. Use "Start on GitHub" instead.'});
   else setNotice({tone:'warning',text:'The result is unknown. The status below was re-read; check it before trying again. Stop can always be pressed again.'});
  }catch{setNotice({tone:'warning',text:'The result is unknown. The status below was re-read; check it before trying again. Stop can always be pressed again.'});}
  finally{setWorking(false);await refresh();}
 };
 // Emergency stop for every strategy: one confirmation, then STOP for each in turn (always allowed, idempotent).
 const stopAll=async(ids:string[])=>{
  if(working||!window.confirm(`Stop all ${ids.length} strategies? No new orders will be placed. Stocks they already hold stay in the accounts.`))return;
  setWorking(true);setNotice(null);const failed:string[]=[];
  // A Start still being confirmed must not repaint "Starting…" over a recorded Stop.
  if(poll.current)window.clearInterval(poll.current);poll.current=null;setStarting(null);
  for(const id of ids){
   try{
    const res=await fetch('/api/internal/paper-auto',{method:'POST',credentials:'same-origin',cache:'no-store',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop',experimentId:id})});
    const data=await res.json() as {status?:string};
    if(data.status!=='recorded')failed.push(id);
   }catch{failed.push(id);}
  }
  setNotice(failed.length?{tone:'warning',text:`Not confirmed for ${failed.join(', ')}. Press Stop again; it is always allowed.`}:
   {tone:'positive',text:'All strategies stopped. No new orders will be placed.'});
  setWorking(false);await refresh();
 };

 if(view==='checking')return <Panel><p className="quiet" aria-busy="true">Checking the autopilot…</p></Panel>;
 if(view==='login')return <Unlock onDone={()=>void refresh()}/>;
 if(view==='unconfigured')return <Panel><Empty title="Not connected on this site">
  The autopilot&apos;s database settings are not added to this deployment yet, so there is nothing to show. Nothing
  trades from this page.</Empty></Panel>;
 if(view==='error')return <Panel><Empty title="Couldn't load the autopilot"
  action={<button type="button" className="button button-secondary" onClick={()=>void refresh()}>Try again</button>}>
  The records couldn&apos;t be read just now. Nothing is placed from this page.</Empty></Panel>;
 const registered=ledgers.filter((l):l is PaperAutoLedger=>l.registered);
 const pending=ledgers.filter(l=>!l.registered);
 const shown=registered.find(l=>l.experimentId===selected)??registered[0];
 return <>
  {notice&&<Callout tone={notice.tone} role="status">{notice.text}</Callout>}
  {registered.length>1&&<Strategies ledgers={registered} release={release} selected={shown?.experimentId??null}
   onSelect={setSelected} onStopAll={()=>void stopAll(registered.map(l=>l.experimentId))} working={working}/>}
  {shown&&<Autopilot key={shown.experimentId} l={shown} release={release} act={act} working={working}
   starting={starting===shown.experimentId} oneClick={oneClick}/>}
  {!registered.length&&<Panel><Empty title="No strategy is set up yet">Registration is a one-time owner step;
   until then there is nothing to run.</Empty></Panel>}
  {pending.length>0&&<p className="quiet small-print">Not set up yet: {pending.map(l=>l.experimentId).join(', ')}. It joins
   this page after its one-time registration.</p>}
 </>;
}

function Strategies({ledgers,release,selected,onSelect,onStopAll,working}:{ledgers:PaperAutoLedger[];release:Release|null;selected:string|null;
 onSelect:(id:string)=>void;onStopAll:()=>void;working:boolean}){
 const rows:CombinedRow[]=ledgers.map(l=>{
  const h=headline(l,release??{brokerWritesEnabled:false,scheduledRunsEnabled:false}),perf=forwardPerformance(l.experiment.startingEquityCents,l.experiment.registeredAt,l.daily);
  const last=perf.marks.at(-1)??null,v=perf.verified;
  return {experimentId:l.experimentId,name:strategy(l.status.modelVersion).name,label:h.label,tone:h.tone,
   valueCents:last?last.equityCents:l.experiment.startingEquityCents,startingCents:l.experiment.startingEquityCents,
   valueSession:last?.session??null,returnPct:v.state==='MEASURING'||v.state==='ENDED'?v.cumulativeReturn:null};
 });
 const c=combined(rows);
 return <Panel title="Your strategies" description="Each one trades its own paper account; together they work like a 50/50 mix"
  actions={<button type="button" className="button button-danger" disabled={working} onClick={onStopAll}>Stop all</button>}
  className="strategies-panel" flush>
  <div className="table-wrap"><table className="data-table strategies-table">
   <thead><tr><th>Strategy</th><th>Status</th><th>Value</th><th>Return</th></tr></thead>
   <tbody>
    {rows.map(r=><tr key={r.experimentId} aria-current={r.experimentId===selected?'true':undefined}>
     <th scope="row">{r.name}</th>
     <td><StatusDot tone={toneOf(r.tone)}/> {r.label}</td>
     <td>{money(r.valueCents)}<small>{r.valueSession?`after ${r.valueSession}`:'starting balance'}</small></td>
     <td className={r.returnPct===null?undefined:r.returnPct>=0?'tone-text-positive':'tone-text-negative'}>{pct(r.returnPct)}</td>
    </tr>)}
    <tr className="strategies-total">
     <th scope="row">Combined</th>
     <td>{overall(rows).label}</td>
     <td>{money(c.valueCents)}<small>of {money(c.startingCents)} to start</small></td>
     <td className={c.returnPct===null?undefined:c.returnPct>=0?'tone-text-positive':'tone-text-negative'}>{pct(c.returnPct)}</td>
    </tr>
   </tbody>
  </table></div>
  <div className="strategies-foot">
   <p className="quiet">{c.leader?`${c.leader} is ahead so far.`:c.returnPct===null?
    'Returns appear after each strategy has a full trading day.':'Both are level so far.'} Paper money only.</p>
   <Segmented label="Show strategy" value={selected??rows[0].experimentId} onChange={onSelect}
    options={rows.map(r=>({value:r.experimentId,label:r.name}))}/>
  </div>
 </Panel>;
}

function Unlock({onDone}:{onDone:()=>void}){
 const [key,setKey]=useState('');const [msg,setMsg]=useState('');const [busy,setBusy]=useState(false);
 const submit=async(e:FormEvent)=>{
  e.preventDefault();if(busy)return;
  const ownerKey=ownerKeyInput(key);
  if(!ownerKey){setMsg(OWNER_KEY_HINT);return;}
  setBusy(true);setMsg('');
  try{
   const r=await fetch('/api/internal/alpaca-paper/session',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerKey})});
   if(r.ok){setKey('');onDone();}
   else{
    const data=await r.json().catch(()=>null) as {reason?:unknown}|null;
    setMsg(ownerSignInError(r.status,data?.reason));
   }
  }catch{setMsg('Could not reach the site. Try again.');}
  finally{setBusy(false);}
 };
 return <Panel title="Owner sign-in" description="Use your 64-character SportsEdge owner key to view the private autopilot and its controls.">
  <form className="unlock-form" onSubmit={e=>void submit(e)}>
   <label><span className="sr-only">SportsEdge owner key</span>
    <input type="password" autoComplete="off" spellCheck={false} placeholder="64-character owner key" value={key}
     onChange={e=>setKey(e.target.value)}/></label>
   <button type="submit" className="button" disabled={busy||!key}>{busy?'Checking…':'Unlock'}</button>
  </form>
  <p className="quiet small-print">{OWNER_KEY_HINT} Surrounding spaces are ignored.</p>
  {msg&&<p className="tone-text-negative" role="alert">{msg}</p>}
 </Panel>;
}

function Autopilot({l,release,act,working,starting,oneClick}:{l:PaperAutoLedger;release:Release|null;act:Act;
 working:boolean;starting:boolean;oneClick:boolean}){
 const s=l.status,id=l.experimentId,h=headline(l,release??{brokerWritesEnabled:false,scheduledRunsEnabled:false});
 const perf=forwardPerformance(l.experiment.startingEquityCents,l.experiment.registeredAt,l.daily);
 const v=perf.verified,b=perf.benchmark,picks=latestPicks(l),held=holdings(l),feed=activity(l);
 const [now,setNow]=useState<number|null>(null);
 useEffect(()=>{const t=window.setTimeout(()=>setNow(Date.now()),0),timer=window.setInterval(()=>setNow(Date.now()),30_000);
  return()=>{window.clearTimeout(t);window.clearInterval(timer);};},[]);
 const next=now===null?null:nextRuns(now);
 const lastMark=perf.marks.at(-1)??null;
 const practice=release?.brokerWritesEnabled!==true;
 const startText=`Start the autopilot? It checks your Alpaca paper account and then switches on. It takes about a minute.${
  practice?' Practice mode: it will plan trades but not send any orders yet.':''}`;
 return <>
  <section className="autopilot-hero glass" aria-labelledby={'ap-'+id}>
   <p className="autopilot-strategy"><strong>{strategy(s.modelVersion).name}</strong>
    <span>{strategy(s.modelVersion).about}</span></p>
   <div className="autopilot-status">
    <StatusDot tone={starting?'info':h.tone==='positive'?'positive':h.tone==='warning'?'warning':'neutral'} label={h.label}/>
    <div>
     <h2 id={'ap-'+id}>{starting?'Starting…':h.label}</h2>
     <p>{starting?'Checking your Alpaca paper account. This page updates by itself.':h.explanation}</p>
     {h.reasons.length>0&&<ul className="autopilot-reasons">{h.reasons.map(r=><li key={r}>{r}</li>)}</ul>}
    </div>
   </div>
   <div className="autopilot-actions">
    {s.gateMode==='ARMED'||starting?null:oneClick?
     <button type="button" className="button button-lg" disabled={working||!h.canStart}
      onClick={()=>void act({action:'start',experimentId:id},startText)}>Start</button>:
     <a className="button button-lg" href={START_PAGE} target="_blank" rel="noopener noreferrer">Start on GitHub</a>}
    <button type="button" className="button button-secondary button-lg" disabled={working||s.gateMode!=='ARMED'}
     onClick={()=>void act({action:'pause',experimentId:id},'Pause the stock autopilot? New orders wait until you use Start again.')}>
     Pause</button>
    <button type="button" className="button button-danger button-lg" disabled={working}
     onClick={()=>void act({action:'stop',experimentId:id},'Stop the autopilot? No new orders will be placed. Stocks it already holds stay in the account.')}>
     Stop autopilot</button>
   </div>
   <div className="autopilot-badges">
    <Badge tone={practice?'warning':'info'} dot>{practice?'Paper orders off — plans only':'Paper orders released'}</Badge>
    <Badge tone={release?.scheduledRunsEnabled?'positive':'neutral'} dot>{release?.scheduledRunsEnabled?'Weekly schedule on':'Schedule off'}</Badge>
    <Badge tone="info">Paper money only</Badge>
   </div>
   <p className="autopilot-release-note"><strong>Next step: </strong>{practice?
    'The paper-order release must be enabled before this can send orders. Start alone does not enable that release.':
    s.gateMode==='ARMED'?'No daily click needed. Check the next run and review any alerts.':
    'Press Start once. It checks the paper account and resumes automatically if the check is clean.'}</p>
   {!oneClick&&s.gateMode!=='ARMED'&&<p className="quiet small-print">On GitHub: press <strong>Run workflow</strong>, choose
    <strong> resume</strong>, keep <strong>{id}</strong>, then Run. This page shows the result about a minute later.</p>}
  </section>

  <MetricGrid columns={4} className="autopilot-metrics">
   <Metric label="Account value" value={lastMark?money(lastMark.equityCents):money(l.experiment.startingEquityCents)}
    detail={lastMark?`After the close on ${lastMark.session}`:'Starting balance; updated after each close'}/>
   <Metric label="Return so far" value={v.state==='MEASURING'||v.state==='ENDED'?pct(v.cumulativeReturn):'—'}
    tone={v.cumulativeReturn===null?undefined:v.cumulativeReturn>=0?'positive':'negative'}
    detail={v.state==='MEASURING'||v.state==='ENDED'?`${money(v.pnlCents)} since ${l.experiment.registeredAt.slice(0,10)}`:'Starts after the first trading day'}/>
   <Metric label="vs S&P 500 (SPY)" value={b.state==='MEASURED'?pct(b.excessReturn):'—'}
    detail={b.state==='MEASURED'?`Autopilot ${pct(b.strategyReturn)} · SPY ${pct(b.benchmarkReturn)}`:'Needs two daily results'}/>
   <Metric label="Holding" value={held.length?`${held.length} stock${held.length===1?'':'s'}`:'Nothing yet'}
    detail={held.length?held.map(x=>`${x.symbol} ×${trim(String(x.shares))}`).join(', '):'Buys happen after the Monday pick'}/>
  </MetricGrid>

  <div className="split-1-1">
   <Panel title="This week's picks" description={picks?`Decided ${picks.session} at 8:00 AM ET`:'Picked every Monday at 8:00 AM ET'}>
    {!picks?<Empty title="No picks yet">The first weekly pick appears here after Monday 8:00 AM ET.</Empty>:
     <><p><strong>{picks.text}</strong></p>
      {picks.targets.length>0&&<div className="pick-chips">{picks.targets.map(t=><span key={t} className="pick-chip">{t}</span>)}</div>}
      {picks.reasons.length>0&&<p className="quiet small-print">{picks.reasons.slice(0,3).join(' · ')}</p>}</>}
   </Panel>
   <Panel title="Coming up" description={release?.scheduledRunsEnabled?'Planned times; jobs can start late and market holidays are skipped':'The automatic schedule is off'}>
    <ol className="next-list">
     <li><span>Weekly pick</span><strong>{next?nyTime(next.pick):'…'}</strong></li>
     <li><span>Trade run</span><strong>{next?nyTime(next.trade):'…'}</strong>
      <small>{!release?.scheduledRunsEnabled?'Automatic runs are off':s.gateMode==='ARMED'?practice?'Plans trades only (orders off)':'Can place paper orders for a valid pick':'Skipped while paused or stopped'}</small></li>
     <li><span>Daily result</span><strong>{next?nyTime(next.close):'…'}</strong></li>
    </ol>
   </Panel>
  </div>

  <Panel title="Recent activity" description="What the autopilot did, newest first"
   actions={<a className="text-link" href={RUNS_PAGE} target="_blank" rel="noopener noreferrer">All runs on GitHub</a>}>
   {!feed.length?<Empty title="Nothing yet">Runs appear here as they happen.</Empty>:
    <ul className="activity-feed">{feed.map(f=><li key={f.runId}>
     <StatusDot tone={f.tone==='positive'?'positive':f.tone==='warning'?'warning':f.tone==='info'?'info':'neutral'}/>
     <span className="activity-what">{f.what}</span><span className="activity-result">{f.result}</span>
     <time dateTime={f.at}>{when(f.at)}</time></li>)}</ul>}
  </Panel>

  <LearningEvidence l={l}/>
  <ResearchTracking l={l}/>

  {l.intents.length>0&&<Panel title="Orders" description="Whole-share limit orders on the paper account" flush>
   <div className="table-wrap"><table className="data-table">
    <thead><tr><th>When</th><th>Order</th><th>Status</th><th>Filled</th></tr></thead>
    <tbody>{[...l.intents].reverse().slice(0,12).map(i=><tr key={i.intentId}><td>{when(i.createdAt)}</td>
     <td>{i.side==='buy'?'Buy':'Sell'} {i.shares} {i.symbol} at {money(i.limitCents)}</td>
     <td>{i.brokerStatus??i.status}</td>
     <td>{trim(i.filledQty)}{i.filledAvgPrice?` at $${trim(i.filledAvgPrice)}`:''}</td></tr>)}</tbody>
   </table></div></Panel>}

  <RiskPanel l={l} practice={practice}/>

  {l.alerts.some(a=>!a.acknowledgedAt&&!isOwnerStopAlert(a.code))&&<Panel title="Alerts to review" description="Acknowledging an alert does not start anything">
   <ul className="activity-feed">{l.alerts.filter(a=>!a.acknowledgedAt&&!isOwnerStopAlert(a.code)).map(a=><li key={a.alertId}>
    <StatusDot tone={a.severity==='critical'?'negative':'warning'}/><span className="activity-what">{a.code}</span>
    <span className="activity-result">{a.severity}</span>
    <button type="button" className="button button-secondary button-sm" disabled={working}
     onClick={()=>void act({action:'ack_alert',experimentId:id,alertId:a.alertId},`Mark ${a.code} as reviewed?`)}>Reviewed</button>
   </li>)}</ul></Panel>}

  <Details title="Technical details">
   <p className="quiet">Experiment <strong>{id}</strong> · model {s.modelVersion} · gate {s.gateMode} ({s.gateReason}), version {s.gateVersion},
    changed {when(s.gateChangedAt)} by {s.gateChangedBy} · account ending {l.experiment.brokerAccountNumberSuffix} ·
    window {s.decisionWindow.start} to {s.decisionWindow.end} · last check {s.lastCheckOk===null?'none':s.lastCheckOk?'clean':'not clean'} {when(s.lastCheckAt)}.</p>
   <p className="quiet">Limits: capital {money(s.limits.capitalLimitCents??null)}, {money(s.limits.maxOrderNotionalCents??null)} per order,
    {' '}{money(s.limits.maxDailyNotionalCents??null)} per day, drawdown stop {(s.limits.drawdownStopBps??0)/100}%.</p>
   <div className="button-row">
    <button type="button" className="button button-secondary" disabled={working||s.gateMode!=='ARMED'}
     onClick={()=>void act({action:'pause',experimentId:id},`Pause ${id}? No new orders until it is started again.`)}>Pause</button>
   </div>
   <h3>Daily results</h3>
   {l.daily.length?<div className="table-wrap"><table className="data-table">
    <thead><tr><th>Session</th><th>Value</th><th>Cash</th><th>Stocks</th><th>Unrealized</th><th>Outside money</th><th>Cash check</th><th>Status</th></tr></thead>
    <tbody>{perf.marks.slice().reverse().map(m=><tr key={m.session}><td>{m.session}</td>
     <td>{money(m.equityCents)}</td><td>{money(m.cashCents)}</td><td>{money(m.longMarketValueCents)}</td>
     <td>{money(m.unrealizedPlCents)}</td><td>{money(m.externalFlowCents)}</td>
     <td>{m.cashReconciled?'Reconciled':'Unexplained '+money(Number(m.cashUnexplainedCents))}</td>
     <td>{VERDICT_TEXT[m.verdict]}</td></tr>)}</tbody></table></div>
    :<p className="quiet">No daily results yet. One is recorded after each close.</p>}
   <p className="quiet">Observed drawdown {v.drawdownCoverage==='UNRECONCILED_GAPS'?'incomplete':dd(v.observedMaxDrawdown)} on {v.verifiedMarks} verified
    results{v.endedAtSession?`; the verified record ended on ${v.endedAtSession} after outside money moved`:''}.</p>
   <ul className="quiet">{PAPER_AUTO_PERFORMANCE_LABELS.map(t=><li key={t}>{t}</li>)}</ul>
   <p className="quiet">Paper fills are simulated and are not real-money results. Historical backtests are a separate track:
    see <Link className="text-link" href="/stocks/research">Quant research</Link>.</p>
   {l.gateEvents.length>0&&<><h3>On/off history</h3><ul className="quiet">{l.gateEvents.map((g,k)=><li key={k}>{when(g.at)}: {g.fromMode} → {g.toMode} ({g.reason}) by {g.actor}</li>)}</ul></>}
  </Details>
 </>;
}

const TARGET_LABEL:Record<TargetStatus,string>={FILLED:'Filled',PARTIAL:'Partly filled',UNFILLED:'Sent, not filled',
 NOT_ORDERED_HELD:'Already held',NOT_ORDERED:'Not ordered',ORDER_STATE_UNKNOWN:'Order state unknown'};
/** Research tracking (stock-research-tracking-v1): SPY at the strategy's own exposure, turnover, assumed costs, rejected
 * candidates and decision-to-fill per target. Read-only; it never changes an order, gate or decision. */
function ResearchTracking({l}:{l:PaperAutoLedger}){
 let t:ReturnType<typeof stockResearchTracking>;
 // Never let a reporting panel take down the page that holds Start and Stop.
 try{t=stockResearchTracking(l,new Date().toISOString());}
 catch{return <Panel title="Research tracking" description="Unavailable for this ledger right now. Orders, Start and Stop are unaffected."><span/></Panel>;}
 const b=t.benchmark;
 const tone=t.state==='INTEGRITY_ISSUES'?'warning':t.state==='MEASURING'?'info':'neutral';
 const rejected=t.rejectedCandidates.filter(d=>d.rejected>0).slice(-4).reverse();
 return <Panel title="Research tracking" description="Measured the way the research was: SPY at the same exposure, turnover and costs from broker-confirmed fills, and what happened to every target."
  actions={<Badge tone={tone}>{t.state.replaceAll('_',' ')}</Badge>}>
  <MetricGrid columns={4}>
   <Metric label="Strategy vs SPY at same exposure" value={b.state==='MEASURED'?pct(b.excessVsMatchedSpy):'NEEDS 2 VERIFIED CLOSES'}
    detail={b.state==='MEASURED'?`strategy ${pct(b.strategyReturn)}, SPY at ${dd(b.averageExposure)} exposure ${pct(b.matchedExposureSpyReturn)}; ${b.links} links`:'verified closes only, never interpolated'}/>
   <Metric label="Strategy vs SPY 100%" value={b.state==='MEASURED'?pct(b.excessVsSpy):'—'} detail={b.state==='MEASURED'?`SPY ${pct(b.spyReturn)}, ${b.fromSession} to ${b.toSession}`:'—'}/>
   <Metric label="Turnover" value={t.turnover.turnover===null?'—':`${(t.turnover.turnover*100).toFixed(1)}%`}
    detail={t.turnover.annualizedTurnover===null?(t.turnover.note??'—'):`${(t.turnover.annualizedTurnover*100).toFixed(0)}% a year; ${t.turnover.filledOrders} fills`}/>
   <Metric label="Estimated costs" value={t.costs.assumedCostDollars===null?'—':usd.format(t.costs.assumedCostDollars)}
    detail={`${t.costs.assumedBpsPerSide} bps per side; fill vs limit ${t.costs.fillVersusLimitBps===null?'—':`${t.costs.fillVersusLimitBps>0?'+':''}${t.costs.fillVersusLimitBps.toFixed(1)} bps`}`}/>
  </MetricGrid>
  <p className="quiet small-print">Drawdown: strategy {dd(t.drawdown.strategy)}, SPY at the same exposure {dd(t.drawdown.matchedExposureSpy)}. {t.costs.note}</p>
  {t.reconciliation.length>0&&<div className="table-wrap"><table className="data-table">
   <caption className="quiet small-print">Decision to fill, target by target (latest decisions first).</caption>
   <thead><tr><th>Session</th><th>Target</th><th>Result</th><th>Ordered</th><th>Filled</th></tr></thead>
   <tbody>{t.reconciliation.slice(-2).reverse().flatMap(r=>r.rows.map(x=><tr key={r.session+x.symbol}>
    <td>{r.session}</td><td>{x.symbol}</td><td>{TARGET_LABEL[x.status]}</td><td>{x.orderedShares}</td><td>{x.filledShares}</td></tr>))}</tbody>
  </table></div>}
  {rejected.length>0&&<p className="quiet small-print">Candidates the bridge skipped: {rejected.map(d=>`${d.session}: ${d.rejected} (${Object.entries(d.byReason).map(([k,n])=>`${n} ${k.replaceAll('_',' ').toLowerCase()}`).join(', ')})`).join('; ')}.</p>}
  {t.issues.length>0&&<Callout tone="warning" title="Needs review">{t.issues.slice(0,6).join('; ')}</Callout>}
 </Panel>;
}

const FUNNEL_LABEL:Record<FunnelStage,string>={NO_TARGETS:'No targets',NOT_EXECUTED:'No execute ran',
 SHADOW_ONLY:'Shadow plan only — no order',ORDERS_UNFILLED:'Orders sent, none filled',FILLED_OPEN:'Filled, still held',REALIZED:'Realized',
 UNVERIFIED_ORDER_STATE:'Order state unavailable at the report time'};

/** Forward learning evidence from real PAPER fills only. Below the minimum sample it says so instead of a win rate. */
function LearningEvidence({l}:{l:PaperAutoLedger}){
 const e=evaluateStockForward(l,new Date().toISOString());
 const pc=(x:number|null)=>x===null?'—':(x*100).toFixed(2)+'%';
 const tone=e.verdict==='MEASURED'?'positive':e.verdict==='INTEGRITY_FAILED'?'warning':'neutral';
 const states=Object.entries(e.sessions.states);
 return <Panel title="Learning evidence" description="Completed trades from real PAPER fills, net of 10 bps per side. Plans, unfilled and rejected orders never count."
  actions={<Badge tone={tone}>{e.verdict==='INSUFFICIENT_DATA'?'INSUFFICIENT DATA':e.verdict.replaceAll('_',' ')}</Badge>}>
  <MetricGrid columns={4}>
   <Metric label="Completed trades" value={String(e.trades.completed)} detail={`needs ${e.minimums.completedTrades}; ${e.trades.openLots} open`}/>
   <Metric label="Clean sessions" value={String(e.sessions.clean)} detail={`needs ${e.minimums.cleanSessions}; ${e.sessions.targets} with targets`}/>
   <Metric label="Win rate" value={e.trades.winRate===null?'INSUFFICIENT DATA':pc(e.trades.winRate)} detail={`${e.trades.winners} won, ${e.trades.losers} lost`}/>
   <Metric label="Avg winner / loser" value={`${pc(e.trades.averageWinnerReturn)} / ${pc(e.trades.averageLoserReturn)}`} detail="net of estimated costs"/>
  </MetricGrid>
  <p className="quiet small-print">Orders: {e.orders.proposed} planned, {e.orders.submitted} sent, {e.orders.filled} filled, {e.orders.partiallyFilled} partly filled, {e.orders.rejected} rejected, {e.orders.canceledOrExpired} cancelled or expired unfilled, {e.orders.notSubmitted} not sent.
   {states.length?` Sessions: ${states.map(([d,s])=>`${d} ${s.replaceAll('_',' ').toLowerCase()}`).join(', ')}.`:''} Prediction accuracy: not measurable (the weekly model records targets, not expected returns).</p>
  {e.sessions.funnel.length>0&&<div className="table-wrap"><table className="data-table">
   <caption className="quiet small-print">Each decision, stage by stage. A shadow plan is not an order; an order is not a fill; a fill is not a result until it is sold.</caption>
   <thead><tr><th>Session</th><th>Decision</th><th>Shadow plans</th><th>Orders sent</th><th>Filled</th><th>Realized (net)</th><th>Stage</th></tr></thead>
   <tbody>{e.sessions.funnel.slice(-8).reverse().map(f=><tr key={f.session}>
    <td>{f.session}</td><td>{f.outcome==='TARGETS'?`${f.targets} targets`:f.outcome.replaceAll('_',' ').toLowerCase()}</td>
    <td>{f.shadowPlans}</td><td>{f.ordersSent}</td><td>{f.ordersFilled}{f.filledShares?` (${f.filledShares} sh)`:''}</td>
    <td>{f.realizedTrades?`${f.realizedTrades} · $${(f.realizedNetPnlCents/100).toFixed(2)}`:'—'}</td>
    <td>{FUNNEL_LABEL[f.stage]}</td></tr>)}</tbody>
  </table></div>}
  {e.verdict==='INTEGRITY_FAILED'&&<Callout tone="warning" title="Evidence integrity check failed">{e.reasons.filter(r=>/LOOKAHEAD|UNMATCHED/.test(r)).join('; ')}</Callout>}
 </Panel>;
}
