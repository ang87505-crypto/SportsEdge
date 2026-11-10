"use client";
import Link from 'next/link';
import {useMemo,type ReactNode} from 'react';
import {Badge,Callout,Evidence,Metric,Panel,Skeleton,StatusDot,type Tone} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import summary from '@/data/research/nba_recent_summary.json';
import protocol from '../../research/stock_audit_20261012/protocol.json';
import stockStudy from '@/data/research/stock_1000_forward_study.json';
import {PAPER_AUTO_RELEASE} from '@/lib/stocks/paper-auto-release';
import {useNow} from '@/lib/use-now';
import {useResearch,useSportsFeed} from '@/lib/use-live-data';
import {latestQuote} from '@/lib/dashboard-snapshot';
import {age,ageHours,american,pct,usdCents,shortDate} from '@/lib/format';

const STALE_ODDS_HOURS=24;

type StatusRow={label:string;value:ReactNode;tone:Tone;detail:string;href:string};

/** Overview body. The PrizePicks figures arrive as server-rendered slots from the ledger. */
export function HomeView({propsCard,propsStatus}:{propsCard:ReactNode;propsStatus:ReactNode}){
 const [research,retryResearch]=useResearch();
 const [nba,retryNba]=useSportsFeed('nba');
 const now=useNow();
 const details=research.status==='ready'?research.data.details:null;

 const quoteAt=nba.status==='ready'?latestQuote(nba.data.games):null;
 const quoteAge=quoteAt&&now?ageHours(quoteAt,now):null;

 const status:StatusRow[]=[
  {label:'Research database',href:'/progress',
   ...(research.status==='loading'?{value:'Checking',tone:'neutral',detail:'Contacting saved research records'}:
    research.status==='error'?{value:'Unavailable',tone:'negative',detail:'Paper and forecast figures are hidden, not assumed'}:
    {value:'Connected',tone:'positive',detail:'Saved forecasts and the paper ledger were read'})},
  {label:'NBA odds snapshots',href:'/sports',
   ...(nba.status==='loading'?{value:'Checking',tone:'neutral',detail:'Reading stored sportsbook quotes'}:
    nba.status==='error'?{value:'Unavailable',tone:'negative',detail:'Stored odds could not be read'}:
    !quoteAt?{value:'No quotes',tone:'warning',detail:`${nba.data.games.length} upcoming game(s), no stored prices`}:
    {value:quoteAge!==null&&quoteAge>STALE_ODDS_HOURS?'Stale':'Recent',tone:quoteAge!==null&&quoteAge>STALE_ODDS_HOURS?'warning':'positive',
     detail:`Latest quote recorded ${now?age(quoteAt,now):shortDate(quoteAt)}`})},
  {label:'Stock historical backtest',href:'/stocks/research',
   value:protocol.release.historical_performance_measured?'See report':'Not measured',tone:'neutral',detail:'Gated on point-in-time data and accounting audits'},
  {label:'Stock paper automation',href:'/automation',
   value:PAPER_AUTO_RELEASE.brokerWritesEnabled?'See owner status':'Plans only',tone:PAPER_AUTO_RELEASE.brokerWritesEnabled?'info':'warning',
   detail:PAPER_AUTO_RELEASE.brokerWritesEnabled?'Order release is on; the owner gate and account checks still apply':'Weekday schedule on; paper orders are still off'},
  {label:'Real-money execution',href:'/guide#limits',value:'Not available',tone:'neutral',detail:'No sportsbook or live brokerage connection exists'},
 ];

 const activity=useMemo(()=>{
  if(!details)return [];
  const items:{at:string;kind:string;tone:Tone;text:ReactNode;href:string}[]=[];
  for(const f of details.forecasts)if(f.role!=='other')items.push({at:f.publishedAt,kind:f.role==='shadow'?'Shadow':'Forecast',tone:f.role==='shadow'?'neutral':'info',href:'/research/nba',
   text:<>{f.away} at {f.home}: home win {pct(f.homeProbability)}</>});
  for(const p of details.positions){
   items.push({at:p.placedAt,kind:'Paper bet',tone:'neutral',href:'/paper-betting',text:<>{p.selection} {american(p.americanOdds)}, {usdCents(p.stakeCents)} virtual stake</>});
   if(p.settlement)items.push({at:p.settlement.settledAt,kind:p.settlement.outcome==='won'?'Won':p.settlement.outcome==='lost'?'Lost':'Void',
    tone:p.settlement.outcome==='won'?'positive':p.settlement.outcome==='lost'?'negative':'neutral',href:'/paper-betting',
    text:<>{p.selection} settled {usdCents(p.settlement.profitCents,{signed:true})}</>});
  }
  return items.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,7);
 },[details]);

 const alerts:{tone:Tone;title:string;body:string;action?:ReactNode}[]=[];
 if(research.status==='error')alerts.push({tone:'negative',title:'Saved research records are unavailable',body:'Paper results and forecasts are hidden rather than shown as zero.',action:<button type="button" className="button button-secondary button-sm" onClick={retryResearch}>Try again</button>});
 if(nba.status==='error')alerts.push({tone:'negative',title:'Stored odds could not be read',body:'Game prices on Sports AI are unavailable until the feed responds.',action:<button type="button" className="button button-secondary button-sm" onClick={retryNba}>Try again</button>});
 if(nba.status==='ready'&&quoteAt&&quoteAge!==null&&quoteAge>STALE_ODDS_HOURS)alerts.push({tone:'warning',title:'Stored odds are older than a day',body:`The newest NBA quote was recorded ${age(quoteAt,now)}. Treat prices as historical, not current.`});
 if(nba.status==='ready'&&!quoteAt&&nba.data.games.length>0)alerts.push({tone:'warning',title:'Upcoming games have no stored prices',body:'Model-versus-market comparisons are unavailable until quotes are collected.'});
 alerts.push({tone:'info',title:'Stock returns are not established',body:'No verified historical backtest or forward paper result exists yet, so no stock return is reported anywhere on SportsEdge.'});


 return <div className="home">
  <section className="home-intro" aria-labelledby="home-title">
   <div className="home-intro-copy">
    <h1 id="home-title">Research desk</h1>
    <p>SportsEdge makes daily virtual PrizePicks picks on NBA player props, keeps its sports model research, and runs a stock strategy on a paper account. Everything runs on its own schedule; nothing uses real money.</p>
    <div className="button-row" style={{marginTop:14}}>
     <Link href="/paper-betting/props" className="button">Open PrizePicks</Link>
     <Link href="/automation" className="button button-secondary">Automation status</Link>
    </div>
    <div className="home-sections" role="list">
     {[{href:'/sports',icon:'sports' as const,title:'Sports AI',text:'Model probabilities next to market prices'},
       {href:'/paper-betting/props',icon:'paper' as const,title:'PrizePicks',text:'Daily virtual picks, entries and results'},
       {href:'/stocks',icon:'stocks' as const,title:'Stocks',text:'Paper account, research and automation status'}].map(s=>
      <Link role="listitem" key={s.href} href={s.href} className="home-section-link">
       <span className="home-section-icon"><NavIcon name={s.icon} size={20}/></span>
       <span><strong>{s.title}</strong><small>{s.text}</small></span>
      </Link>)}
    </div>
   </div>
   <Panel title="System status" className="status-panel" actions={<span className="quiet" aria-live="polite">{research.status==='ready'?`Checked ${new Date(research.checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:research.status==='loading'?'Checking…':'Check failed'}</span>}>
    <ul className="status-list">
     {propsStatus}
     {status.map(s=><li key={s.label}><Link href={s.href}>
      <StatusDot tone={s.tone}/>
      <span className="status-copy"><span>{s.label}</span><small>{s.detail}</small></span>
      <span className={`status-value tone-text-${s.tone==='neutral'?'neutral':s.tone}`}>{s.value}</span>
     </Link></li>)}
    </ul>
   </Panel>
  </section>

  <div className="home-grid">
   {propsCard}
   <Panel title="Sports AI" description="Retrospective NBA Elo study, 2024–26" actions={<Evidence kind="historical"/>}>
    <div className="home-metric-pair">
     <Metric label="Winner accuracy" value={pct(summary.accuracy)} detail={`Always picking home: ${pct(summary.baseline_accuracy)}`}/>
     <Metric label="Brier score" value={summary.brier.toFixed(3)} detail={`Baseline ${summary.baseline_brier.toFixed(3)} · lower is better`} hint="Mean squared error of the probabilities. Rewards honest confidence, not just correct picks."/>
    </div>
    <p className="home-panel-note">{summary.evaluation_games.toLocaleString()} games. Accuracy is not a betting return: historical sportsbook prices were not available, so no ROI is claimed.</p>
    <div className="home-panel-foot">
     <span>{details?`${details.forecasts.filter(f=>f.role==='production').length} recorded forward forecast(s)`:research.status==='loading'?'Loading forecasts…':'Forecasts unavailable'}</span>
     <Link href="/sports" className="text-link">Open today&apos;s board</Link>
    </div>
   </Panel>

   <Panel title="Stocks" description="Frozen momentum strategy with Alpaca PAPER" actions={<Evidence kind="unverified"/>}>
    <ul className="evidence-list">
     <li><span>Historical backtest</span><Badge tone="neutral">{protocol.release.historical_performance_measured?'Report available':'Not measured'}</Badge></li>
     <li><span>Forward paper results</span><Badge tone="neutral">{stockStudy.events.length?`${stockStudy.events.length} events`:'None recorded'}</Badge></li>
     <li><span>Synthetic engineering tests</span><Badge tone="warning">Not returns</Badge></li>
     <li><span>Recurring paper orders</span><Badge tone={PAPER_AUTO_RELEASE.brokerWritesEnabled?'info':'warning'}>{PAPER_AUTO_RELEASE.brokerWritesEnabled?'Released; check owner status':'Off — plans only'}</Badge></li>
    </ul>
    <p className="home-panel-note">Baseline <code>{protocol.baseline}</code> and one candidate are registered. Returns stay unreported until a verified point-in-time backtest exists.</p>
    <div className="home-panel-foot"><span>Alpaca PAPER is owner-only</span><Link href="/stocks" className="text-link">Open stocks</Link></div>
   </Panel>
  </div>

  <div className="home-lower">
   <Panel title="Sports model activity" description="NBA forecasts and the older moneyline paper test" flush>
    {research.status==='loading'?<div className="panel-pad"><Skeleton lines={5}/></div>:
     research.status==='error'?<div className="panel-pad"><p className="quiet">Activity is unavailable while the research database cannot be reached.</p></div>:
     !activity.length?<div className="panel-pad"><p className="quiet">No forecasts or paper bets have been recorded yet.</p></div>:
     <ol className="activity">{activity.map((a,i)=><li key={i}>
      <Link href={a.href}>
       <Badge tone={a.tone}>{a.kind}</Badge>
       <span className="activity-text">{a.text}</span>
       <time dateTime={a.at} className="activity-time">{now?age(a.at,now):shortDate(a.at)}</time>
      </Link>
     </li>)}</ol>}
   </Panel>
   <Panel title="Alerts" description="Conditions that affect how to read this site">
    <div className="alert-stack">{alerts.map(a=><Callout key={a.title} tone={a.tone} title={a.title}>{a.body}{a.action&&<div style={{marginTop:8}}>{a.action}</div>}</Callout>)}</div>
   </Panel>
  </div>
 </div>;
}
