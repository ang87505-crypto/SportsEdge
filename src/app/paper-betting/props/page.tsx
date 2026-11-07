import {Suspense} from 'react';
import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Empty,Details,KeyValues,Loading,Badge,type Tone} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {buildView,type PropsView} from '@/lib/props/dashboard-view';
import {PLATFORMS,PLATFORM_LABEL,MODEL_VERSION,SELECTION_VERSION,type Platform} from '@/lib/props/contract';
import {PROPS_RELEASE,nextPlannedRuns} from '@/lib/props/schedule';
import {dateTimeUtc,pct,usdCents} from '@/lib/format';
import {CalibrationChart} from '@/components/charts';
import {calibrationBins,brierEdge,type BacktestSummary} from '@/lib/props/backtest-view';
import {ACTIVE_BUDGET_POLICY} from '@/lib/props/budget';
import {PROPS_SCHEDULE} from '@/lib/props/schedule';
import backtestJson from '@/data/props/backtest_v1.json';
import type {Stat} from '@/lib/props/contract';

const BACKTEST=backtestJson as BacktestSummary;
const STAT_TABS:Stat[]=['points','rebounds','assists'];

export const metadata={title:'NBA Player Props · SportsEdge',description:'Virtual paper test of NBA player-stat picks on PrizePicks and DraftKings Pick6 lines.'};

type Search=Promise<Record<string,string|string[]|undefined>>;
export default function Page({searchParams}:{searchParams:Search}){
 return <>
  <PageHeading title="NBA Player Props" description="A daily paper test: observed PrizePicks and Pick6 lines, a frozen model estimate for each, simulated entries recorded before lock, and results graded from final box scores."
   action={<Link href="/paper-betting" className="button button-secondary">Moneyline ledger</Link>}/>
  <div className="virtual-banner" role="note">
   <span className="virtual-banner-icon"><NavIcon name="shield" size={18}/></span>
   <div><strong>Virtual entries only.</strong> No DFS account is connected, nothing here submits an entry, and no real money is involved. Paid contests may not be lawful where you live; this research says nothing about eligibility.</div>
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
 if(!propsDashboardConfigured())return <>{tabs}<NotConnected/><HistoricalCheck platform={platform} cal={cal}/><Limits/></>;
 let view:PropsView|null=null;
 try{view=buildView(await loadPropsDashboard(),platform);}catch{view=null;}
 if(!view)return <>{tabs}<Panel><Empty title="The props ledger did not respond" action={<a className="button button-secondary" href={`/paper-betting/props?platform=${platform}`}>Reload</a>}>No line, pick or result has been substituted.</Empty></Panel><Limits/></>;
 return <>{tabs}<Automation v={view}/><Performance v={view}/><Lines v={view}/><Entries v={view}/><HistoricalCheck platform={platform} cal={cal}/><Limits/></>;
}

function NotConnected(){
 return <>
  <Panel title="Not connected yet" actions={<Evidence kind="unavailable"/>}>
   <p className="quiet">This deployment has no props ledger configured, so there are no observed lines, model estimates or simulated results to show. Nothing has been filled in with examples.</p>
   <KeyValues items={[['Scheduled runs',PROPS_RELEASE.scheduledRunsEnabled?'Released':'Released OFF in source'],['Model',MODEL_VERSION],['Selection rule',SELECTION_VERSION]]}/>
  </Panel>
  <Schedule/>
 </>;
}

