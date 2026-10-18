import Link from 'next/link';
import {PageHeading,Panel,Details,Evidence,Callout,type EvidenceKind} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';

export const metadata={title:'Guide & methodology · SportsEdge',description:'How SportsEdge works, the terms it uses, and the limits of its data sources.'};

const terms:[string,string][]=[
 ['Paper trading','Practising with virtual money. A paper bet or trade never places a real order.'],
 ['Probability','An estimated chance. A well-calibrated 60% still fails about 40% of the time.'],
 ['No-vig probability','The market\'s implied chance after removing the sportsbook\'s built-in margin from a complete set of prices.'],
 ['Model − market','The difference, in percentage points, between the model and the market. A research signal, not proof of an edge.'],
 ['ROI','Return on investment: profit divided by the amount staked. High accuracy does not guarantee positive ROI.'],
 ['Drawdown','How far an account falls below its previous high. It shows risk that a win rate hides.'],
 ['Calibration','Whether forecasts of X% come true about X% of the time.'],
 ['Brier score','Average squared error of probabilities. Lower is better; it rewards honest confidence.'],
];
const evidence:EvidenceKind[]=['verified','historical','recorded','broker','simulated','synthetic','unverified','not-measured','unavailable','local'];
const evidenceText:Record<EvidenceKind,string>={
 verified:'Measured from audited, reconciled records.',
 historical:'Retrospective evaluation on past games. Not a betting or trading return.',
 recorded:'Read from saved SportsEdge records. Not a live feed.',
 broker:'Reported by Alpaca PAPER. Simulated fills, not real money.',
 simulated:'Virtual money. No real wager or order exists.',
 synthetic:'Engineering fixture. Never a performance result.',
 unverified:'Research that has not passed its evidence gates.',
 'not-measured':'No valid measurement exists yet. Nothing is assumed.',
 unavailable:'The source could not be reached or validated.',
 local:'Saved only in this browser. Not synced or verified.',
};

export default function Guide(){
 return <>
  <PageHeading title="Guide & methodology" description="How SportsEdge is organized, what its labels mean, and where its data stops."
   action={<Link className="button button-secondary" href="/testing">Test center</Link>}/>

  <div className="guide-sections">
   {[{href:'/sports',icon:'sports' as const,title:'Sports AI',text:'Pick a game, compare the model\'s probability with the market\'s, and read how well the model has been calibrated.'},
     {href:'/paper-betting',icon:'paper' as const,title:'Paper Betting',text:'Follow the shared virtual NBA bankroll: open bets, settled results, ROI and drawdown.'},
     {href:'/stocks',icon:'stocks' as const,title:'Stocks',text:'See the Alpaca PAPER account, the frozen strategy\'s evidence gates, and your own practice journal.'}].map(s=>
    <Link key={s.href} href={s.href} className="guide-section">
     <span className="home-section-icon"><NavIcon name={s.icon} size={20}/></span>
     <strong>{s.title}</strong><span>{s.text}</span>
    </Link>)}
  </div>

  <div className="split-1-1 mt-12">
   <Panel title="Provenance labels" description="Every figure carries one of these, so you always know where a number came from.">
    <ul className="evidence-legend">{evidence.map(k=><li key={k}><Evidence kind={k}/><span>{evidenceText[k]}</span></li>)}</ul>
   </Panel>
   <Panel title="Terms you will see">
    <dl className="glossary">{terms.map(([t,d])=><div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
   </Panel>
  </div>

  <section id="limits" className="mt-12">
   <div className="section-header"><div><h2>What this site runs on</h2><p>Reviewed October 2026.</p></div></div>
   <Callout tone="info" title="A custom web app, not a sportsbook or broker">SportsEdge is built with Next.js and React, hosted on Vercel, with a Supabase PostgreSQL database and source on GitHub. There is no sportsbook execution and no live brokerage connection. An owner-only, read-only Alpaca PAPER viewer works only where the owner key and PAPER credentials are configured. The practice journal lives in your browser; the sports ledger is shared research data.</Callout>
   <Details title="Hosting limits: Vercel"><p>The exact billing plan has not been verified here. The Hobby plan is for personal, non-commercial use.</p><p>Hobby cron jobs run at most once per day. Functions are request-based and are not persistent WebSocket servers, so frequent trading jobs or continuous data feeds need a suitable scheduler and backend.</p><p><a href="https://vercel.com/docs/plans/hobby" target="_blank" rel="noopener noreferrer">Hobby plan</a>, <a href="https://vercel.com/docs/cron-jobs/usage-and-pricing" target="_blank" rel="noopener noreferrer">scheduling limits</a>, <a href="https://vercel.com/docs/limits" target="_blank" rel="noopener noreferrer">platform limits</a></p></Details>
   <Details title="Database and sports-data limits"><p>Supabase Free includes a 500 MB database, 1 GB file storage and 5 GB egress, and free projects can pause after a week of inactivity. These are published plan limits, not this account&apos;s usage.</p><p>The Odds API free plan lists 500 credits per month; historical odds need a paid plan. Showing stored quotes does not refresh them.</p><p>Historical NBA winner accuracy has been tested. Historical betting returns need matched prices. Roster and injury effects, full source audits and automated settlement are separate validation work.</p><p><a href="https://supabase.com/pricing" target="_blank" rel="noopener noreferrer">Supabase plans</a>, <a href="https://the-odds-api.com/" target="_blank" rel="noopener noreferrer">Odds API plans</a>, <a href="https://the-odds-api.com/historical-odds-data/" target="_blank" rel="noopener noreferrer">historical odds coverage</a></p></Details>
   <Details title="Stock data and broker integration"><p>The Alpaca PAPER viewer is not a price feed or an order executor. The free Basic equities feed covers IEX only, one exchange rather than the consolidated market. Staging order-receipt infrastructure is not connected to recurring trading.</p><p>Data licensing and intended use must be checked before connecting a feed or publishing prices. No paid plan or real-money account has been activated.</p><p><a href="https://docs.alpaca.markets/us/docs/about-market-data-api" target="_blank" rel="noopener noreferrer">Alpaca market data coverage</a></p></Details>
  </section>
 </>;
}
