/** Backup scheduler for jobs GitHub's own schedule often starts hours late or drops.
 * Called by daily Vercel crons (one per slot, an hour after the GitHub slot). It only dispatches fixed,
 * idempotent workflows: props runs carry their scheduled slot, so the database records a second start as
 * DUPLICATE. It never arms a gate, places an order, changes a control or calls a paid model.
 */
import {timingSafeEqual} from 'node:crypto';
import {PROPS_RELEASE} from '../props/schedule.ts';

type Env=Readonly<Record<string,string|undefined>>;
type Deps={now:()=>number;fetcher:typeof fetch};
type Slot={hourUtc:number;weekdaysUtc?:number[];workflow:string;inputs:Record<string,string>;props?:boolean;
 /** A one-session research trial must not be dispatched on later days. */
 dateUtc?:string;
 /** Skip when this workflow already succeeded this recently (non-props jobs without slot keys). */
 skipIfSucceededWithinHours?:number};
const REPO='ang87505-crypto/SportsEdge';
const BASE='https://api.github.com/repos/'+REPO+'/actions/workflows/';
const TOKEN=/^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{30,64})$/;

/** Each Vercel cron fires once a day within its hour (Hobby precision is per hour). */
export const SCHEDULER_SLOTS:Record<string,Slot>={
 'props-settle-morning':{hourUtc:10,workflow:'props-daily.yml',inputs:{kind:'settle',cron:'20 9 * * *'},props:true},
 'props-settle-midday':{hourUtc:16,workflow:'props-daily.yml',inputs:{kind:'settle',cron:'20 15 * * *'},props:true},
 'props-collect-early':{hourUtc:20,workflow:'props-daily.yml',inputs:{kind:'collect',cron:'10 19 * * *'},props:true},
 'props-collect-late':{hourUtc:23,workflow:'props-daily.yml',inputs:{kind:'collect',cron:'10 22 * * *'},props:true},
 'research-collect':{hourUtc:4,weekdaysUtc:[2,3,4,5,6],workflow:'research-collect.yml',inputs:{},skipIfSucceededWithinHours:20},
 'ops-monitor':{hourUtc:13,workflow:'ops-monitor.yml',inputs:{}},
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
 const token=env.SPORTSEDGE_GITHUB_DISPATCH_TOKEN??'';
 if(!TOKEN.test(token))return json({status:'dispatch_not_configured',slot:slotName},503);
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'sportsedge-scheduler'};
 if(slot.skipIfSucceededWithinHours){
  try{
   const r=await deps.fetcher(BASE+slot.workflow+'/runs?branch=main&status=success&per_page=5',
    {headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});
   if(r.ok){
    const body=await r.json() as {workflow_runs?:{created_at:string}[]};
    const recent=(body.workflow_runs??[]).some(x=>deps.now()-Date.parse(x.created_at)<slot.skipIfSucceededWithinHours!*3600_000);
    if(recent)return json({status:'skipped',reason:'already_succeeded_recently',slot:slotName});
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