const tone=(s:string):Tone=>s==='completed'?'positive':s==='failed'||s==='abandoned'?'negative':s==='skipped'?'warning':'info';
function Automation({v}:{v:PropsView}){
 const a=v.automation;const b=a.budget;
 const next=nextPlannedRuns(new Date().toISOString(),2);
 return <Panel title="Automation" description="Every run is recorded. A finished workflow is not proof of recorded picks; the receipt counts below come from the ledger." actions={<Evidence kind="recorded"/>} className="mt-12">
  <MetricGrid columns={4}>
   <Metric size="sm" label="Control" value={a.control?.state??'Unknown'} tone={a.control?.state==='RUNNING'?'positive':'warning'} detail={a.control?.reason??'No control row'}/>
   <Metric size="sm" label="Last successful collection" value={a.lastCollect?dateTimeUtc(a.lastCollect.finished_at):'None yet'} detail={a.lastCollect?receipt(a.lastCollect.summary):'No completed collection'}/>
   <Metric size="sm" label="Last successful settlement" value={a.lastSettle?dateTimeUtc(a.lastSettle.finished_at):'None yet'}/>
   <Metric size="sm" label="Next planned run" value={PROPS_RELEASE.scheduledRunsEnabled&&next[0]?`${next[0].kind} ${dateTimeUtc(next[0].at)}`:'Schedule released OFF'} detail={PROPS_RELEASE.scheduledRunsEnabled?'GitHub schedules can start late; late runs never relabel post-lock lines':'Manual runs only until the owner releases the schedule'}/>
  </MetricGrid>
  <Schedule embedded/>
  {a.lastFailure&&<p className="game-card-warning" style={{marginTop:10}}>Last failure: {a.lastFailure.kind} run {a.lastFailure.slot_key} ended {a.lastFailure.status} ({a.lastFailure.outcome}).</p>}
  <div style={{marginTop:12}}><KeyValues items={[
   ['Provider credits reserved (24 h)',`${b.used24h} of ${b.daily}`],['Provider credits reserved (30 days)',`${b.used30d} of ${b.monthly}`],
   ['Provider credits remaining (last report)',b.providerRemaining===null?'Not reported yet':`${b.providerRemaining} (props stop at ${b.floor})`]]}/></div>
  <div className="table-wrap table-scroll" style={{marginTop:12}}><table className="data-table ledger-table">
   <thead><tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Started</th><th scope="col">Receipt</th></tr></thead>
   <tbody>{a.runs.length?a.runs.map(r=><tr key={r.id}>
    <td data-label="Run"><strong>{r.kind}</strong><small>{r.slot_key}</small></td>
    <td data-label="Status"><Badge tone={tone(r.status)}>{r.status}</Badge><small>{r.outcome}</small></td>
    <td data-label="Started">{dateTimeUtc(r.started_at)}{r.start_delay_seconds?<small>{Math.round(r.start_delay_seconds/60)} min after its slot</small>:null}</td>
    <td data-label="Receipt">{receipt(r.summary)}</td>
   </tr>):<tr><td colSpan={4} className="quiet">No runs recorded yet.</td></tr>}</tbody>
  </table></div>
 </Panel>;
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

function Performance({v}:{v:PropsView}){
 const acc=v.accuracy;const e=v.entryStats;
 return <div className="two-grid mt-12">
  <Panel title="Individual picks" description="Recorded picks graded More/Less only. Voids (DNP, ties, postponements) are excluded, not counted as losses." actions={<Evidence kind="recorded"/>}>
   <MetricGrid columns={2}>
    <Metric size="sm" label="Hit rate" value={acc.hitRate===null?'Not measured':pct(acc.hitRate,1)} detail={`${acc.correct} of ${acc.graded} graded; ${acc.pending} pending; ${acc.voided} void`}/>
    <Metric size="sm" label="Probability quality (Brier)" value={acc.brierAllScored===null?'Not measured':acc.brierAllScored.toFixed(3)} hint="Mean squared error of the model's P(More) across every scored line with a More/Less result. 0.25 equals always saying 50%." detail={`${acc.brierN} scored lines`}/>
   </MetricGrid>
  </Panel>
  <Panel title="Simulated entries" description={v.platform==='pick6'?'Pick6 pays from a peer-to-peer pool; the NBA base payout table is not published, so returns stay unknown.':'Returns use the captured PrizePicks standard Power Play table.'} actions={<Evidence kind="simulated"/>}>
   <MetricGrid columns={2}>
    {v.bankroll?<Metric size="sm" label="Simulated balance" value={usdCents(v.bankroll.balanceCents)} detail={`Start ${usdCents(v.bankroll.initialCents)}; realized ${usdCents(v.bankroll.realizedProfitCents,{signed:true})}; open ${usdCents(v.bankroll.openStakeCents)}`}/>
     :<Metric size="sm" label="Simulated balance" value="Not measurable" detail="Total payouts depend on other entrants"/>}
    <Metric size="sm" label="Entries" value={`${e.total}`} detail={`${e.open} open, ${e.settled} settled${v.platform==='pick6'?`, ${e.allLegsHit} with every leg correct`:`, ${e.won} won, ${e.lost} lost`}`}/>
   </MetricGrid>
  </Panel>
 </div>;
}

const outcomeText=(l:PropsView['lines'][number])=>{
 if(!l.result)return l.locked?'Unknown, awaiting final':'Not started';
 const o=l.result.outcome;
 const base=o==='void_dnp'?'Void: did not play':o==='void_postponed'?'Void: postponed':o==='tie'?`Tie at ${l.result.actual}`:`${l.result.actual} (${o==='more'?'More':'Less'})`;
 return l.result.corrected?base+' · corrected':base;
};
function Lines({v}:{v:PropsView}){
 const rows=v.lines.slice(0,60);
 return <Panel title="Observed lines and model estimates" description={`${PLATFORM_LABEL[v.platform]} standard full-game lines from The Odds API (indicative DFS odds), last 14 days${v.lines.length>rows.length?`; newest ${rows.length} of ${v.lines.length} shown`:''}.`} actions={<Evidence kind="recorded"/>} className="mt-12" flush>
  {rows.length?<div className="table-wrap table-scroll"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Observed line</th><th scope="col">Game</th><th scope="col" className="num">Model estimate</th><th scope="col">Decision</th><th scope="col">Result</th></tr></thead>
   <tbody>{rows.map(l=><tr key={l.id}>
    <td data-label="Observed line"><strong>{l.player}</strong><small>{l.stat} {l.line} · quote {l.quoteAgeMinutes} min old at capture</small></td>
    <td data-label="Game">{l.game}<small>Locks {dateTimeUtc(l.lockAt)}</small></td>
    <td data-label="Model estimate" className="num">{l.pMore===null?<span className="quiet">Unscorable ({(l.predictionReason??'missing').replace(/_/g,' ')})</span>
     :<>More {pct(l.pMore,0)} · Less {pct(l.pLess,0)}<small>mean {l.mean?.toFixed(1)} · {l.modelVersion}</small></>}</td>
    <td data-label="Decision">{l.decision==='recorded'?<Badge tone="info">{l.side==='more'?'More':'Less'}</Badge>:<span className="quiet">Skipped</span>}<small>{(l.decisionReason??'no decision').replace(/_/g,' ')}</small></td>
    <td data-label="Result" className={l.correct===true?'tone-text-positive':l.correct===false?'tone-text-negative':undefined}>{outcomeText(l)}</td>
   </tr>)}</tbody>
  </table></div>:<div className="panel-pad"><p className="quiet">No {PLATFORM_LABEL[v.platform]} lines recorded in the last 14 days.</p></div>}
 </Panel>;
}

function Entries({v}:{v:PropsView}){
 return <Panel title="Simulated entries" description="Two picks per entry from different games and players (no joint model in v1). Recorded before lock; never forced to fill a daily quota." actions={<Evidence kind="simulated"/>} className="mt-12" flush>
  {v.entries.length?<div className="table-wrap table-scroll"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Entry</th><th scope="col">Legs</th><th scope="col">Simulated result</th></tr></thead>
   <tbody>{v.entries.slice(0,60).map(e=><tr key={e.id}>
    <td data-label="Entry"><strong>#{e.id} · {usdCents(e.stakeCents)}</strong><small>Recorded {dateTimeUtc(e.createdAt)}</small></td>
    <td data-label="Legs">{e.legs.map(l=><div key={l.id}>{l.player} {l.side==='more'?'More':'Less'} {l.line} {l.stat}<small>{outcomeText(l)}</small></div>)}</td>
    <td data-label="Simulated result">{!e.settlement?<span className="quiet">Open</span>:e.settlement.profitCents===null?
     <>Payout unknown<small>{e.settlement.wins} correct, {e.settlement.losses} wrong, {e.settlement.voids} void</small></>:
     <span className={e.settlement.profitCents>0?'tone-text-positive':e.settlement.profitCents<0?'tone-text-negative':undefined}>{e.settlement.outcome} {usdCents(e.settlement.profitCents,{signed:true})}<small>returned {usdCents(e.settlement.returnCents)}</small></span>}</td>
   </tr>)}</tbody>
  </table></div>:<div className="panel-pad"><p className="quiet">No simulated {PLATFORM_LABEL[v.platform]} entries yet.</p></div>}
 </Panel>;
}

const nmTime=(hour:number,minute:number)=>{
 const d=new Date();d.setUTCHours(hour,minute,0,0);
 return new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',hour:'numeric',minute:'2-digit'}).format(d);
};
function Schedule({embedded=false}:{embedded?:boolean}){
 const b=ACTIVE_BUDGET_POLICY;
 const rows=[...PROPS_SCHEDULE].sort((x,y)=>x.hour*60+x.minute-(y.hour*60+y.minute));
 const body=<>
  <ol className="props-schedule">{rows.map(r=><li key={r.cron}>
   <Badge tone={r.kind==='collect'?'info':'accent'}>{r.kind==='collect'?'Collect lines':'Grade and settle'}</Badge>
   <span><strong>{String(r.hour).padStart(2,'0')}:{String(r.minute).padStart(2,'0')} UTC</strong><small>{nmTime(r.hour,r.minute)} New Mexico time today</small></span>
  </li>)}</ol>
  <p className="quiet" style={{marginTop:8}}>{PROPS_RELEASE.scheduledRunsEnabled?'Daily schedule released. ':'Daily schedule released OFF: runs happen only when started by hand. '}
   Budget {b.version}: up to {b.maxEventsPerRun} games per collection, {b.dailyCredits} provider credits per rolling 24 hours, {b.monthlyCredits} per 30 days, and a stop when the provider reports fewer than {b.providerFloor} credits left. The later collect only spends if the earlier one could not.</p>
 </>;
 return embedded?<div style={{marginTop:12}}><h3 className="props-subhead">Daily cycle</h3>{body}</div>
  :<Panel title="Daily cycle" description="Fixed UTC slots; local times shift with daylight saving." actions={<Evidence kind="recorded" label="Planned"/>} className="mt-12">{body}</Panel>;
}

function HistoricalCheck({platform,cal}:{platform:Platform;cal:Stat}){
 const seasons=BACKTEST.seasons;const latest=seasons[seasons.length-1];
 const band=(k:string,s=latest)=>s.selection.byBand[k];
 const statLabel={points:'Points',rebounds:'Rebounds',assists:'Assists'};
 return <Panel title="Historical check" description="Two seasons the model never saw: parameters fit on the prior season, every game predicted from earlier games only. Lines are proxies (each player's recent median + 0.5), not PrizePicks or Pick6 lines, so this measures calibration, not profit." actions={<Evidence kind="historical"/>} className="mt-12" flush>
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
 </Panel>;
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
