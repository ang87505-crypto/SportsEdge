'use client';

import Link from 'next/link';
import {useCallback,useEffect,useState} from 'react';
import {Empty,Stat} from '@/components/ui';
import {OPERATOR_STATES,resumeCandidate,type PaperAutoLedger,type UnregisteredLedger}
 from '@/lib/stocks/paper-auto-ledger';
import {forwardPerformance,PAPER_AUTO_PERFORMANCE_LABELS,type MarkVerdict}
 from '@/lib/stocks/paper-auto-performance';

type View='checking'|'login'|'unconfigured'|'error'|'ready';
type Release={paperOnly:true;brokerWritesEnabled:boolean;scheduledRunsEnabled:boolean;realMoneyEnabled:false};
type Ledger=PaperAutoLedger|UnregisteredLedger;
type Act=(body:Record<string,unknown>,confirmText:string)=>Promise<void>;
const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const money=(c:number|null)=>c===null?'—':usd.format(c/100);
const dollars=(c:number)=>usd.format(Math.round(c/100)).replace(/\.00$/,'');
const pct=(r:number|null)=>r===null?'—':`${r>=0?'+':''}${(r*100).toFixed(2)}%`;
const dd=(r:number|null)=>r===null?'—':`${(r*100).toFixed(2)}%`;
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString():'—';
const trim=(v:string)=>v.includes('.')?v.replace(/\.?0+$/,''):v;
const STATE_TEXT:Record<PaperAutoLedger['status']['state'],string>={
 STOPPED:'Stopped. No new orders; the next worker run cancels any working strategy order. Existing holdings remain exposed to price changes.',
 PAUSED:'Paused by the owner. No new orders until a reconciled resume.',
 READY:'Armed, checked within 26 hours and clear. Orders also need broker writes released in source.',
 BLOCKED:'Armed but not clear: a stale check, an unresolved submission, an open critical alert or an ended window.',
 EXECUTING:'A worker run holds the execution lease right now.'};
const VERDICT_TEXT:Record<MarkVerdict,string>={VERIFIED:'Verified',UNRECONCILED_SKIPPED:'Unreconciled (skipped)',
 CONTAMINATED:'Contaminated (chain ends)',AFTER_CONTAMINATION:'After contamination'};

