/**
 * Once-daily NBA/EPL moneyline (h2h) refresh for the stored Sports AI board.
 *
 * Why: the dual-track collector (collect/odds-collector.ts) was only ever run by hand through a DB-issued
 * research_dispatch capability (runs 2-3 on 2026-10-30). Nothing scheduled it, so /api/sports kept serving
 * Oct 30 quotes and stopped listing EPL fixtures once the stored ones had started.
 *
 * Shape: a Vercel cron calls this once a day. It reuses, unchanged, the existing production pin
 * (researchCycleEnvironmentReady), the existing research_reserve_credit caps (8 requests / rolling 24 h,
 * 240 / rolling 30 d, two per run, counted even if the provider call fails) and the existing collector
 * (append-only snapshots, ON CONFLICT DO NOTHING). It never retries a provider call, creates no forecasts,
 * wagers, settlements or results, and calls no paid model.
 *
 * Release switch: while scheduledRunsEnabled is false every firing exits before any network call.
 * Turning it on is an owner decision (see docs/MONEYLINE_REFRESH_2026_11_26.md). Rollback = set it back to false.
 */
import {timingSafeEqual} from 'node:crypto';
import {researchCycleEnvironmentReady} from './research-cycle-handler.ts';

/** NOT owner-approved. Flip to true only in a reviewed PR after the owner approves the daily schedule. */
export const MONEYLINE_REFRESH_RELEASE={scheduledRunsEnabled:false,paperOnly:true,realMoneyEnabled:false} as const;
/** 11:00 UTC: before EPL's earliest kickoffs (12:30 UTC) and the same night's NBA tip-offs (23:00-03:30 UTC).
 * No other Odds API job runs in this hour (props collect/ticks run 13:00-02:00 UTC). Must match vercel.json. */
export const MONEYLINE_REFRESH_SLOT={hourUtc:11,cron:'0 11 * * *',path:'/api/internal/moneyline-refresh'} as const;
/** A second firing within this window is skipped without spending provider credits. */
export const MIN_HOURS_BETWEEN_REFRESHES=20;

type Env=Readonly<Record<string,string|undefined>>;
export type LatestH2h={observedAt:string|null;ingestedAt:string|null};
export type MoneylineRefreshDeps={
 now:()=>number;
 /** Read-only: newest stored h2h snapshot (provider observed_at and our ingested_at). */
 latestH2h:()=>Promise<LatestH2h>;
 /** Existing research_reserve_credit RPC. */
 reserve:(track:'nba'|'soccer')=>Promise<boolean>;
 /** Existing collectDualTracks(). */
 collect:()=>Promise<unknown>;
 /** Release flag, injectable only so tests can exercise the enabled path. */
 released?:boolean;
};

const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,
 headers:{'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'}});

function authorized(req:Request,env:Env){
 const secret=env.CRON_SECRET??'',given=req.headers.get('authorization')??'',expected='Bearer '+secret;
 const a=Buffer.from(given),b=Buffer.from(expected);
 return secret.length>=32&&secret.length<=128&&a.length===b.length&&timingSafeEqual(a,b);
}
const stamp=(v:string|null)=>v!==null&&Number.isFinite(Date.parse(v))?v:null;
/** Total oddsInserted across tracks in a collectDualTracks report, or null if the shape is not recognised. */
export function insertedCount(report:unknown):number|null{
 const tracks=(report as {tracks?:Record<string,{oddsInserted?:unknown}>}|null)?.tracks;
 if(!tracks||typeof tracks!=='object')return null;
 let n=0;
 for(const t of Object.values(tracks)){if(!Number.isSafeInteger(t?.oddsInserted))return null;n+=t.oddsInserted as number;}
 return n;
}

export async function handleMoneylineRefresh(req:Request,env:Env,deps:MoneylineRefreshDeps):Promise<Response>{
 if(!authorized(req,env))return json({status:'unauthorized'},401);
 if(req.method!=='GET'||new URL(req.url).search)return json({status:'invalid_request'},400);
 if(env.VERCEL_ENV!=='production')return json({status:'production_only'},403);
 const now=new Date(deps.now());
 // Only inside its own hour: a replayed or misrouted call cannot run at another time.
 if(now.getUTCHours()!==MONEYLINE_REFRESH_SLOT.hourUtc)return json({status:'skipped',reason:'outside_slot_hour'});
 if((deps.released??(MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled as boolean))!==true)
  return json({status:'skipped',reason:'moneyline_schedule_off'});
 if(!researchCycleEnvironmentReady(env))return json({status:'not_configured'},503);
 let reserved=false;
 try{
  const before=await deps.latestH2h();
  const last=stamp(before.ingestedAt);
  if(last&&now.getTime()-Date.parse(last)<MIN_HOURS_BETWEEN_REFRESHES*3_600_000)
   return json({status:'skipped',reason:'already_refreshed',latestIngestedAt:last});
  // Same order and caps as the DB-dispatched research-cycle run. Never retried here.
  const nba=await deps.reserve('nba');
  reserved=nba;
  if(!nba||!await deps.reserve('soccer'))return json({status:'quota_blocked',creditsReserved:reserved,automaticRetry:false},429);
  reserved=true;
  const report=await deps.collect();
  // Receipt read back from the database, not taken from the collector's own counts.
  const after=await deps.latestH2h();
  const saved=stamp(after.ingestedAt);
  const savedThisRun=saved!==null&&Date.parse(saved)>=now.getTime()-60_000;
  const inserted=insertedCount(report);
  // The collector says it wrote rows but the database shows none from this run: do not call it refreshed.
  const status=savedThisRun?'refreshed':inserted===0?'no_new_quotes':'refresh_unverified';
  return json({status,report,receipt:{before,after,savedThisRun,collectorInserted:inserted},
   automaticBettingEnabled:false,realMoneyEnabled:false},status==='refresh_unverified'?503:200);
 }catch{
  // Provider URLs carry the API key: never return or log thrown messages.
  return json({status:'refresh_unverified',creditsReserved:reserved,reviewRequired:true,automaticRetry:false},503);
 }
}
