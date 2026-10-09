import {Details} from '@/components/ui';

export function AlpacaAccess() {
  return <section aria-labelledby="alpaca-title">
    <div className="glass panel">
      <div className="module-top" style={{marginBottom:18}}>
        <span className="pill">Alpaca · paper trading</span>
        <span className="pill pill-amber">Account not connected</span>
      </div>
      <h2 id="alpaca-title">Practice with market-based prices.</h2>
      <p>Alpaca lets you place simulated stock trades using virtual money. Open its dashboard in a new tab, sign in, and select your <strong>Paper</strong> account.</p>
      <div className="button-row">
        <a className="button" href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noopener noreferrer">Open Alpaca paper trading ↗</a>
        <a className="button button-secondary" href="https://docs.alpaca.markets/us/docs/paper-trading" target="_blank" rel="noopener noreferrer">How Alpaca paper trading works ↗</a>
      </div>
      <p style={{marginBottom:0,fontSize:12}}>This shortcut opens Alpaca. Your Alpaca balances, orders and positions do not sync to SportsEdge yet. SportsEdge is an independent app.</p>
    </div>
    <Details title="Can I connect Alpaca here—and use real money later?">
      <p><strong>Next: connect your paper account.</strong> We need to register SportsEdge with Alpaca and add a secure sign-in and authorization flow. Then we can show your paper balance, positions and order history here, followed by tested paper-order controls.</p>
      <p><strong>Later: live trading.</strong> Alpaca also offers real-money brokerage accounts, subject to eligibility and account approval. Live trading through SportsEdge is not enabled and would require a separate, explicit setup.</p>
      <p>Paper fills are simulations and can differ from live execution. Paper-only accounts receive IEX data, which covers one exchange. This manual journal remains separate from your Alpaca account.</p>
      <p><a href="https://docs.alpaca.markets/us/docs/about-connect-api" target="_blank" rel="noopener noreferrer">Read about Alpaca account connections ↗</a></p>
    </Details>
  </section>;
}
