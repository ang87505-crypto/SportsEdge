import {connection,type NextRequest} from 'next/server';
import {handleSchedulerKickoff} from '@/lib/server/scheduler-kickoff';

export const maxDuration=30;
/** Daily Vercel cron backup for jobs GitHub schedules late or drops. Dispatches fixed idempotent workflows only. */
export async function GET(req:NextRequest,ctx:RouteContext<'/api/internal/scheduler/[slot]'>){
 await connection();
 const {slot}=await ctx.params;
 const result=await handleSchedulerKickoff(req,slot,process.env,{now:()=>Date.now(),fetcher:fetch});
 // Only fixed outcome codes, slot and workflow names. Never log headers, bodies or keys.
 console.info('scheduler-kickoff',await result.clone().text());
 return result;
}
