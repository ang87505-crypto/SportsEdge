import {Suspense} from 'react';
import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeading,Panel,Metric,MetricGrid,Empty,Loading,Details,Badge,type Tone} from '@/components/ui';
import {loadPropsResearch} from '@/lib/server/props-research-data';
import {propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {watchOnlyLedger,type WatchOutcome} from '@/lib/props/watch-only';
import {PLATFORM_LABEL,type Platform} from '@/lib/props/contract';

export const metadata={
 title:'Watch Only · SportsEdge',
 description:'Every stored NBA player-stat line and pregame forecast, graded automatically without bets, stakes, or virtual entries.'
};
type Search=Promise<Record<string,string|string[]|undefined>>;
const first=(x:string|string[]|undefined)=>Array.isArray(x)?x[0]:x;
const percent=(p:number|null)=>p===null?'Not graded':(p*100).toFixed(1)+'%';
const ts=(s:string)=>s.replace('T',' ').slice(0,16)+' UTC';
const state:Record<WatchOutcome,{label:string;tone:Tone}>={
 win:{label:'Correct',tone:'positive'},loss:{label:'Incorrect',tone:'negative'},
 push:{label:'Tie / void',tone:'neutral'},pending:{label:'Pending',tone:'info'},
 unscored:{label:'No model score',tone:'neutral'}
};
const THRESHOLDS=[{key:'all',label:'All captured',value:0},{key:'60',label:'60%+',value:.60},
 {key:'70',label:'70%+',value:.70},{key:'80',label:'80%+',value:.80}] as const;
const PLATFORMS=[{value:'all',label:'Both sources'},{value:'prizepicks',label:'PrizePicks'},
 {value:'pick6',label:'Pick6'}] as const;

export default function Page({searchParams}:{searchParams:Search}){
 return <>
  <PageHeading title="Watch Only" description="A read-only NBA line tracker: every captured line, original forecast and eventual box-score result. No bet, no virtual entry, no PrizePicks sign-in."
   action={<Link className="button button-secondary" href="/paper-betting/predictions">All models</Link>}/>
  <Suspense fallback={<Loading label="Loading stored lines and grades"/>}><Live searchParams={searchParams}/></Suspense>
  <Details title="What is actually being tracked?">
   <p>The existing collection job fetches PrizePicks and Pick6 lines through The Odds API. SportsEdge already stores eligible line observations and pregame model probabilities in its own Supabase database. The existing settlement job grades the recorded observations later. This page only reads that history; it never enters a contest, creates a virtual entry, places a bet or changes the current collector.</p>
   <p><strong>Every captured line</strong> does not mean every line currently on PrizePicks: only games, players and markets that the budgeted collector obtained are present. The same line from PrizePicks and Pick6 can appear twice as a source record; accuracy and unique-line totals count the market once. An unscorable line remains visible but contributes no hit or miss. Lines with unreliable or late source timestamps are excluded.</p>
   <p>A 60% forecast is a model estimate, <strong>not</strong> a verified 60% chance, a positive expected return or an available payout. The source time shown is the timestamp recorded by the odds provider. No dollar amounts appear in Watch Only because no wager or paper stake exists.</p>
  </Details>
 </>;
}
async function Live({searchParams}:{searchParams:Search}){
 await connection();
 if(!propsDashboardConfigured())return <Empty title="Watch history is not connected">This deployment cannot read the existing props database. No records or wins are inferred.</Empty>;
 let report:ReturnType<typeof watchOnlyLedger>;
 try{report=watchOnlyLedger(await loadPropsResearch());}
 catch{return <Empty title="Watch history could not be verified">The existing props snapshot is unavailable or has exceeded safe read limits. No scores are assumed.</Empty>;}
 const sp=await searchParams;
 const requested=first(sp.threshold)??'all';
 const threshold=THRESHOLDS.find(t=>t.key===requested)??THRESHOLDS[0];
 const selectedPlatform=first(sp.platform)??'all';
 const platform=PLATFORMS.some(p=>p.value===selectedPlatform)?selectedPlatform:'all';
 const dates=[...new Set(report.rows.map(r=>r.date))].sort().reverse();
 const requestedDate=first(sp.date);
 const date=requestedDate&&dates.includes(requestedDate)?requestedDate:dates[0];
 if(!date)return <Empty title="No lines captured yet">The existing budgeted collection job must save a valid pre-lock line first. This page does not fetch any new source data.</Empty>;
 const platformFilter=platform==='all'?undefined:platform;
 const listed=report.filter(threshold.value,date,platformFilter);
 const all=report.report(threshold.value,undefined,platformFilter);
 const impact=report.impact(threshold.value,date,platformFilter);
 const daily=impact.daily;
 const link=(d:string,t:string,p:string)=>'/paper-betting/watch?date='+encodeURIComponent(d)+'&threshold='+encodeURIComponent(t)+'&platform='+encodeURIComponent(p);
 const display=listed.slice(0,800);
 return <>
  <MetricGrid columns={4}>
   <Metric label="Tracked unique lines" value={daily.uniqueLines.toLocaleString()} detail={date+' · '+threshold.label+' · '+daily.lines+' source records'}/>
   <Metric label="Games covered" value={String(daily.games)} detail="Only games in stored odds data"/>
   <Metric label="Correct / incorrect" value={daily.wins+' / '+daily.losses} detail={daily.pending+' pending · '+daily.unscored+' unscorable · '+daily.pushes+' ties/voids'}/>
   <Metric label="Directional accuracy" value={percent(daily.winRate)} detail={daily.wins+daily.losses+' graded decisions, no stakes or P/L'}/>
  </MetricGrid>
  <Panel title="All-time view within the retained 90-day snapshot" description="These totals are from the existing recorded data, not all sportsbook markets.">
   <div className="evidence-list">
    <p><strong>{all.uniqueLines.toLocaleString()} tracked unique lines</strong> across {all.games.toLocaleString()} games. Of the scored outcomes: <strong>{all.wins} correct</strong>, <strong>{all.losses} incorrect</strong>, {all.pushes} ties/voids, and {all.pending} pending. {all.unscored} lines had no valid model forecast.</p>
    <p>Accuracy for the selected confidence band: <strong>{percent(all.winRate)}</strong>. This does not measure profitability, and multiple lines from the same game are correlated rather than independent bets.</p>
   </div>
  </Panel>
  <Panel title={'How '+date+' affected the accuracy'} description="Compare graded directional outcomes before and through this Eastern-time NBA slate; no new entries are created.">
   <div className="evidence-list">
    <p>Before this slate: <strong>{percent(impact.before.winRate)}</strong> ({impact.before.wins} correct, {impact.before.losses} incorrect). Through this slate: <strong>{percent(impact.through.winRate)}</strong> ({impact.through.wins} correct, {impact.through.losses} incorrect).</p>
    <p>Impact: <strong>{impact.deltaPercentagePoints===null?'Not measurable yet':(impact.deltaPercentagePoints>0?'+':'')+impact.deltaPercentagePoints.toFixed(2)+' percentage points'}</strong>. Pending lines do not count as losses or wins; the numbers update when the existing settlement process records final evidence.</p>
   </div>
  </Panel>
  <Panel title="Recorded lines and original predictions" description="No bets or paper entries; review original captured source and eventual outcome." flush>
   <div className="panel-pad">
    <div className="chat-chips" role="group" aria-label="Game date">{dates.slice(0,20).map(d=><Link key={d} className="chat-chip" aria-current={date===d?'true':undefined} href={link(d,threshold.key,platform)}>{d}</Link>)}</div>
    <div className="chat-chips" role="group" aria-label="Confidence threshold" style={{marginTop:8}}>{THRESHOLDS.map(t=><Link key={t.key} className="chat-chip" aria-current={threshold.key===t.key?'true':undefined} href={link(date,t.key,platform)}>{t.label}</Link>)}</div>
    <div className="chat-chips" role="group" aria-label="Source platform" style={{marginTop:8}}>{PLATFORMS.map(p=><Link key={p.value} className="chat-chip" aria-current={platform===p.value?'true':undefined} href={link(date,threshold.key,p.value)}>{p.label}</Link>)}</div>
    <p className="quiet" style={{marginTop:12}}>{daily.lines} stored source records; {daily.uniqueLines} unique lines. Matching PrizePicks/Pick6 records are retained but not double-counted in accuracy. Source: The Odds API (no PrizePicks login).</p>
   </div>
   <div className="chat-table-scroll"><table className="chat-table predictions-table">
    <thead><tr>{['Player / game','Captured line','Model call','Original confidence','Provider updated (UTC)','Result','Source'].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead>
    <tbody>{display.map(row=><tr key={row.observationId} className={row.isUnique?undefined:'quiet'}>
     <th scope="row">{row.player}<small className="quiet"> · {row.game}</small></th>
     <td>{row.stat} {row.line}</td>
     <td>{row.side??'No score'}</td>
     <td>{row.probability===null?'No probability':percent(row.probability)}{row.tieProbability!==null&&row.tieProbability>.05?<small className="quiet"> · tie risk</small>:null}</td>
     <td><small>{ts(row.providerUpdatedAt)}<span className="quiet"> · saved {ts(row.recordedAt)}</span></small></td>
     <td><Badge tone={state[row.outcome].tone}>{state[row.outcome].label}</Badge>{row.actual===null?null:<small className="quiet"> · actual {row.actual}</small>}</td>
     <td><small>{PLATFORM_LABEL[row.platform as Platform]??row.platform}{row.isUnique?'':' · same line'}</small></td>
    </tr>)}</tbody>
   </table></div>
   {listed.length>display.length?<p className="quiet panel-pad">Displaying {display.length} of {listed.length} records for this date. The accuracy totals include all matching records, not only visible rows.</p>:null}
   {!listed.length?<p className="quiet panel-pad">No stored lines match the selected threshold/source/date. This does not mean no markets were available elsewhere.</p>:null}
  </Panel>
  <Panel title="Coverage and limits" description="Watch Only separates research from betting.">
   <p>The view covers the previous 90 days of archived database records, limited by the existing bounded research reader. It makes no Odds API, PrizePicks, Pick6, broker, exchange or sports-stat provider requests. Capturing more games requires a separate licensed source and budget decision. The existing account entry caps and collection rules are unchanged.</p>
   <p><Link href="/paper-betting/predictions">All saved model predictions</Link> provides the existing per-model comparison. <Link href="/paper-betting/props">Virtual entries</Link> is separate and has its own payout/settlement accounting.</p>
  </Panel>
 </>;
}
