import {Badge,Details,Metric,MetricGrid,Panel} from '@/components/ui';
import {mountainTime} from '@/lib/paper-automation-view';
import {pct} from '@/lib/format';
import type {CollectionStatus} from '@/lib/props/collection-status';
import type {TimingStudy} from '@/lib/props/timing-study';

const TRIGGER:Record<string,string>={'github-schedule':'GitHub schedule','backup-dispatch':'Vercel backup',manual:'Manual'};
const GAME_STATE:Record<string,{label:string;tone:'positive'|'warning'|'negative'|'neutral'|'info'}>={
 WAITING_FOR_WINDOW:{label:'Planned',tone:'neutral'},DUE:{label:'Window open',tone:'info'},CAPTURED:{label:'Captured',tone:'positive'},
 NO_LINES_FOUND:{label:'No lines posted',tone:'warning'},BUDGET_REFUSED:{label:'No credits',tone:'warning'},MISSED:{label:'Window missed',tone:'negative'},
 FAILED:{label:'Failed',tone:'negative'},ATTEMPT_UNRESOLVED:{label:'Unresolved',tone:'warning'},NOT_SELECTED:{label:'Not selected',tone:'neutral'}};
const VERDICT:Record<string,string>={INSUFFICIENT_DATA:'Not enough data yet',NO_CLEAR_DIFFERENCE:'No clear difference',EARLY_BETTER:'Early looks better',LATE_BETTER:'Late looks better'};

