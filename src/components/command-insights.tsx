import 'server-only';
import Link from 'next/link';
import {connection} from 'next/server';
import {Badge,Panel,StatusDot} from '@/components/ui';
import {AskButton} from '@/components/assistant-chat';
import {loadLab} from '@/lib/server/lab-load';
import {loadOpsStatus} from '@/lib/server/ops-status-load';
import {opsLabel} from '@/lib/ops/status';

/** Active experiments and alerts, from the same recorded sources the command center's tools read. Each source fails alone. */
export async function CommandInsights(){
 await connection();
 const nowIso=new Date().toISOString();
 const [lab,ops]=await Promise.allSettled([loadLab(nowIso),loadOpsStatus(nowIso)]);
 const l=lab.status==='fulfilled'?lab.value:null,o=ops.status==='fulfilled'?ops.value:null;
 const f=l?.samples.forward??null,min=l?.samples.minimums??null;
 const alerts=(o?.status?.jobs??[]).filter(j=>!['positive','neutral','info'].includes(opsLabel(j.status).tone));
 return <div className="home-grid briefing-grid">
  <Panel title="Active experiments" description="Challengers are tested on frozen forward predictions; nothing is promoted automatically">
   {!l?<p className="quiet">Learning Lab records are unavailable right now.</p>:<>
    <p><strong>{l.active?.version??'Unknown model'}</strong> is live. Testing: {l.testing.productionShadows.length?l.testing.productionShadows.join(', '):'no production shadows'} plus {l.testing.labVariants} lab variants.</p>
    {f&&min?<ul className="chat-bars" aria-label="Forward sample progress">
     {[['Graded lines',f.graded,min.lines],['Dates',f.dates,min.dates],['Games',f.games,min.games]].map(([k,v,m])=><li key={k as string}>
      <span className="chat-bar-label">{k}</span>
      <span className="chat-bar-track" aria-hidden="true"><span className="chat-bar-fill" style={{width:`${Math.min(100,(Number(v)/Number(m))*100)}%`}}/></span>
      <span className="chat-bar-value">{v}/{m}</span></li>)}
    </ul>:<p className="quiet">No forward report yet.</p>}
    <p className="quiet small-print">Status: {String(l.forwardStatus).replaceAll('_',' ')}. <Link href="/lab">Open the Learning Lab</Link></p>
   </>}
   <AskButton question="Show active experiments" className="chat-chip">Ask about experiments</AskButton>
  </Panel>
  <Panel title="Alerts" description="Background jobs that need attention, from the operations monitor">
   {!o?.status?<p className="quiet">The operations monitor is unavailable right now; that is not the same as healthy.</p>:alerts.length?
    <ul className="status-list">{alerts.slice(0,6).map(j=><li key={j.id}><Link href={j.historyUrl||'/automation'}>
     <StatusDot tone={opsLabel(j.status).tone}/>
     <span className="status-copy"><span>{j.label}</span><small>{j.detail}</small></span>
     <Badge tone={opsLabel(j.status).tone}>{opsLabel(j.status).label}</Badge></Link></li>)}</ul>
    :<p>No job reports a problem{o.monitorStale?', but the monitor itself is stale':''}.</p>}
   <AskButton question="Show job health" className="chat-chip">Ask about job health</AskButton>
  </Panel>
 </div>;
}
