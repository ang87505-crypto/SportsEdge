import {Suspense,cache} from 'react';
import Link from 'next/link';
import {connection} from 'next/server';
import {Badge,Details,Empty,Loading,Metric,MetricGrid,PageHeading,Panel} from '@/components/ui';
import {AutomationRefresh} from '@/components/automation-refresh';
import {AutopilotSummary} from '@/components/autopilot-summary';
import {OpsStatusPanel} from '@/components/ops-status-panel';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {PAPER_AUTO_RELEASE} from '@/lib/stocks/paper-auto-release';
import {PROPS_RELEASE,nextPlannedRuns,ticksReleased} from '@/lib/props/schedule';
import {collectionStatus} from '@/lib/props/collection-status';
import {timingStudy} from '@/lib/props/timing-study';
import {ACTIVE_BUDGET_POLICY} from '@/lib/props/budget';
import {MODEL_VERSION} from '@/lib/props/contract';
import {PropsCollectionPanel} from '@/components/props-collection-panel';
import {buildView} from '@/lib/props/dashboard-view';
import {mountainTime,propsAutomationStatus} from '@/lib/paper-automation-view';
import {pct,usdCents} from '@/lib/format';
import {propsSummary,learningStatus} from '@/lib/props/summary';
import {slotStatus} from '@/lib/props/slot-status';

/** One ledger read per request, shared by the status card and the collection panel. */
const loadOnce=cache(loadPropsDashboard);

export const metadata={title:'Paper automation · SportsEdge',description:'One place to follow PrizePicks props and stock paper automation.'};

export default function AutomationPage(){
 return <>
  <PageHeading title="Paper automation" description="See what runs by itself, what needs you, and what happened last. All money here is virtual."
   action={<AutomationRefresh/>}/>
  <p className="quiet small-print">Times below are New Mexico time. Status refreshes every minute while this page is open. Nothing here needs Claude or ChatGPT: the jobs run on GitHub, the records live in Supabase, and the controls are on this site.</p>
  <div className="automation-grid">
   <Suspense fallback={<Panel title="PrizePicks props"><Loading label="Reading sports records…"/></Panel>}><SportsStatus/></Suspense>
   <Panel title="Stocks" description="Alpaca paper account · weekly stock picks" actions={<Badge tone="info">Paper account</Badge>}>
    <div className="automation-card-body">
     <AutopilotSummary autoRefresh/>
     <dl className="automation-facts">
      <div><dt>Paper orders</dt><dd>{PAPER_AUTO_RELEASE.brokerWritesEnabled?'Released; see owner status above':'Off — plans only'}</dd></div>
      <div><dt>Schedule</dt><dd>{PAPER_AUTO_RELEASE.scheduledRunsEnabled?'On; orders also need a clean account check and Start':'Off'}</dd></div>
      <div><dt>Weekly picks</dt><dd>First market day, usually Monday, 6:00 AM</dd></div>
      <div><dt>First trade run</dt><dd>Weekdays, 7:50 AM; later runs manage remaining orders</dd></div>
      <div><dt>Daily result</dt><dd>After the market closes</dd></div>
     </dl>
     <p className="quiet small-print">Start checks the account and resumes in one action. Once enabled, no daily click is needed. Missed decisions are skipped.</p>
    </div>
   </Panel>
  </div>
  <Suspense fallback={<Panel title="Props line collection" className="mt-12"><Loading label="Reading collection receipts…"/></Panel>}><CollectionSection/></Suspense>
  <div className="mt-12"><Suspense fallback={<Panel title="Background jobs"><Loading label="Reading the operations monitor…"/></Panel>}><OpsStatusPanel/></Suspense></div>
  <Panel title="What the controls mean" className="mt-12">
   <div className="automation-guide">
    <div><h3>Already running</h3><p>PrizePicks collects lines twice each afternoon and grades results overnight and again in the morning, every day, with no click needed. Stocks needs one owner Start after checking the paper account.</p></div>
    <div><h3>Follow the results</h3><p>PrizePicks grades picks after final box scores. Stocks records its account after each close. A scheduled run may find no qualifying pick or order; that is normal.</p></div>
    <div><h3>Pause or stop</h3><p>PrizePicks: sign in on its page and press Pause, Resume or Stop. Stocks: use its Autopilot page. Stopping stocks blocks new orders; existing holdings stay in the account.</p></div>
   </div>
  </Panel>
  <Details title="Schedules and evidence">
   <p>Planned times are targets. GitHub can start jobs late. A green workflow alone does not prove that it saved picks or placed paper orders; check its recorded receipt.</p>
   <p>Stock decisions require a timely data capture. A late decision is skipped instead of using later prices. Market holidays can move the weekly pick to the next session.</p>
   <p>PrizePicks returns use a simulated payout table. Pick6 payouts remain unknown. Neither system has a real-money connection.</p>
   <div className="button-row"><a className="text-link" href="https://github.com/ang87505-crypto/SportsEdge/actions" target="_blank" rel="noopener noreferrer">Run history on GitHub</a></div>
  </Details>
 </>;
}

