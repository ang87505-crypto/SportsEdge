import {Suspense} from 'react';
import {connection} from 'next/server';
import Link from 'next/link';
import {paperPerformance} from '@/lib/server/research-db';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Empty,Details,KeyValues,Loading} from '@/components/ui';
import {StackedBar} from '@/components/charts';
import {PerformanceChart} from '@/components/performance-chart';
import {PaperLedgerBrowser} from '@/components/paper-ledger-browser';
import {NbaPaperRunPanel} from '@/components/nba-paper-run-panel';
import {NavIcon} from '@/components/nav-icon';
import {realizedSeries,type RealizedPoint} from '@/lib/performance-series';
import {american,pct,usdCents} from '@/lib/format';

export const metadata={title:'Paper Betting · SportsEdge',description:'Shared virtual-money NBA ledger: bankroll, open and settled bets, and realized performance.'};

export default function Page(){
 return <>
  <PageHeading title="Paper Betting" description="A shared virtual-money NBA ledger. A bet is recorded only when the model's fixed rules qualify it, and results settle against checked final scores."
   action={<Link href="/sports" className="button button-secondary">Browse games</Link>}/>
  <div className="virtual-banner" role="note">
   <span className="virtual-banner-icon"><NavIcon name="shield" size={18}/></span>
   <div><strong>Virtual money only.</strong> No sportsbook account is connected and nothing on this page can place a real wager. Balances are research records.</div>
  </div>
  <Suspense fallback={<Loading label="Loading the paper ledger"/>}><Ledger/></Suspense>
 </>;
}

async function Ledger(){
 await connection();
 let d:Awaited<ReturnType<typeof paperPerformance>>|null=null;
 try{d=await paperPerformance();}catch{}
 if(!d)return <>
  <Panel><Empty title="The paper ledger is unavailable" action={<a className="button button-secondary" href="/paper-betting">Reload ledger</a>}>The saved research database did not respond. No balance or result has been substituted.</Empty></Panel>
  <OwnerTools/>
 </>;

 let graph:RealizedPoint[]=[];
 let graphInvalid=false;
 try{
  graph=realizedSeries(d.initial_cents,d.positions.filter(p=>p.settlement!==null).map(p=>({id:String(p.id),at:p.settlement!.settled_at,profitCents:Number(p.settlement!.profit_cents)})));
 }catch{graphInvalid=true;}

 const voids=d.positions.filter(p=>p.settlement?.outcome==='void').length;
 const stakes=d.positions.map(p=>Number(p.stake_cents)).filter(Number.isFinite);
 const avgStake=stakes.length?Math.round(stakes.reduce((a,b)=>a+b,0)/stakes.length):null;
 const odds=d.positions.map(p=>Number(p.american_odds)).filter(Number.isFinite).sort((a,b)=>a-b);
 const medianOdds=odds.length?odds[Math.floor(odds.length/2)]:null;
 const profitTone=d.profit_cents>0?'positive':d.profit_cents<0?'negative':undefined;

 return <>
  <MetricGrid columns={4}>
   <Metric size="lg" label="Virtual balance" value={usdCents(d.equity_cents)} evidence="simulated" detail={`Starting bankroll ${usdCents(d.initial_cents)} plus settled results`}/>
   <Metric size="lg" label="Net realized P&L" value={usdCents(d.profit_cents,{signed:true})} tone={profitTone} detail="Settled bets only. Open stakes are not losses."/>
   <Metric size="lg" label="ROI on settled stakes" value={pct(d.roi,2,{signed:true})} tone={d.roi===null||d.roi===0?undefined:d.roi>0?'positive':'negative'} hint="Net realized profit divided by the total amount staked on settled, non-void bets." detail={d.roi===null?'Not measured until a bet settles':'Small samples are noisy'}/>
   <Metric size="lg" label="Record" value={d.wins+d.losses?`${d.wins}–${d.losses}`:'—'} detail={d.win_rate===null?'No settled results yet':`Win rate ${pct(d.win_rate,1)}${voids?`, ${voids} void`:''}`}/>
  </MetricGrid>

  <div className="ledger-grid">
   {graphInvalid?<Panel title="Performance chart unavailable"><p className="quiet">Some settlement records could not be validated, so no curve is drawn. Review the ledger below; nothing has been guessed.</p></Panel>:
    <PerformanceChart points={graph} initialCents={d.initial_cents} heading="Realized balance" description="How the virtual balance moved as bets settled. Open bets do not move this line."
     source="Source: recorded NBA research settlements, ordered by settlement time"/>}
   <Panel title="Exposure and outcomes" description="Current state of the virtual bankroll">
    <StackedBar label="Bet outcomes" segments={[
     {label:'Won',value:d.wins,color:'var(--pos)'},{label:'Lost',value:d.losses,color:'var(--neg)'},
     {label:'Void',value:voids,color:'var(--unk)'},{label:'Open',value:d.pending_bets,color:'var(--c2)'}]}/>
    <div style={{marginTop:14}}>
     <KeyValues items={[
      ['Available cash',usdCents(d.available_cents)],
      ['Open exposure',<>{usdCents(d.pending_stake_cents)} <span className="quiet">({d.pending_bets} bet{d.pending_bets===1?'':'s'})</span></>],
      ['Largest drawdown',d.settled_bets?<span className={d.max_drawdown_cents>0?'tone-text-negative':undefined}>{usdCents(-d.max_drawdown_cents)} ({pct(d.max_drawdown_fraction,1)})</span>:'Not measured'],
      ['Typical stake',avgStake===null?'—':usdCents(avgStake)],
      ['Median recorded price',american(medianOdds)],
     ]}/>
    </div>
   </Panel>
  </div>

  <PaperLedgerBrowser positions={d.positions}/>

  <OwnerTools/>

  <div className="two-grid" style={{marginTop:12}}>
   <Details title="The fixed rules behind these bets"><p>Starting virtual bankroll: {usdCents(d.initial_cents)}. Each new position stakes 1% of available cash, with at most one position per forecast.</p><p>Prices must come from one sportsbook&apos;s complete market observed within the last hour. The model&apos;s estimated expected return must be at least 2%, and its probability must exceed the market&apos;s margin-free probability.</p><p>Results settle only against checked final scores. A real sportsbook might not accept the recorded price. This experiment has not shown an economic edge.</p></Details>
   <Details title="Where are soccer paper bets?"><p>EPL forecasts are an archived experiment with no paper ledger. They are not included in these balances. See the <Link href="/research/epl">Soccer model</Link> for its snapshot and limitations.</p></Details>
  </div>
 </>;
}

function OwnerTools(){
 return <section className="owner-tools" aria-labelledby="owner-tools-title">
  <div className="section-header"><div><h2 id="owner-tools-title">Owner tools</h2><p>Requires the private owner key. Records at most one virtual bet per confirmation.</p></div><Evidence kind="simulated"/></div>
  <NbaPaperRunPanel/>
 </section>;
}

