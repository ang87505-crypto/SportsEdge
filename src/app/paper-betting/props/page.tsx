import {Suspense} from 'react';
import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Empty,Details,KeyValues,Loading,Badge,type Tone} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {buildView,type PropsView,type Raw} from '@/lib/props/dashboard-view';
import {propsSummary,mtShort,whyLine} from '@/lib/props/summary';
import {PropsModelPanel,PropsReviewCard,SafetyBrakeBanner} from '@/components/props-model-panel';
import {propsAutomationStatus} from '@/lib/paper-automation-view';
import {PropsOwnerControls} from '@/components/props-owner-controls';
import {AutomationRefresh} from '@/components/automation-refresh';
import {PLATFORMS,PLATFORM_LABEL,MODEL_VERSION,SELECTION_VERSION,type Platform} from '@/lib/props/contract';
import {PROPS_RELEASE,nextPlannedRuns,ticksReleased} from '@/lib/props/schedule';
import {nextCollectionAt} from '@/lib/props/collection-status';
import {pct,usdCents} from '@/lib/format';
import {CalibrationChart} from '@/components/charts';
import {calibrationBins,brierEdge,type BacktestSummary} from '@/lib/props/backtest-view';
import {ACTIVE_BUDGET_POLICY} from '@/lib/props/budget';
import {PROPS_SCHEDULE} from '@/lib/props/schedule';
import backtestJson from '@/data/props/backtest_v1.json';
import type {Stat} from '@/lib/props/contract';

const BACKTEST=backtestJson as BacktestSummary;
const STAT_TABS:Stat[]=['points','rebounds','assists'];

export const metadata={title:'PrizePicks Player Props · SportsEdge',description:'Daily virtual NBA player-stat picks on PrizePicks (and DraftKings Pick6) lines: status, results and controls.'};

type Search=Promise<Record<string,string|string[]|undefined>>;
export default function Page({searchParams}:{searchParams:Search}){
 return <>
  <PageHeading title="PrizePicks player props" description="Daily virtual picks on NBA points, rebounds and assists. Lines are saved before each game, picks are recorded before lock, and results are graded from final box scores."
   action={<><Link href="/assistant" className="button">Ask</Link><Link href="/paper-betting/props-research" className="button button-secondary">Ranked picks &amp; research</Link><AutomationRefresh/></>}/>
  <div className="virtual-banner" role="note">
   <span className="virtual-banner-icon"><NavIcon name="shield" size={18}/></span>
   <div><strong>Virtual entries only.</strong> No PrizePicks or DFS account is connected and nothing here submits a real entry. Paid contests may not be lawful where you live.</div>
  </div>
  <Suspense fallback={<Loading label="Loading the props paper ledger"/>}><Body searchParams={searchParams}/></Suspense>
 </>;
}

async function Body({searchParams}:{searchParams:Search}){
 await connection();
 const sp=await searchParams;
 const platform:Platform=sp.platform==='pick6'?'pick6':'prizepicks';
 const cal:Stat=STAT_TABS.includes(sp.cal as Stat)?sp.cal as Stat:'points';
 const tabs=<nav className="tabs props-tabs" aria-label="Platform" style={{marginBottom:12}}>
  {PLATFORMS.map(p=><Link key={p} href={`/paper-betting/props?platform=${p}`} aria-current={p===platform?'page':undefined}>{PLATFORM_LABEL[p]}</Link>)}
 </nav>;
 if(!propsDashboardConfigured())return <>{tabs}<NotConnected/><PropsModelPanel v={null}/><HistoricalCheck platform={platform} cal={cal}/><Limits/></>;
 let raw:Raw|null=null;let view:PropsView|null=null;
 const record=sp.record==='v1'?'v1':'current';
 try{raw=await loadPropsDashboard();view=buildView(raw,platform,{record});}catch{view=null;}
 if(!raw||!view)return <>{tabs}<Panel><Empty title="The props ledger did not respond" action={<a className="button button-secondary" href={`/paper-betting/props?platform=${platform}`}>Reload</a>}>No line, pick or result has been substituted.</Empty></Panel><PropsOwnerControls/><Limits/></>;
 const learnActive=/^props-learn-v[0-9]+$/.test(view.model?.active??'');
 const recordTabs=learnActive?<nav className="tabs" aria-label="Record" style={{marginBottom:12}}>
  <Link href={`/paper-betting/props?platform=${platform}`} aria-current={record==='current'?'page':undefined}>Current record</Link>
  <Link href={`/paper-betting/props?platform=${platform}&record=v1`} aria-current={record==='v1'?'page':undefined}>Stats-model record (v1)</Link>
 </nav>:null;
 return <>{tabs}{recordTabs}<SafetyBrakeBanner control={raw.control}/><Summary raw={raw} v={view}/><TodaysPicks v={view}/><PropsOwnerControls/>
  <PropsModelPanel v={view}/><PropsReviewCard v={view}/><Entries v={view}/><Lines v={view}/>
  <RunHistory v={view}/><HistoricalCheck platform={platform} cal={cal}/><Limits/></>;
}