async function SportsStatus(){
 await connection();
 if(!propsDashboardConfigured())return <Panel title="PrizePicks props"><Empty title="Sports records unavailable"
  action={<Link className="button button-secondary" href="/paper-betting/props">Open PrizePicks</Link>}>The props ledger is not connected on this deployment.</Empty></Panel>;
 let raw;
 try{raw=await loadOnce();}catch{return <Panel title="PrizePicks props"><Empty title="Could not read sports status"
  action={<Link className="button button-secondary" href="/paper-betting/props">Try the props ledger</Link>}>Refresh to check again. The last status is not assumed to be current.</Empty></Panel>;}
 const status=propsAutomationStatus(raw,PROPS_RELEASE.scheduledRunsEnabled);
 const pp=buildView(raw,'prizepicks'),p6=buildView(raw,'pick6');
 const sum=propsSummary(pp);
 const next=nextPlannedRuns(raw.nowIso,4);
 const collect=next.find(r=>r.kind==='collect'),settle=next.find(r=>r.kind==='settle');
 const last=pp.automation.lastCollect;
 const open=pp.entryStats.open+p6.entryStats.open,settled=pp.entryStats.settled+p6.entryStats.settled;
 return <Panel title="PrizePicks props" description="NBA player props · daily virtual entries (Pick6 tracked alongside)" actions={<Badge tone="info">$5 virtual entries</Badge>}>
  <div className="automation-card-body">
   <div className="automation-state"><Badge tone={status.tone} dot>{status.label}</Badge><p>{status.explanation}</p></div>
   <div className="automation-next-action"><span>Next step</span><strong>{status.nextAction}</strong></div>
   <MetricGrid columns={2}>
    <Metric label="Open entries" value={open} detail="Across both platforms" size="sm"/>
    <Metric label="Settled entries" value={settled} detail={settled?'Graded from final scores':'Results are still pending'} size="sm"/>
   </MetricGrid>
   <dl className="automation-facts">
    <div><dt>Last collection</dt><dd>{mountainTime(last?.finished_at??null)}</dd></div>
    <div><dt>Lines saved</dt><dd>{pp.lines.length} PrizePicks · {p6.lines.length} Pick6</dd></div>
    <div><dt>Next collection slot</dt><dd>{PROPS_RELEASE.scheduledRunsEnabled&&raw.control?.state==='RUNNING'&&collect?mountainTime(collect.at):'Waiting until automation is on'}</dd></div>
    <div><dt>Next settlement slot</dt><dd>{PROPS_RELEASE.scheduledRunsEnabled&&raw.control?.state==='RUNNING'&&settle?mountainTime(settle.at):'Manual settlement while testing'}</dd></div>
    <div><dt>Model</dt><dd>{learningStatus(pp.model)}</dd></div>
    <div><dt>PrizePicks balance</dt><dd>{usdCents(sum.balanceCents)} ({pp.bankroll&&pp.bankroll.settledKnown?`${usdCents(sum.netCents,{signed:true})}, ${sum.record.won}–${sum.record.lost}`:'no settled entries yet'})</dd></div>
    <div><dt>PrizePicks pick hit rate</dt><dd>{sum.hitRate===null?'Not measured yet':`${pct(sum.hitRate,1)} of ${sum.graded} graded`}</dd></div>
    <div><dt>Pick6 returns</dt><dd>Unknown — payout depends on its pool</dd></div>
   </dl>
   <div className="button-row">
    <Link href="/paper-betting/props" className="button">Open PrizePicks and controls</Link>
    <a href="https://github.com/ang87505-crypto/SportsEdge/actions/workflows/props-daily.yml" className="button button-secondary" target="_blank" rel="noopener noreferrer">Run history on GitHub</a>
   </div>
   <SlotTable rows={slotStatus(raw.runs,raw.nowIso,1,raw.runCounts??null)}/>
   <p className="quiet small-print">{raw.accounts.length?`Up to ${raw.accounts.reduce((sum,a)=>sum+a.max_entries_per_day,0)} virtual entries a day across both platforms. `:''}Only qualifying picks are recorded.</p>
   <p className="quiet small-print">Read {mountainTime(raw.nowIso)} · saved lines cover the last 14 days.</p>
  </div>
 </Panel>;
}

