import 'server-only';
import Link from 'next/link';
import {connection} from 'next/server';
import {Badge,Evidence,Metric,Panel,StatusDot} from '@/components/ui';
import {loadBriefing} from '@/lib/server/briefing-load';
import {OP_STATES,briefingTime} from '@/lib/briefing/briefing';
import {mtShort} from '@/lib/props/summary';

const money=(c:number,signed=false)=>(c<0?'−':signed&&c>0?'+':'')+'$'+(Math.abs(c)/100).toFixed(2);
const pct=(x:number|null)=>x===null?'—':(x*100).toFixed(1)+'%';

/** "Right now": overall health, each system's operating state, and what is waiting on the owner. */
export async function BriefingNow(){
 await connection();
 const b=await loadBriefing();
 const h=b.health;
 return <Panel title="Right now" className="status-panel briefing-now"
  actions={<span className="quiet">{h.checkedAt?`Checked ${mtShort(h.checkedAt)}`:'No check yet'}</span>}>
  <Link href="/automation" className="briefing-health">
   <StatusDot tone={h.tone}/>
   <span><strong>{h.headline}</strong><small>{h.detail}</small></span>
  </Link>
  <ul className="status-list" aria-label="Systems">
   {b.systems.map(s=><li key={s.id}><Link href={s.href}>
    <StatusDot tone={OP_STATES[s.state].tone}/>
    <span className="status-copy"><span>{s.name}</span><small>{s.reason}</small></span>
    <span className={`status-value tone-text-${OP_STATES[s.state].tone}`}>{OP_STATES[s.state].label}</span>
   </Link></li>)}
   <li><Link href="/guide#limits">
    <StatusDot tone="neutral"/>
    <span className="status-copy"><span>Real-money execution</span><small>Off. No live brokerage or sportsbook connection exists; everything is virtual or PAPER.</small></span>
    <span className="status-value tone-text-neutral">Not available</span>
   </Link></li>
  </ul>
  <div className="briefing-approvals">
   {b.approvals.length?<>
    <p className="briefing-label">Needs you ({b.approvals.length})</p>
    <ul>{b.approvals.map(a=><li key={a.text}><span>{a.text}</span><small>{a.action}</small></li>)}</ul>
   </>:<p className="quiet">Nothing is waiting on you.</p>}
  </div>
 </Panel>;
}

/** Today / Results / Next, then what the model is learning. Every row is a recorded receipt or a labelled plan. */
export async function BriefingBoard(){
 await connection();
 const b=await loadBriefing();
 const m=b.money,pp=m.prizepicks,l=b.learning;
 return <>
  <div className="home-grid briefing-grid">
   <Panel title="Today" description="Recorded today, Mountain time" flush>
    {b.today.length?<ol className="briefing-list">{b.today.map((t,i)=><li key={i}>
     <Link href={t.href}><StatusDot tone={t.tone}/><span>{t.text}</span><time dateTime={t.at}>{briefingTime(t.at)}</time></Link>
    </li>)}</ol>:<p className="quiet panel-pad">Nothing recorded yet today. Planned times are on the right; they are plans, not runs.</p>}
   </Panel>
   <Panel title="Results" description="Virtual PrizePicks entries" actions={<Evidence kind="simulated"/>}>
    {pp?<>
     <div className="home-metric-pair">
      <Metric label="Virtual balance" value={money(pp.balanceCents)} detail={`Started at ${money(pp.startCents)}`}/>
      <Metric label="Net result" value={money(pp.netCents,true)} tone={pp.netCents===0?undefined:pp.netCents>0?'positive':'negative'}
       detail={`${pp.won}–${pp.lost} settled · ${pp.openEntries} open`}/>
     </div>
     <p className="home-panel-note">Last 7 days: {money(pp.weekNetCents,true)} on {pp.weekSettled} settled entr{pp.weekSettled===1?'y':'ies'}.
      {m.pick6?` Pick6: ${m.pick6.settled} settled with unknown payouts, not counted.`:''}</p>
     {m.preliminary&&<p className="home-panel-note"><Badge tone="warning">Too early to judge</Badge> {m.note.replace(/^Too early to judge profitability: /,'')}</p>}
    </>:<p className="home-panel-note">{m.note}</p>}
    <div className="home-panel-foot"><span>Stock PAPER results are owner-only</span><Link href="/paper-betting/props" className="text-link">All entries</Link></div>
   </Panel>
   <Panel title="Next" description="Planned times — not runs until they happen">
    {b.next.length?<ul className="briefing-next">{b.next.map(n=><li key={n.what}>
     <span>{n.what}</span><time dateTime={n.at}>{mtShort(n.at)}</time></li>)}</ul>:
     <p className="quiet">No planned times are available.</p>}
    <div className="home-panel-foot"><span>Times in Mountain time</span><Link href="/automation" className="text-link">Automation</Link></div>
   </Panel>
  </div>
  <Panel title="What the model is learning" className="briefing-learning" description="Sports props model, graded on real box scores">
   {l?<>
    <div className="briefing-learning-metrics">
     <Metric size="sm" label="Pick hit rate" value={pct(l.hitRate)} detail={`${l.graded} graded`}/>
     <Metric size="sm" label="Stated confidence" value={pct(l.meanConfidence)} detail="Average for those picks" tone={l.overconfident?'warning':undefined}/>
     <Metric size="sm" label="Brier score" value={l.brier===null?'—':l.brier.toFixed(3)} detail={`${l.brierN} lines · coin flip 0.250`}/>
     <Metric size="sm" label="Challengers" value={String(l.challengers.length)} detail="Tested on later games only"/>
    </div>
    <p className="home-panel-note">{l.note}</p>
   </>:<p className="home-panel-note">The sports model records could not be read.</p>}
   <p className="home-panel-note">Stock research: {b.research.stocks?`${b.research.stocks.overall.toLowerCase()}${b.research.stocks.daily?`; daily strategies ${b.research.stocks.daily.toLowerCase()}`:''}. No research candidate is active.`:'unavailable right now.'}</p>
   <div className="home-panel-foot"><span>Nothing is promoted without passing its registered forward test</span><Link href="/paper-betting/props" className="text-link">Model details</Link></div>
  </Panel>
 </>;
}
