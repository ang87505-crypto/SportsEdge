import {connection,type NextRequest} from 'next/server';
import {handlePaperKickoff} from '@/lib/server/paper-auto-kickoff';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';

export const maxDuration=60;
/** Daily Vercel kickoff only: no order, owner resume, paid collection or model changes. */
export async function GET(req:NextRequest){
 await connection();
 const result=await handlePaperKickoff(req,process.env,{now:()=>Date.now(),fetcher:fetch,sportsReady:async()=>{
  if(!propsDashboardConfigured())return false;
  const raw=await loadPropsDashboard();
  return raw.control?.state==='RUNNING'&&['prizepicks','pick6'].every(p=>raw.observations.some(o=>o.platform===p))&&
   raw.runs.some(r=>r.kind==='collect'&&r.status==='completed'&&r.outcome==='COMPLETED');
 }});
 // Only fixed outcome codes and workflow names. Never log headers, bodies or keys.
 console.info('paper-auto-kickoff',await result.clone().text());
 return result;
}
