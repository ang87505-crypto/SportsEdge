import Link from 'next/link';
import {Action, Details, PageHeading} from '@/components/ui';

export const metadata = {
  title: 'QuantConnect setup | SportsEdge',
  description: 'Open QuantConnect for stock backtesting and understand the separate research workflow.',
};

export default function QuantConnectSetupPage() {
  return <>
    <PageHeading
      eyebrow="STOCKS / HISTORICAL BACKTESTING"
      title="QuantConnect research workspace."
      description="Run historical research on QuantConnect before considering automated stock paper trading. The external workspace is available now; an authenticated SportsEdge integration is not yet installed."
      action={<Action href="/stocks" secondary>Back to stocks</Action>}
    />
    <div className="notice" role="status">
      <strong>Workspace shortcut only — not an account connection.</strong>{' '}
      QuantConnect sign-in, research projects, results and datasets stay on QuantConnect. This page does not fetch an account, import results, or send trades.
    </div>
    <section className="glass panel" aria-labelledby="qc-start">
      <div className="eyebrow">START ON THE FREE PLAN</div>
      <h2 id="qc-start">Create a research project in QuantConnect.</h2>
      <div className="guide-grid" style={{marginTop:18}}>
        <div className="how-step"><span className="step-number">01</span><div><h3>Open the terminal</h3><p>Use your existing QuantConnect sign-in. The free organization can run cloud backtests.</p></div></div>
        <div className="how-step"><span className="step-number">02</span><div><h3>Choose Code From Template</h3><p>Select Python and create a project named SportsEdge-Stock-Research. A template is not yet the SportsEdge algorithm.</p></div></div>
        <div className="how-step"><span className="step-number">03</span><div><h3>Port and verify the frozen rules</h3><p>Before reporting performance, check parity with the committed baseline and hold-rank-ten candidate, accounting and eligible datasets.</p></div></div>
        <div className="how-step"><span className="step-number">04</span><div><h3>Review development results first</h3><p>Use the registered 2000–2011 development period and required warmup. Do not inspect validation or sealed-test returns early.</p></div></div>
      </div>
      <div className="button-row" style={{marginTop:20}}>
        <a className="button" href="https://www.quantconnect.com/terminal/" target="_blank" rel="noopener noreferrer">Open QuantConnect terminal ↗</a>
        <a className="button button-secondary" href="https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/getting-started" target="_blank" rel="noopener noreferrer">Official backtesting guide ↗</a>
      </div>
    </section>
    <div className="section-title"><h2>Before we trust an external backtest</h2><span className="pill pill-amber">Historical performance not measured</span></div>
    <div className="two-grid">
      <section className="glass panel"><h2>Frozen SportsEdge comparison</h2><p>Run the unchanged momentum baseline and the single registered hold-rank-ten candidate. Reconcile selections, permanent security identities, point-in-time membership, corporate events, the $1,000 starting capital and transaction-cost conventions.</p><Link href="/stocks/research" className="button button-secondary" style={{marginTop:14}}>View research protocol →</Link></section>
      <section className="glass panel"><h2>External data boundary</h2><p>QuantConnect licenses hosted historical data for use on its platform. Do not scrape or upload its raw market data into SportsEdge. After independent review, only permitted derived results should be considered for import.</p><a href="https://www.quantconnect.com/docs/v2/cloud-platform/datasets/licensing" target="_blank" rel="noopener noreferrer" className="button button-secondary" style={{marginTop:14}}>Read data licensing ↗</a></section>
    </div>
    <Details title="What will a genuine API connection require?">
      <p>QuantConnect provides an authenticated API for reading projects and backtest results. A future integration requires a private server-side User Id and API Token stored in environment secrets, owner-only access controls, rate limits, strict response validation, and review of allowed exports. No API connection is active on this page.</p>
      <p style={{marginTop:12}}>Do not enter or paste API tokens into this website, GitHub issues, pull requests, or ChatGPT. Configure them in a protected server environment once the read-only integration is reviewed.</p>
      <p style={{marginTop:12}}><a href="https://www.quantconnect.com/docs/v2/cloud-platform/api-reference/authentication" target="_blank" rel="noopener noreferrer">Official API authentication documentation ↗</a></p>
    </Details>
    <div className="button-row" style={{marginTop:20}}>
      <Action href="/stocks" secondary>Return to stock workspace</Action>
      <Action href="/stocks/research" secondary>Research readiness</Action>
    </div>
  </>;
}
