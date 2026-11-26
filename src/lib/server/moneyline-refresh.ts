/**
 * Once-daily NBA/EPL moneyline (h2h) refresh for the stored Sports AI board.
 *
 * Why: the dual-track collector was only ever run by hand through a DB-issued research_dispatch capability (runs 2-3
 * on 2026-10-30). Nothing scheduled it, so /api/sports kept serving Oct 30 quotes and listed no EPL fixtures once
 * the stored ones had started.
 *
 * Shape: this cron handler never reserves credits, calls the provider or writes odds. It makes one call to
 * research_refresh_slot_dispatch('moneyline-h2h-<UTC date>') (database/migrations/20261126_research_refresh_slots_v1.sql).
 * That function atomically claims today's slot and, in the same transaction, calls the existing research_dispatch(false).
 * The existing chain then runs unchanged:
 *   pg_net → /api/internal/research-cycle → research_claim (single-use, ten minutes) → research_reserve_credit
 *   (nba, soccer; 8 per 24 h / 240 per 30 d) → collector → research_finish with the per-sport receipt for that run id.
 * Overlapping or replayed firings for the same day get duplicate_slot and dispatch nothing. A dispatch that fails
 * rolls back and leaves the slot free; a committed dispatch spends the slot even if its run later fails, so one slot
 * can never reserve credits twice. Credits are only reserved inside a claimed run.
 *
 * Release switch: while scheduledRunsEnabled is false every firing exits before any network call. Turning it on needs
 * the owner's approval, the read-only contract check and the migration (docs/MONEYLINE_REFRESH_2026_11_26.md).
 * Rollback = set it back to false.
 */
import {timingSafeEqual} from 'node:crypto';
import {researchCycleEnvironmentReady} from './research-cycle-handler.ts';

/** NOT owner-approved. Flip to true only in a reviewed PR after the owner approves the daily schedule. */
export const MONEYLINE_REFRESH_RELEASE={scheduledRunsEnabled:false,paperOnly:true,realMoneyEnabled:false} as const;
/** 11:00 UTC: before EPL's earliest kickoffs (12:30 UTC) and the same night's NBA tip-offs (23:00-03:30 UTC).
 * No other Odds API job runs in this hour (props collect/ticks run 13:00-02:00 UTC). Must match vercel.json. */
export const MONEYLINE_REFRESH_SLOT={hourUtc:11,cron:'0 11 * * *',path:'/api/internal/moneyline-refresh'} as const;
export const slotKey=(now:Date)=>'moneyline-h2h-'+now.toISOString().slice(0,10);

type Env=Readonly<Record<string,string|undefined>>;
export type MoneylineRefreshDeps={
 now:()=>number;
 /** research_refresh_slot_dispatch RPC: atomic slot claim plus the existing research_dispatch(false). */
 dispatchSlot:(slot:string)=>Promise<unknown>;
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
 const slot=slotKey(now);
 let result:unknown;
 try{result=await deps.dispatchSlot(slot);}
 catch{
  // The call may still have committed (for example a client timeout). The slot then holds, and a later firing today
  // gets duplicate_slot, so nothing is retried here.
  return json({status:'dispatch_unverified',slot,reviewRequired:true,automaticRetry:false},503);
 }
 const r=(result&&typeof result==='object'&&!Array.isArray(result)?result:{}) as Record<string,unknown>;
 if(r.slot!==slot)return json({status:'dispatch_unverified',slot,reviewRequired:true,automaticRetry:false},503);
 if(r.status==='duplicate_slot')return json({status:'skipped',reason:'duplicate_slot',slot});
 if(r.status==='dispatched'&&typeof r.dispatch==='string')
  // The collection receipt is written by research-cycle under this run, not here.
  return json({status:'dispatched',slot,dispatch:r.dispatch,receipt:'research_runs summary for this dispatch',
   automaticBettingEnabled:false,realMoneyEnabled:false},202);
 return json({status:'dispatch_unverified',slot,reviewRequired:true,automaticRetry:false},503);
}