function NotConnected(){
 return <>
  <Panel title="Not connected yet" actions={<Evidence kind="unavailable"/>}>
   <p className="quiet">This deployment has no props ledger configured, so there are no observed lines, model estimates or simulated results to show. Nothing has been filled in with examples.</p>
   <KeyValues items={[['Daily schedule',PROPS_RELEASE.scheduledRunsEnabled?'On':'Off'],['Model',MODEL_VERSION],['Selection rule',SELECTION_VERSION]]}/>
  </Panel>
  <Panel title="Daily cycle" description="Fixed UTC slots; local times shift with daylight saving." className="mt-12"><Schedule/></Panel>
 </>;
}

/** The first thing to read: is it running, and how is it doing? */
function Summary({raw,v}:{raw:Raw;v:PropsView}){
 const status=propsAutomationStatus(raw,PROPS_RELEASE.scheduledRunsEnabled);
 const s=propsSummary(v);
 const running=PROPS_RELEASE.scheduledRunsEnabled&&raw.control?.state==='RUNNING';
 const next=nextPlannedRuns(raw.nowIso,4);
 const collectAt=nextCollectionAt({nowIso:raw.nowIso,ticksReleased:ticksReleased(),plans:raw.capturePlans,captures:raw.captures});
 const collect=collectAt?{at:collectAt}:null,settle=next.find(r=>r.kind==='settle');
 const pp=v.platform==='prizepicks';
 const r=s.record;
 return <Panel title={`${PLATFORM_LABEL[v.platform]} at a glance`} description={`Read ${mtShort(raw.nowIso)} (New Mexico time). Lines and picks cover the last 14 days.`} actions={<Evidence kind={pp?'simulated':'recorded'}/>}>
  <div className="props-status-line"><Badge tone={status.tone} dot>{status.label}</Badge><p>{status.explanation} <strong>Next:</strong> {status.nextAction}</p></div>
  <MetricGrid columns={4}>
   {pp?<Metric label="Virtual balance" value={usdCents(s.balanceCents)} detail={v.bankroll?`Started at ${usdCents(v.bankroll.initialCents)}`:'No PrizePicks account row'}/>
    :<Metric label="Virtual balance" value="Not measurable" detail="Pick6 payouts depend on other entrants"/>}
   <Metric label="Net result" value={pp?usdCents(s.netCents,{signed:true}):'Unknown'} tone={s.netCents===null||s.netCents===0||!pp?undefined:s.netCents>0?'positive':'negative'}
    detail={pp?(s.roi===null?'Shown once an entry settles':`ROI ${pct(s.roi,1,{signed:true})} on settled $5 entries`):'Leg results are still graded below'}/>
   <Metric label="Entries" value={pp?`${r.won}–${r.lost}`:`${v.entryStats.allLegsHit} perfect`} hint={pp?'Won–lost for settled 2-pick Power Play entries. Refunds (ties or did-not-play) are not counted as wins or losses.':undefined}
    detail={`${s.openEntries} open${pp&&r.refund?`, ${r.refund} refunded`:''}${!pp?`, ${v.entryStats.settled} settled`:''}`}/>
   <Metric label="Pick hit rate" value={s.hitRate===null?'Not measured':pct(s.hitRate,1)} hint="Share of recorded More/Less picks that were right. A 2-pick Power Play needs about 57.7% to break even."
    detail={s.graded?`${s.correct} of ${s.graded} graded picks`:'No graded picks yet'}/>
  </MetricGrid>
  <div style={{marginTop:12}}><KeyValues items={[
   ['Last line collection',v.automation.lastCollect?mtShort(v.automation.lastCollect.finished_at):'None yet'],
   ['Next line collection',running&&collect?mtShort(collect.at):'Not scheduled while paused or stopped'],
   ['Next grading',running&&settle?mtShort(settle.at):'Not scheduled while paused or stopped'],
  ]}/></div>
 </Panel>;
}