async function CollectionSection(){
 await connection();
 if(!propsDashboardConfigured())return null;
 let raw;
 try{raw=await loadOnce();}catch{return <Panel title="Props line collection" className="mt-12"><Empty title="Could not read collection receipts">Refresh to check again. Nothing is assumed.</Empty></Panel>;}
 const s=collectionStatus({nowIso:raw.nowIso,runs:raw.runs,credits:raw.credits,providerRemaining:raw.providerRemaining,runCounts:raw.runCounts??null,
  plans:raw.capturePlans??null,captures:raw.captures??null,policy:ACTIVE_BUDGET_POLICY,ticksReleased:ticksReleased(),
  scheduledRunsEnabled:PROPS_RELEASE.scheduledRunsEnabled,controlState:raw.control?.state??null});
 const study=raw.capturePlans&&raw.captures?timingStudy({nowIso:raw.nowIso,observations:raw.observations.map(o=>({...o,run_id:o.run_id??-1})),
  predictions:raw.predictions,picks:raw.picks,results:raw.results,legs:raw.legs,entries:raw.entries,accounts:raw.accounts,settlements:raw.settlements,
  plans:raw.capturePlans,captures:raw.captures,modelVersion:MODEL_VERSION}):null;
 return <PropsCollectionPanel s={s} study={study} ticksReleased={ticksReleased()}/>;
}

const TRIGGER:Record<string,string>={'github-schedule':'GitHub schedule','backup-dispatch':'Vercel backup',manual:'Manual'};
const STATE:Record<string,{label:string;tone:'positive'|'warning'|'negative'|'neutral'|'info'}>={
 PLANNED:{label:'Planned',tone:'neutral'},NO_RUN_RECORDED:{label:'No run recorded',tone:'warning'},RUNNING:{label:'Running',tone:'info'},
 COMPLETED:{label:'Completed',tone:'positive'},SKIPPED:{label:'Skipped',tone:'warning'},FAILED:{label:'Failed',tone:'negative'}};
/** Each slot: scheduled time, what started it and when, how it ended, picks and entries made, entries settled. */
function SlotTable({rows}:{rows:ReturnType<typeof slotStatus>}){
 return <Details title="Recent and next slots">
  <div className="table-wrap table-scroll"><table className="data-table">
   <thead><tr><th scope="col">Slot (scheduled)</th><th scope="col">State</th><th scope="col">Started by / delay</th><th scope="col">Finished</th><th scope="col">Decisions (incl. skips)</th><th scope="col">Qualifying picks</th><th scope="col">Entries made</th><th scope="col">Entries settled</th></tr></thead>
   <tbody>{rows.map(r=>{const st=STATE[r.state];return <tr key={r.slot}>
    <th scope="row">{r.kind==='collect'?'Collect':'Settle'} · {mountainTime(r.scheduledFor)}</th>
    <td><Badge tone={st.tone}>{st.label}</Badge>{r.outcome&&r.outcome!=='COMPLETED'?<div className="quiet small-print">{r.outcome}</div>:null}{r.note?<div className="quiet small-print">{r.note}</div>:null}</td>
    <td>{r.startedAt?`${r.trigger?TRIGGER[r.trigger]??r.trigger:'Not recorded'} · ${r.startDelayMinutes??0} min late`:'—'}</td>
    <td>{r.finishedAt?mountainTime(r.finishedAt):'—'}</td>
    <td>{r.kind==='collect'&&r.startedAt?r.decisions??'Unknown':'—'}</td>
    <td>{r.kind==='collect'&&r.startedAt?r.qualifyingPicks??'Unknown':'—'}</td>
    <td>{r.entriesCreated===null?'—':r.entriesCreated}{r.noEntryReasons.length?<div className="quiet small-print">{r.noEntryReasons.map(x=>`${x.platform==='prizepicks'?'PrizePicks':'Pick6'}: ${x.text}`).join(' ')}</div>:null}</td>
    <td>{r.entriesSettled??'—'}</td></tr>;})}</tbody>
  </table></div>
  <p className="quiet small-print">Decisions include skips; qualifying picks are the decisions recorded as picks, read from the saved pick rows (Unknown when they cannot be read). Planned slots have not run. A collect that starts more than 150 minutes late spends nothing; the Vercel backup starts each slot within about two hours if GitHub is late, and the ledger refuses a second start of the same slot.</p>
 </Details>;
}
