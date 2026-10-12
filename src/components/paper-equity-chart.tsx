import {buildEquityPlot,type SettledEquityPoint} from '@/lib/paper-curve';

const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);

export function PaperEquityChart({initialCents,curve}:{initialCents:number;curve:SettledEquityPoint[]}){
  const last=curve.length?curve[curve.length-1].equity_cents:initialCents;
  // No fabricated intraday mark-to-market prices: every point comes from a recorded settlement.
  const plot=curve.length?buildEquityPlot(initialCents,curve):null;
  return <section className="glass paper-curve-card" aria-labelledby="paper-curve-title">
    <div className="paper-curve-head">
      <div><div className="eyebrow">SIMULATED ACCOUNT HISTORY</div><h2 id="paper-curve-title">Settled equity</h2><p>Starts at the virtual bankroll. Each step is a recorded final result—not a live price or a guaranteed return.</p></div>
      <div className="paper-curve-total"><span>After {curve.length} settled result{curve.length===1?'':'s'}</span><strong>{usd(last)}</strong><small>Starting value: {usd(initialCents)}</small></div>
    </div>
    {!plot?<div className="paper-curve-empty">The equity chart will appear after the first verified paper result. No performance is inferred from pending games.</div>:
      <div className="paper-curve-visual">
        <svg viewBox="0 0 720 190" role="img" aria-label={`Simulated account equity from ${usd(initialCents)} to ${usd(last)} across ${curve.length} settled results`} preserveAspectRatio="none">
          <defs><linearGradient id="paper-equity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#81efad" stopOpacity="0.32"/><stop offset="100%" stopColor="#81efad" stopOpacity="0.005"/></linearGradient></defs>
          <line x1="0" x2="720" y1={plot.baselineY} y2={plot.baselineY} stroke="#b5f5d0" strokeDasharray="5 6" strokeOpacity=".42"/>
          <path d={plot.area} fill="url(#paper-equity-fill)"/>
          <path d={plot.line} fill="none" stroke="#a9f4c7" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
          <circle cx={plot.coordinates[plot.coordinates.length-1].x} cy={plot.coordinates[plot.coordinates.length-1].y} r="5" fill="#b5f5d0" stroke="#153d2b" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
        </svg>
        <div className="paper-curve-axis"><span>Initial bankroll</span><span>Most recent settlement</span></div>
      </div>}
    <p className="paper-curve-footnote">Pending stakes reduce available cash, not account equity. This is recorded simulation data, not stock or sportsbook execution.</p>
  </section>;
}