function TodaysPicks({v}:{v:PropsView}){
 const picks=propsSummary(v).upcoming.slice(0,8);
 return <Panel title="Upcoming picks" description="Recorded picks for games that have not started, most confident first. A pick is a model estimate, not a sure thing." actions={<Evidence kind="recorded"/>} className="mt-12">
  {picks.length?<ol className="props-picks">{picks.map(p=><li key={p.id}>
   <span><strong>{p.player} · {p.side==='more'?'More':'Less'} {p.line} {p.stat}</strong><small>{p.game} · locks {mtShort(p.lockAt)}</small>
    {whyLine(p)&&<small className="props-why">{whyLine(p)}</small>}<Flags flags={p.market?.flags??[]}/></span>
   <strong className="prob">{pct(p.probability,0)}</strong>
  </li>)}</ol>:<p className="quiet">No upcoming picks right now. New picks appear after the next line collection if any line passes the selection rule (60–80% model confidence).</p>}
 </Panel>;
}

const tone=(s:string):Tone=>s==='completed'?'positive':s==='failed'||s==='abandoned'?'negative':s==='skipped'?'warning':'info';
function RunHistory({v}:{v:PropsView}){
 const a=v.automation;const b=a.budget;
 return <Details title="Run history, schedule and data budget">
  {a.lastFailure&&<p className="game-card-warning">Last failure: {a.lastFailure.kind} run {a.lastFailure.slot_key} ended {a.lastFailure.status} ({a.lastFailure.outcome}).</p>}
  <Schedule/>
  <div style={{marginTop:12}}><KeyValues items={[
   ['Data credits used (24 h)',`${b.used24h} of ${b.daily}`],['Data credits used (30 days)',`${b.used30d} of ${b.monthly}`],
   ['Provider credits left (last report)',b.providerRemaining===null?'Not reported yet':`${b.providerRemaining} (collection stops at ${b.floor})`]]}/></div>
  <div className="table-wrap table-scroll" style={{marginTop:12}}><table className="data-table ledger-table">
   <thead><tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Started</th><th scope="col">Receipt</th></tr></thead>
   <tbody>{a.runs.length?a.runs.map(r=><tr key={r.id}>
    <td data-label="Run"><strong>{r.kind}</strong><small>{r.slot_key}</small></td>
    <td data-label="Status"><Badge tone={tone(r.status)}>{r.status}</Badge><small>{r.outcome}</small></td>
    <td data-label="Started">{mtShort(r.started_at)}{r.start_delay_seconds?<small>{Math.round(r.start_delay_seconds/60)} min after its slot</small>:null}</td>
    <td data-label="Receipt">{receipt(r.summary)}</td>
   </tr>):<tr><td colSpan={4} className="quiet">No runs recorded yet.</td></tr>}</tbody>
  </table></div>
  <p className="quiet small-print">A finished workflow is not proof of recorded picks; the receipts above come from the ledger.</p>
 </Details>;
}
function receipt(s:Record<string,unknown>){
 const r=s?.receipt as {observations?:number;predictions?:number;picks?:number}|undefined;
 const g=s?.grading as {newResults?:number}|undefined;
 const box=s?.boxScores as {newRows?:number;games?:number}|undefined;
 const st=s?.settlement as {settled?:number}|undefined;
 if(r)return `${r.observations??0} lines, ${r.predictions??0} estimates, ${r.picks??0} decisions`;
 if(g||box)return [box?`${(box.newRows??0).toLocaleString()} box-score rows saved`:null,g?`${g.newResults??0} lines graded`:null,
  st?.settled?`${st.settled} entries settled`:null].filter(Boolean).join(', ');
 return typeof s?.reason==='string'?s.reason.replace(/_/g,' '):'—';
}

