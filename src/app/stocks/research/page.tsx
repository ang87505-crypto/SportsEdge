import Link from 'next/link';
import {Action, Details, PageHeading, Stat} from '@/components/ui';
import study from '@/data/research/stock_1000_forward_study.json';
import protocol from '../../../../research/stock_audit_20261012/protocol.json';

const usd = (cents: number) =>
  new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);

const historicalMeasured = protocol.release.historical_performance_measured;
const paperActivated = protocol.release.automatic_paper_trades;
const evidence = [
  ['Frozen strategy rules', 'Registered', 'Baseline and one candidate are specified in the committed research protocol.'],
  ['Accounting and candidate adapters', 'Engineering review', 'Astra delivered additive packages. They require integration and full repository CI before use.'],
  ['Point-in-time market data', 'Not verified', 'Complete dated security membership, delistings and licensed price histories have not been attested.'],
  ['Corporate-event reconciliation', 'Blocked', 'Delistings, mergers and fractional entitlements require documented, independently tested handling.'],
  ['Historical strategy comparison', historicalMeasured ? 'Measured' : 'Not measured', 'Do not interpret synthetic parity checks as backtested returns.'],
  ['Automated stock paper orders', paperActivated ? 'Enabled' : 'Disabled', 'No model-driven broker automation or live trading is activated.'],
] as const;

export const metadata = {
  title: 'Stock strategy research | SportsEdge',
  description: 'Frozen stock selection rules, evidence readiness, and honest historical-backtest status.',
};

export default function StockResearchPage() {
  const recordedEvents = study.events.length;
  const costs = protocol.execution.primary_costs;
  const oneWayBps = costs.half_spread_bps + costs.additional_slippage_bps;

  return <>
    <PageHeading eyebrow="STOCKS / ALGORITHM RESEARCH"
      title="Evidence before execution."
      description="See the actual versioned stock research contract, data gates, and test readiness. No backtest profits or model orders are fabricated."
      action={<Action href="/stocks" secondary>Back to stock workspace</Action>}
    />
    <div className="notice" role="status">
      <strong>Not yet backtested on verified historical data.</strong>{' '}
      The algorithm, candidate adapter and synthetic accounting tests are research work—not an investable return record.
      This screen is based on committed study configuration. It is not a live brokerage or CI-monitoring feed.
    </div>
    <div className="stats-grid">
      <Stat label="Registered starting capital" value={usd(protocol.execution.capital_cents)}
        detail="Independent frozen historical comparison account" />
      <Stat label="Historical net ROI" value={historicalMeasured ? 'See approved report' : 'Not measured'}
        detail="No historical profit can be inferred from synthetic fixtures" />
      <Stat label="Model-driven paper trades" value={paperActivated ? 'Enabled' : 'Off'}
        detail={`${recordedEvents} recorded event(s) in the separate $1,000 stock study`} />
      <Stat label="Primary execution assumption" value={`${oneWayBps} bps`}
        detail="One way, half-spread plus slippage; sensitivities are also required" />
    </div>
    <div className="section-title">
      <div><div className="eyebrow">FROZEN EVALUATION</div><h2>Two versions. One registered comparison.</h2></div>
      <span className="pill">No parameter search</span>
    </div>
    <div className="two-grid">
      <section className="glass panel">
        <span className="pill">Baseline</span>
        <h2 style={{marginTop: 16}}>Momentum + trend filter</h2>
        <p style={{overflowWrap: 'anywhere', marginTop: 12}}><code>{protocol.baseline}</code></p>
        <p style={{marginTop: 12}}>Monthly stock selection under the registered eligibility, diversification, size and execution limits.</p>
      </section>
      <section className="glass panel">
        <span className="pill">Single candidate</span>
        <h2 style={{marginTop: 16}}>Momentum + hold-rank buffer</h2>
        <p style={{overflowWrap: 'anywhere', marginTop: 12}}><code>{protocol.candidate}</code></p>
        <p style={{marginTop: 12}}>Preserves otherwise eligible holdings up to qualifying rank {protocol.candidate_rules.hold_rank_max} when the frozen selection constraints permit.</p>
      </section>
    </div>
    <div className="section-title"><h2>What must pass before a backtest?</h2><span className="pill pill-amber">Historical study gated</span></div>
    <section className="glass">
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Gate</th><th scope="col">Status</th><th scope="col">What this means</th></tr></thead>
          <tbody>{evidence.map(([gate, status, detail]) => <tr key={gate}>
            <td><strong>{gate}</strong></td><td><span className="pill">{status}</span></td><td>{detail}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <div className="section-title"><h2>Registered evaluation windows</h2><span className="pill">Do not pick dates after seeing results</span></div>
    <section className="glass panel">
      <div className="guide-grid">
        <div className="how-step"><span className="step-number">01</span><div><h3>Development</h3><p>{protocol.periods.training_development}</p></div></div>
        <div className="how-step"><span className="step-number">02</span><div><h3>Validation</h3><p>{protocol.periods.validation}</p></div></div>
        <div className="how-step"><span className="step-number">03</span><div><h3>Sealed test</h3><p>{protocol.periods.sealed_test}</p></div></div>
      </div>
      <p style={{marginTop: 16}}>The sealed test remains unavailable for tuning. Any previously seen outcome must be disclosed before calling a period untouched.</p>
    </section>
    <Details title="How we decide whether the candidate is better">
      <p>{protocol.primary_comparison}</p>
      <p style={{marginTop: 12}}>{protocol.decision_rule}</p>
      <p style={{marginTop: 12}}>The study must report uncertainty, costs, turnover and drawdown, including failed securities and rejected sessions. A positive return alone is not evidence of an advantage.</p>
    </Details>
    <Details title="What is connected to this page?">
      <p>This page reads the committed <code>research/stock_audit_20261012/protocol.json</code> and the separate <code>stock_1000_forward_study.json</code>. It intentionally does not fetch licensed market data, place orders, or display synthetic test fixtures as returns.</p>
      <p style={{marginTop: 12}}>Your manual stock journal on <Link href="/stocks">the stock workspace</Link> is an independent, browser-local practice tool. It is not the algorithm account or the broker&apos;s paper ledger.</p>
      <p style={{marginTop: 12}}><a href="https://github.com/ang87505-crypto/SportsEdge/blob/main/research/stock_audit_20261012/protocol.json" target="_blank" rel="noopener noreferrer">View registered source protocol ↗</a></p>
    </Details>
    <div className="button-row" style={{marginTop: 20}}>
      <Action href="/stocks" secondary>Return to stocks</Action>
      <Action href="/guide" secondary>Research and account limits</Action>
    </div>
  </>;
}
