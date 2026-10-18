import Link from 'next/link';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Callout,Details,Badge} from '@/components/ui';
import data from '@/data/research/epl_october_2026_forecasts.json';
import {dateTimeUtc,pct} from '@/lib/format';

export const metadata={title:'Soccer model · Sports AI · SportsEdge',description:'Archived experimental EPL three-way forecasts with coverage limits.'};

const favourite=(p:{home:number;draw:number;away:number})=>p.home>=p.draw&&p.home>=p.away?'home':p.away>=p.draw?'away':'draw';

export default function EPL(){
 const draws=data.fit_counts.baseline_draws/data.fit_counts.baseline_games;
 return <>
  <PageHeading title="Soccer model" description="Experimental Elo forecasts for the Premier League with three outcomes: home win, draw or away win. This is an archived snapshot, not a live feed."
   meta={<><Evidence kind="unverified"/><Badge tone="neutral">{data.model_version}</Badge></>}
   action={<><Link href="/research/backtest" className="button button-secondary">Accuracy history</Link><Link href="/sports" className="button button-secondary">Stored odds</Link></>}/>
  <Callout tone="warning" title="Archived October 8 snapshot">These are model estimates from a snapshot whose source data ends {data.source_latest_result_date}, with incomplete recent-season coverage. They are not current prices and no paper bets were placed on them.</Callout>
  <MetricGrid columns={4}>
   <Metric label="Archived forecasts" value={data.forecasts.length} detail="Fixtures for October 10–12, 2026"/>
   <Metric label="Games used for ratings" value={data.fit_counts.rated_games} detail="Coverage varies by season"/>
   <Metric label="Fixed draw rate" value={pct(draws,1)} hint="The draw probability is the historical draw share, not tailored per match." detail={`${data.fit_counts.baseline_draws} draws in ${data.fit_counts.baseline_games} earlier matches`}/>
   <Metric label="Betting profitability" value="Unproven" evidence="not-measured" detail="No validated betting ROI"/>
  </MetricGrid>

  <Panel title="Forecasts" description="Each bar splits 100% across home win, draw and away win. The favoured outcome is labelled." flush>
   <div className="three-way-legend"><span><i style={{background:'var(--c1)'}}/>Home win</span><span><i style={{background:'var(--c-ref)'}}/>Draw</span><span><i style={{background:'var(--c2)'}}/>Away win</span></div>
   <ul className="three-way-list">{data.forecasts.map(f=>{const p=f.probabilities,fav=favourite(p);return <li key={f.game_id}>
    <div className="three-way-head"><strong>{f.home} <span>vs</span> {f.away}</strong><time dateTime={f.starts_at}>{dateTimeUtc(f.starts_at)}</time></div>
    <div className="three-way-bar" role="img" aria-label={`${f.home} ${pct(p.home)}, draw ${pct(p.draw)}, ${f.away} ${pct(p.away)}`}>
     <span style={{flexGrow:p.home,background:'var(--c1)'}}/><span style={{flexGrow:p.draw,background:'var(--c-ref)'}}/><span style={{flexGrow:p.away,background:'var(--c2)'}}/>
    </div>
    <div className="three-way-values"><span className={fav==='home'?'is-fav':undefined}>Home {pct(p.home)}</span><span className={fav==='draw'?'is-fav':undefined}>Draw {pct(p.draw)}</span><span className={fav==='away'?'is-fav':undefined}>Away {pct(p.away)}</span></div>
   </li>;})}</ul>
  </Panel>

  <Details title="Source coverage and model limitations"><p>Model {data.model_version}. The draw rate uses {data.fit_counts.baseline_draws} draws from {data.fit_counts.baseline_games} earlier matches and is the same for every fixture.</p><p>Coverage by season: {Object.entries(data.historical_coverage).map(([year,v])=>`${year}: ${v.completed_in_snapshot} of ${v.source_fixtures} fixtures completed`).join('; ')}.</p><p>Fresh complete three-way prices, position rules, result verification and further validation are needed before this model could be judged as a betting strategy.</p><p><a href={data.fixture_source} target="_blank" rel="noopener noreferrer">Fixture reference</a></p></Details>
 </>;
}