function Flags({flags}:{flags:string[]}){
 if(!flags.length)return null;
 return <span className="props-flag-row">{flags.map(f=><Badge key={f} tone={f==='pros_disagree'?'warning':'info'}>{f==='pros_disagree'?'Pros disagree':'Lagging line'}</Badge>)}</span>;
}
const outcomeText=(l:PropsView['lines'][number])=>{
 if(!l.result)return l.locked?'Unknown, awaiting final':'Not started';
 const o=l.result.outcome;
 const base=o==='void_dnp'?'Void: did not play':o==='void_postponed'?'Void: postponed':o==='tie'?`Tie at ${l.result.actual}`:`${l.result.actual} (${o==='more'?'More':'Less'})`;
 return l.result.corrected?base+' · corrected':base;
};
function Lines({v}:{v:PropsView}){
 const rows=v.lines.slice(0,60);
 return <Panel title="Every line checked" description={`${PLATFORM_LABEL[v.platform]} standard full-game lines from The Odds API, last 14 days${v.lines.length>rows.length?`; newest ${rows.length} of ${v.lines.length} shown`:''}. Most lines are skipped; only 60–80% model confidence becomes a pick.`} actions={<Evidence kind="recorded"/>} className="mt-12" flush>
  {rows.length?<div className="table-wrap table-scroll"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Observed line</th><th scope="col">Game</th><th scope="col" className="num">Model estimate</th><th scope="col">Decision</th><th scope="col">Result</th></tr></thead>
   <tbody>{rows.map(l=><tr key={l.id}>
    <td data-label="Observed line"><strong>{l.player}</strong><small>{l.stat} {l.line} · quote {l.quoteAgeMinutes} min old at capture</small></td>
    <td data-label="Game">{l.game}<small>Locks {mtShort(l.lockAt)}</small></td>
    <td data-label="Model estimate" className="num">{l.pMore===null?<span className="quiet">Unscorable ({(l.predictionReason??'missing').replace(/_/g,' ')})</span>
     :<>More {pct(l.pMore,0)} · Less {pct(l.pLess,0)}<small>{whyLine(l)||`mean ${l.mean?.toFixed(1)}`} · {l.modelVersion}</small><Flags flags={l.market?.flags??[]}/></>}</td>
    <td data-label="Decision">{l.decision==='recorded'?<Badge tone="info">{l.side==='more'?'More':'Less'}</Badge>:<span className="quiet">Skipped</span>}<small>{(l.decisionReason??'no decision').replace(/_/g,' ')}</small></td>
    <td data-label="Result" className={l.correct===true?'tone-text-positive':l.correct===false?'tone-text-negative':undefined}>{outcomeText(l)}</td>
   </tr>)}</tbody>
  </table></div>:<div className="panel-pad"><p className="quiet">No {PLATFORM_LABEL[v.platform]} lines recorded in the last 14 days.</p></div>}
 </Panel>;
}

