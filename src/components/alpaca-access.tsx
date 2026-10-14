import Link from 'next/link';
import {Details} from '@/components/ui';

export function AlpacaAccess() {
  return <section aria-labelledby="alpaca-title">
    <div className="glass panel">
      <div className="module-top" style={{marginBottom:18}}>
        <span className="pill">Alpaca · paper trading</span>
        <span className="pill">Owner-only viewer</span>
      </div>
      <h2 id="alpaca-title">Your Alpaca paper account, in SportsEdge.</h2>
      <p>See broker-reported virtual equity, cash, positions and recent orders using a private, read-only viewer. This is separate from the manual journal below; no orders are sent by this dashboard.</p>
      <div className="button-row">
        <Link className="button" href="/stocks/alpaca">View private paper account →</Link>
        <a className="button button-secondary" href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noopener noreferrer">Open Alpaca paper trading ↗</a>
      </div>
      <p style={{marginBottom:0,fontSize:12}}>The API connection has been validated in Preview. The private viewer requires a separate owner key in Vercel before account data can appear. Production is not connected until the code is reviewed and merged.</p>
    </div>
    <Details title="What is and is not connected?">
      <p><strong>Connected on Preview:</strong> Alpaca&apos;s paper-account read-only API. The private viewer can display an owner-authorized snapshot once the owner key is configured.</p>
      <p><strong>Not connected:</strong> Automatic stock signals to broker orders, order execution, live account trading, and a validated performance report. Research and paper-order safeguards remain separate work.</p>
      <p>Paper fills are simulations and can differ from live execution. Paper-only accounts may receive limited market data. This browser&apos;s manual practice journal is not synced with Alpaca.</p>
    </Details>
  </section>;
}
