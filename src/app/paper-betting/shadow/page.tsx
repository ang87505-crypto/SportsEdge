import {Suspense} from 'react';
import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeading,Panel,Metric,MetricGrid,Empty,Loading,Details,Badge} from '@/components/ui';
import {loadPropsResearch} from '@/lib/server/props-research-data';
import {propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {shadowLedger,SHADOW_STUDY} from '@/lib/props/shadow-ledger';

export const metadata={
 title:'All 60%+ shadow forecasts · SportsEdge',
 description:'Paper-only research of every qualifying frozen NBA player-prop forecast, independent of virtual entry caps.'
};
type Search=Promise<Record<string,string|string[]|undefined>>;
const first=(s:string|string[]|undefined)=>Array.isArray(s)?s[0]:s;
const pct=(n:number|null)=>n===null?'Unknown':(n*100).toFixed(1)+'%';
const dollar=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const signed=(c:number|null)=>c===null?'Pending':(c>=0?'+':'')+dollar(c);

export default function Page({searchParams}:{searchParams:Search}){
 return <>
  <PageHeading title="60%+ shadow ledger" description="Every first-seen, pre-lock NBA stats-model forecast with at least 60% stated side probability, including lines that never became a $5 entry. Research only."
   action={<Link className="button button-secondary" href="/paper-betting/predictions">Every saved prediction</Link>}/>
  <Suspense fallback={<Loading label="Reading saved predictions and final results"/>}><Live searchParams={searchParams}/></Suspense>
  <Details title="What the hypothetical $5 figures mean (read before using)">
   <p>For each unique event, athlete, stat, line and model version, we use the first pre-lock forecast already saved in the SportsEdge database. No new Odds API calls are made. Later verified box scores grade it. Pending games have no recorded net.</p>
   <p>Every qualifying selection gets the same imaginary $5 stake at <strong>2.00 decimal odds (even money)</strong>. A win displays +$5, loss −$5, tie or void $0, pending unknown. Expected virtual net is based on the original saved probabilities, including ties. These are <strong>not executable prices, actual sportsbook profits, PrizePicks single-leg payouts or Kalshi market opportunities</strong>. No provider ever offered this hypothetical price by virtue of its appearance here.</p>
   <p>We include probabilities above 80% for analysis but flag them because the frozen live model normally excludes them. High tie risk, correlated picks, duplicated markets, inaccurate model calibration and unreliable payouts can all undermine a apparent 60% signal. This page does not add any entry, change the betting model, or increase API spending.</p>
  </Details>
 </>;
}
async function Live({searchParams}:{searchParams:Search}){
 await connection();
 if(!propsDashboardConfigured())return <Empty title="Sports records unavailable">No Supabase props database is configured in this deployment.</Empty>;
 let x:ReturnType<typeof shadowLedger>;
 try{x=shadowLedger(await loadPropsResearch());}
 catch{return <Empty title="Cannot verify the shadow ledger">The source ledger is unavailable or too large for safe verification; no performance is assumed.</Empty>;}
 const dates=[...new Set(x.rows.map(r=>r.slateDate))].sort().reverse();
 const sp=await searchParams,chosen=first(sp.date);
 const date=chosen&&dates.includes(chosen)?chosen:dates[0];
 if(!date)return <Empty title="No qualifying forecasts saved yet">The live collector must save valid before-lock observations before this research ledger has any rows. It will never invent picks just to reach a daily quota.</Empty>;
 const rows=x.rows.filter(r=>r.slateDate===date);
 const impact=x.impact(date);
 const daily=impact.daily;
 const display=rows.slice(0,800);
 const dateHref=(d:string)=>'/paper-betting/shadow?date='+encodeURIComponent(d);
 return <>
  <MetricGrid columns={4}>
   <Metric label="60%+ forecasts" value={daily.rows.toLocaleString()} detail={date+' · unique first-seen lines'}/>
   <Metric label="Distinct games" value={daily.games.toLocaleString()} detail="Observed coverage; not a 15–20-game guarantee"/>
   <Metric label="Graded shadow results" value={String(daily.graded)} detail={daily.wins+' wins · '+daily.losses+' losses · '+daily.pushes+' pushes · '+daily.pending+' pending'}/>
   <Metric label="Hypothetical settled net" value={signed(daily.hypotheticalNetCents)} detail="$5 imaginary even-money stake per settled candidate; NOT actual returns"/>
  </MetricGrid>
  <Panel title={'How '+date+' changed the overall win percentage'} description="Before versus after this NBA slate, using only verified win/loss outcomes. The slate dates use US Eastern time.">
   <div className="evidence-list">
    <p>Before this slate: <strong>{pct(impact.prior.winRate)}</strong> ({impact.prior.wins} wins, {impact.prior.losses} losses). Through this slate: <strong>{pct(impact.through.winRate)}</strong> ({impact.through.wins} wins, {impact.through.losses} losses).</p>
    <p>Effect on the cumulative win percentage: <strong>{impact.deltaPoints===null?'Not measurable yet':(impact.deltaPoints>0?'+':'')+impact.deltaPoints.toFixed(2)+' percentage points'}</strong>. {daily.pending} predictions are still pending, so this figure can change when legitimate final grades arrive or are corrected.</p>
    <p>These percentages track the 60%+ shadow-research selections only. They are separate from the live pick selection win rate and the actual multi-leg virtual-entry accounting. New forecasts do not become wins until a verified result is recorded.</p>
   </div>
  </Panel>
  <Panel title="Research quality and coverage" description="A >=60% model probability is not verified profitability or evidence of a market edge.">
   <div className="evidence-list">
    <p>Graded directional win rate: <strong>{pct(daily.winRate)}</strong> ({daily.wins+daily.losses} excluding voids/ties). Virtual benchmark expected net over all candidates: <strong>{signed(daily.hypotheticalExpectedNetCents)}</strong>; pending forecasts have not contributed to settled net.</p>
    <p>{daily.liveRecorded} were actually recorded as selections by the existing live model; {daily.excludedByLiveRules} were not recorded. A forecast can be excluded by the live 60–80% band, high tie risk, or other existing selection rules. Only existing multi-pick virtual entries carry their own actual recorded settlement.</p>
    <p>Coverage changes only when the collector legitimately records more games before lock. The present Odds API budget limits priced games; NHL/NFL archives and public weather data are separate research sources and do not create NBA props picks.</p>
   </div>
  </Panel>
  <Panel title={'Every 60%+ research selection · '+date} description={'Pure saved-data analysis: '+rows.length+' unique forecasts; model '+SHADOW_STUDY.version} flush>
   <div className="panel-pad"><div className="chat-chips" role="group" aria-label="Shadow study dates">
    {dates.slice(0,15).map(d=><Link key={d} className="chat-chip" aria-current={date===d?'true':undefined} href={dateHref(d)}>{d}</Link>)}
   </div></div>
   <div className="chat-table-scroll"><table className="chat-table predictions-table">
    <thead><tr>{['Game / athlete','Line','Model side','Stated chance','Live pick decision (not entry)','Final outcome','Hypothetical $5 net'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{display.map(r=><tr key={r.predictionId}>
     <th scope="row">{r.player}<small className="quiet"> · {r.game}</small></th>
     <td>{r.stat} {r.line}</td>
     <td>{r.side}</td>
     <td>{pct(r.probability)}{r.outsideLiveBand?<small className="quiet"> · above live 80% cap</small>:null}{r.tieRisk?<small className="quiet"> · high tie risk</small>:null}</td>
     <td>{r.liveStatus==='recorded'?<Badge tone="positive">Recorded</Badge>:<Badge>{r.liveStatus==='skipped'?'Skipped':'Research only'}</Badge>}</td>
     <td><Badge tone={r.state==='win'?'positive':r.state==='loss'?'negative':r.state==='pending'?'info':'neutral'}>{r.state}</Badge>{r.actual===null?null:<small> · {r.actual}</small>}</td>
     <td>{signed(r.hypotheticalNetCents)}<small className="quiet"> · estimated pregame {signed(r.hypotheticalExpectedNetCents)}</small></td>
    </tr>)}</tbody>
   </table></div>
   {rows.length>display.length?<p className="quiet panel-pad">Showing {display.length} of {rows.length} rows. No totals are based on a truncated subset.</p>:null}
  </Panel>
  <Panel title="What this is not" description="Avoid confusing forecasting research with executed bets.">
   <p>Research candidate counts may be much larger than virtual entries. There is no standalone PrizePicks single-pick payout, no guaranteed −110 sportsbook price, and no reliable profit estimate unless an eligible executable price was actually captured before the decision. For recorded virtual entries and their settlement use <Link href="/paper-betting/props">the existing paper ledger</Link>.</p>
  </Panel>
 </>;
}
