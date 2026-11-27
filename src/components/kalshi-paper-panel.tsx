'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {Panel,Metric,MetricGrid,Evidence,KeyValues,Callout,Details} from '@/components/ui';
import {ownerHintPresent} from '@/lib/owner-hint';
import type {KalshiPlatformView} from '@/lib/server/kalshi-platform-view';
type State={kind:'loading'|'login'|'error';code?:string}|{kind:'ready';data:KalshiPlatformView};
const money=(micros:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(micros/1_000_000);
const date=(value:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Denver'}).format(new Date(value))+' MT';
const readiness=(code:string)=>code==='READY_FOR_OWNER_CHECK'?'Ready for an owner account check':
 code.includes('ACCESS_NOT_REVIEWED')?'Trading and market-data access review needed':code.includes('INVALID_KEY')?'Demo credentials need checking':'Demo account setup needed';
export function KalshiPaperPanel(){
 const [state,setState]=useState<State>({kind:'loading'}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const read=useCallback(async()=>{
  if(!ownerHintPresent(document.cookie)){setNotice('');setState({kind:'login'});return;}
  try{
   const response=await fetch('/api/internal/kalshi-paper',{credentials:'same-origin',cache:'no-store'});
   const data=await response.json();
   if(response.status===401){setNotice('');setState({kind:'login'});return;}
   if(!response.ok||data.schemaVersion!=='kalshi-platform-view-v1'){setNotice('');setState({kind:'error',code:data.code});return;}
   setState({kind:'ready',data});
  }catch{setNotice('');setState({kind:'error'});}
 },[]);
 useEffect(()=>{const timer=window.setTimeout(()=>void read(),0);return()=>window.clearTimeout(timer);},[read]);
 async function act(action:string){
  setBusy(true);setNotice('');
  try{
   const response=await fetch('/api/internal/kalshi-paper',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
   const data=await response.json();
   if(response.status===401){setNotice('');setState({kind:'login'});}
   else if(!response.ok)setNotice((action==='check-demo-connection'?'Demo connection could not be verified. ':'The action was not confirmed. Refresh before another order test. ')+(data.code??''));
   else if(action==='check-demo-connection'){
    const r=data.result;
    if(data.status!=='CHECKED'||r?.status!=='DEMO_CONNECTION_VERIFIED'||r.source!=='KALSHI_DEMO'||r.readOnly!==true||
     !Number.isSafeInteger(r.cashMicros)||r.cashMicros<0||typeof r.checkedAt!=='string'||!Number.isFinite(Date.parse(r.checkedAt)))
     setNotice('Demo connection could not be verified. Refresh and try the read-only check again.');
    else setNotice('Read-only demo connection verified. Available mock cash: '+money(r.cashMicros)+'. Checked '+date(r.checkedAt)+'.');
   }
   else setNotice(action==='offline-check'?'Synthetic system check saved. This is an engineering test, not a trading result.':
    action==='stop-demo'?'Demo automation stopped.':action==='start-demo'?'Demo automation armed after an account check.':
    action==='smoke-demo'?'Demo test processed. Check the recorded acknowledgement and fills below.':'Run recorded. Status refreshed.');
  }catch{setNotice(action==='check-demo-connection'?'Demo connection could not be verified. Try the read-only check again.':'The reply was lost. Refresh and reconcile before another demo order test.');}
  finally{setBusy(false);await read();}
 }
 return <Panel title="Kalshi paper workspace" description="Independent forecasts, system checks and exchange demo records, each tracked separately." className="mt-12"
  actions={<button type="button" className="button button-secondary" disabled={busy} onClick={()=>void read()}>Refresh paper status</button>}>
  {state.kind==='loading'&&<p role="status">Checking owner access…</p>}
  {state.kind==='login'&&<Callout title="Owner sign-in required"><p><Link href="/stocks/alpaca">Sign in as the owner</Link>, then return here and refresh this panel to see private records and controls.</p></Callout>}
  {state.kind==='error'&&<Callout tone="warning" title="Paper status unavailable"><p>The database or worker could not be verified. No account balance or result is inferred.</p>{state.code&&<p className="quiet small-print">Diagnostic: {state.code}</p>}</Callout>}
  {state.kind==='ready'&&<>
   <MetricGrid columns={3}>
    <Metric label="Demo automation" value={state.data.demo.state==='ARMED'?'Armed':'Stopped'} evidence="simulated" detail={readiness(state.data.demo.readiness)}/>
    <Metric label="Weather history" value={state.data.weather?state.data.weather.matchedDays+' / 30':'Awaiting first run'}
     evidence="recorded" detail="Horizon-matched forecast and outcome pairs"/>
    <Metric label="Recorded demo fills" value={String(state.data.demo.filledOrders)} evidence="recorded"
     detail={state.data.demo.attempts+' order attempts · '+state.data.demo.unresolved+' unresolved'}/>
   </MetricGrid>
   <div className="button-row mt-12">
    <button type="button" className="button" disabled={busy} onClick={()=>void act('run-worker')}>{busy?'Working…':'Update research and paper status'}</button>
    <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void act('offline-check')}>Run offline system check</button>
   </div>
   {state.data.weather&&<div className="mt-12">
    <h3>Frozen independent forecast · {state.data.weather.target}</h3>
    <p>{state.data.weather.forecastHighF}°F NWS forecast high. Recorded {date(state.data.weather.recordedAt)}.</p>
    {state.data.weather.status==='AWAITING_VERIFIED_HISTORY'?<Callout tone="warning" title="Collecting history"><p>Probabilities remain unavailable until 30 comparable historical days are verified. The worker continues collecting and grading research.</p></Callout>:
     <Callout tone="warning" title="Experimental probabilities"><p>This model is uncalibrated. Its probabilities have not demonstrated an advantage over market prices.</p></Callout>}
    <div className="table-wrap"><table><caption>Independent research ranges; these are not exchange listings</caption>
     <thead><tr><th>Daily high range</th><th>Model probability</th></tr></thead>
     <tbody>{state.data.weather.contracts.map(c=><tr key={c.label}><td>{c.label}</td><td>{c.probabilityPpm===null?'Awaiting history':(c.probabilityPpm/10000).toFixed(2)+'%'}</td></tr>)}</tbody>
    </table></div>
   </div>}
   <Details title="Research results and latest worker receipt">
    <KeyValues items={[
     ['Forecasts graded',String(state.data.research.gradedDays)],
     ['Temperature error',state.data.research.meanAbsoluteErrorF===null?'Not measured':state.data.research.meanAbsoluteErrorF.toFixed(2)+'°F'],
     ['Model-scored forecasts',String(state.data.research.modelScoredDays)],
     ['Model Brier score',state.data.research.brier===null?'Not measured':state.data.research.brier.toFixed(5)],
     ['Latest worker',state.data.lastRun?state.data.lastRun.status+' · '+date(state.data.lastRun.startedAt):'No recorded run'],
    ]}/>
    <p className="quiet">Research grades use preliminary NWS reports. They are not exchange settlements or trading returns.</p>
   </Details>
   <Details title="Demo account and automation controls">
    <p><strong>{readiness(state.data.demo.readiness)}.</strong> Test your demo connection to read your mock cash balance. Account history and automated orders require a separate access review.</p>
    {state.data.demo.account&&<KeyValues items={[
     ['Demo available cash',money(state.data.demo.account.cashMicros)],
     ['Demo portfolio value (broker reported)',money(state.data.demo.account.portfolioValueMicros)],
     ['Account last read',date(state.data.demo.account.fetchedAt)],
     ['Model order attempts',String(state.data.demo.modelAttempts)],
     ['Engineering order tests',String(state.data.demo.smokeAttempts)],
    ]}/>}
    <div className="button-row">
     <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void act('check-demo-connection')}>Test demo connection</button>
     <button type="button" className="button button-secondary" disabled={busy||state.data.demo.readiness!=='READY_FOR_OWNER_CHECK'} onClick={()=>void act('check-demo')}>Check demo account</button>
     <button type="button" className="button" disabled={busy||state.data.demo.readiness!=='READY_FOR_OWNER_CHECK'||state.data.demo.state==='ARMED'} onClick={()=>void act('start-demo')}>Start demo automation</button>
     <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void act('stop-demo')}>Stop demo automation</button>
    </div>
    <p className="quiet small-print">One whole contract per order, at most three attempts per climate day. Model orders require valid trained inputs and estimated edge after costs. Unconfirmed orders block further attempts until reconciled.</p>
    {state.data.demo.orders.length>0&&<div className="table-wrap"><table><caption>Recorded exchange demo attempts · latest 20</caption>
     <thead><tr><th>Market</th><th>Purpose</th><th>Status</th><th>Filled contracts</th><th>Reported fees</th><th>Final result</th></tr></thead>
     <tbody>{state.data.demo.orders.map(o=><tr key={o.id}><td>{o.ticker} · {o.side.toUpperCase()}</td>
      <td>{o.kind==='SMOKE'?'System test':'Model'}</td><td>{o.status.replaceAll('_',' ').toLowerCase()}</td>
      <td>{o.filledMicros===null?'Unconfirmed':(o.filledMicros/1_000_000).toFixed(2)}</td>
      <td>{o.feesMicros===null?'Awaiting order read':money(o.feesMicros)}</td><td>{o.settlement?.toUpperCase()??'Not settled'}</td></tr>)}</tbody>
    </table></div>}
    <h3>First connected system test</h3>
    <p>Once armed, this test buys one YES demo contract at its displayed ask, up to $0.99 plus fees. It uses mock funds and does not evaluate model accuracy. An acknowledgement can contain a partial fill or no fill.</p>
    <button type="button" className="button button-secondary" disabled={busy||state.data.demo.state!=='ARMED'||!state.data.weather} onClick={()=>void act('smoke-demo')}>Run one demo order test</button>
   </Details>
   {state.data.fixture&&<Details title="Offline engineering check — synthetic data">
    <Evidence kind="synthetic"/>
    <p>Recorded {date(state.data.fixture.recordedAt)}. {state.data.fixture.events} replayable events, including {state.data.fixture.corrections} settlement correction. Example balance: {money(state.data.fixture.balanceMicros)}.</p>
    <p className="quiet">This fixture tests bookkeeping only. Its invented quotes, probability and outcomes are excluded from research results and demo fills.</p>
   </Details>}
  </>}
  {state.kind==='ready'&&notice&&<p role="status" className="quiet mt-12">{notice}</p>}
 </Panel>;
}
