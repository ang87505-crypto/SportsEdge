import {Suspense} from 'react';
import Link from 'next/link';
import {connection} from 'next/server';
import {Badge,Details,Empty,Loading,Metric,MetricGrid,PageHeading,Panel} from '@/components/ui';
import {AutomationRefresh} from '@/components/automation-refresh';
import {AutopilotSummary} from '@/components/autopilot-summary';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {PAPER_AUTO_RELEASE} from '@/lib/stocks/paper-auto-release';
import {PROPS_RELEASE,nextPlannedRuns} from '@/lib/props/schedule';
import {buildView} from '@/lib/props/dashboard-view';
import {mountainTime,propsAutomationStatus} from '@/lib/paper-automation-view';
import {pct,usdCents} from '@/lib/format';
import {propsSummary,learningStatus} from '@/lib/props/summary';

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
 try{raw=await loadPropsDashboard();}catch{return <Panel title="PrizePicks props"><Empty title="Could not read sports status"
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
   <p className="quiet small-print">{raw.accounts.length?`Up to ${raw.accounts.reduce((sum,a)=>sum+a.max_entries_per_day,0)} virtual entries a day across both platforms. `:''}Only qualifying picks are recorded.</p>
   <p className="quiet small-print">Read {mountainTime(raw.nowIso)} · saved lines cover the last 14 days.</p>
  </div>
 </Panel>;
}