function Entries({v}:{v:PropsView}){
 return <Panel title="Virtual entries" description="$5 two-pick entries, each pick from a different game and player, recorded before lock. At most 3 per platform per day; never forced to fill a quota." actions={<Evidence kind="simulated"/>} className="mt-12" flush>
  {v.entries.length?<div className="table-wrap table-scroll"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Entry</th><th scope="col">Legs</th><th scope="col">Simulated result</th></tr></thead>
   <tbody>{v.entries.slice(0,60).map(e=><tr key={e.id}>
    <td data-label="Entry"><strong>#{e.id} · {usdCents(e.stakeCents)}</strong><small>Recorded {mtShort(e.createdAt)}</small></td>
    <td data-label="Legs">{e.legs.map(l=><div key={l.id}>{l.player} {l.side==='more'?'More':'Less'} {l.line} {l.stat}<small>{outcomeText(l)}</small></div>)}</td>
    <td data-label="Simulated result">{!e.settlement?<span className="quiet">Open</span>:e.settlement.profitCents===null?
     <>Payout unknown<small>{e.settlement.wins} correct, {e.settlement.losses} wrong, {e.settlement.voids} void</small></>:
     <span className={e.settlement.profitCents>0?'tone-text-positive':e.settlement.profitCents<0?'tone-text-negative':undefined}>{e.settlement.outcome==='won'?'Won':e.settlement.outcome==='lost'?'Lost':e.settlement.outcome==='refund'?'Refunded':e.settlement.outcome} {usdCents(e.settlement.profitCents,{signed:true})}<small>returned {usdCents(e.settlement.returnCents)}</small></span>}</td>
   </tr>)}</tbody>
  </table></div>:<div className="panel-pad"><p className="quiet">No simulated {PLATFORM_LABEL[v.platform]} entries yet.</p></div>}
 </Panel>;
}

const nmTime=(hour:number,minute:number)=>{
 const d=new Date();d.setUTCHours(hour,minute,0,0);
 return new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',hour:'numeric',minute:'2-digit'}).format(d);
};
function Schedule(){
 const b=ACTIVE_BUDGET_POLICY;
 const rows=[...PROPS_SCHEDULE].sort((x,y)=>x.hour*60+x.minute-(y.hour*60+y.minute));
 return <>
  <ol className="props-schedule">{rows.map(r=><li key={r.cron}>
   <Badge tone={r.kind==='collect'?'info':'accent'}>{r.kind==='collect'?'Collect lines':'Grade and settle'}</Badge>
   <span><strong>{nmTime(r.hour,r.minute)} New Mexico</strong><small>{String(r.hour).padStart(2,'0')}:{String(r.minute).padStart(2,'0')} UTC daily</small></span>
  </li>)}</ol>
  <p className="quiet" style={{marginTop:8}}>{PROPS_RELEASE.scheduledRunsEnabled?'The daily schedule is on. ':'The daily schedule is off: runs happen only when started by hand. '}
   Data budget {b.version}: up to {b.maxEventsPerRun} games per collection, {b.dailyCredits} provider credits per rolling 24 hours, {b.monthlyCredits} per 30 days, and a stop when the provider reports fewer than {b.providerFloor} credits left. The later collection only spends if the earlier one could not.</p>
 </>;
}

