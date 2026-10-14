import Link from 'next/link';
import {PageHeading,Stat,Details} from '@/components/ui';
import {ResearchProgressBoard,type ProgressRecord} from '@/components/research-progress-board';
import protocol from '../../../research/stock_audit_20261012/protocol.json';
import nba from '@/data/research/nba_recent_summary.json';

export const metadata={
 title:'Research progress | SportsEdge',
 description:'Evidence-based stock, sports, and platform milestones with direct sources and clear next steps.'
};
const items:ProgressRecord[]=[
 {id:'nba-study',group:'Sports',title:'Historical NBA forecasting study',state:'Measured',
  description:`${nba.evaluation_games.toLocaleString()} historical game forecasts evaluated for winner accuracy. This is not a profitable-betting result.`,
  next:'Validate paired, time-aligned historical sportsbook prices and forward profitability after costs.',
  href:'/research/nba',source:'Committed NBA historical research'},
 {id:'nba-paper',group:'Sports',title:'Shared NBA virtual betting ledger',state:'Available',
  description:'Recorded simulated bets, pending positions and settled outcomes can be viewed when the saved Supabase ledger is reachable.',
  next:'Audit settlement completeness and accumulate enough genuine forward observations to assess outcomes.',
  href:'/paper-betting',source:'Saved paper research account'},
 {id:'stock-protocol',group:'Stocks',title:'Stock momentum research protocol',state:'Registered',
  description:`Frozen baseline ${protocol.baseline} and the single hold-rank candidate are defined before a legitimate historical comparison.`,
  next:'Maintain the frozen rules and pass documented data, accounting and execution gates.',
  href:'/stocks/research',source:'Versioned stock research protocol'},
 {id:'stock-history',group:'Stocks',title:'After-cost historical stock backtest',state:protocol.release.historical_performance_measured?'Measured':'Not verified',
  description:protocol.release.historical_performance_measured?'Protocol declares historical measurement; see approved report for evidence.':'No verified historical stock ROI or Sharpe is recorded in the release protocol.',
  next:'Obtain complete point-in-time membership, delistings and corporate events; run the registered comparison.',
  href:'/stocks/research',source:'Frozen stock audit / release flags'},
 {id:'stock-paper',group:'Stocks',title:'Model-driven Alpaca paper execution',state:protocol.release.automatic_paper_trades?'Available':'Not enabled',
  description:'Automated broker paper orders are not enabled by this stock research protocol. Local journal trades are independent manual practice.',
  next:'Only after audited signals: add owner approval, risk caps, duplicate-order protection, reconciliation and an emergency stop.',
  href:'/stocks',source:'Stock research protocol / release flags'},
 {id:'paper-connect',group:'Platform',title:'Private broker portfolio dashboard',state:'In review',
  description:'The separate Alpaca paper read-only integration is under review in PR #47. Production does not expose private broker balances from this research page.',
  next:'Finish independent owner authentication review, Preview testing and an explicitly approved release.',
  href:'/stocks',source:'Separate Alpaca integration (PR #47)'},
 {id:'ui',group:'Platform',title:'SportsEdge navigation and research workspace',state:'Available',
  description:'Responsive homepage, workspace navigation, historical-summary labels and a guided research process.',
  next:'Verify ongoing mobile usability and keep source labels and empty states accurate as new modules ship.',
  href:'/',source:'Production website user interface'}
];

export default function ResearchProgress(){
 const registered=protocol.baseline;
 return <>
  <PageHeading eyebrow="PLATFORM / RESEARCH STATUS" title="One place for the work that matters."
   description="Track research evidence, readiness gates and the next concrete step. No synthetic ROI, guessed completion percentages, or sensitive account balances."
   action={<Link href="/stocks/research" className="button button-secondary">Stock study details ↗</Link>}/>
  <div className="notice"><strong>Evidence snapshot, not live CI telemetry.</strong> These statuses come from the committed research protocol and application capabilities. They do not update automatically when a draft pull request changes, a backtest is run elsewhere, or a broker account changes. Verify the underlying source before acting.</div>
  <div className="stats-grid progress-stats">
   <Stat label="Stock strategy" value="Registered" detail={`Baseline: ${registered}`}/>
   <Stat label="Historical stock returns" value={protocol.release.historical_performance_measured?'Protocol says measured':'Not measured'} detail="After-cost returns need a genuine audited backtest"/>
   <Stat label="Model stock paper orders" value={protocol.release.automatic_paper_trades?'On':'Off'} detail="No model-directed broker execution enabled"/>
   <Stat label="Real-money stock trading" value={protocol.release.real_trades?'On':'Off'} detail="Separate explicit controls required"/>
  </div>
  <ResearchProgressBoard records={items}/>
  <div className="two-grid progress-links">
   <section className="glass panel">
    <span className="eyebrow">STOCKS / REGISTERED WINDOWS</span><h2>Keep training and testing separate.</h2>
    <p>Development: {protocol.periods.training_development}</p>
    <p>Validation: {protocol.periods.validation}</p>
    <p>Sealed test: {protocol.periods.sealed_test}</p>
    <p>Real historical results are not inferred from unit tests, documentation, simulated balances or paper-broker access.</p>
    <Link href="/stocks/research" className="button button-secondary">Review full stock protocol ↗</Link>
   </section>
   <section className="glass panel">
    <span className="eyebrow">SOURCE OF TRUTH</span><h2>Code and evidence remain versioned.</h2>
    <p>Completed code, research plans and tests live in GitHub. Broker paper balances remain with Alpaca and behind separate owner-only access; they are not published here.</p>
    <div className="progress-source-links">
     <a href="https://github.com/ang87505-crypto/SportsEdge" target="_blank" rel="noopener noreferrer">Open source repository ↗</a>
     <a href="https://github.com/ang87505-crypto/SportsEdge/pulls" target="_blank" rel="noopener noreferrer">Review engineering pull requests ↗</a>
     <a href="https://github.com/ang87505-crypto/SportsEdge/blob/main/research/stock_audit_20261012/protocol.json" target="_blank" rel="noopener noreferrer">Frozen stock research protocol ↗</a>
    </div>
   </section>
  </div>
  <Details title="Why is there no percent-complete meter?"><p>A percentage could imply that required source data, execution evidence or statistical validity have been established when they have not. Each research item names the evidence currently documented and the explicit outstanding gate instead.</p><p>Actual broker trades, historical backtests and model releases must be verified independently before their statuses change.</p></Details>
 </>;
}
