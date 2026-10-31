'use client';

import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Badge,Callout,Details,Empty,Metric,MetricGrid,Panel,StatusDot} from '@/components/ui';
import {OPERATOR_STATES,type PaperAutoLedger,type UnregisteredLedger} from '@/lib/stocks/paper-auto-ledger';
import {forwardPerformance,PAPER_AUTO_PERFORMANCE_LABELS,type MarkVerdict} from '@/lib/stocks/paper-auto-performance';
import {activity,headline,holdings,latestPicks,nextRuns} from '@/lib/stocks/autopilot-view';

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
const VERDICT_TEXT:Record<MarkVerdict,string>={VERIFIED:'Verified',UNRECONCILED_SKIPPED:'Unreconciled (skipped)',
 CONTAMINATED:'Contaminated (chain ends)',AFTER_CONTAMINATION:'After contamination'};
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
 const [starting,setStarting]=useState(false);
 const poll=useRef<number|null>(null);
 const refresh=useCallback(async():Promise<Ledger[]>=>{
  // The top-bar badge caches the status for a minute; a fresh read here replaces it.
  try{sessionStorage.removeItem('sportsedge-autopilot-summary');}catch{/* optional cache */}
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
 useEffect(()=>{const t=window.setTimeout(()=>{void refresh();},0);
  return()=>{window.clearTimeout(t);if(poll.current)window.clearInterval(poll.current);};},[refresh]);

 // After Start, re-read every 8 s for up to 3 minutes until the database reports the gate armed.
 const watchStart=(id:string)=>{
  setStarting(true);let tries=0;
  if(poll.current)window.clearInterval(poll.current);
  poll.current=window.setInterval(async()=>{
   tries++;
   const ls=await refresh();
   const l=ls.find(x=>x.experimentId===id);
   const armed=!!l&&l.registered&&l.status.gateMode==='ARMED';
   if(armed||tries>=22){
    if(poll.current)window.clearInterval(poll.current);poll.current=null;setStarting(false);
    setNotice(armed?{tone:'positive',text:'Autopilot is on.'}:{tone:'warning',text:
     'Start did not finish within 3 minutes. Open the GitHub run to see why. Nothing was traded.'});
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
   else if(data.status==='recorded')setNotice({tone:'positive',text:body.action==='stop'?'Stopped. No new orders will be placed.':
    `Done: ${String(body.action)}.`});
   else if(data.status==='refused')setNotice({tone:'warning',text:data.code==='ALREADY_RUNNING'?'Autopilot is already on.':
    `Not done (${data.code??'refused'}). Nothing changed.`});
   else if(data.status==='start_not_configured')setNotice({tone:'warning',text:'One-click Start is not set up on this site yet. Use "Start on GitHub" instead.'});
   else setNotice({tone:'warning',text:'The result is unknown. The status below was re-read; check it before trying again. Stop can always be pressed again.'});
  }catch{setNotice({tone:'warning',text:'The result is unknown. The status below was re-read; check it before trying again. Stop can always be pressed again.'});}
  finally{setWorking(false);await refresh();}
 };

 if(view==='checking')return <Panel><p className="quiet" aria-busy="true">Checking the autopilot…</p></Panel>;
 if(view==='login')return <Unlock onDone={()=>void refresh()}/>;
 if(view==='unconfigured')return <Panel><Empty title="Not connected on this site">
  The autopilot&apos;s database settings are not added to this deployment yet, so there is nothing to show. Nothing
  trades from this page.</Empty></Panel>;
 if(view==='error')return <Panel><Empty title="Couldn't load the autopilot"
  action={<button type="button" className="button button-secondary" onClick={()=>void refresh()}>Try again</button>}>
  The records couldn&apos;t be read just now. Nothing is placed from this page.</Empty></Panel>;
 return <>
  {notice&&<Callout tone={notice.tone} role="status">{notice.text}</Callout>}
  {ledgers.map(l=>l.registered?<Autopilot key={l.experimentId} l={l} release={release} act={act} working={working}
    starting={starting} oneClick={oneClick}/>:
   <Panel key={l.experimentId}><Empty title={`${l.experimentId} is not set up yet`}>Registration is a one-time owner step;
    until then there is nothing to run.</Empty></Panel>)}
 </>;
}

function Unlock({onDone}:{onDone:()=>void}){
 const [key,setKey]=useState('');const [msg,setMsg]=useState('');const [busy,setBusy]=useState(false);
 const submit=async(e:FormEvent)=>{
  e.preventDefault();if(busy||!key)return;setBusy(true);setMsg('');
  try{
   const r=await fetch('/api/internal/alpaca-paper/session',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerKey:key})});
   if(r.ok){setKey('');onDone();}
   else setMsg(r.status===401?'That password is not right.':'Owner sign-in is not set up on this site.');
  }catch{setMsg('Could not reach the site. Try again.');}
  finally{setBusy(false);}
 };
 return <Panel title="Owner sign-in" description="The autopilot is private. Enter your owner password to see it and to start or stop it.">
  <form className="unlock-form" onSubmit={e=>void submit(e)}>
   <label><span className="sr-only">Owner password</span>
    <input type="password" autoComplete="current-password" placeholder="Owner password" value={key}
     onChange={e=>setKey(e.target.value)}/></label>
   <button type="submit" className="button" disabled={busy||!key}>{busy?'Checking…':'Unlock'}</button>
  </form>
  {msg&&<p className="tone-text-negative" role="alert">{msg}</p>}
 </Panel>;
}

