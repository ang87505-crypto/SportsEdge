"use client";
import Link from 'next/link';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Badge,Callout,Empty,Skeleton} from '@/components/ui';
import protocol from '../../../research/stock_audit_20261012/protocol.json';
import {StockEvidenceTracks} from '@/components/stock-evidence';
import {AutopilotSummary} from '@/components/autopilot-summary';
import {usePaperSnapshotSummary,type PaperSnapshot} from '@/lib/stocks/paper-snapshot';
import {useJournal} from '@/lib/stocks/journal-store';
import {totals} from '@/lib/stocks/journal';
import {dateTime,pct,usdCents,usdString} from '@/lib/format';

const costs=protocol.execution.primary_costs;
const oneWayBps=costs.half_spread_bps+costs.additional_slippage_bps;

export default function Stocks(){
 const paper=usePaperSnapshotSummary();
 const {journal,invalid}=useJournal();
 const local=totals(journal);
 return <>
  <PageHeading title="Stocks" description="A frozen momentum strategy under audit, an Alpaca PAPER account for simulated orders, and a manual practice journal. Three separate books; none uses real money."
   action={<><Link href="/stocks/research" className="button button-secondary">Quant research</Link><Link href="/stocks/alpaca" className="button">Paper account</Link></>}/>

  <div className="book-strip" role="list" aria-label="Separate stock books">
   <Link role="listitem" href="/stocks/alpaca" className="book"><Evidence kind="broker"/><strong>Alpaca PAPER account</strong><span>Simulated fills reported by the broker. Owner-only.</span></Link>
   <Link role="listitem" href="/stocks/research" className="book"><Evidence kind="unverified"/><strong>Strategy research</strong><span>Frozen rules and evidence gates. No returns yet.</span></Link>
   <Link role="listitem" href="/stocks/journal" className="book"><Evidence kind="local"/><strong>Practice journal</strong><span>Your manual trades, stored in this browser.</span></Link>
  </div>

  <div className="stocks-top">
   <PaperPortfolio view={paper}/>
   <Panel title="Autopilot" description="Weekly picks traded on the Alpaca paper account" className="automation-panel">
    <AutopilotSummary/>
    <Link href="/stocks/alpaca#alpaca-staging-stop-title" className="estop-link"><span className="estop-icon" aria-hidden="true"/><span><strong>Emergency stop</strong><small>Owner-only staging STOP on the paper account page</small></span></Link>
   </Panel>
  </div>

  <Panel title="Research evidence" description="Four kinds of evidence, kept apart so a test balance is never read as a return." actions={<Link href="/stocks/research" className="text-link">Open quant research</Link>}>
   <StockEvidenceTracks/>
   <div className="panel-foot">
    <span>Baseline <code>{protocol.baseline}</code></span>
    <span>Cost assumption {oneWayBps} bps one way, {usdCents(costs.fee_cents_per_order)} per order</span>
    <span>Protocol {protocol.version}</span>
   </div>
  </Panel>

  <Panel title="Practice journal" description="Your manual virtual trades in this browser" actions={<Link href="/stocks/journal" className="text-link">Open journal</Link>}>
   {invalid?<Callout tone="negative" title="Saved journal could not be read">Open the journal to export the raw data.</Callout>:
    <MetricGrid columns={4}>
     <Metric size="sm" label="Virtual cash" value={usdCents(local.cash)} evidence="local"/>
     <Metric size="sm" label="Open at cost" value={usdCents(local.cost)} detail={`${local.open} open`}/>
     <Metric size="sm" label="Realized P&L" value={usdCents(local.realized,{signed:true})} tone={local.realized>0?'positive':local.realized<0?'negative':undefined} detail={`${local.closed} closed`}/>
     <Metric size="sm" label="Watchlist" value={journal.watchlist.length} detail="Tickers saved"/>
    </MetricGrid>}
  </Panel>
 </>;
}