function viewOk(data:unknown):data is {release:Release;experiments:Ledger[]}{
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
 const [ledgers,setLedgers]=useState<Ledger[]>([]);
 const [notice,setNotice]=useState('');
 const [working,setWorking]=useState(false);
 const refresh=useCallback(async()=>{
  try{
   const res=await fetch('/api/internal/paper-auto',{method:'GET',cache:'no-store',credentials:'same-origin'});
   const data:unknown=await res.json();
   if(res.status===401){setView('login');setLedgers([]);return;}
   if(res.status===503&&(data as {status?:unknown})?.status==='paper_auto_not_configured'){
    setView('unconfigured');setLedgers([]);return;}
   if(!res.ok||!viewOk(data)){setView('error');setLedgers([]);return;}
   setRelease(data.release);setLedgers(data.experiments);setView('ready');
  }catch{setView('error');setLedgers([]);}
 },[]);
 useEffect(()=>{const t=window.setTimeout(()=>{void refresh();},0);return()=>window.clearTimeout(t);},[refresh]);
 const act:Act=async(body,confirmText)=>{
  if(working||!window.confirm(confirmText))return;
  setWorking(true);setNotice('');
  try{
   const res=await fetch('/api/internal/paper-auto',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await res.json() as {status?:string;code?:string};
   if(res.status===401)setNotice('Your private owner session expired. Unlock it again on the Alpaca paper page.');
   else if(data.status==='recorded')setNotice(`Recorded: ${String(body.action)}. Status was re-read from the database.`);
   else if(data.status==='refused')setNotice(`The database refused ${String(body.action)}: ${data.code??'unknown reason'}. Nothing changed.`);
   else setNotice('The outcome is unknown. Status was re-read; check it before retrying. STOP can always be sent again.');
  }catch{setNotice('The outcome is unknown. Status was re-read; check it before retrying. STOP can always be sent again.');}
  finally{setWorking(false);await refresh();}
 };
 if(view==='checking')return <div className="glass panel" aria-busy="true">Checking the recurring PAPER ledger…</div>;
 if(view==='login')return <div className="glass panel"><Empty title="Owner session required">
  Unlock your private owner session on the <Link className="text-link" href="/stocks/alpaca">Alpaca paper page</Link>, then
  return here. This page never shows credentials.</Empty></div>;
 if(view==='unconfigured')return <div className="glass panel"><Empty title="Not connected">
  The recurring PAPER ledger is not configured on this deployment (staging database and experiment ids). Nothing is
  registered, scheduled or trading from here.</Empty></div>;
 if(view==='error')return <div className="glass panel"><Empty title="Ledger unavailable">
  The staging ledger could not be read or verified. No order is placed from this page. <button type="button"
   className="text-link" onClick={()=>void refresh()}>Try again</button></Empty></div>;
 return <>
  <section className="notice" aria-label="Release switches">
   <strong>Release switches in this build:</strong> broker writes {release?.brokerWritesEnabled?'ON':'OFF (execute records shadow plans only)'};
   scheduled runs {release?.scheduledRunsEnabled?'ON':'OFF (manual dispatch only)'}; real money never. Every
   number below is Alpaca <strong>PAPER</strong> and simulated.
  </section>
  {notice&&<p className="notice" role="status" aria-live="polite">{notice}</p>}
  {ledgers.map(l=>l.registered?<Experiment key={l.experimentId} l={l} act={act} working={working}/>:
   <div key={l.experimentId} className="glass panel" style={{margin:'18px 0'}}>
    <Empty title={l.experimentId+' is not registered'}>Registration is an owner-authorized step in the release
     checklist. Until then there is no gate, no ledger and nothing to trade.</Empty></div>)}
 </>;
}

function Experiment({l,act,working}:{l:PaperAutoLedger;act:Act;working:boolean}){
 const s=l.status,id=l.experimentId;
 const perf=forwardPerformance(l.experiment.startingEquityCents,l.experiment.registeredAt,l.daily);
 // The database's own read time, so a resume candidate is judged against the server clock.
 const candidate=resumeCandidate(l,Date.parse(s.checkedAt));
 const canResume=(s.gateMode==='STOPPED'||s.gateMode==='PAUSED')&&!!candidate&&s.unresolvedIntents===0&&
  s.unacknowledgedCriticalAlerts===0;
 const resumeWhy=s.gateMode==='ARMED'?'Already armed.':s.unresolvedIntents>0?'An unresolved submission must be resolved first.':
  s.unacknowledgedCriticalAlerts>0?'Acknowledge the open critical alerts first.':
  !candidate?'Dispatch a reconcile run first; resume needs a clean one from the last 15 minutes.':'';
 const v=perf.verified,b=perf.benchmark;
 return <section className="glass panel" style={{margin:'22px 0'}} aria-labelledby={'exp-'+id}>
  <div className="module-top" style={{marginBottom:14}}>
   <span className="pill">{s.modelVersion}</span>
   <span className={s.state==='READY'||s.state==='EXECUTING'?'pill':'pill pill-amber'}>{s.state}</span>
  </div>
  <h2 id={'exp-'+id}>{id}</h2>
  <p>{STATE_TEXT[s.state]} Gate {s.gateMode} ({s.gateReason}), version {s.gateVersion}, changed {when(s.gateChangedAt)} by {s.gateChangedBy}.
   Account ending {l.experiment.brokerAccountNumberSuffix}. Decision window {s.decisionWindow.start} to {s.decisionWindow.end}.</p>
  <div className="stats-grid">
   <Stat label="Last check" value={s.lastCheckOk===null?'—':s.lastCheckOk?'Clean':'Not clean'}
    detail={when(s.lastCheckAt)+(s.lastCheckBlockers.length?' · '+s.lastCheckBlockers.slice(0,3).join(', '):'')}/>
   <Stat label="Unresolved submissions" value={s.unresolvedIntents} detail={`${s.activeIntents} live or unresolved intents`}/>
   <Stat label="Open critical alerts" value={s.unacknowledgedCriticalAlerts} detail="Resume needs zero"/>
   <Stat label="Capital limit" value={dollars(s.limits.capitalLimitCents)}
    detail={`Max ${money(s.limits.maxOrderNotionalCents)} per order · drawdown stop ${s.limits.drawdownStopBps/100}%`}/>
  </div>
  <div className="button-row">
   <button type="button" className="button" disabled={working}
    onClick={()=>void act({action:'stop',experimentId:id},`Record an owner STOP for ${id}? New orders stop at once; the next worker run cancels working orders. Existing holdings remain invested.`)}>
    Record owner STOP</button>
   <button type="button" className="button button-secondary" disabled={working||s.gateMode!=='ARMED'}
    onClick={()=>void act({action:'pause',experimentId:id},`Pause ${id}? No new orders until a reconciled resume.`)}>Pause</button>
   <button type="button" className="button button-secondary" disabled={working||!canResume}
    onClick={()=>candidate&&void act({action:'resume',experimentId:id,expectedGateVersion:s.gateVersion,
     reconcileRunId:candidate.runId},`Resume ${id} from gate version ${s.gateVersion} using reconcile run ${candidate.runId} (finished ${when(candidate.finishedAt)})?`)}>
    Resume after reconciliation</button>
  </div>
  {resumeWhy&&<p className="quiet" style={{marginTop:10}}>{resumeWhy}</p>}
  {l.alerts.some(a=>!a.acknowledgedAt)&&<><div className="eyebrow" style={{marginTop:22}}>Open alerts</div>
   <div className="table-wrap"><table className="data-table">
    <thead><tr><th>Severity</th><th>Code</th><th>Raised</th><th/></tr></thead>
    <tbody>{l.alerts.filter(a=>!a.acknowledgedAt).map(a=><tr key={a.alertId}><td>{a.severity}</td><td>{a.code}</td>
     <td>{when(a.createdAt)}</td><td><button type="button" className="remove-button" disabled={working}
      onClick={()=>void act({action:'ack_alert',experimentId:id,alertId:a.alertId},
       `Acknowledge ${a.code}? Acknowledging does not resume trading.`)}>Acknowledge</button></td></tr>)}</tbody>
   </table></div></>}

  <h3 style={{marginTop:28}}>1 · Broker observations (Alpaca PAPER, simulated fills)</h3>
  <p className="quiet">After-close account marks exactly as recorded, with the database&apos;s cash reconciliation.</p>
  {l.daily.length?<div className="table-wrap"><table className="data-table">
   <thead><tr><th>Session</th><th>Equity</th><th>Cash</th><th>Positions</th><th>Unrealized</th><th>External flow</th><th>Cash check</th><th>Status</th></tr></thead>
   <tbody>{perf.marks.slice().reverse().map(m=><tr key={m.session}><td>{m.session}<small>{when(m.capturedAt)}</small></td>
    <td>{money(m.equityCents)}</td><td>{money(m.cashCents)}</td><td>{money(m.longMarketValueCents)}</td>
    <td>{money(m.unrealizedPlCents)}</td><td>{money(m.externalFlowCents)}</td><td>{m.cashReconciled?'Reconciled':'Unexplained '+money(Number(m.cashUnexplainedCents))}</td>
    <td>{VERDICT_TEXT[m.verdict]}</td></tr>)}</tbody></table></div>
   :<Empty title="No after-close marks yet">The monitor records one mark per session after 16:15 New York.</Empty>}
  <Orders l={l}/>

  <h3 style={{marginTop:28}}>2 · Verified strategy P&amp;L</h3>
  {v.state==='NO_MARKS'||v.state==='NO_VERIFIED_MARKS'?<Empty title="Not measured yet">Returns are never computed
   from the registration snapshot alone. They start with the first uncontaminated, cash-reconciled mark.</Empty>:
   <div className="stats-grid">
    <Stat label="Since registration" value={pct(v.cumulativeReturn)} detail={`${money(v.pnlCents)} through ${v.throughSession}`+
     ` · realized ${money(v.realizedPlCents)} · unrealized ${money(v.unrealizedPlCents)}`}/>
    <Stat label="Observed drawdown" value={v.drawdownCoverage==='UNRECONCILED_GAPS'?'Incomplete':dd(v.observedMaxDrawdown)}
     detail={`${dd(v.observedMaxDrawdown)} on ${v.verifiedMarks} verified marks · ${v.skippedMarks} skipped · missing sessions not checked`}/>
    <Stat label="Same window vs SPY" value={pct(b.excessReturn)} detail={b.state==='MEASURED'?
     `${b.fromSession} to ${b.toSession}: strategy ${pct(b.strategyReturn)}, SPY ${pct(b.benchmarkReturn)}`:'Needs two verified SPY closes'}/>
    <Stat label="Chain" value={v.state==='ENDED'?'Ended':'Measuring'} detail={v.endedAtSession?
     `Contaminated on ${v.endedAtSession}; later marks are observations only`:`Starting equity ${money(perf.startingEquityCents)}`}/>
   </div>}
  <ul className="quiet">{PAPER_AUTO_PERFORMANCE_LABELS.map(t=><li key={t}>{t}</li>)}</ul>

  <h3 style={{marginTop:28}}>3 · Historical backtest (separate track)</h3>
  <p className="quiet">Backtests are research on past data and are never merged with these forward results. No backtest
   figure is shown here; see <Link className="text-link" href="/stocks/research">stock research</Link>.</p>
  <h3 style={{marginTop:22}}>4 · Unverified research</h3>
  <p className="quiet">Candidate rules and preliminary ideas stay unverified until a pre-registered forward experiment
   measures them here. Paper P&amp;L never changes the frozen strategy; a change needs a new version and a separately
   reviewed experiment.</p>
  <Runs l={l}/>
 </section>;
}

function Orders({l}:{l:PaperAutoLedger}){
 return <>
  {l.decisions.length>0&&<><div className="eyebrow" style={{marginTop:22}}>Decisions (one per session, including HOLD and MISSED)</div>
   <div className="table-wrap"><table className="data-table">
   <thead><tr><th>Session</th><th>Outcome</th><th>Targets or reasons</th></tr></thead>
   <tbody>{l.decisions.map(d=><tr key={d.decisionId}><td>{d.session}<small>{when(d.decisionAt)}</small></td>
    <td>{d.outcome}</td><td>{d.targets.length?d.targets.join(', '):d.reasons.join('; ')||'—'}</td></tr>)}</tbody></table></div></>}
  {l.intents.length>0&&<><div className="eyebrow" style={{marginTop:22}}>Order intents and broker states (whole-share limit orders)</div>
   <div className="table-wrap"><table className="data-table">
   <thead><tr><th>Created</th><th>Order</th><th>Status</th><th>Filled</th></tr></thead>
   <tbody>{l.intents.map(i=><tr key={i.intentId}><td>{when(i.createdAt)}<small>attempt {i.attempt} · {i.phase}</small></td>
    <td>{i.side.toUpperCase()} {i.shares} {i.symbol} @ {money(i.limitCents)}</td>
    <td>{i.status}<small>{i.brokerStatus??'no broker order'}</small></td>
    <td>{trim(i.filledQty)}{i.filledAvgPrice?' @ $'+trim(i.filledAvgPrice):''}</td></tr>)}</tbody></table></div></>}
 </>;
}

function Runs({l}:{l:PaperAutoLedger}){
 if(!l.runs.length)return null;
 return <details className="glass detail-panel"><summary>Recent worker runs and gate changes<span aria-hidden="true">＋</span></summary>
  <div className="detail-content table-wrap"><table className="data-table">
   <thead><tr><th>Started</th><th>Kind</th><th>Slot</th><th>Status</th><th>Summary</th></tr></thead>
   <tbody>{l.runs.map(r=><tr key={r.runId}><td>{when(r.startedAt)}</td><td>{r.kind}</td><td>{r.slot}<small>attempt {r.attempt}</small></td>
    <td>{r.status}</td><td>{r.summary??'—'}</td></tr>)}</tbody></table>
   <ul>{l.gateEvents.map((g,k)=><li key={k}>{when(g.at)}: {g.fromMode} → {g.toMode} ({g.reason}) by {g.actor}</li>)}</ul>
  </div></details>;
}
