import {Suspense} from 'react';
import {connection} from 'next/server';
import Link from 'next/link';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Callout,Details,Empty,Loading,Badge} from '@/components/ui';
import {CalibrationChart,LineChart,PairedBars} from '@/components/charts';
import summary from '@/data/research/nba_recent_summary.json';
import v2 from '../../../../research/nba_model_v2_20261020/report.json';
import {forecastRole} from '@/lib/dashboard-snapshot';
import predictions from '@/data/research/nba_recent_predictions.json';
import {forecasts,type ForecastRow} from '@/lib/server/research-db';
import {dateTimeUtc,pct} from '@/lib/format';

export const metadata={title:'NBA model · Sports AI · SportsEdge',description:'Retrospective NBA Elo evaluation: accuracy, calibration and recorded forward forecasts.'};

const WINDOW=200,STEP=50;
// Rolling accuracy and Brier score over the evaluation, in game order. Computed at build time from committed predictions.
function rolling(){
 const rows=[...predictions].sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
 const acc:{x:number;y:number;note:string}[]=[],base:{x:number;y:number;note:string}[]=[];
 for(let end=WINDOW;end<=rows.length;end+=STEP){
  const slice=rows.slice(end-WINDOW,end);
  const date=new Date(slice[slice.length-1].starts_at).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
  const x=Date.parse(slice[slice.length-1].starts_at);
  acc.push({x,y:slice.filter(r=>r.correct).length/WINDOW,note:`Games ${end-WINDOW+1}–${end}, to ${date}`});
  base.push({x,y:slice.filter(r=>r.baseline_correct).length/WINDOW,note:`Games ${end-WINDOW+1}–${end}, to ${date}`});
 }
 return {acc,base};
}
const roll=rolling();
const ratings=Object.entries(summary.ratings).map(([id,r])=>({id,name:(summary.team_names as Record<string,string>)[id]??id,rating:r})).sort((a,b)=>b.rating-a.rating);

