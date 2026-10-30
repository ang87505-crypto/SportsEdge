import Link from 'next/link';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Callout,Details,Badge,KeyValues} from '@/components/ui';
import {StockEvidenceTracks} from '@/components/stock-evidence';
import study from '@/data/research/stock_1000_forward_study.json';
import protocol from '../../../../research/stock_audit_20261012/protocol.json';
import {usdCents} from '@/lib/format';

export const metadata = {
  title: 'Quant research · Stocks · SportsEdge',
  description: 'Frozen stock selection rules, evidence gates, cost assumptions and honest historical-backtest status.',
};

// Protocol prose is stored lower-case; capitalize it for display without changing the source.
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const historicalMeasured = protocol.release.historical_performance_measured;
const paperActivated = protocol.release.automatic_paper_trades;
const costs = protocol.execution.primary_costs;
const oneWayBps = costs.half_spread_bps + costs.additional_slippage_bps;

const gates = [
  ['Frozen strategy rules', 'Registered', 'positive', 'Baseline and one candidate are specified in the committed research protocol.'],
  ['Accounting and candidate adapters', 'Engineering review', 'warning', 'Additive packages require integration and full repository CI before use.'],
  ['Point-in-time market data', 'Not verified', 'warning', 'Complete dated security membership, delistings and licensed price histories have not been attested.'],
  ['Corporate-event reconciliation', 'Blocked', 'negative', 'Delistings, mergers and fractional entitlements need documented, independently tested handling.'],
  ['Historical strategy comparison', historicalMeasured ? 'Measured' : 'Not measured', 'neutral', 'Synthetic parity checks are not backtested returns.'],
  ['Automated stock paper orders', paperActivated ? 'Enabled' : 'Disabled', 'neutral', 'No model-driven broker automation or live trading is activated by this protocol.'],
] as const;

// Registered evaluation windows, drawn to scale on one timeline (years).
const windows = [
  {label: 'Warm-up', from: 1999, to: 2000, tone: 'ref', text: cap(protocol.periods.warmup)},
  {label: 'Development', from: 2000, to: 2012, tone: 'c1', text: protocol.periods.training_development},
  {label: 'Validation', from: 2012, to: 2017, tone: 'c2', text: protocol.periods.validation},
  {label: 'Sealed test', from: 2017, to: 2026, tone: 'c3', text: protocol.periods.sealed_test},
  {label: 'Prospective', from: 2027, to: 2028, tone: 'ref', text: cap(protocol.periods.prospective_reserve)},
];
const SPAN: [number, number] = [1999, 2028];

const spec: [string, string, string][] = [
  ['Model version', protocol.baseline, protocol.candidate],
  ['Selection', 'Momentum (252 sessions, skip 21) with a positive 200-session trend filter', 'Same'],
  ['Portfolio limits', cap(protocol.candidate_rules.unchanged), 'Same'],
  ['Holding rule', 'Replace holdings by baseline rank each month', cap(protocol.candidate_rules.retain)],
  ['Decision time', protocol.execution.decision, 'Same'],
  ['Parameter search', 'None', protocol.candidate_rules.parameter_search ? 'Yes' : 'None'],
];

const metricsToReport = ['Net ending wealth', 'CAGR', 'Annualized monthly volatility', 'Sharpe ratio', 'Maximum drawdown and recovery', 'One-way turnover', 'Fees, spread and slippage', 'Exposure and cash drag', 'Benchmark-relative return', 'Rolling 12-month return'];