/** Line collection: planned work, completed jobs, recorded picks and virtual entries, each counted separately. */
export function PropsCollectionPanel({s,study,ticksReleased}:{s:CollectionStatus;study:TimingStudy|null;ticksReleased:boolean}){
 const b=s.budget;
 return <Panel title="Props line collection" className="mt-12"
  description={ticksReleased?'Event-aware capture: each game is captured inside its own window before tip-off.':'Fixed collect slots (event-aware capture is built but released off).'}
  actions={<Badge tone={ticksReleased?'positive':'neutral'}>{ticksReleased?'Capture windows':'Fixed slots'}</Badge>}>
  <MetricGrid columns={4}>
   <Metric size="sm" label="Last successful collection" value={s.lastSuccess?mountainTime(s.lastSuccess.at):'None yet'}
    detail={s.lastSuccess?`${s.lastSuccess.mode==='tick'?'Capture tick':'Collect slot'}${s.lastSuccess.trigger?' · '+(TRIGGER[s.lastSuccess.trigger]??s.lastSuccess.trigger):''}`:'No collect has completed'}/>
   <Metric size="sm" label="Next planned collection" value={s.next?mountainTime(s.next.at):'None planned'} detail={s.next?s.next.what:'Automation is off, paused, or nothing is scheduled'}/>
   <Metric size="sm" label="Rolling 24-hour credits left" value={`${b.remaining24h} of ${b.daily}`}
    detail={b.nextRelease?`${b.nextRelease.credits} free again ${mountainTime(b.nextRelease.at)}`:b.used24h?'No credits scheduled to roll off':'No credits used in the last 24 hours'}/>
   <Metric size="sm" label="30-day credits left" value={`${b.remaining30d} of ${b.monthly}`}
    detail={b.providerRemaining===null?'Provider balance not seen yet':`Provider balance ${b.providerRemaining} (floor ${b.providerFloor})`}/>
  </MetricGrid>
  <p className="quiet small-print">{b.countsProviderActuals?'Budget reflects provider-confirmed charges; unknown costs still count at the reserved amount.':'Budget uses conservative reserved credits.'}</p>
  <dl className="automation-facts mt-12" aria-label="Last 48 hours by stage">
   <div><dt>Planned (not yet run)</dt><dd>{s.stages.planned} {ticksReleased?'game windows':'collect slots in the next 36 h'}</dd></div>
   <div><dt>Completed collect jobs</dt><dd>{s.stages.completedJobs}</dd></div>
   <div><dt>Qualifying picks recorded</dt><dd>{s.stages.recordedPicks??'Unknown'}</dd></div>
   <div><dt>Virtual entries made</dt><dd>{s.stages.virtualEntries??'Unknown'}</dd></div>
  </dl>
  {s.noEntryReasons.length?<p className="quiet small-print">No entries in the latest collect: {s.noEntryReasons.map(r=>`${r.platform==='prizepicks'?'PrizePicks':'Pick6'}: ${r.text}`).join(' ')}</p>:null}

  {s.missing.length?<Details title={`Missing or late collection windows (${s.missing.length})`} defaultOpen>
   <ul className="plain-list">{s.missing.map(m=><li key={m.when+m.what}><strong>{mountainTime(m.when)}</strong> · {m.what}: {m.why}</li>)}</ul>
  </Details>:null}

  {s.slates.length?<Details title="Slates: games examined, selected and captured" defaultOpen={ticksReleased}>
   {s.slates.map(sl=><div key={sl.date} className="mt-12">
    <p><strong>{sl.date}</strong> · {sl.arm?`${sl.arm.toUpperCase()} slate`:'no game selected'} · {sl.gamesExamined} games examined · {sl.selected} selected · {sl.captured} captured · {sl.linesObserved} lines · {sl.qualifyingPicks??'unknown'} qualifying picks · {sl.entries??'unknown'} entries</p>
    <div className="table-wrap table-scroll"><table className="data-table">
     <thead><tr><th scope="col">Game</th><th scope="col">Tip-off</th><th scope="col">Assigned window</th><th scope="col">State</th><th scope="col">Captures</th></tr></thead>
     <tbody>{sl.games.map(g=>{const st=GAME_STATE[g.state]??{label:g.state,tone:'neutral' as const};return <tr key={g.event}>
      <th scope="row">{g.matchup}</th><td>{mountainTime(g.tipoff)}</td>
      <td>{(g.arm??'').toUpperCase()} · {mountainTime(g.window.from)} – {mountainTime(g.window.to)}</td>
      <td><Badge tone={st.tone}>{st.label}</Badge></td>
      <td>{g.captures.length?g.captures.map(c=><div key={c.key}>{c.key} · {c.window} · {mountainTime(c.at)} · {c.outcome??'unresolved'}{c.lines!==null?` · ${c.lines} lines`:''}{c.minutesToTip!==null?` · ${Math.round(c.minutesToTip)} min before tip`:''}</div>):'—'}</td></tr>;})}</tbody>
    </table></div></div>)}
  </Details>:<p className="quiet small-print">{s.capturesAvailable?'No capture plans yet.':'Capture plans are not set up on this database yet (props_capture_v1.sql not applied).'}</p>}

  <Details title="Actual execution versus schedule">
   <div className="table-wrap table-scroll"><table className="data-table">
    <thead><tr><th scope="col">Run</th><th scope="col">Started by</th><th scope="col">Started</th><th scope="col">Late by</th><th scope="col">Outcome</th><th scope="col">Games priced</th><th scope="col">Qualifying picks</th><th scope="col">Entries</th></tr></thead>
    <tbody>{s.executions.map(e=><tr key={e.id}>
     <th scope="row">{e.mode==='tick'?'Capture tick':'Collect slot'} <span className="quiet small-print">{e.slot}</span></th>
     <td>{e.trigger?TRIGGER[e.trigger]??e.trigger:'Not recorded'}</td><td>{mountainTime(e.startedAt)}</td>
     <td>{e.delayMinutes===null?(e.mode==='tick'?'No fixed slot':'—'):`${e.delayMinutes} min`}</td>
     <td>{e.outcome}</td><td>{e.gamesCaptured??'—'}</td><td>{e.qualifyingPicks??'Unknown'}</td><td>{e.entries??'Unknown'}</td></tr>)}</tbody>
   </table></div>
   <p className="quiet small-print">A capture tick has no fixed slot: it acts only on games whose own window is open, so a late start cannot spend on a game that has started. Backup ticks record the hour they were scheduled for.</p>
  </Details>

  <Details title="Timing study: early versus late capture">
   {!study?<p>The timing study needs the capture tables and at least one captured slate.</p>:<>
    <p>{study.counts.prospectivePicks} prospective qualifying picks ({study.counts.observationalPicks} older slot picks are kept separate as observational). Verdict on picks: <strong>{VERDICT[study.comparison.picks.verdict]}</strong>
     {study.comparison.picks.difference!==null?` (early minus late hit rate ${pct(study.comparison.picks.difference,1)}, 95% interval ${pct(study.comparison.picks.ci95![0],1)} to ${pct(study.comparison.picks.ci95![1],1)})`:''}.
     A verdict needs at least {study.comparison.picks.minSlatesPerArm} slates and {study.comparison.picks.minGradedPerArm} graded picks per window; there are {study.comparison.picks.earlySlates}/{study.comparison.picks.lateSlates} slates and {study.comparison.picks.earlyGraded}/{study.comparison.picks.lateGraded} graded picks (early/late).</p>
    <div className="table-wrap table-scroll"><table className="data-table">
     <thead><tr><th scope="col">Group</th><th scope="col">Picks</th><th scope="col">Graded</th><th scope="col">Hit rate (95% interval)</th><th scope="col">Model said</th><th scope="col">With closing line</th><th scope="col">Avg line value</th></tr></thead>
     <tbody>{[...Object.entries(study.picks.byArm).map(([k,g])=>['Assigned '+k.toUpperCase(),g] as const),
      ...Object.entries(study.picks.byMinutesToTip).map(([k,g])=>['Captured '+k+' before tip',g] as const),
      ['Older slot picks (observational)',study.picks.observational] as const].map(([label,g])=><tr key={label}>
      <th scope="row">{label}</th><td>{g.lines}</td><td>{g.graded}</td>
      <td>{g.hitRate===null?'—':`${pct(g.hitRate,1)} (${pct(g.ci95![0],0)}–${pct(g.ci95![1],0)})`}</td>
      <td>{g.meanModelProbability===null?'—':pct(g.meanModelProbability,1)}</td><td>{g.withClosing}</td>
      <td>{g.meanClvPoints===null?'—':`${g.meanClvPoints>0?'+':''}${g.meanClvPoints.toFixed(2)} pts`}</td></tr>)}</tbody>
    </table></div>
    <p className="quiet small-print">&ldquo;First observed&rdquo; is the first line SportsEdge saw, not the market&apos;s opening line. Line value is shown only when a later observation of the same line exists within 90 minutes of tip-off; it is never estimated. Picks and probabilities are read exactly as recorded before lock.</p>
   </>}
  </Details>
 </Panel>;
}
