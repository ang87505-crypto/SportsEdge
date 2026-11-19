/**
 * Dispatch one fixed workflow on main for a Vercel cron (scheduler-kickoff.ts, paper-auto-kickoff.ts).
 *
 * Independence: on a public repository GitHub disables scheduled workflows after 60 days without repository
 * activity (state `disabled_inactivity`), and a disabled workflow also refuses dispatches. Left alone, every GitHub
 * schedule and every Vercel backup would stop together, silently, once development pauses. When a dispatch is
 * refused, this reads the workflow's state and, ONLY for `disabled_inactivity`, re-enables it and dispatches once
 * more. A workflow the owner disabled (`disabled_manually`) is never touched. The token is the existing
 * SPORTSEDGE_GITHUB_DISPATCH_TOKEN (Actions: write on this repository); nothing else is changed.
 */
const BASE='https://api.github.com/repos/ang87505-crypto/SportsEdge/actions/workflows/';
const WORKFLOW=/^[a-z0-9-]{1,60}\.yml$/;

export type DispatchResult={status:'dispatched'|'dispatch_refused'|'dispatch_outcome_unknown';httpStatus?:number;
 reenabled?:boolean;workflowState?:string};

export async function dispatchWorkflow(fetcher:typeof fetch,token:string,workflow:string,inputs:Record<string,string>,
 userAgent:string):Promise<DispatchResult>{
 if(!WORKFLOW.test(workflow))return {status:'dispatch_refused'};
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':userAgent};
 const opts={redirect:'error' as const,cache:'no-store' as const};
 const post=()=>fetcher(BASE+workflow+'/dispatches',{...opts,method:'POST',headers:{...headers,'Content-Type':'application/json'},
  body:JSON.stringify({ref:'main',inputs}),signal:AbortSignal.timeout(10_000)});
 const verdict=(res:Response,extra:Partial<DispatchResult>={}):DispatchResult=>res.status===204?{status:'dispatched',...extra}:
  {status:res.status>=500||res.status===429?'dispatch_outcome_unknown':'dispatch_refused',httpStatus:res.status,...extra};
 let res:Response;
 try{res=await post();}catch{return {status:'dispatch_outcome_unknown'};}
 // Only a definite refusal (not auth, not rate limit, not a server error) can be a disabled workflow.
 if(res.status===204||res.status===401||res.status===429||res.status>=500)return verdict(res);
 let state:string|undefined;
 try{
  const w=await fetcher(BASE+workflow,{...opts,method:'GET',headers,signal:AbortSignal.timeout(10_000)});
  if(w.ok)state=String(((await w.json()) as {state?:unknown}).state??'');
 }catch{/* state unknown: report the original refusal */}
 if(state!=='disabled_inactivity')return verdict(res,state?{workflowState:state}:{});
 try{
  const en=await fetcher(BASE+workflow+'/enable',{...opts,method:'PUT',headers,signal:AbortSignal.timeout(10_000)});
  if(en.status!==204)return verdict(res,{workflowState:state});
 }catch{return verdict(res,{workflowState:state});}
 // The original POST was a definite refusal, so this one dispatch cannot double-run the job.
 try{res=await post();}catch{return {status:'dispatch_outcome_unknown',reenabled:true,workflowState:state};}
 return verdict(res,{reenabled:true,workflowState:state});
}
