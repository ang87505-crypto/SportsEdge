import Link from 'next/link';

/** External workspace shortcut only; API credentials must never reach the browser. */
export function QuantConnectAccess() {
  return <section aria-labelledby="quantconnect-title" style={{marginBottom:24}}>
    <div className="glass panel">
      <div className="module-top" style={{marginBottom:18}}>
        <span className="pill">QuantConnect · historical backtesting</span>
        <span className="pill pill-amber">Account API not connected</span>
      </div>
      <h2 id="quantconnect-title">Backtest the stock strategy before paper trading.</h2>
      <p>Open your QuantConnect research workspace to create and run Python backtests using its hosted historical data. This opens your separate QuantConnect session; SportsEdge does not read your projects, market data, balances or results yet.</p>
      <div className="button-row" style={{marginTop:16}}>
        <a className="button" href="https://www.quantconnect.com/terminal/" target="_blank" rel="noopener noreferrer">Open QuantConnect workspace ↗</a>
        <Link className="button button-secondary" href="/stocks/quantconnect">Setup and research safeguards →</Link>
      </div>
      <p style={{marginBottom:0,fontSize:12}}>No QuantConnect API token is required for this shortcut. No historical returns are measured, and no orders are placed through SportsEdge.</p>
    </div>
  </section>;
}