function Autopilot({l,release,act,working,starting,oneClick}:{l:PaperAutoLedger;release:Release|null;act:Act;
 working:boolean;starting:boolean;oneClick:boolean}){
 const s=l.status,id=l.experimentId,h=headline(l);
 const perf=forwardPerformance(l.experiment.startingEquityCents,l.experiment.registeredAt,l.daily);
 const v=perf.verified,b=perf.benchmark,picks=latestPicks(l),held=holdings(l),feed=activity(l);
 const [now,setNow]=useState<number|null>(null);
 useEffect(()=>{const t=window.setTimeout(()=>setNow(Date.now()),0);return()=>window.clearTimeout(t);},[]);
 const next=now===null?null:nextRuns(now);
 const lastMark=perf.marks.at(-1)??null;
 const practice=release?.brokerWritesEnabled!==true;
 const startText=`Start the autopilot? It checks your Alpaca paper account and then switches on. It takes about a minute.${
  practice?' Practice mode: it will plan trades but not send any orders yet.':''}`;
 return <>
  <section className="autopilot-hero glass" aria-labelledby={'ap-'+id}>
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
    <button type="button" className="button button-danger button-lg" disabled={working}
     onClick={()=>void act({action:'stop',experimentId:id},'Stop the autopilot? No new orders will be placed. Stocks it already holds stay in the account.')}>
     Stop autopilot</button>
   </div>
   <div className="autopilot-badges">
    <Badge tone={practice?'warning':'positive'} dot>{practice?'Practice mode: plans only, no orders':'Paper orders on'}</Badge>
    <Badge tone={release?.scheduledRunsEnabled?'positive':'neutral'} dot>{release?.scheduledRunsEnabled?'Weekly schedule on':'Schedule off'}</Badge>
    <Badge tone="info">Paper money only</Badge>
   </div>
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
   <Panel title="Coming up" description="Runs by itself on weekdays">
    <ol className="next-list">
     <li><span>Weekly pick</span><strong>{next?nyTime(next.pick):'…'}</strong></li>
     <li><span>Trade run</span><strong>{next?nyTime(next.trade):'…'}</strong>
      <small>{s.gateMode==='ARMED'?practice?'Plans trades only (practice mode)':'Places paper orders for the latest pick':'Skipped while stopped'}</small></li>
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

  {l.intents.length>0&&<Panel title="Orders" description="Whole-share limit orders on the paper account" flush>
   <div className="table-wrap"><table className="data-table">
    <thead><tr><th>When</th><th>Order</th><th>Status</th><th>Filled</th></tr></thead>
    <tbody>{[...l.intents].reverse().slice(0,12).map(i=><tr key={i.intentId}><td>{when(i.createdAt)}</td>
     <td>{i.side==='buy'?'Buy':'Sell'} {i.shares} {i.symbol} at {money(i.limitCents)}</td>
     <td>{i.brokerStatus??i.status}</td>
     <td>{trim(i.filledQty)}{i.filledAvgPrice?` at $${trim(i.filledAvgPrice)}`:''}</td></tr>)}</tbody>
   </table></div></Panel>}

  {l.alerts.some(a=>!a.acknowledgedAt)&&<Panel title="Alerts to review" description="Acknowledging an alert does not start anything">
   <ul className="activity-feed">{l.alerts.filter(a=>!a.acknowledgedAt).map(a=><li key={a.alertId}>
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