export default function Page(){
 const cal=summary.calibration;
 return <>
  <PageHeading title="NBA model" description="An Elo rating model that estimates each team's chance of winning. Here is how its probabilities held up on two past seasons, and the forecasts it has published since."
   meta={<><Evidence kind="historical"/><Badge tone="neutral">Elo, K={summary.settings.k_factor}, home +{summary.settings.home_advantage}</Badge></>}
   action={<Link href="/sports" className="button button-secondary">Today&apos;s board</Link>}/>
  <Callout tone="warning" title="Live forecasts use ratings frozen in April">Forecasts published for 2026–27 come from team ratings stored on {dateTimeUtc(summary.ratings_as_of)}, and those ratings do not update during the season. Replaying 2024–26 that way scored {pct(v2.refresh_cadence.frozen_at_season_start.production.accuracy,1)} winner accuracy (Brier {v2.refresh_cadence.frozen_at_season_start.production.brier.toFixed(3)}), against {pct(v2.refresh_cadence.daily.production.accuracy,1)} (Brier {v2.refresh_cadence.daily.production.brier.toFixed(3)}) for the daily-updated model measured on this page. Weekly refreshes would recover most of the gap: {pct(v2.refresh_cadence.weekly.production.accuracy,1)}. Details are in the October 20 model research note in <code>docs/</code>.</Callout>
  <Callout tone="info" title="Accuracy is not profit">Historical accuracy asks “who won?”. A betting return asks “did the price paid produce a profit?”. Matched historical sportsbook prices were not available, so no historical ROI is reported. Forward paper results are on the <Link className="text-link" href="/paper-betting">Paper Betting</Link> page.</Callout>

  <MetricGrid columns={4}>
   <Metric label="Winner accuracy" value={pct(summary.accuracy)} detail={`Always picking home: ${pct(summary.baseline_accuracy)}. 95% interval ${pct(cal.classification_accuracy_wilson_95[0])}–${pct(cal.classification_accuracy_wilson_95[1])}`}/>
   <Metric label="Brier score" value={summary.brier.toFixed(3)} hint="Mean squared error of the probabilities; lower is better." detail={`Baseline ${summary.baseline_brier.toFixed(3)}, lower is better`}/>
   <Metric label="Log loss" value={summary.log_loss.toFixed(3)} hint="Penalises confident wrong forecasts heavily; lower is better." detail={`Baseline ${summary.baseline_log_loss.toFixed(3)}`}/>
   <Metric label="Calibration error" value={pct(cal.expected_calibration_error,1)} hint="Average gap between forecast probability and observed win rate, weighted by games." detail={`Worst bin ${pct(cal.max_calibration_error,1)}`}/>
  </MetricGrid>

  <div className="split-1-1" style={{marginTop:12}}>
   <Panel title="Calibration" description={`When the model said X%, how often did the home team win? ${cal.sample_size.toLocaleString()} games in ${cal.bins_populated} bins; dot size shows games per bin.`}>
    <CalibrationChart bins={cal.calibration_bins} label={`Reliability diagram: model probability against observed home win rate across ${cal.bins_populated} bins, with 95% Wilson intervals. Expected calibration error ${pct(cal.expected_calibration_error,1)}.`}/>
   </Panel>
   <Panel title="Accuracy over time" description={`Rolling ${WINDOW}-game winner accuracy through the evaluation, against always picking the home team.`}>
    <LineChart series={[{id:'model',label:'Elo model',color:'var(--c1)',points:roll.acc},{id:'home',label:'Always home',color:'var(--c-ref)',dashed:true,points:roll.base}]}
     height={260} yFormat="pct0" xFormat="monthYear" gapBreak={45*86400000}
     ariaLabel={`Rolling ${WINDOW}-game accuracy of the Elo model and an always-home baseline across ${summary.evaluation_games} games`}/>
    <p className="quiet small-print">Each point covers the previous {WINDOW} games in time order. Lines break over the off-season. Early-season dips reflect stale ratings.</p>
   </Panel>
  </div>

  <div className="split-1-1" style={{marginTop:12}}>
   <Panel title="By season" description="Winner accuracy against the always-home baseline">
    <PairedBars labels={['Elo model','Always home']} scale={[0.4,0.75]} format="pct1"
     rows={Object.entries(summary.per_season).map(([season,s])=>({label:season,a:s.accuracy,b:s.baseline_accuracy,note:`${s.correct} of ${s.games} correct`}))}/>
    <div className="table-wrap" style={{marginTop:14}}><table className="data-table">
     <thead><tr><th scope="col">Season</th><th scope="col" className="num">Correct</th><th scope="col" className="num">Accuracy</th><th scope="col" className="num">Always home</th></tr></thead>
     <tbody>{Object.entries(summary.per_season).map(([season,s])=><tr key={season}><th scope="row">{season}</th><td className="num">{s.correct.toLocaleString()} / {s.games.toLocaleString()}</td><td className="num">{pct(s.accuracy)}</td><td className="num">{pct(s.baseline_accuracy)}</td></tr>)}</tbody>
    </table></div>
   </Panel>
   <Panel title="Team ratings" description={`Elo ratings as of ${dateTimeUtc(summary.ratings_as_of)}. 1500 is average. Off-season roster changes are not reflected.`}>
    <ol className="rating-list">{ratings.map((t,i)=><li key={t.id}>
     <span className="rating-rank">{i+1}</span><span className="rating-name">{t.name}</span>
     <span className="rating-track" aria-hidden="true"><span style={{left:`${Math.min(100,Math.max(0,(t.rating-1200)/600*100))}%`}}/></span>
     <span className="rating-value">{Math.round(t.rating)}</span>
    </li>)}</ol>
   </Panel>
  </div>

  <Suspense fallback={<Loading label="Loading recorded forecasts"/>}><ForwardForecasts/></Suspense>

  <div className="two-grid" style={{marginTop:12}}>
   <Details title="How the model works and where it is limited"><p>Elo gives each team a rating that moves after every game; stronger teams get higher chances against weaker ones. This baseline uses K={summary.settings.k_factor} and a home advantage of {summary.settings.home_advantage} Elo points.</p><p>Forward estimates use the April 2026 snapshot. They do not account for off-season roster changes, injuries or lineups. A 70% estimate still loses about three times in ten.</p><p>Historical predictions were reconstructed in time order. They were not published before those games were played.</p></Details>
   <Details title="Data sources and scoring"><p>All {summary.evaluation_games.toLocaleString()} evaluated games reconcile across the SportsDataverse ESPN and NBA Stats mirrors. Both mirrors share a publisher, so verification against original sources is partial.</p><p>Brier {summary.brier.toFixed(4)}, log loss {summary.log_loss.toFixed(4)}. These scores reward honest probabilities, not just picking winners.</p><p><a href="https://github.com/sportsdataverse/sportsdataverse-data" target="_blank" rel="noopener noreferrer">Source publisher, CC BY 4.0</a></p></Details>
  </div>
 </>;
}

async function ForwardForecasts(){
 await connection();
 let rows:ForecastRow[]=[];let failed=false;
 try{rows=await forecasts();}catch{failed=true;}
 return <Panel title="Recorded forward forecasts" description="Published before tip-off and stored with their publication time. Newest first." actions={<Evidence kind="recorded"/>} flush>
  {failed?<Empty title="Forecasts are unavailable" action={<a className="button button-secondary" href="/research/nba">Reload</a>}>The research database did not respond. The historical evaluation above is unaffected.</Empty>:
   !rows.length?<Empty title="No forecasts recorded yet">Eligible fixtures appear here once checked and published.</Empty>:
   <div className="table-wrap table-scroll"><table className="data-table ledger-table">
    <thead><tr><th scope="col">Matchup</th><th scope="col">Tip-off</th><th scope="col">Home win</th><th scope="col" className="num">Away win</th><th scope="col">Published</th></tr></thead>
    <tbody>{rows.map(r=>{const p=Number(r.home_probability);return <tr key={r.id}>
     <td data-label="Matchup"><strong>{r.games.away.name}</strong><small>at {r.games.home.name}</small></td>
     <td data-label="Tip-off">{dateTimeUtc(r.starts_at)}</td>
     <td data-label="Home win"><span className="inline-prob"><span className="inline-prob-track" aria-hidden="true"><span style={{width:`${p*100}%`}}/></span>{pct(p)}</span></td>
     <td data-label="Away win" className="num">{pct(1-p)}</td>
     <td data-label="Published">{dateTimeUtc(r.published_at)}<small>{forecastRole(r.model_version)==='production'?'Production':forecastRole(r.model_version)==='shadow'?'Shadow v2 (not used for bets)':'Other'}: {r.model_version}</small></td>
    </tr>;})}</tbody>
   </table></div>}
 </Panel>;
}
