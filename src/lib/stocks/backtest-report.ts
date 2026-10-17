/** Read-only public report schema. Publication requires a separately reviewed hash. */
export const REPORT_VERSION = 'stock-backtest-report-v1';
export const BASELINE = 'stock-mom252-skip21-trend200-v1';
export const CANDIDATE = 'stock-mom252-skip21-trend200-holdrank10-v1';
export type Metrics = {
  netProfit: number; cagr: number; maxDrawdown: number; volatility: number;
  tradingCosts: number; turnover: number; exposure: number;
  cashWeight: number; cashDrag: number | null; sharpe: number | null;
};
export type EquityPoint = {date: string; baseline: number; candidate: number; market: number; balanced: number};
export type Trade = {id: string; strategy: 'baseline' | 'candidate'; date: string; securityId: string;
  symbol: string; side: 'buy' | 'sell'; shares: number; amountCents: number; feeCents: number};
export type BacktestReport = {
  version: typeof REPORT_VERSION; kind: 'historical'; status: 'validated'; phase: 'development' | 'validation' | 'sealed_test';
  protocolSha256: string; sourceCommit: string; datasetSha256: string; engineVersion: string;
  provenance: string; benchmarkDefinition: string; account: 'frozen_stock_research';
  startingCapitalCents: 100000; baselineVersion: typeof BASELINE; candidateVersion: typeof CANDIDATE;
  primaryCostBps: 15; sensitivityBps: number[]; reconciliationPassed: true; gatesPassed: true;
  period: {start: string; end: string}; metrics: {baseline: Metrics; candidate: Metrics};
  equity: EquityPoint[]; trades: Trade[];
  uncertainty: {meanMonthlyDifference: number; lower: number; upper: number; seed: 20261012;
    replicates: 10000; yearBlocks: number; limitation: string};
};
export type ReportView = {status: 'not_measured'; reason: string; report: null} |
  {status: 'validated'; reason: string; report: BacktestReport};
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 4000;
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const windows = {development:['2000-01-01','2011-12-31'], validation:['2012-01-01','2016-12-31'], sealed_test:['2017-01-01','2025-12-31']} as const;
function validMetrics(m: unknown): m is Metrics {
  if (!record(m)) return false;
  for (const k of ['netProfit','cagr','maxDrawdown','volatility','tradingCosts','turnover','exposure','cashWeight']) if (!finite(m[k])) return false;
  if (!(m.cashDrag === null || finite(m.cashDrag)) || !(m.sharpe === null || finite(m.sharpe))) return false;
  return (m.cagr as number) > -1 && (m.maxDrawdown as number) >= 0 && (m.maxDrawdown as number) <= 1 &&
    (m.volatility as number) >= 0 && (m.tradingCosts as number) >= 0 && (m.turnover as number) >= 0 &&
    (m.exposure as number) >= 0 && (m.exposure as number) <= 1 &&
    (m.cashWeight as number) >= 0 && (m.cashWeight as number) <= 1;
}
export function validReport(v: unknown, protocolHash: string): v is BacktestReport {
  if (!record(v) || v.version !== REPORT_VERSION || v.kind !== 'historical' || v.status !== 'validated' ||
      v.account !== 'frozen_stock_research' || v.startingCapitalCents !== 100000 ||
      v.baselineVersion !== BASELINE || v.candidateVersion !== CANDIDATE || v.primaryCostBps !== 15 ||
      JSON.stringify(v.sensitivityBps) !== '[25,50]' || v.reconciliationPassed !== true || v.gatesPassed !== true ||
      v.protocolSha256 !== protocolHash || !sha(v.datasetSha256) ||
      typeof v.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(v.sourceCommit) ||
      !text(v.engineVersion) || !text(v.provenance) || !text(v.benchmarkDefinition) ||
      !record(v.period) || !record(v.metrics) || !validMetrics(v.metrics.baseline) || !validMetrics(v.metrics.candidate)) return false;
  if (v.phase !== 'development' && v.phase !== 'validation' && v.phase !== 'sealed_test') return false;
  const [start,end] = windows[v.phase];
  if (v.period.start !== start || v.period.end !== end || !Array.isArray(v.equity) || v.equity.length < 2 || v.equity.length > 10000) return false;
  let previous = '';
  for (const p of v.equity) {
    if (!record(p) || !day(p.date) || p.date <= previous || p.date > end ||
        ['baseline','candidate','market','balanced'].some(k => !finite(p[k]) || (p[k] as number) <= 0)) return false;
    previous = p.date;
  }
  const first=v.equity[0], last=v.equity.at(-1)!;
  // Origin is the previous exchange close; first/last trading dates may straddle weekends/holidays.
  if (first.date > start || Date.parse(start)-Date.parse(first.date)>7*86400000 ||
      Date.parse(end)-Date.parse(last.date)>7*86400000 ||
      ['baseline','candidate','market','balanced'].some(k=>first[k]!==1000)) return false;
  for (const name of ['baseline','candidate'] as const) {
    const m=v.metrics[name] as Metrics;
    if (Math.abs((last[name]-1000)-m.netProfit)>0.011) return false;
    const years=(Date.parse(last.date)-Date.parse(first.date))/86400000/365.25;
    if (Math.abs((last[name]/1000)**(1/years)-1-m.cagr)>1e-8) return false;
    let peak=1000, drawdown=0;
    for(const p of v.equity){peak=Math.max(peak,p[name]);drawdown=Math.max(drawdown,1-p[name]/peak);}
    if(Math.abs(drawdown-m.maxDrawdown)>1e-8)return false;
  }
  if (!Array.isArray(v.trades) || v.trades.length>100000) return false;
  const ids=new Set<string>();
  for(const t of v.trades){
    if(!record(t)||!text(t.id)||ids.has(t.id)||!day(t.date)||t.date<start||t.date>end||
      (t.strategy!=='baseline'&&t.strategy!=='candidate')||(t.side!=='buy'&&t.side!=='sell')||
      !text(t.securityId)||!text(t.symbol)||!count(t.shares)||t.shares===0||!count(t.amountCents)||!count(t.feeCents))return false;
    ids.add(t.id);
  }
  const u=v.uncertainty;
  return record(u)&&finite(u.meanMonthlyDifference)&&finite(u.lower)&&finite(u.upper)&&u.lower<=u.upper&&
    u.seed===20261012&&u.replicates===10000&&count(u.yearBlocks)&&u.yearBlocks===Number(end.slice(0,4))-Number(start.slice(0,4))+1&&text(u.limitation);
}
export function admitReport(value: unknown, actualHash: string, approvedHashes: readonly string[], protocolHash: string): ReportView {
  if(!approvedHashes.includes(actualHash))return {status:'not_measured',reason:'No reviewed historical report is approved for publication.',report:null};
  if(!validReport(value,protocolHash))return {status:'not_measured',reason:'The report failed version, provenance or reconciliation checks.',report:null};
  return {status:'validated',reason:'Reviewed historical research; future returns remain uncertain.',report:value};
}
