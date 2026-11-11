/** Backup scheduler for jobs GitHub's own schedule often starts hours late or drops.
 * Called by daily Vercel crons (one per slot, an hour after the GitHub slot). It only dispatches fixed,
 * idempotent workflows: props runs carry their scheduled slot, so the database records a second start as
 * DUPLICATE. It never arms a gate, changes a control or calls a paid model. A stock worker backup dispatches the
 * same execute or monitor run as the GitHub schedule (trigger=backup is treated as scheduled); that run trades only
 * under the reviewed stock release manifest, an owner-armed gate and a same-day decision.
 */
import {timingSafeEqual} from 'node:crypto';
import {PROPS_RELEASE} from '../props/schedule.ts';
import {PAPER_AUTO_RELEASE} from '../stocks/paper-auto-release.ts';

type Env=Readonly<Record<string,string|undefined>>;
type Deps={now:()=>number;fetcher:typeof fetch};
type Slot={hourUtc:number;weekdaysUtc?:number[];workflow:string;inputs:Record<string,string>;props?:boolean;
 /** Stock PAPER worker slot: follows the reviewed stock release manifest's scheduledRunsEnabled. */
 stock?:boolean;
 /** A one-session research trial must not be dispatched on later days. */
 dateUtc?:string;
 /** Skip only when this workflow already succeeded since this UTC time today (HH:MM, the GitHub slot it backs up).
  * A rolling window is wrong here: GitHub often starts a slot many hours late, and a late run of yesterday's slot
  * must not suppress today's backup (2026-11-11: a 09:59 run on 10 Nov blocked the 04:00 backup on 11 Nov). */
 skipIfSucceededSinceUtc?:string};
const REPO='ang87505-crypto/SportsEdge';
const BASE='https://api.github.com/repos/'+REPO+'/actions/workflows/';
const TOKEN=/^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{30,64})$/;

/** Each Vercel cron fires once a day within its hour (Hobby precision is per hour). */
export const SCHEDULER_SLOTS:Record<string,Slot>={
 'props-settle-morning':{hourUtc:10,workflow:'props-daily.yml',inputs:{kind:'settle',cron:'20 9 * * *'},props:true},
 'props-settle-midday':{hourUtc:16,workflow:'props-daily.yml',inputs:{kind:'settle',cron:'20 15 * * *'},props:true},
 'props-collect-early':{hourUtc:20,workflow:'props-daily.yml',inputs:{kind:'collect',cron:'10 19 * * *'},props:true},
 'props-collect-late':{hourUtc:23,workflow:'props-daily.yml',inputs:{kind:'collect',cron:'10 22 * * *'},props:true},
 'research-collect':{hourUtc:4,weekdaysUtc:[2,3,4,5,6],workflow:'research-collect.yml',inputs:{},skipIfSucceededSinceUtc:'02:00'},
 'ops-monitor':{hourUtc:13,workflow:'ops-monitor.yml',inputs:{}},
 // Stock PAPER worker backups (weekdays). Execute hours sit inside 09:30 ET + 30 min to 16:00 ET - 20 min in both
 // offsets; the controller re-checks the exchange session, the owner gate and the same-day decision itself.
 'stock-execute-early':{hourUtc:15,weekdaysUtc:[1,2,3,4,5],workflow:'paper-auto-worker.yml',stock:true,
  inputs:{kind:'execute',experiment:'stock-v2-weekly-1',trigger:'backup'}},
 'stock-execute-midday':{hourUtc:16,weekdaysUtc:[1,2,3,4,5],workflow:'paper-auto-worker.yml',stock:true,
  inputs:{kind:'execute',experiment:'stock-v2-weekly-1',trigger:'backup'}},
 'stock-execute-late':{hourUtc:18,weekdaysUtc:[1,2,3,4,5],workflow:'paper-auto-worker.yml',stock:true,
  inputs:{kind:'execute',experiment:'stock-v2-weekly-1',trigger:'backup'}},
 'stock-monitor':{hourUtc:22,weekdaysUtc:[1,2,3,4,5],workflow:'paper-auto-worker.yml',stock:true,
  inputs:{kind:'monitor',experiment:'stock-v2-weekly-1',trigger:'backup'}},
 'daily-shadow-plan':{hourUtc:12,dateUtc:'2026-11-10',workflow:'daily-shadow-test.yml',inputs:{phase:'plan'}},
 'daily-shadow-grade':{hourUtc:0,dateUtc:'2026-11-11',workflow:'daily-shadow-test.yml',inputs:{phase:'grade'}},
};