function PaperPortfolio({view}:{view:ReturnType<typeof usePaperSnapshotSummary>}){
 const actions=<Evidence kind="broker"/>;
 if(view.status==='checking')return <Panel title="Paper portfolio" description="Alpaca PAPER account" actions={actions}><Skeleton lines={4}/></Panel>;
 if(view.status!=='ready'){
  const copy={login:{t:'Owner sign-in required',b:'Balances and positions are private. Sign in with the owner key on the paper account page to see them here.'},
   unconfigured:{t:'Not connected on this deployment',b:'The owner key or Alpaca PAPER credentials are not configured here, so no account data exists to show.'},
   error:{t:'Broker snapshot unavailable',b:'The read-only account viewer did not return a verifiable snapshot. Nothing is shown in its place.'}}[view.status];
  return <Panel title="Paper portfolio" description="Alpaca PAPER account" actions={actions}>
   <Empty title={copy.t} action={<Link href="/stocks/alpaca" className="button button-secondary">{view.status==='login'?'Sign in on paper account':'Open paper account'}</Link>}>{copy.b}</Empty>
  </Panel>;
 }
 return <PortfolioReady snapshot={view.snapshot}/>;
}

function PortfolioReady({snapshot}:{snapshot:PaperSnapshot}){
 const equity=Number(snapshot.account.equityUsd);
 const cash=Number(snapshot.account.cashUsd);
 const positions=snapshot.positions.map(p=>({...p,value:Number(p.marketValueUsd)})).filter(p=>Number.isFinite(p.value)).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
 const invested=positions.reduce((a,p)=>a+Math.abs(p.value),0);
 const restricted=snapshot.account.tradingBlocked||snapshot.account.accountBlocked;
 return <Panel title="Paper portfolio" description={`Alpaca PAPER, captured ${dateTime(snapshot.capturedAt)}`} actions={<Evidence kind="broker"/>}>
  <MetricGrid columns={4}>
   <Metric size="sm" label="Equity" value={usdString(snapshot.account.equityUsd)}/>
   <Metric size="sm" label="Cash" value={usdString(snapshot.account.cashUsd)}/>
   <Metric size="sm" label="Invested" value={Number.isFinite(equity)&&equity>0?pct(invested/equity,1):'—'} detail="Gross position value ÷ equity"/>
   <Metric size="sm" label="Account" value={snapshot.account.status} tone={restricted?'warning':undefined} detail={restricted?'Trading restrictions present':'Broker-reported status'}/>
  </MetricGrid>
  <div className="exposure">
   <div className="exposure-head"><span>Position concentration</span><span className="quiet">{positions.length} position(s), share of equity</span></div>
   {positions.length===0?<p className="quiet">No open paper positions. {Number.isFinite(cash)?`${usdString(snapshot.account.cashUsd)} is held as cash.`:''}</p>:
    <ul className="exposure-list">{positions.slice(0,8).map(p=>{const w=equity>0?Math.abs(p.value)/equity:0;return <li key={p.symbol}>
     <span className="exposure-symbol">{p.symbol}{p.side==='short'&&<Badge tone="warning">Short</Badge>}</span>
     <span className="exposure-track"><span style={{width:`${Math.min(1,w)*100}%`}}/></span>
     <span className="exposure-value">{pct(w,1)}<small>{usdString(p.marketValueUsd)}</small></span>
    </li>;})}</ul>}
  </div>
  <div className="panel-foot">
   <span>{snapshot.recentOrders.length} recent order(s) reported{snapshot.recentOrders[0]?`, latest ${dateTime(snapshot.recentOrders[0].createdAt)}`:''}</span>
   <Link href="/stocks/alpaca" className="text-link">Orders and safety checks</Link>
  </div>
  {snapshot.warnings.length>0&&<Callout tone="warning" title="Broker reconciliation warnings">{snapshot.warnings.join('; ')}</Callout>}
  <p className="quiet small-print">A snapshot, not a performance record. Strategy P&amp;L is never inferred from account balances.</p>
 </Panel>;
}