export default function StockResearchPage() {
  return <>
    <PageHeading title="Quant research" description="A frozen momentum strategy and one pre-registered candidate. Every gate between the rules and a reportable return is listed here with its real status."
      meta={<><Evidence kind="unverified"/><Badge tone="neutral">{protocol.version}</Badge></>}
      action={<Link href="/stocks/alpaca" className="button button-secondary">Paper account</Link>}/>
    <Callout tone="warning" role="status" title={historicalMeasured ? 'Protocol reports a historical measurement' : 'Not yet backtested on verified historical data'}>
      The rules, adapters and synthetic accounting tests are research work, not an investable return record. This page reads the committed protocol; it is not a live brokerage or CI feed.
    </Callout>

    <MetricGrid columns={4}>
      <Metric label="Research capital" value={usdCents(protocol.execution.capital_cents, {whole: true})} detail="Frozen historical comparison account"/>
      <Metric label="Historical net return" value={historicalMeasured ? 'See report' : 'Not measured'} evidence={historicalMeasured ? 'verified' : 'not-measured'} detail="Never inferred from synthetic fixtures"/>
      <Metric label="Cost assumption" value={`${oneWayBps} bps`} hint="Half-spread plus extra slippage, applied one way on every trade." detail={`One way; sensitivities ${protocol.execution.sensitivity_total_one_way_bps.join(' and ')} bps`}/>
      <Metric label="Forward paper events" value={study.events.length} evidence={study.events.length ? 'broker' : 'not-measured'} detail={`Separate ${usdCents(study.starting_cash_cents, {whole: true})} study, model orders ${paperActivated ? 'on' : 'off'}`}/>
    </MetricGrid>

    <Panel title="Evidence tracks" description="Four kinds of evidence, never merged into one number." className="mt-12"><StockEvidenceTracks/></Panel>

    <Panel title="Baseline vs. candidate" description="One frozen comparison. The candidate changes only the holding rule." flush className="mt-12">
      <div className="table-wrap"><table className="data-table spec-table">
        <thead><tr><th scope="col">Rule</th><th scope="col">Baseline</th><th scope="col">Hold-rank candidate</th></tr></thead>
        <tbody>{spec.map(([rule, a, b]) => <tr key={rule}><th scope="row">{rule}</th><td>{rule === 'Model version' ? <code>{a}</code> : a}</td><td className={b === 'Same' ? 'quiet' : undefined}>{rule === 'Model version' ? <code>{b}</code> : b}</td></tr>)}</tbody>
      </table></div>
      <p className="panel-note">{cap(protocol.candidate_rules.limits)}.</p>
    </Panel>

    <Panel title="Backtest results" description="What the registered comparison will report. Every cell stays empty until a verified report exists." actions={<Evidence kind="not-measured"/>} flush className="mt-12">
      <div className="table-wrap"><table className="data-table results-table">
        <thead><tr><th scope="col">Measure</th><th scope="col" className="num">Baseline</th><th scope="col" className="num">Candidate</th><th scope="col" className="num">Benchmark</th></tr></thead>
        <tbody>{metricsToReport.map(m => <tr key={m}><th scope="row">{m}</th><td className="num quiet">Not measured</td><td className="num quiet">Not measured</td><td className="num quiet">Not measured</td></tr>)}</tbody>
      </table></div>
      <p className="panel-note">Benchmarks: {protocol.benchmarks.join('; ')}.</p>
    </Panel>

    <div className="split-1-1 mt-12">
      <Panel title="Registered evaluation windows" description="Fixed before any outcome was seen. Dates are never moved after looking at results.">
        <div className="timeline" role="list">
          {windows.map(w => <div key={w.label} className="timeline-row" role="listitem">
            <span className="timeline-label">{w.label}</span>
            <span className="timeline-track"><span className={`timeline-bar tone-${w.tone}`} style={{left: `${(w.from - SPAN[0]) / (SPAN[1] - SPAN[0]) * 100}%`, width: `${(w.to - w.from) / (SPAN[1] - SPAN[0]) * 100}%`}}/></span>
            <span className="timeline-text">{w.text}</span>
          </div>)}
          <div className="timeline-axis" aria-hidden="true"><span>1999</span><span>2010</span><span>2020</span><span>2028</span></div>
        </div>
        <p className="panel-note">Sealed test: {protocol.periods.test_status}.</p>
      </Panel>
      <Panel title="Cost and execution assumptions" description={cap(protocol.execution.cost_status) + '.'}>
        <KeyValues items={[
          ['Half-spread', `${costs.half_spread_bps} bps`],
          ['Additional slippage', `${costs.additional_slippage_bps} bps`],
          ['Fee per order', usdCents(costs.fee_cents_per_order)],
          ['Sensitivity tests', `${protocol.execution.sensitivity_total_one_way_bps.join(', ')} bps one way; ${usdCents(protocol.execution.sensitivity_fee_cents_per_order)} per order`],
          ['Liquidity cap', '≤ 1% of prior 20-session mean volume'],
          ['Leverage, shorts, fractions', [protocol.execution.leverage, protocol.execution.shorts, protocol.execution.fractional_shares].some(Boolean) ? 'Some allowed' : 'None'],
          ['Historical fill', 'Next regular-session open plus costs'],
        ]}/>
      </Panel>
    </div>

    <Panel title="Data and accounting gates" description="All must pass before a historical return can be reported." flush className="mt-12">
      <div className="table-wrap"><table className="data-table ledger-table">
        <thead><tr><th scope="col">Gate</th><th scope="col">Status</th><th scope="col">What it means</th></tr></thead>
        <tbody>{gates.map(([gate, status, tone, detail]) => <tr key={gate}><td data-label="Gate"><strong>{gate}</strong></td><td data-label="Status"><Badge tone={tone}>{status}</Badge></td><td data-label="Meaning">{detail}</td></tr>)}</tbody>
      </table></div>
      <Details title={`Required data attestations (${protocol.data_gates.length})`}><ul className="plain-list">{protocol.data_gates.map(g => <li key={g}>{cap(g)}</li>)}</ul></Details>
    </Panel>

    <div className="two-grid mt-12">
      <Details title="How the candidate is judged"><p>{protocol.primary_comparison}</p><p>{protocol.decision_rule}</p><p>The study must report uncertainty, costs, turnover and drawdown, including failed securities and rejected sessions. A positive return alone is not evidence of an advantage.</p></Details>
      <Details title="What this page reads"><p>The committed <code>research/stock_audit_20261012/protocol.json</code> and the separate <code>stock_1000_forward_study.json</code>. It does not fetch licensed market data, place orders, or show synthetic fixtures as returns.</p><p>The <Link href="/stocks/journal">practice journal</Link> is a separate browser-local tool, not the strategy or the broker ledger.</p><p><a href="https://github.com/ang87505-crypto/SportsEdge/blob/main/research/stock_audit_20261012/protocol.json" target="_blank" rel="noopener noreferrer">View the registered protocol on GitHub</a></p></Details>
    </div>
  </>;
}