const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,
 headers:{'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'}});

function authorized(req:Request,env:Env){
 const secret=env.CRON_SECRET??'',given=req.headers.get('authorization')??'',expected='Bearer '+secret;
 const a=Buffer.from(given),b=Buffer.from(expected);
 return secret.length>=32&&secret.length<=128&&a.length===b.length&&timingSafeEqual(a,b);
}

export async function handleSchedulerKickoff(req:Request,slotName:string,env:Env,deps:Deps):Promise<Response>{
 if(!authorized(req,env))return json({status:'unauthorized'},401);
 if(req.method!=='GET'||new URL(req.url).search)return json({status:'invalid_request'},400);
 if(env.VERCEL_ENV!=='production')return json({status:'production_only'},403);
 const slot=Object.hasOwn(SCHEDULER_SLOTS,slotName)?SCHEDULER_SLOTS[slotName]:null;
 if(!slot)return json({status:'unknown_slot'},404);
 const now=new Date(deps.now());
 // Only inside its own hour: a replayed or misrouted call cannot run a slot at another time.
 if(now.getUTCHours()!==slot.hourUtc||(slot.weekdaysUtc&&!slot.weekdaysUtc.includes(now.getUTCDay()))||
  (slot.dateUtc&&now.toISOString().slice(0,10)!==slot.dateUtc))
  return json({status:'skipped',reason:'outside_slot_hour',slot:slotName});
 if(slot.props&&(PROPS_RELEASE.scheduledRunsEnabled as boolean)!==true)return json({status:'skipped',reason:'props_schedule_off',slot:slotName});
 if(slot.stock&&(PAPER_AUTO_RELEASE.scheduledRunsEnabled as boolean)!==true)return json({status:'skipped',reason:'stock_schedule_off',slot:slotName});
 const token=env.SPORTSEDGE_GITHUB_DISPATCH_TOKEN??'';
 if(!TOKEN.test(token))return json({status:'dispatch_not_configured',slot:slotName},503);
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'sportsedge-scheduler'};
 if(slot.skipIfSucceededSinceUtc){
  const since=Date.parse(new Date(deps.now()).toISOString().slice(0,10)+'T'+slot.skipIfSucceededSinceUtc+':00Z');
  try{
   const r=await deps.fetcher(BASE+slot.workflow+'/runs?branch=main&status=success&per_page=5',
    {headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});
   if(r.ok){
    const body=await r.json() as {workflow_runs?:{created_at:string}[]};
    const done=(body.workflow_runs??[]).some(x=>Date.parse(x.created_at)>=since);
    if(done)return json({status:'skipped',reason:'already_succeeded_since_slot',slot:slotName});
   }
  }catch{/* Could not check: dispatching a duplicate of these jobs is harmless. */}
 }
 let res:Response;
 try{
  res=await deps.fetcher(BASE+slot.workflow+'/dispatches',{method:'POST',redirect:'error',cache:'no-store',
   headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:slot.inputs}),
   signal:AbortSignal.timeout(10_000)});
 }catch{return json({status:'dispatch_outcome_unknown',slot:slotName,workflow:slot.workflow},503);}
 if(res.status!==204)return json({status:res.status>=500||res.status===429?'dispatch_outcome_unknown':'dispatch_refused',
  slot:slotName,workflow:slot.workflow,httpStatus:res.status},503);
 return json({status:'dispatched',slot:slotName,workflow:slot.workflow},202);
}
