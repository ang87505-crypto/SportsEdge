import Link from 'next/link';
import {PageHeading,Metric,MetricGrid,Details,Callout,Panel,Evidence} from '@/components/ui';
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
 {id:'paper-connect',group:'Platform',title:'Private Alpaca PAPER account viewer',state:'Available',
  description:'An owner-key protected, read-only viewer shows broker-reported PAPER balances, positions and orders. It shows nothing until the owner key and PAPER credentials are configured for a deployment.',
  next:'Recurring PAPER automation and its owner dashboard remain in separate, unreleased pull requests.',
  href:'/stocks/alpaca',source:'Owner-only Alpaca PAPER viewer'},
 {id:'ui',group:'Platform',title:'SportsEdge navigation and research workspace',state:'Available',
  description:'Command-center overview, grouped navigation for Sports AI, Paper Betting and Stocks, provenance labels on every figure, and responsive layouts.',
  next:'Verify ongoing mobile usability and keep source labels and empty states accurate as new modules ship.',
  href:'/',source:'Production website user interface'}
];

export default function ResearchProgress(){
 const registered=protocol.baseline;
 return <>
  <PageHeading title="Research status" description="Each research track with the evidence that exists today and the next concrete gate. No synthetic returns, guessed completion percentages or private balances."
   meta={<Evidence kind="recorded" label="Committed evidence snapshot"/>}
   action={<Link href="/stocks/research" className="button button-secondary">Stock research details</Link>}/>
  <Callout tone="info" title="Evidence snapshot, not live telemetry">Statuses come from the committed research protocol and shipped capabilities. They do not change when a draft pull request, an external backtest or a broker account changes. Check the source before acting.</Callout>
  <MetricGrid columns={4} className="progress-stats">
   <Metric label="Stock strategy" value="Registered" detail={`Baseline ${registered}`}/>
   <Metric label="Historical stock returns" value={protocol.release.historical_performance_measured?'Measured':'Not measured'} evidence={protocol.release.historical_performance_measured?'verified':'not-measured'} detail="Needs a genuine audited backtest"/>
   <Metric label="Model stock paper orders" value={protocol.release.automatic_paper_trades?'On':'Off'} detail="No model-directed broker execution"/>
   <Metric label="Real-money stock trading" value={protocol.release.real_trades?'On':'Off'} detail="Not available on SportsEdge"/>
  </MetricGrid>
  <ResearchProgressBoard records={items}/>
  <div className="split-1-1 progress-links">
   <Panel title="Registered stock windows" description="Training and testing stay separate.">
    <dl className="kv">
     <div><dt>Development</dt><dd>{protocol.periods.training_development}</dd></div>
     <div><dt>Validation</dt><dd>{protocol.periods.validation}</dd></div>
     <div><dt>Sealed test</dt><dd>{protocol.periods.sealed_test}</dd></div>
    </dl>
    <p className="panel-note">Historical results are never inferred from unit tests, documentation, simulated balances or paper-broker access.</p>
   </Panel>
   <Panel title="Source of truth" description="Code, research plans and tests are versioned in GitHub. Broker PAPER balances stay with Alpaca behind owner-only access.">
    <ul className="link-list">
     <li><a href="https://github.com/ang87505-crypto/SportsEdge" target="_blank" rel="noopener noreferrer">Source repository</a></li>
     <li><a href="https://github.com/ang87505-crypto/SportsEdge/pulls" target="_blank" rel="noopener noreferrer">Engineering pull requests</a></li>
     <li><a href="https://github.com/ang87505-crypto/SportsEdge/blob/main/research/stock_audit_20261012/protocol.json" target="_blank" rel="noopener noreferrer">Frozen stock research protocol</a></li>
    </ul>
   </Panel>
  </div>
  <Details title="Why is there no percent-complete meter?"><p>A percentage would imply that source data, execution evidence or statistical validity exist when they do not. Each item names the evidence documented today and the gate still outstanding.</p><p>Broker trades, historical backtests and model releases must be verified independently before their statuses change.</p></Details>
 </>;
}
