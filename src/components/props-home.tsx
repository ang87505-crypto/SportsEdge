import 'server-only';
import Link from 'next/link';
import {cache} from 'react';
import {connection} from 'next/server';
import {Badge,Evidence,Metric,Panel,StatusDot} from '@/components/ui';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {buildView} from '@/lib/props/dashboard-view';
import {propsSummary,mtShort,learningStatus} from '@/lib/props/summary';
import {propsAutomationStatus} from '@/lib/paper-automation-view';
import {PROPS_RELEASE,ticksReleased} from '@/lib/props/schedule';
import {nextCollectionAt} from '@/lib/props/collection-status';
import {pct,usdCents} from '@/lib/format';

/** One ledger read per request, shared by the card and the status row. */
const load=cache(async()=>{
 if(!propsDashboardConfigured())return {kind:'unconfigured'} as const;
 try{
  const raw=await loadPropsDashboard();
  const v=buildView(raw,'prizepicks');
  return {kind:'ready',raw,v,s:propsSummary(v),status:propsAutomationStatus(raw,PROPS_RELEASE.scheduledRunsEnabled)} as const;
 }catch{return {kind:'error'} as const;}
});

/** Overview card: the PrizePicks paper test's headline numbers. */
export async function PropsHomeCard(){
 await connection();
 const d=await load();
 const foot=(left:string)=><div className="home-panel-foot"><span>{left}</span><Link href="/paper-betting/props" className="text-link">Open PrizePicks</Link></div>;
 const head={title:'PrizePicks',description:'Daily NBA player props · $5 virtual entries',actions:<Evidence kind="simulated"/>};
 if(d.kind!=='ready')return <Panel {...head}>
  <p className="home-panel-note">{d.kind==='unconfigured'?'This deployment has no props ledger connected, so no figures are shown.':'The props ledger could not be read. No balance is shown.'}</p>
  {foot('—')}
 </Panel>;
 const {s,v,raw,status}=d;
 const nextAt=nextCollectionAt({nowIso:raw.nowIso,ticksReleased:ticksReleased(),plans:raw.capturePlans,captures:raw.captures});
 const next=nextAt?{at:nextAt}:null;
 const running=PROPS_RELEASE.scheduledRunsEnabled&&raw.control?.state==='RUNNING';
 return <Panel {...head}>
  <div className="props-status-line"><Badge tone={status.tone} dot>{status.label}</Badge><p className="small-print" style={{margin:0}}>{learningStatus(v.model)}</p></div>
  <div className="home-metric-pair">
   <Metric label="Virtual balance" value={usdCents(s.balanceCents)} detail={v.bankroll?`Started at ${usdCents(v.bankroll.initialCents)}`:'No account row'}/>
   <Metric label="Net result" value={usdCents(s.netCents,{signed:true})} tone={s.netCents===null||s.netCents===0?undefined:s.netCents>0?'positive':'negative'}
    detail={`${s.record.won}–${s.record.lost} entries${s.roi===null?'':`, ROI ${pct(s.roi,1,{signed:true})}`}`}/>
  </div>
  <p className="home-panel-note">Pick hit rate {s.hitRate===null?'not measured yet':`${pct(s.hitRate,1)} (${s.correct} of ${s.graded})`} · {s.openEntries} open entr{s.openEntries===1?'y':'ies'}.
   {s.upcoming.length?` Top upcoming pick: ${s.upcoming[0].player} ${s.upcoming[0].side==='more'?'More':'Less'} ${s.upcoming[0].line} ${s.upcoming[0].stat} (${pct(s.upcoming[0].probability,0)}).`:''}</p>
  {foot(running&&next?`Next lines ${mtShort(next.at)}`:status.label)}
 </Panel>;
}

/** Overview status row for the PrizePicks paper test. */
export async function PropsStatusRow(){
 await connection();
 const d=await load();
 const row=d.kind!=='ready'?{value:d.kind==='unconfigured'?'Not connected':'Unavailable',tone:d.kind==='unconfigured'?'neutral' as const:'negative' as const,detail:'Daily player-prop paper picks'}
  :{value:d.status.label,tone:d.status.tone,detail:d.v.automation.lastCollect?`Lines last saved ${mtShort(d.v.automation.lastCollect.finished_at)}`:'No completed line collection yet'};
 return <li><Link href="/paper-betting/props">
  <StatusDot tone={row.tone}/>
  <span className="status-copy"><span>PrizePicks paper picks</span><small>{row.detail}</small></span>
  <span className={`status-value tone-text-${row.tone}`}>{row.value}</span>
 </Link></li>;
}
