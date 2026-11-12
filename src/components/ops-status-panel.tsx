import {connection} from 'next/server';
import {Badge,Empty,Panel} from '@/components/ui';
import {loadOpsStatus} from '@/lib/server/ops-status-load';
import {mt,opsLabel,type OpsRun} from '@/lib/ops/status';

const RunLink=({run,empty}:{run:OpsRun|null;empty:string})=>run
 ?<a className="text-link" href={run.url} target="_blank" rel="noopener noreferrer">{mt(run.startedAt)}</a>
 :<span className="quiet">{empty}</span>;

/** Background jobs as last checked by the operations monitor. Planned times are labelled as plans. */
export async function OpsStatusPanel(){
 await connection();
 const view=await loadOpsStatus(new Date().toISOString());
 const s=view.status;
 if(!s)return <Panel title="Background jobs"><Empty title="Job status unavailable"
  action={<a className="button button-secondary" href="https://github.com/ang87505-crypto/SportsEdge/actions/workflows/ops-monitor.yml" target="_blank" rel="noopener noreferrer">Monitor runs on GitHub</a>}>
  The operations monitor has not published a status, or it could not be read. Nothing here is assumed to have run.</Empty></Panel>;
 const tone=s.overall.state==='OK'?'positive':s.overall.state==='WARN'?'warning':'negative';
 return <Panel title="Background jobs" description="Every job runs on GitHub or Vercel without Claude, ChatGPT or your computer."
  actions={<Badge tone={tone} dot>{s.overall.state==='OK'?'Healthy':s.overall.state==='WARN'?'Working, with warnings':'Needs attention'}</Badge>}>
  <p className="quiet small-print">Checked {mt(s.generatedAt)}{s.monitorRun?<> by <a className="text-link" href={s.monitorRun.url} target="_blank" rel="noopener noreferrer">this monitor run</a></>:null}.
   {view.monitorStale?' This check is old; the monitor itself may be running late.':''} &ldquo;Next planned&rdquo; is a schedule, not a run.</p>
  {s.blockers.length?<div className="mt-12"><h3>Needs attention</h3><ul>{s.blockers.map(b=><li key={b.id}><strong>{b.text}</strong> {b.action}</li>)}</ul></div>:null}
  <div className="table-wrap table-scroll mt-12">
   <table className="data-table">
    <thead><tr><th scope="col">Job</th><th scope="col">State</th><th scope="col">Last success</th><th scope="col">Last failure</th><th scope="col">Missed planned times (7 days)</th><th scope="col">Next planned</th></tr></thead>
    <tbody>{s.jobs.map(j=>{const l=opsLabel(j.status);return <tr key={j.id}>
     <th scope="row"><a className="text-link" href={j.historyUrl} target="_blank" rel="noopener noreferrer">{j.label}</a>{j.required?null:<span className="quiet"> (optional)</span>}</th>
     <td><Badge tone={l.tone}>{l.label}</Badge>{j.status==='OK'&&!j.stuckQueued?null:<div className="quiet small-print">{j.detail}</div>}</td>
     <td><RunLink run={j.lastSuccess} empty="No successful run yet"/></td>
     <td><RunLink run={j.lastFailure} empty="None recorded"/></td>
     <td>{j.slots7d.due?`${j.slots7d.missed} of ${j.slots7d.due}`:'—'}</td>
     <td>{j.nextPlanned[0]?<>{mt(j.nextPlanned[0])} <span className="quiet">(planned)</span></>:<span className="quiet">None scheduled</span>}</td>
    </tr>;})}</tbody>
   </table>
  </div>
  <p className="quiet small-print">Live site check: {s.site.ok?'all pages, chat answers and owner protections passed':'failed: '+s.site.checks.filter(c=>!c.ok).map(c=>c.name).join(', ')} ({mt(s.site.checkedAt)}).
   GitHub can start scheduled jobs late or skip them; Vercel backup triggers re-run the time-sensitive sports and research slots, and duplicates are refused by the ledgers.</p>
  {s.site.deployment&&s.site.deployment.state!=='UNKNOWN'?<p className="quiet small-print">Deployment: {s.site.deployment.detail}</p>:null}
 </Panel>;
}
