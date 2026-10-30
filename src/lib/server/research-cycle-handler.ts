import {createHash} from 'node:crypto';

type Claim={id:number;probe:boolean};
type Summary=Record<string,unknown>;
export type ResearchCycleDependencies={
  enabled:boolean;
  claim:(id:number,hash:string)=>Promise<Claim|null>;
  finish:(id:number,status:'completed'|'failed',summary:Summary)=>Promise<unknown>;
  reserve:(track:'nba'|'soccer')=>Promise<boolean>;
  probe:()=>Promise<unknown>;
  collect:()=>Promise<unknown>;
};

/** This endpoint consumes existing, short-lived DB-issued capabilities. It does
 * not accept owner keys, browser quotes, model parameters, or wager requests. */
export function researchCycleEnvironmentReady(env:Record<string,string|undefined>){
  if(env.VERCEL_ENV!=='production'||env.SPORTSEDGE_PREVIEW_FIXTURES==='1'||
     env.SUPABASE_READONLY_KEY||!env.ODDS_API_KEY||
     !(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY))return false;
  try{
    const url=new URL(env.SUPABASE_URL??'');
    return url.origin==='https://fzyjazhvkstvwwzjhlrr.supabase.co'&&
      url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password;
  }catch{return false;}
}

const headers={'Cache-Control':'private, no-store, max-age=0',
  'Pragma':'no-cache','X-Content-Type-Options':'nosniff'};
const json=(body:Summary,status=200)=>Response.json(body,{status,headers});

async function readRunId(request:Request){
  if(!request.body)throw Error('INVALID_BODY');
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let length=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>80){await reader.cancel();throw Error('INVALID_BODY');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);
  let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_BODY');
  const body=value as Record<string,unknown>;
  if(Object.keys(body).length!==1||!Number.isSafeInteger(body.runId)||
     (body.runId as number)<1)throw Error('INVALID_BODY');
  return body.runId as number;
}

export async function handleResearchCycle(request:Request,deps:ResearchCycleDependencies){
  if(!deps.enabled||request.method!=='POST')return json({status:'not_found'},404);
  const auth=request.headers.get('authorization')??'';
  if(!/^Bearer [a-f0-9]{64}$/.test(auth))return json({status:'not_found'},404);
  if(new URL(request.url).search||
     request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')
    return json({status:'invalid_request'},400);
  let runId:number;
  try{runId=await readRunId(request);}
  catch{return json({status:'invalid_request'},400);}
  let claimed=false;
  try{
    const hash=createHash('sha256').update(auth.slice(7)).digest('hex');
    // research_claim atomically accepts only a queued run younger than 10 min.
    const run=await deps.claim(runId,hash);
    if(!run||run.id!==runId||typeof run.probe!=='boolean')
      return json({status:'not_found'},404);
    claimed=true;
    if(run.probe){
      const report=await deps.probe();
      const summary={status:'connected',mode:'READ_ONLY_PROBE',report};
      await deps.finish(runId,'completed',summary);
      return json({...summary,runId});
    }
    // Conservative reservations count against the existing 8/24h, 240/30d
    // caps even if an upstream request fails. Never retry a provider here.
    if(!await deps.reserve('nba')||!await deps.reserve('soccer')){
      const summary={status:'quota_blocked',automaticRetry:false};
      await deps.finish(runId,'failed',summary);
      return json({...summary,runId},429);
    }
    const report=await deps.collect();
    const summary={status:'refreshed',report,automaticBettingEnabled:false,
      realMoneyEnabled:false};
    await deps.finish(runId,'completed',summary);
    return json({...summary,runId});
  }catch{
    const summary={status:'refresh_unverified',reviewRequired:true,
      automaticRetry:false,realMoneyEnabled:false};
    if(claimed){try{await deps.finish(runId,'failed',summary);}catch{/* audit lookup required */}}
    // Provider URLs can carry secrets. Do not return/log thrown messages.
    return json({...summary,runId},503);
  }
}
