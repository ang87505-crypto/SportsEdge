/**
 * Request-budget planning for The Odds API player-prop collection (pure).
 *
 * Documented cost rules (the-odds-api.com/liveapi/guides/v4, read 2026-11-07):
 *  - event odds: cost = [unique markets returned] x [regions]; bookmakers within
 *    one region count as that one region.
 *  - events list: documented as costing 1 when events are returned (counted as 1).
 * Reservations are made for the WORST case (all requested markets returned) and
 * are never refunded, including failed or empty requests.
 *
 * Coordination: the existing NBA/EPL moneyline refresh has its own DB cap
 * (8 requests/24h, 240/30 days). Props get an independent cap AND must leave a
 * floor of provider credits (x-requests-remaining) for that refresh.
 */
import {STATS} from './contract.ts';

export type BudgetPolicy={
 version:string;
 dailyCredits:number;      // rolling 24h
 monthlyCredits:number;    // rolling 30 days
 providerFloor:number;     // never let x-requests-remaining drop below this
 maxEventsPerRun:number;
};
/** v1 defaults: 240 (existing) + 200 (props) <= 500 credits/month (plan size unverified). */
export const BUDGET_POLICY_V1:BudgetPolicy={
 version:'props-budget-v1',dailyCredits:12,monthlyCredits:200,providerFloor:60,maxEventsPerRun:3};
/**
 * v2 (owner-approved 2026-11-07): sustainable inside the same 200/30-day share.
 * One collect prices at most 2 games: 1 (event list, reserved conservatively) + 2 x 3 = 7
 * credits per rolling 24 h, about 200 per 30 days. The database row
 * (database/props/props_budget_v2.sql) is authoritative; this copy only plans requests.
 */
export const BUDGET_POLICY_V2:BudgetPolicy={
 version:'props-budget-v2',dailyCredits:7,monthlyCredits:200,providerFloor:60,maxEventsPerRun:2};
/** The policy the worker plans with; must match the newest active props_budget_policy row. */
export const ACTIVE_BUDGET_POLICY=BUDGET_POLICY_V2;

export const EVENTS_LIST_COST=1;
export const MARKETS_PER_EVENT=STATS.length;
export const REGIONS_PER_REQUEST=1;
export const eventOddsWorstCost=(markets=MARKETS_PER_EVENT,regions=REGIONS_PER_REQUEST)=>{
 if(!Number.isSafeInteger(markets)||!Number.isSafeInteger(regions)||markets<1||regions<1)throw new Error('PROPS_BAD_COST_INPUT');
 return markets*regions;
};

export type BudgetState={
 used24h:number;used30d:number;
 /** Last provider-reported x-requests-remaining, or null when never observed. */
 providerRemaining:number|null;
};
export type BudgetDecision={allowed:boolean;reason:'OK'|'DAILY_CAP'|'MONTHLY_CAP'|'PROVIDER_FLOOR'|'INVALID'};

export function canSpend(policy:BudgetPolicy,state:BudgetState,credits:number):BudgetDecision{
 const ints=[state.used24h,state.used30d,credits].every(n=>Number.isSafeInteger(n)&&n>=0);
 if(!ints||credits<1||(state.providerRemaining!==null&&!Number.isSafeInteger(state.providerRemaining)))
  return {allowed:false,reason:'INVALID'};
 if(state.used24h+credits>policy.dailyCredits)return {allowed:false,reason:'DAILY_CAP'};
 if(state.used30d+credits>policy.monthlyCredits)return {allowed:false,reason:'MONTHLY_CAP'};
 if(state.providerRemaining!==null&&state.providerRemaining-credits<policy.providerFloor)
  return {allowed:false,reason:'PROVIDER_FLOOR'};
 return {allowed:true,reason:'OK'};
}

/**
 * Choose which listed events to price in this run: earliest first, starting
 * after the lock buffer and within the horizon, not already collected, and
 * only as many as the remaining budget covers. Never forces a quota.
 */
export function chooseEvents<T extends {id:string;commenceTime:string}>(input:{
 events:T[];alreadyCollected:Set<string>;nowIso:string;lockBufferMs:number;horizonMs:number;
 policy:BudgetPolicy;state:BudgetState;
}):{chosen:T[];skipped:{id:string;reason:'collected'|'too_soon'|'beyond_horizon'|'budget'}[]}{
 const now=Date.parse(input.nowIso);
 if(!Number.isFinite(now))throw new Error('PROPS_INVALID_CLOCK');
 const per=eventOddsWorstCost();
 const chosen:T[]=[];const skipped:{id:string;reason:'collected'|'too_soon'|'beyond_horizon'|'budget'}[]=[];
 let spent=0;
 for(const e of [...input.events].sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.id.localeCompare(b.id))){
  const start=Date.parse(e.commenceTime);
  if(input.alreadyCollected.has(e.id)){skipped.push({id:e.id,reason:'collected'});continue;}
  if(start-now<=input.lockBufferMs){skipped.push({id:e.id,reason:'too_soon'});continue;}
  if(start-now>input.horizonMs){skipped.push({id:e.id,reason:'beyond_horizon'});continue;}
  const next={used24h:input.state.used24h+spent,used30d:input.state.used30d+spent,
   providerRemaining:input.state.providerRemaining===null?null:input.state.providerRemaining-spent};
  if(chosen.length>=input.policy.maxEventsPerRun||!canSpend(input.policy,next,per).allowed){
   skipped.push({id:e.id,reason:'budget'});continue;
  }
  chosen.push(e);spent+=per;
 }
 return {chosen,skipped};
}

/** Parse provider usage headers; malformed values are treated as unknown (null). */
export function providerUsage(headers:{get(name:string):string|null}){
 const n=(k:string)=>{const v=headers.get(k);if(v===null||!/^\d{1,9}$/.test(v.trim()))return null;return Number(v.trim());};
 return {remaining:n('x-requests-remaining'),used:n('x-requests-used'),last:n('x-requests-last')};
}
