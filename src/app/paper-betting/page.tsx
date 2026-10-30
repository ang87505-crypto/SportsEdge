import {Suspense} from 'react';
import {connection} from 'next/server';
import Link from 'next/link';
import {paperPerformance} from '@/lib/server/research-db';
import {paperClosingLineValue,type PaperClv} from '@/lib/server/paper-clv';
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Empty,Details,KeyValues,Loading} from '@/components/ui';
import {StackedBar} from '@/components/charts';
import {PerformanceChart} from '@/components/performance-chart';
import {PaperLedgerBrowser} from '@/components/paper-ledger-browser';
import {NbaPaperRunPanel} from '@/components/nba-paper-run-panel';
import {NavIcon} from '@/components/nav-icon';
import {realizedSeries,type RealizedPoint} from '@/lib/performance-series';
import {american,dateTimeUtc,pct,usdCents} from '@/lib/format';

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

  <Suspense fallback={<Loading label="Checking closing prices"/>}><ClosingLineValue/></Suspense>

  <PaperLedgerBrowser positions={d.positions}/>

  <OwnerTools/>

  <div className="two-grid" style={{marginTop:12}}>
   <Details title="The fixed rules behind these bets"><p>Starting virtual bankroll: {usdCents(d.initial_cents)}. Each new position stakes 1% of available cash, with at most one position per forecast.</p><p>Prices must come from one sportsbook&apos;s complete market observed within the last hour. The model&apos;s estimated expected return must be at least 2%, and its probability must exceed the market&apos;s margin-free probability.</p><p>Results settle only against checked final scores. A real sportsbook might not accept the recorded price. This experiment has not shown an economic edge.</p></Details>
   <Details title="Where are soccer paper bets?"><p>EPL forecasts are an archived experiment with no paper ledger. They are not included in these balances. See the <Link href="/research/epl">Soccer model</Link> for its snapshot and limitations.</p></Details>
  </div>
 </>;
}

function minutes(m:number|null){
 if(m===null)return '—';
 return m<90?`${m} min`:m<48*60?`${Math.round(m/60)} h`:`${Math.round(m/1440)} d`;
}

/** Did recorded bets get better prices than the market's last stored price before tip-off? */
async function ClosingLineValue(){
 await connection();
 let clv:PaperClv|null=null;
 try{clv=await paperClosingLineValue();}catch{}
 const head={title:'Closing-line value',description:'Each bet\'s price against the same sportsbook\'s last stored price before tip-off. Positive values beat the close.'};
 if(!clv)return <Panel {...head} actions={<Evidence kind="unavailable"/>} className="mt-12"><p className="quiet">Closing prices could not be read. Bet results above are unaffected.</p></Panel>;
 const s=clv.summary;
 if(!s.withClose)return <Panel {...head} actions={<Evidence kind="not-measured"/>} className="mt-12">
  <p className="quiet">{clv.startedBets?`None of the ${clv.startedBets} bet(s) on started games has a stored two-way price at its sportsbook before tip-off.`:'No bets on started games yet. A close exists only once a game has tipped off.'}</p>
 </Panel>;
 const evTone=s.interval&&s.interval[0]>0?'positive':s.interval&&s.interval[1]<0?'negative':undefined;
 return <Panel {...head} actions={<Evidence kind="recorded"/>} className="mt-12" flush>
  <div className="panel-pad">
   <MetricGrid columns={4}>
    <Metric size="sm" label="Bets with a close" value={`${s.withClose} of ${s.bets}`} detail="Started games only"/>
    <Metric size="sm" label="Beat the close" value={pct(s.beatCloseRate,0)} hint="Share of bets placed at a better price than the last stored pregame price at the same book." detail="Better price than the last pregame quote"/>
    <Metric size="sm" label="Expected return at close" value={pct(s.meanClosingEv,1,{signed:true})} tone={evTone} hint="Average of (closing margin-free probability × bet decimal odds − 1). If closing prices are efficient, this estimates the bets' true expected return." detail={s.interval?`95% interval ${pct(s.interval[0],1,{signed:true})} to ${pct(s.interval[1],1,{signed:true})}`:'Needs 2+ bets for an interval'}/>
    <Metric size="sm" label="Close observed" value={minutes(s.medianMinutesBeforeStart)} detail="Median time before tip-off"/>
   </MetricGrid>
   {s.medianMinutesBeforeStart!==null&&s.medianMinutesBeforeStart>120&&<p className="game-card-warning" style={{marginTop:10}}>The stored “close” is usually more than two hours before tip-off, so it is an early price, not the true closing line. Collecting odds nearer tip-off would make this measure stronger.</p>}
   {clv.quoteLimitReached&&<p className="game-card-warning" style={{marginTop:10}}>The quote read hit its limit; some closes may be missing.</p>}
  </div>
  <div className="table-wrap table-scroll"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Bet</th><th scope="col" className="num">Bet price</th><th scope="col" className="num">Close</th><th scope="col" className="num">Price CLV</th><th scope="col" className="num">EV at close</th></tr></thead>
   <tbody>{[...clv.bets].reverse().slice(0,50).map(b=><tr key={b.id}>
    <td data-label="Bet"><strong>{b.selection}</strong><small>{b.sportsbook}, close {dateTimeUtc(b.close.observedAt)}</small></td>
    <td data-label="Bet price" className="num">{american(b.americanOdds)}</td>
    <td data-label="Close" className="num">{american(b.close.americanOdds)}<small>{pct(b.close.probability,1)} margin-free</small></td>
    <td data-label="Price CLV" className={`num ${b.priceClv>0?'tone-text-positive':b.priceClv<0?'tone-text-negative':''}`}>{pct(b.priceClv,1,{signed:true})}</td>
    <td data-label="EV at close" className={`num ${b.closingEv>0?'tone-text-positive':b.closingEv<0?'tone-text-negative':''}`}>{pct(b.closingEv,1,{signed:true})}</td>
   </tr>)}</tbody>
  </table></div>
  <p className="ledger-foot">Closing-line value measures price quality, not results. It needs many bets before it means much, and it depends on when prices were collected.</p>
 </Panel>;
}

function OwnerTools(){
 return <section className="owner-tools" aria-labelledby="owner-tools-title">
  <div className="section-header"><div><h2 id="owner-tools-title">Owner tools</h2><p>Requires the private owner key. Records at most one virtual bet per confirmation.</p></div><Evidence kind="simulated"/></div>
  <NbaPaperRunPanel/>
 </section>;
}

