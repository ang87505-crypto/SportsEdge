/**
 * Research-only evaluation for Kalshi shadow forecasts.
 * Market midpoint is a QUOTE benchmark, not an observed probability truth.
 * Report hypothetical P&L separately from predictive scoring; no claim of real fills or alpha.
 */
import type {PaperForecast,PaperGrade} from './paper.ts';

export type PaperStudy={
 status:'INSUFFICIENT_FORWARD_EVENTS'|'RESEARCH_ONLY_NOT_PROVEN';
 nForecasts:number;graded:number;independentEvents:number;distinctDates:number;
 modelBrier:number|null;modelLogLoss:number|null;
 marketBenchmarkN:number;marketMidpointBrier:number|null;pairedModelBrier:number|null;
 hypotheticalTrades:number;hypotheticalWins:number;hypotheticalNetMicros:number;
 hypotheticalCostMicros:number;hypotheticalRoi:number|null;hypotheticalMaxDrawdownMicros:number;
 warning:string;
};
const sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0);
const round=(n:number)=>Number(n.toFixed(6));
export function evaluateKalshiPaper(forecasts:readonly PaperForecast[],grades:readonly PaperGrade[]):PaperStudy{
 const byId=new Map(forecasts.map(x=>[x.id,x]));
 if(byId.size!==forecasts.length)throw Error('KALSHI_DUPLICATE_FORECAST');
 const used=new Set<string>(),evaluated:{f:PaperForecast;g:PaperGrade}[]=[];
 for(const g of grades){
  if(used.has(g.forecastId))throw Error('KALSHI_DUPLICATE_GRADE');
  used.add(g.forecastId);
  const f=byId.get(g.forecastId);
  if(!f||f.marketTicker!==g.marketTicker||f.eventTicker!==g.eventTicker||
   g.execution!=='HYPOTHETICAL_UNCONFIRMED')throw Error('KALSHI_GRADE_MISMATCH');
  evaluated.push({f,g});
 }
 const p=(f:PaperForecast)=>f.probabilityYesPpm/1_000_000;
 const y=(g:PaperGrade)=>g.result==='yes'?1:0;
 const brier=(p:number,y:number)=>(p-y)**2;
 const logloss=(p:number,y:number)=>-(y*Math.log(Math.max(1e-9,p))+(1-y)*Math.log(Math.max(1e-9,1-p)));
 const n=evaluated.length,withQuotes=evaluated.filter(x=>x.f.marketMidpointYesPpm!==null);
 const traded=evaluated.filter(x=>x.g.virtualNetMicros!==null);
 const sorted=[...traded].sort((a,b)=>a.g.settledAt.localeCompare(b.g.settledAt)||a.f.id.localeCompare(b.f.id));
 let cum=0,peak=0,maxDrawdown=0;
 for(const {g} of sorted){cum+=g.virtualNetMicros!;peak=Math.max(peak,cum);maxDrawdown=Math.max(maxDrawdown,peak-cum);}
 const cost=sum(traded.map(({f})=>f.contracts*f.priceMicros!+f.feeMicros+f.slippageMicros));
 const net=sum(traded.map(({g})=>g.virtualNetMicros!));
 const events=new Set(evaluated.map(({f})=>f.eventTicker)).size;
 const dates=new Set(evaluated.map(({f})=>f.closeTime.slice(0,10))).size;
 return {
  status:events>=50&&dates>=14?'RESEARCH_ONLY_NOT_PROVEN':'INSUFFICIENT_FORWARD_EVENTS',
  nForecasts:forecasts.length,graded:n,independentEvents:events,distinctDates:dates,
  modelBrier:n?round(sum(evaluated.map(({f,g})=>brier(p(f),y(g))))/n):null,
  modelLogLoss:n?round(sum(evaluated.map(({f,g})=>logloss(p(f),y(g))))/n):null,
  marketBenchmarkN:withQuotes.length,
  marketMidpointBrier:withQuotes.length?round(sum(withQuotes.map(({f,g})=>brier(f.marketMidpointYesPpm!/1_000_000,y(g))))/withQuotes.length):null,
  pairedModelBrier:withQuotes.length?round(sum(withQuotes.map(({f,g})=>brier(p(f),y(g))))/withQuotes.length):null,
  hypotheticalTrades:traded.length,
  hypotheticalWins:traded.filter(({g})=>g.correct).length,
  hypotheticalNetMicros:net,
  hypotheticalCostMicros:cost,
  hypotheticalRoi:cost?round(net/cost):null,
  hypotheticalMaxDrawdownMicros:maxDrawdown,
  warning:'Research only. These are hypothetical fills at observed displayed depth, not executed orders. Fees use a provisional general schedule. No positive predictive edge or profit has been proven.',
 };
}
