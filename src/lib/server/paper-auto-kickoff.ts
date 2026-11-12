/** Authenticated early kickoff. Dispatches fixed paper workflows; never arms or trades. */
import {timingSafeEqual} from 'node:crypto';
import {nyDate,nyMinutes} from './paper-auto-time.ts';
import {PAPER_AUTO_RELEASE} from '../stocks/paper-auto-release.ts';
import {dispatchWorkflow} from './github-dispatch.ts';

type Env=Readonly<Record<string,string|undefined>>;
type Deps={now:()=>number;fetcher:typeof fetch;sportsReady:()=>Promise<boolean>};
const TOKEN=/^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{30,64})$/;
const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,
 headers:{'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'}});

export async function handlePaperKickoff(req:Request,env:Env,deps:Deps):Promise<Response>{
 const secret=env.CRON_SECRET??'',given=req.headers.get('authorization')??'';
 const expected='Bearer '+secret;
 const authBytes=Buffer.from(given),expectedBytes=Buffer.from(expected);
 if(secret.length<32||secret.length>128||given.length!==expected.length||
  authBytes.length!==expectedBytes.length||!timingSafeEqual(authBytes,expectedBytes))return json({status:'unauthorized'},401);
 if(req.method!=='GET'||new URL(req.url).search)return json({status:'invalid_request'},400);
 if(env.VERCEL_ENV!=='production')return json({status:'production_only'},403);
 if(!PAPER_AUTO_RELEASE.paperOnly||PAPER_AUTO_RELEASE.realMoneyEnabled)return json({status:'release_invalid'},503);
 const now=deps.now(),date=nyDate(now),minutes=nyMinutes(now);
 const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(now);
 let workflow:string,inputs:Record<string,string>;
 if(['Mon','Tue','Wed','Thu','Fri'].includes(day)){
  if(!PAPER_AUTO_RELEASE.scheduledRunsEnabled)return json({status:'skipped',reason:'stock_schedule_off'});
  // The 09:00 UTC daily cron has at least two hours of headroom in both NY offsets.
  // The bridge retains its exact 08:00 decision rule. Late kickoffs never catch up.
  if(minutes<3*60||minutes>=7*60+45)return json({status:'skipped',reason:'outside_early_window',session:date});
  workflow='paper-auto-decision-weekly.yml';
  inputs={experiment:'stock-v2-weekly-1',session:date,initial:'false'};
 }else if(date==='2026-11-08'&&minutes>=3*60&&minutes<11*60){
  // One-time owner-requested release validation. No collect/backfill, odds credits,
  // control change, or schedule enablement. Settlement still respects the ledger's
  // own pause/stop, duplicate, final-score and payout rules inside the worker.
  let ready=false;
  try{ready=await deps.sportsReady();}catch{return json({status:'sports_ledger_unavailable'},503);}
  if(!ready)return json({status:'skipped',reason:'sports_validation_not_ready'});
  workflow='props-daily.yml';inputs={kind:'settle'};
 }else return json({status:'skipped',reason:'no_kickoff_today',session:date});
 const token=env.SPORTSEDGE_GITHUB_DISPATCH_TOKEN??'';
 if(!TOKEN.test(token))return json({status:'dispatch_not_configured'},503);
 const r=await dispatchWorkflow(deps.fetcher,token,workflow,inputs,'sportsedge-paper-kickoff');
 const extra={...(r.reenabled?{reenabled:true}:{}),...(r.workflowState?{workflowState:r.workflowState}:{})};
 if(r.status!=='dispatched')return json({status:r.status,workflow,...(r.httpStatus?{httpStatus:r.httpStatus}:{}),session:date,...extra},503);
 return json({status:'dispatched',workflow,session:date,...extra},202);
}