function HistoricalCheck({platform,cal}:{platform:Platform;cal:Stat}){
 const seasons=BACKTEST.seasons;const latest=seasons[seasons.length-1];
 const band=(k:string,s=latest)=>s.selection.byBand[k];
 const statLabel={points:'Points',rebounds:'Rebounds',assists:'Assists'};
 return <Details title="Historical check: how the model did on past seasons"><Panel description="Two seasons the model never saw: parameters fit on the prior season, every game predicted from earlier games only. Lines are proxies (each player's recent median + 0.5), not PrizePicks or Pick6 lines, so this measures calibration, not profit." actions={<Evidence kind="historical"/>} flush>
  <div className="panel-pad">
   <MetricGrid columns={4}>
    <Metric size="sm" label="Lines checked" value={seasons.reduce((a,s)=>a+s.scoredLines,0).toLocaleString()} detail={seasons.map(s=>s.label).join(' and ')}/>
    <Metric size="sm" label="Picks that qualify" value={pct(latest.selection.qualifyingShare,0)} detail={`${latest.label}: rule ${BACKTEST.selectionVersion} (60–80% model probability)`}/>
    <Metric size="sm" label="Pick hit rate (proxy lines)" value={pct(latest.selection.recorded.hitRate,1)} detail={`${latest.selection.recorded.n.toLocaleString()} picks; 2-pick break-even ${pct(latest.selection.breakEven,1)}`}/>
    <Metric size="sm" label="Beats simple baselines" value={STAT_TABS.every(s=>seasons.every(x=>brierEdge(x.brier,s)>0))?'All 3 stats':'Not on every stat'} hint="Brier score (lower is better) against a season-average and a last-10-game Poisson baseline." detail="Both seasons"/>
   </MetricGrid>
  </div>
  <div className="table-wrap"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Season</th><th scope="col" className="num">Model Brier</th><th scope="col" className="num">Last-10 baseline</th><th scope="col" className="num">Season-average baseline</th></tr></thead>
   <tbody>{seasons.flatMap(s=>STAT_TABS.map(st=><tr key={s.label+st}>
    <td data-label="Season"><strong>{s.label}</strong><small>{statLabel[st]}</small></td>
    <td data-label="Model Brier" className="num tone-text-positive">{s.brier.model[st].toFixed(4)}</td>
    <td data-label="Last-10 baseline" className="num">{s.brier.last10Poisson[st].toFixed(4)}</td>
    <td data-label="Season-average baseline" className="num">{s.brier.seasonMeanPoisson[st].toFixed(4)}</td>
   </tr>))}</tbody>
  </table></div>
  <div className="panel-pad two-grid">
   <div>
    <h3 className="props-subhead">Pick hit rate by model confidence</h3>
    <KeyValues items={[...seasons.flatMap(s=>['0.60-0.65','0.65-0.70','0.70-0.80'].map(k=>[`${s.label} · ${k.replace('-','–')}`,
     `${pct(band(k,s).hitRate,1)} of ${band(k,s).n.toLocaleString()}`] as [string,string])),
     ...seasons.map(s=>[`${s.label} · skipped above 80%`,`${pct(s.selection.skipped.extreme_disagreement.hitRate,1)} of ${s.selection.skipped.extreme_disagreement.n.toLocaleString()} (not recorded)`] as [string,string])]}/>
    <p className="quiet" style={{marginTop:8}}>Hit rates track the stated confidence. Real platform lines come from professional projections and will be harder than these proxies; forward paper results are the real test.</p>
   </div>
   <div>
    <h3 className="props-subhead">Calibration, {latest.label}</h3>
    <nav className="tabs" aria-label="Stat" style={{marginBottom:8}}>{STAT_TABS.map(s=><Link key={s} href={`/paper-betting/props?platform=${platform}&cal=${s}`} aria-current={s===cal?'page':undefined} scroll={false}>{statLabel[s]}</Link>)}</nav>
    <CalibrationChart bins={calibrationBins(latest.reliability[cal])} xTitle="Model probability of More" outcome="Went over" unit="lines" observedLabel="Observed share over the line (95% interval)"
     label={`Reliability of P(More) for ${statLabel[cal].toLowerCase()} in ${latest.label}: predicted against observed share over the proxy line, bins with at least 30 lines.`}/>
   </div>
  </div>
 </Panel></Details>;
}

function Limits(){
 return <div className="two-grid mt-12">
  <Details title="Data, model and payout limits">
   <p>Lines come from The Odds API&apos;s DFS feed, which it labels indicative. They are not guaranteed to match what the app offered at that moment, and odds are not converted into payouts. Goblins, demons and other non-standard multipliers are excluded.</p>
   <p>The model ({MODEL_VERSION}) uses recent minutes and per-minute rates with a negative binomial spread. It ignores injuries, lineups and opponents, and is conditional on the player appearing. In a 2025-26 walk-forward check it beat simple Poisson baselines, but it was overconfident above about 70%, and those checks used proxy lines, not real DFS lines.</p>
   <p>PrizePicks returns use the published standard Power Play table (2 picks 3x; a tie or DNP reverts the lineup). Promotions, state-specific rules and in-app payout changes are not modelled. Pick6 returns are not simulated.</p>
  </Details>
  <Details title="Grading rules">
   <p>Results come from final box scores (overtime included). A player who did not play voids that pick. A postponed game voids after 36 hours. Ties are void on Pick6 and revert the lineup on PrizePicks.</p>
   <p>Later stat corrections are recorded as new revisions and flagged, but settled entries are not rewritten. Box scores come from ESPN&apos;s public data, which has no published licence; current-season logs are collected the same way.</p>
  </Details>
 </div>;
}
