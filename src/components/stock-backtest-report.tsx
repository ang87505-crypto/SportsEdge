import type {ReportView, Metrics} from '@/lib/stocks/backtest-report';
import {Details} from '@/components/ui';
const usd=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
const pct=(v:number)=>`${(v*100).toFixed(2)}%`;
const rows: [keyof Metrics,string,(n:number)=>string][]=[
  ['netProfit','Net profit / loss',usd],['cagr','Annualized return (CAGR)',pct],
  ['maxDrawdown','Largest decline from a peak',pct],['volatility','Annualized monthly volatility',pct],
  ['tradingCosts','Total trading costs',usd],['turnover','Cumulative one-way turnover',pct],
  ['exposure','Average stock exposure',pct],['cashWeight','Average cash weight',pct],
  ['cashDrag','Cash drag versus benchmark',pct],['sharpe','Sharpe ratio',v=>v.toFixed(2)],
];
export function StockBacktestReport({view}:{view:ReportView}) {
  const r=view.report;
  return <section aria-labelledby="comparison-title" style={{marginTop:28}}>
    <div className="section-title"><div><div className="eyebrow">AFTER-COST COMPARISON</div><h2 id="comparison-title">What did the research earn?</h2></div><span className="pill">{r?'Validated report':'Not measured'}</span></div>
    <p style={{marginBottom:16}}>{view.reason} This $1,000 research account is separate from your manual journal and Alpaca balance.</p>
    <div className="glass table-wrap"><table className="data-table">
      <caption style={{textAlign:'left',padding:16}}>Same starting capital. Same execution rules. One frozen candidate.</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">Baseline</th><th scope="col">Hold-rank candidate</th></tr></thead>
      <tbody>{rows.map(([key,label,format])=><tr key={key}><th scope="row">{label}</th>{(['baseline','candidate'] as const).map(name=><td key={name}>{r&&r.metrics[name][key]!==null?format(r.metrics[name][key]!):'Not measured'}</td>)}</tr>)}</tbody>
    </table></div>
    <div className="two-grid" style={{marginTop:20}}>
      <section className="glass panel"><h3>Equity and cumulative returns</h3>{r?<>
        <p style={{margin:'12px 0'}}>Baseline {pct(r.equity.at(-1)!.baseline/1000-1)} · Candidate {pct(r.equity.at(-1)!.candidate/1000-1)}</p>
        <EquityCurve points={r.equity}/>
      </>:<p style={{marginTop:16}}>Not measured. An equity curve appears only after the dataset and report pass review.</p>}</section>
      <section className="glass panel"><h3>How certain is the difference?</h3>{r?<>
        <p style={{marginTop:16}}>Candidate minus baseline: {pct(r.uncertainty.meanMonthlyDifference)} per month.</p>
        <p>95% interval: {pct(r.uncertainty.lower)} to {pct(r.uncertainty.upper)}.</p>
        <p>{r.uncertainty.yearBlocks} calendar-year blocks · 10,000 paired resamples.</p><p>{r.uncertainty.limitation}</p>
      </>:<p style={{marginTop:16}}>Not measured. The registered comparison uses paired calendar-year resampling. A positive result alone does not establish an advantage.</p>}</section>
    </div>
    <Details title="Benchmarks and historical trade ledger">
      <p>{r?r.benchmarkDefinition:'Not measured. Required comparisons: a licensed broad-market total-return index and a monthly rebalanced 50% index / 50% cash portfolio.'}</p>
      {r?<><p>Market ending value: {usd(r.equity.at(-1)!.market)} · Balanced benchmark: {usd(r.equity.at(-1)!.balanced)}</p>
        <div className="table-wrap" style={{maxHeight:420,overflow:'auto'}} tabIndex={0} role="region" aria-label="Historical simulated trade ledger"><table className="data-table"><thead><tr>{['Date','Account','Security','Side','Shares','Cash amount','Fee'].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{r.trades.map(t=><tr key={t.id}><td>{t.date}</td><td>{t.strategy}</td><td>{t.symbol} ({t.securityId})</td><td>{t.side}</td><td>{t.shares}</td><td>{usd(t.amountCents/100)}</td><td>{usd(t.feeCents/100)}</td></tr>)}</tbody></table></div>
      </>:<p>No validated historical trades are available.</p>}
    </Details>
    <Details title="Dataset provenance and backtest version">
      {r?<div style={{overflowWrap:'anywhere'}}><p>{r.provenance}</p><p>{r.period.start}–{r.period.end} · {r.phase}</p><p>Report: {r.version} · Engine: {r.engineVersion}</p><p>Source commit: <code>{r.sourceCommit}</code></p><p>Dataset SHA-256: <code>{r.datasetSha256}</code></p><p>Protocol SHA-256: <code>{r.protocolSha256}</code></p></div>:<p>Not measured. No historical dataset or return report has been approved. Synthetic engineering checks are kept out of this performance display.</p>}
    </Details>
  </section>;
}
function EquityCurve({points}:{points:NonNullable<ReportView['report']>['equity']}){
  const keys=['baseline','candidate','market','balanced'] as const;
  let low=Infinity,high=-Infinity;
  for(const p of points)for(const key of keys){low=Math.min(low,p[key]);high=Math.max(high,p[key]);}
  const colors=['#b8c5bf','#68f0a2','#e7bc66','#8cacf5'];
  const start=Date.parse(points[0].date),span=Date.parse(points.at(-1)!.date)-start;
  return <figure style={{margin:0}}><svg viewBox="0 0 640 260" role="img" aria-label="Baseline, candidate and benchmark equity curves in dollars" style={{width:'100%',height:'auto'}}>
    <text x="8" y="18" fill="currentColor" fontSize="12">{usd(high)}</text><text x="8" y="235" fill="currentColor" fontSize="12">{usd(low)}</text>
    {keys.map((key,i)=><polyline key={key} fill="none" stroke={colors[i]} strokeWidth="2" strokeDasharray={i>1?'5 4':undefined} points={points.map(p=>`${80+550*(Date.parse(p.date)-start)/span},${25+195*(high-p[key])/(high-low||1)}`).join(' ')}/>)}
  </svg><figcaption>{keys.map((key,i)=><span key={key} style={{color:colors[i],marginRight:14}}>{key}</span>)}<p>{points[0].date} → {points.at(-1)!.date}</p></figcaption>
  <details><summary>View exact equity values</summary><div className="table-wrap" style={{maxHeight:300,overflow:'auto'}}><table className="data-table"><thead><tr><th scope="col">Date</th>{keys.map(k=><th scope="col" key={k}>{k}</th>)}</tr></thead><tbody>{points.map(p=><tr key={p.date}><td>{p.date}</td>{keys.map(k=><td key={k}>{usd(p[k])}</td>)}</tr>)}</tbody></table></div></details></figure>;
}
