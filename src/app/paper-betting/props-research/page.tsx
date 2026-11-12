import {Suspense} from 'react';
import {createHash} from 'node:crypto';
import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeading,Panel,Metric,MetricGrid,Empty,Loading,Details,KeyValues,Evidence,Badge} from '@/components/ui';
import {AutomationRefresh} from '@/components/automation-refresh';
import {loadPropsResearch} from '@/lib/server/props-research-data';
import {propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {buildResearch,type PropsResearchView} from '@/lib/props/research';
import {PLATFORM_LABEL,type Platform} from '@/lib/props/contract';
import {PROPS_RELEASE,ticksReleased} from '@/lib/props/schedule';
import {nextCollectionAt} from '@/lib/props/collection-status';
import {pct} from '@/lib/format';
import artifact from '@/data/props/research_v2.json';
import baselineArtifact from '@/data/props/model_v1.json';

export const metadata={title:'Props Research & Picks · SportsEdge',description:'Ranked qualifying NBA paper picks and a chronological probability-calibration experiment.'};
const localTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const date=(s:string)=>localTime.format(new Date(s));
const score=(n:number|null)=>n===null?'Pending':n.toFixed(4);
type Search=Promise<Record<string,string|string[]|undefined>>;

export default function Page({searchParams}:{searchParams:Search}){
 return <>
  <PageHeading title="Props research & picks" description="The strongest qualifying picks according to the current model, plus a separate test of more cautious confidence estimates. All entries use paper money."
   action={<><Link className="button button-secondary" href="/paper-betting/props">Paper ledger</Link><AutomationRefresh/></>}/>
  <Suspense fallback={<Loading label="Reading the latest paper picks and research results"/>}><Live searchParams={searchParams}/></Suspense>
  <Historical/>
  <Details title="What the research can establish">
   <p>The candidate scales the original model&apos;s More/Less confidence toward 50%, independently for each stat. It preserves ties and does not change the predicted side. The historical temperatures were chosen on January 2026 games; February and later games provide retrospective confirmation.</p>
   <p>The historical study uses proxy thresholds derived from prior games. It does not use archived PrizePicks or Pick6 lines, and the original model&apos;s aggregate results on this season were already inspected. It cannot establish a profitable edge.</p>
   <p>The forward comparison uses the same real, archived forecasts for both versions, deduplicates identical lines across platforms, and uses the latest final grades. It starts {date(artifact.forwardStartsAt)}. Progress covers the displayed rolling 90-day window. Ties and DNPs are excluded from directional accuracy; ties remain explicit outcomes in probability scoring.</p>
   <p>Review requires at least {artifact.reviewGate.minGradedLines} graded lines, {artifact.reviewGate.minDates} NBA slate dates, {artifact.reviewGate.minGames} games and {artifact.reviewGate.minCandidateDecisions} candidate decisions. A paired game-level bootstrap must support a Brier improvement greater than 0.002, with no worse log loss. A passing score requests review; it does not switch models or demonstrate profitability.</p>
   <p>Next research questions are timestamped injuries and lineups, changing minutes and roles, and opponent, pace and rest effects. These inputs are not currently included. Pick6 dollar payouts remain unknown.</p>
  </Details>
 </>;
}

async function Live({searchParams}:{searchParams:Search}){
 await connection();
 const platform:Platform=(await searchParams).platform==='pick6'?'pick6':'prizepicks';
 const tabs=<nav className="tabs props-tabs" aria-label="Pick platform">
  {(['prizepicks','pick6'] as const).map(p=><Link key={p} href={`/paper-betting/props-research?platform=${p}`} aria-current={platform===p?'page':undefined}>{PLATFORM_LABEL[p]}</Link>)}
 </nav>;
 if(!propsDashboardConfigured())return <>{tabs}<Panel className="mt-12"><Empty title="The paper ledger is not connected">Ranked picks and forward research will appear when this deployment can read the ledger. The historical comparison below is available now.</Empty></Panel></>;
 let v:PropsResearchView;
 try{
  if(createHash('sha256').update(JSON.stringify(baselineArtifact)).digest('hex')!==artifact.baselineCanonicalSha256)throw new Error('BASELINE_CHANGED');
  v=buildResearch(await loadPropsResearch(),artifact);
 }catch{return <>{tabs}<Panel className="mt-12"><Empty title="The research snapshot is unavailable">Refresh to try again. No picks or forward results have been filled in.</Empty></Panel></>;}
 // The research snapshot carries no capture plans: with ticks released this shows no time rather than a stale slot.
 const nextAt=nextCollectionAt({nowIso:v.asOf,ticksReleased:ticksReleased(),plans:null,captures:null});
 const next=nextAt?{at:nextAt}:null;
 return <>{tabs}
  <Panel title="Automatic paper selection" className="mt-12" actions={<Evidence kind="recorded"/>}>
   <MetricGrid columns={3}>
    <Metric size="sm" label="Owner control" value={v.control?.state??'Unknown'} detail={v.control?.reason??'No control receipt'}/>
    <Metric size="sm" label="Daily worker" value={PROPS_RELEASE.scheduledRunsEnabled?'Schedule released':'Release pending'} detail={PROPS_RELEASE.scheduledRunsEnabled&&next?`Next collection ${date(next.at)}`:'The original settlement and release checks must pass'}/>
    <Metric size="sm" label="Latest view" value={date(v.asOf)} detail="Refreshes every minute while this page is visible"/>
   </MetricGrid>
   <p className="quiet mt-12">The paper worker chooses from the original model&apos;s qualifying picks. Higher model confidence ranks first. Each entry spans different games and players, with at most three $5 entries per platform per day. A qualifying pick is not a guaranteed winner.</p>
  </Panel>
  <Rankings v={v} platform={platform} candidate={false}/>
  <Panel title="Forward model comparison" description={`Same real lines for both versions; NBA slate dates in New York. Data from ${date(v.windowStart)}.`} actions={<Badge tone="info">{v.review.status==='ready_for_review'?'Ready for review':v.review.status==='collecting'?'Collecting evidence':'Needs more evidence'}</Badge>} className="mt-12">
   <MetricGrid columns={4}>
    <Metric size="sm" label="Unique graded lines" value={`${v.baseline.n} / ${v.review.gate.minGradedLines}`} detail={`${v.progress.pending} pending · ${v.progress.voided} void`}/>
    <Metric size="sm" label="NBA slate dates" value={`${v.progress.dates} / ${v.review.gate.minDates}`} detail={`${v.progress.games} games; ${v.review.gate.minGames} required`}/>
    <Metric size="sm" label="Original Brier" value={score(v.baseline.brier)} detail="Lower is better; ties are scored explicitly"/>
    <Metric size="sm" label="Candidate Brier" value={score(v.candidate.brier)} detail="Confidence calibration; research only"/>
   </MetricGrid>
   <div className="table-wrap table-scroll mt-12"><table className="data-table ledger-table">
    <caption className="quiet">Results on identical future lines; neither version has demonstrated a profitable edge.</caption>
    <thead><tr><th scope="col">Version</th><th scope="col">Log loss</th><th scope="col">Directional hits</th><th scope="col">Qualifying decisions</th><th scope="col">Use</th></tr></thead>
    <tbody>{[{name:'Original',s:v.baseline,use:'Active paper selector'},{name:'Calibrated candidate',s:v.candidate,use:'Research comparison'}].map(x=><tr key={x.name}>
     <td data-label="Version">{x.name}</td><td data-label="Log loss">{score(x.s.logLoss)}</td>
     <td data-label="Directional hits">{x.s.directional?`${x.s.correct} / ${x.s.directional} (${pct(x.s.hitRate,1)})`:'Pending'}</td>
     <td data-label="Qualifying decisions">{x.s.decisions?`${x.s.decisionsCorrect} / ${x.s.decisions} correct`:'None graded yet'}</td><td data-label="Use">{x.use}</td>
    </tr>)}</tbody>
   </table></div>
   <p className="quiet mt-12">{v.progress.preRegistration} earlier unique lines are excluded from the forward test; {v.progress.duplicates} repeated observations are deduplicated. {v.progress.invalid} records failed validation. Future results update after the settlement worker records final grades.</p>
  </Panel>
  <Details title="Candidate research shortlist">
   <p>These are the candidate&apos;s qualifying estimates on the same current lines. They are not recorded paper entries and do not replace the active model.</p>
   <Rankings v={v} platform={platform} candidate/>
  </Details>
 </>;
}

function Rankings({v,platform,candidate}:{v:PropsResearchView;platform:Platform;candidate:boolean}){
 const rows=(candidate?v.rankings.candidate:v.rankings.baseline).filter(x=>x.platform===platform).slice(0,6);
 return <Panel title={candidate?'Calibrated research picks':'Top qualifying paper picks'} description={`${PLATFORM_LABEL[platform]} · excludes locked games, quotes over two hours old and invalid forecasts.`} className="mt-12" flush>
  {rows.length?<div className="table-wrap table-scroll"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Rank / pick</th><th scope="col">Model estimate</th><th scope="col">Game / lock</th><th scope="col">Quote captured</th><th scope="col">Paper entry</th></tr></thead>
   <tbody>{rows.map((r,i)=><tr key={r.observationId}>
    <td data-label="Rank / pick"><strong>{i+1}. {r.player}</strong><small>{r.side==='more'?'More':'Less'} {r.line} {r.stat}</small></td>
    <td data-label="Model estimate">{pct(r.probability,1)}<small>{candidate?'Calibrated, unproven':'Original, uncalibrated'}</small></td>
    <td data-label="Game / lock">{r.game}<small>{date(r.lockAt)}</small></td><td data-label="Quote captured">{date(r.quoteAt)}</td>
    <td data-label="Paper entry">{candidate?'Research only':r.entryIds.length?r.entryIds.map(id=>'#'+id).join(', '):'Qualifying; not in an entry'}</td>
   </tr>)}</tbody>
  </table></div>:<div className="panel-pad"><Empty title={v.control?.state==='RUNNING'?'No fresh qualifying picks':'Paper selection is paused'}>{v.control?.state==='RUNNING'?'New picks appear after a successful pregame collection if they pass the selection rules. Games that have locked are removed automatically.':'The owner control must be RUNNING before a current shortlist is shown.'}</Empty></div>}
 </Panel>;
}

function Historical(){
 const h=artifact.historical;
 return <Panel title="Historical research completed" description="Retrospective probability test using proxy lines; no simulated returns or profitability claim." actions={<Evidence kind="recorded"/>} className="mt-12">
  <MetricGrid columns={3}>
   <Metric size="sm" label="Stat forecasts" value={h.n.toLocaleString('en-US')} detail={`${h.games} games · ${h.from} to ${h.through}`}/>
   <Metric size="sm" label="Original Brier" value={score(h.baseline.brier)}/>
   <Metric size="sm" label="Candidate Brier" value={score(h.candidate.brier)} detail="A modest improvement in probability quality"/>
  </MetricGrid>
  <div className="table-wrap mt-12"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Stat</th><th scope="col">Original Brier</th><th scope="col">Candidate Brier</th><th scope="col">Temperature</th></tr></thead>
   <tbody>{(['points','rebounds','assists'] as const).map(s=><tr key={s}><td data-label="Stat">{s}</td><td data-label="Original Brier">{score(h.byStat[s].baseline.brier)}</td><td data-label="Candidate Brier">{score(h.byStat[s].candidate.brier)}</td><td data-label="Temperature">{artifact.temperatures[s]}</td></tr>)}</tbody>
  </table></div>
  <KeyValues items={[
   ['Candidate use','Research only; the original paper selector stays active'],
   ['Confidence adjustment','Fitted on January 2026; later games scored separately'],
   ['Next evidence','Real pregame lines and final results from the forward test'],
  ]}/>
 </Panel>;
}
