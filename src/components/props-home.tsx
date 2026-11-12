import 'server-only';
import Link from 'next/link';
import {cache} from 'react';
import {connection} from 'next/server';
import {StatusDot} from '@/components/ui';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {buildView} from '@/lib/props/dashboard-view';
import {mtShort} from '@/lib/props/summary';
import {propsAutomationStatus} from '@/lib/paper-automation-view';
import {PROPS_RELEASE} from '@/lib/props/schedule';

/** One ledger read per request for the Overview status row. */
const load=cache(async()=>{
 if(!propsDashboardConfigured())return {kind:'unconfigured'} as const;
 try{
  const raw=await loadPropsDashboard();
  const v=buildView(raw,'prizepicks');
  return {kind:'ready',raw,v,status:propsAutomationStatus(raw,PROPS_RELEASE.scheduledRunsEnabled)} as const;
 }catch{return {kind:'error'} as const;}
});

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
