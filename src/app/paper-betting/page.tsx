import {Suspense} from 'react';
import {connection} from 'next/server';
import {paperPerformance} from '@/lib/server/research-db';
import {PageHeading,Stat,Details,Action,Empty} from '@/components/ui';
import {PerformanceChart} from '@/components/performance-chart';
import {PaperLedgerBrowser} from '@/components/paper-ledger-browser';
import {realizedSeries,type RealizedPoint} from '@/lib/performance-series';
export default function Page(){return <Suspense fallback={<div className="loading">Loading paper bets…</div>}><Paper/></Suspense>;}
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const rate=(n:number|null)=>n===null?'Not measured':`${(n*100).toFixed(2)}%`;
async function Paper(){
 await connection();
 let d:Awaited<ReturnType<typeof paperPerformance>>|null=null;
 try{d=await paperPerformance();}catch{}
 let graph:RealizedPoint[]=[];
 let graphInvalid=false;
 if(d){
  try{
   const events=d.positions.filter(p=>p.settlement!==null).map(p=>({
    id:String(p.id),at:p.settlement!.settled_at,
    profitCents:Number(p.settlement!.profit_cents)
   }));
   graph=realizedSeries(d.initial_cents,events);
  }catch{graphInvalid=true;}
 }
return <><PageHeading eyebrow="SPORTS PAPER BETS" title="Practice now. Measure honestly." description="Follow the NBA model’s shared virtual account. A paper bet records an idea and a price without placing a real wager." action={<Action href="/sports" secondary>Browse games</Action>}/><div className="notice"><strong>Shared NBA experiment.</strong> These are the model’s recorded positions, not a personal betting account. “Pending” means the game has not been settled in this ledger.</div>{!d?<section className="glass"><Empty title="The ledger is temporarily unavailable">Try again shortly. No result or balance has been substituted.</Empty></section>:<><div className="stats-grid"><Stat label="Virtual account value" value={money(d.equity_cents)} detail="Starting cash plus settled profit/loss"/><Stat label="Available virtual cash" value={money(d.available_cents)} detail={`${money(d.pending_stake_cents)} reserved in pending bets`}/><Stat label="Settled return (ROI)" value={rate(d.roi)} detail="Profit / amount staked on settled bets"/><Stat label="Settled win rate" value={rate(d.win_rate)} detail={`${d.settled_bets} settled · ${d.pending_bets} pending`}/></div>{graphInvalid?<div className="notice" role="alert"><strong>Performance chart unavailable.</strong> Some settlement records could not be validated. Review the saved ledger; no curve has been guessed.</div>:<PerformanceChart points={graph} initialCents={d.initial_cents}
 heading="NBA virtual balance after settlement"
 description="Trace profit as recorded NBA virtual bets settle. Pending bets do not create imaginary returns."
 source="Source: recorded NBA research settlements, ordered by settlement date"/>}<PaperLedgerBrowser positions={d.positions}/><Details title="Risk, profit and drawdown explained"><p><strong>Realized profit / loss:</strong> {money(d.profit_cents)}. Only settled wagers affect this figure.</p><p><strong>Largest realized drawdown:</strong> {d.settled_bets?`${money(d.max_drawdown_cents)} (${rate(d.max_drawdown_fraction)})`:'Not measured yet'}. This is the largest fall from a previous account high.</p><p><strong>Pending exposure:</strong> {money(d.pending_stake_cents)} across {d.pending_bets} wagers. This cash is reserved, not counted as a loss.</p></Details><Details title="The fixed rules behind these paper bets"><p>Starting virtual bankroll: {money(d.initial_cents)}. Each new position uses 1% of available cash, with at most one position per forecast.</p><p>Prices must form a complete market from one sportsbook and be observed within one hour. The model’s estimated expected return must be at least 2%, with a positive difference against the market’s margin-adjusted probability.</p><p>Results settle only against checked final scores. Prices can move and a real bet might not be accepted at the recorded price. This experiment has no established economic advantage.</p></Details></>}<Details title="Where are the soccer paper bets?"><p>EPL forecasts have a separate experimental ledger and bankroll. They are not included in the NBA balances above. See <a href="/research/epl">EPL research</a> for the current model snapshot and its limitations.</p></Details></>;}
