'use client';
import {Stat} from '@/components/ui';

/** Broker snapshots are NOT an audited strategy return series.
 * Do not compute P&L, hit rate, Sharpe, drawdown, or return from a single snapshot.
 */
export function AlpacaPaperPerformanceEvidence({
 capturedAt,positionsCount,recentOrdersCount
}:{capturedAt:string;positionsCount:number;recentOrdersCount:number}){
 const capture=Number.isFinite(Date.parse(capturedAt))
  ?new Date(capturedAt).toLocaleString():'Unavailable';
 return <section className="glass panel" id="alpaca-performance-evidence"
  aria-labelledby="paper-performance-evidence-heading" style={{margin:'24px 0'}}>
  <div className="module-top" style={{marginBottom:14}}>
   <span className="pill">STOCK PERFORMANCE / SOURCE EVIDENCE</span>
   <span className="pill pill-amber">Strategy returns not established</span>
  </div>
  <h2 id="paper-performance-evidence-heading">Paper performance: what we can actually prove</h2>
  <p>Alpaca reports a virtual account balance and positions, but that is not proof that the stock-selection model earned a return. Broker deposits, manually entered positions and unrelated orders must not be attributed to the strategy.</p>
  <div className="stats-grid" style={{margin:'20px 0'}}>
   <Stat label="After-cost strategy return" value="Not verified"
    detail="Requires attributed fills, fees and a recorded starting balance"/>
   <Stat label="Strategy maximum drawdown" value="Not verified"
    detail="Requires a complete, timestamped strategy equity history"/>
   <Stat label="Benchmark comparison" value="Not verified"
    detail="Requires matching dates, benchmark prices and cash flows"/>
   <Stat label="Paper broker evidence" value={String(recentOrdersCount)+' recent orders'}
    detail={positionsCount+' positions visible; this is not the complete broker order history'}/>
  </div>
  <div className="notice">
   <strong>Latest account snapshot:</strong> {capture}. Balances above come from Alpaca PAPER only.
   They must not be represented as stock-algorithm profit, backtest results or live-money performance.
  </div>
  <p style={{fontSize:12,marginTop:14}}>
   To activate audited performance tracking, Astra's execution worker must produce a verified
   experiment/account identity, pre-start capital and cash flows, broker-linked order/fill and
   cost receipts, daily equity snapshots, and a dated benchmark. Until then, return and
   risk metrics intentionally remain unavailable.
  </p>
 </section>;
}
