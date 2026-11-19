/** One GitHub issue for operational problems: opened when something breaks (GitHub notifies the owner),
 * commented only when the set of problems changes, closed when healthy. Owner-pending steps that are not
 * failures (the supervised first stock session, an owner pause) stay on the dashboard, not in the alert.
 * Usage: node scripts/ops-alert.mjs <status.json>
 */
import {readFileSync} from 'node:fs';

const REPO='ang87505-crypto/SportsEdge',API='https://api.github.com/repos/'+REPO,LABEL='ops-alert';
const FOOTER='\n\n---\n_Posted automatically by the SportsEdge operations monitor (GitHub Actions)._';
const OWNER_PENDING=new Set(['stock-first-session','props-control']);
export function alertProblems(status){
 return status.blockers.filter(b=>!OWNER_PENDING.has(b.id));
}
export function alertBody(status,problems){
 const lines=problems.map(p=>`- **${p.text}**\n  ${p.action}`);
 return `The operations monitor found ${problems.length} problem${problems.length===1?'':'s'} at ${status.generatedAt}.\n\n${lines.join('\n')}\n\n`+
  `Status page: https://sports-edge-eta.vercel.app/automation · Monitor run: ${status.monitorRun?.url??'local'}\n\n`+
  `<!-- ops-alert-ids: ${problems.map(p=>p.id).sort().join(',')} -->`+FOOTER;
}
const idsIn=body=>(/<!-- ops-alert-ids: ([^>]*) -->/.exec(body??'')?.[1]??'').split(',').filter(Boolean).sort().join(',');

async function gh(path,{method='GET',body}={}){
 const res=await fetch(API+path,{method,redirect:'error',signal:AbortSignal.timeout(20_000),headers:{Authorization:'Bearer '+process.env.GH_TOKEN,
  Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!res.ok&&!(method==='POST'&&path==='/labels'&&res.status===422))throw new Error('GITHUB_HTTP_'+res.status+' '+method+' '+path.split('?')[0]);
 const text=await res.text();return text?JSON.parse(text):null;
}

if(import.meta.url===`file://${process.argv[1]}`){
 const status=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const problems=alertProblems(status),ids=problems.map(p=>p.id).sort().join(',');
 const open=(await gh(`/issues?labels=${LABEL}&state=open&per_page=5`)).filter(i=>!i.pull_request);
 const issue=open[0];
 if(problems.length&&!issue){
  await gh('/labels',{method:'POST',body:{name:LABEL,color:'d93f0b',description:'Raised by the operations monitor'}});
  const created=await gh('/issues',{method:'POST',body:{title:'Automation needs attention',labels:[LABEL],body:alertBody(status,problems)}});
  console.log('ALERT_OPENED #'+created.number+' '+ids);
 }else if(problems.length&&idsIn(issue.body)!==ids){
  await gh('/issues/'+issue.number,{method:'PATCH',body:{body:alertBody(status,problems)}});
  await gh('/issues/'+issue.number+'/comments',{method:'POST',body:{body:`The problem list changed: ${ids.replaceAll(',',', ')}.`+FOOTER}});
  console.log('ALERT_UPDATED #'+issue.number+' '+ids);
 }else if(!problems.length&&issue){
  await gh('/issues/'+issue.number+'/comments',{method:'POST',body:{body:`All monitored jobs and the live site are healthy as of ${status.generatedAt}. Closing.`+FOOTER}});
  await gh('/issues/'+issue.number,{method:'PATCH',body:{state:'closed',state_reason:'completed'}});
  console.log('ALERT_CLOSED #'+issue.number);
 }else console.log(problems.length?'ALERT_UNCHANGED #'+issue.number:'NO_ALERT');
}
