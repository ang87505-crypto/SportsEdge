/**
 * Owner "Start" for the recurring PAPER autopilot. SERVER ONLY.
 * Triggers the owner-only GitHub workflow action `resume` (paper-auto-owner.yml), which runs a
 * fresh reconcile and then the database's own resume against that exact run. This module never
 * contacts a broker and never changes the gate itself: the database decides, with every check.
 * Repository, workflow, ref and inputs are fixed here. The only caller input is an experiment id
 * the owner API has already matched against the configured list. The token needs nothing beyond
 * Actions read/write on this one repository.
 */
const DISPATCH_URL='https://api.github.com/repos/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-owner.yml/dispatches';
export const START_WORKFLOW_PAGE='https://github.com/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-owner.yml';
const TOKEN=/^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{30,64})$/;

type Env=Readonly<Record<string,string|undefined>>;
export type StartOutcome={result:'dispatched'}|{result:'not_configured'}|
 {result:'refused'|'unknown';code:string};
export type Dispatcher=(experimentId:string,env:Env)=>Promise<StartOutcome>;

export function startConfigured(env:Env):boolean{
 return TOKEN.test(env.SPORTSEDGE_GITHUB_DISPATCH_TOKEN??'');
}

/** One workflow_dispatch request; never retried (a lost reply is reported as unknown). */
export async function dispatchOwnerResume(experimentId:string,env:Env,fetcher:typeof fetch=fetch)
 :Promise<StartOutcome>{
 const token=env.SPORTSEDGE_GITHUB_DISPATCH_TOKEN??'';
 if(!TOKEN.test(token))return {result:'not_configured'};
 if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(experimentId))return {result:'refused',code:'INVALID_EXPERIMENT'};
 let res:Response;
 try{
  res=await fetcher(DISPATCH_URL,{method:'POST',redirect:'error',cache:'no-store',
   headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'sportsedge-autopilot'},
   body:JSON.stringify({ref:'main',inputs:{action:'resume',experiment:experimentId}}),
   signal:AbortSignal.timeout(10_000)});
 }catch{return {result:'unknown',code:'GITHUB_NETWORK'};}
 if(res.status===204)return {result:'dispatched'};
 return {result:res.status>=500||res.status===429?'unknown':'refused',code:`GITHUB_${res.status}`};
}
