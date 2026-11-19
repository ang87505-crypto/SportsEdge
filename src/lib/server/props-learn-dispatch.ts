/**
 * "Retrain now" for the props learning loop. SERVER ONLY. One fixed GitHub workflow_dispatch
 * (props-learn.yml, kind train, ref main); never retried, since a lost reply has an unknown outcome.
 * The token needs nothing beyond Actions read/write on this one repository.
 */
export const LEARN_DISPATCH_URL='https://api.github.com/repos/ang87505-crypto/SportsEdge/actions/workflows/props-learn.yml/dispatches';
const TOKEN=/^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{30,64})$/;
type Env=Readonly<Record<string,string|undefined>>;
export type LearnDispatch={result:'dispatched'}|{result:'not_configured'}|{result:'refused'|'unknown';code:string};
export type LearnDispatcher=(env:Env)=>Promise<LearnDispatch>;

export async function dispatchPropsLearn(env:Env,fetcher:typeof fetch=fetch):Promise<LearnDispatch>{
 const token=env.SPORTSEDGE_GITHUB_DISPATCH_TOKEN??'';
 if(!TOKEN.test(token))return {result:'not_configured'};
 let res:Response;
 try{
  res=await fetcher(LEARN_DISPATCH_URL,{method:'POST',redirect:'error',cache:'no-store',
   headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
    'Content-Type':'application/json','User-Agent':'sportsedge-props-learn'},
   body:JSON.stringify({ref:'main',inputs:{kind:'train'}}),signal:AbortSignal.timeout(10_000)});
 }catch{return {result:'unknown',code:'GITHUB_NETWORK'};}
 if(res.status===204)return {result:'dispatched'};
 return {result:res.status>=500||res.status===429?'unknown':'refused',code:`GITHUB_${res.status}`};
}
