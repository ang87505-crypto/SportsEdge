/**
 * props-capture-v1: event-aware capture plan for NBA player-prop PAPER lines (pure; no I/O, no wall clock).
 *
 * Replaces fixed collect slots with frequent, idempotent "ticks". Each tick reads the free events list,
 * plans each NBA slate once (before any of its lines are seen), and captures a selected game only while
 * that game's own capture window is open. A late or duplicated tick therefore cannot spend on a game that
 * has started, and lateness of the scheduler no longer matters as long as some tick lands in the window.
 *
 * Research design (pre-registered by this file; see docs/PROPS_COLLECTION_TIMING_2026_11_10.md):
 *  - Which games: games in a slate are ranked by a salted hash of the provider event id (outcome-blind) and
 *    the top N are selected, N sized to the budget (never to a pick quota).
 *  - When: each slate is assigned EARLY or LATE by a salted hash of its date (blocked by slate, so every
 *    virtual entry is single-arm). EARLY = 8 to 4 hours before tip-off; LATE = 3 hours to 35 minutes before.
 *    (Our only availability evidence is lines present 6 h before tip; an empty attempt still reserves 3 credits.)
 *    An EARLY game whose window is missed falls back to the LATE window and stays labelled EARLY (intention
 *    to treat); the analysis also reports the window actually used.
 *  - Plans are written before the first capture and never edited, so no decision changes after results.
 */
import {createHash} from 'node:crypto';
import {canSpend,type BudgetPolicy,type BudgetState} from './budget.ts';

export const CAPTURE_PLAN_V1={
 version:'props-capture-v1',
 salt:'props-capture-v1:2026-11-10',
 /** Worst case for one event-odds request: 3 markets x 1 region (events list is free). */
 creditsPerGame:3,
 maxGamesPerSlate:6,
 /** Share of slates assigned to the EARLY arm. */
 earlyShare:0.5,
 /** Minutes before tip-off: [from, to). */
 windows:{early:{fromMin:480,toMin:240},late:{fromMin:180,toMin:35},recheck:{fromMin:75,toMin:35}},
 /** A slate (ET date D) is planned once the events window (now + 36 h) reaches D+1 08:00 UTC. */
 eventsHorizonHours:36,
 /** A retry after a capture that found no PrizePicks/Pick6 lines waits at least this long. */
 retryAfterMin:60,
 /** A recheck (closing observation) needs at least this much time since the primary capture. */
 recheckMinGapMin:120,
} as const;
export type CaptureConfig=typeof CAPTURE_PLAN_V1;
export type Arm='early'|'late';
export type CaptureKey='primary'|'retry'|'recheck';

export type PlanEvent={id:string;commenceTime:string;homeTeam:string;awayTeam:string};
export type PlanRow={plan_version:string;slate_date:string;provider_event_id:string;home_team:string;away_team:string;
 commence_time:string;selected:boolean;selection_rank:number;arm:Arm|null;reason:string;planned_at?:string};
/** A claimed capture and its outcome (null while unknown: a claim without an outcome is never retried). */
export type CaptureRow={provider_event_id:string;capture_key:CaptureKey;window_name:Arm;claimed_at:string;
 outcome:string|null;dfs_lines:number|null};

const MIN=60_000;
const etFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
/** NBA slates are ET calendar days (an 11 pm ET tip-off is 03:00-04:00 UTC the next day). */
export const slateDateOf=(iso:string)=>etFmt.format(new Date(iso));
export function hashUnit(salt:string,key:string){
 return parseInt(createHash('sha256').update(salt+'|'+key,'utf8').digest('hex').slice(0,12),16)/2**48;
}
export function captureWindows(commenceTime:string,cfg:CaptureConfig=CAPTURE_PLAN_V1){
 const tip=Date.parse(commenceTime);
 const at=(m:number)=>new Date(tip-m*MIN).toISOString();
 return {earlyFrom:at(cfg.windows.early.fromMin),earlyTo:at(cfg.windows.early.toMin),
  lateFrom:at(cfg.windows.late.fromMin),lateTo:at(cfg.windows.late.toMin),
  recheckFrom:at(cfg.windows.recheck.fromMin),recheckTo:at(cfg.windows.recheck.toMin)};
}
/** Games per slate the budget sustains: the daily cap and the 30-day cap paced per day, whichever is lower. */
export function gamesPerSlate(policy:BudgetPolicy,cfg:CaptureConfig=CAPTURE_PLAN_V1){
 const perDay=Math.min(policy.dailyCredits,Math.floor(policy.monthlyCredits/30));
 return Math.max(0,Math.min(cfg.maxGamesPerSlate,Math.floor(perDay/cfg.creditsPerGame)));
}
export const slateArm=(slate:string,cfg:CaptureConfig=CAPTURE_PLAN_V1):Arm=>hashUnit(cfg.salt,'arm:'+slate)<cfg.earlyShare?'early':'late';
/** True once the events window is guaranteed to contain the whole slate (latest tip-offs ~04:00-05:00 UTC). */
export function slateFullyVisible(slate:string,nowIso:string,cfg:CaptureConfig=CAPTURE_PLAN_V1){
 const end=Date.parse(slate+'T00:00:00Z')+32*3600_000;  // D+1 08:00 UTC
 return Date.parse(nowIso)+cfg.eventsHorizonHours*3600_000>=end;
}

/**
 * Plan rows for slates seen for the first time. Existing slates are never re-planned; a game that appears
 * after its slate was planned is recorded as not selected. Selection ignores lines, players and odds.
 */
export function planSlates(input:{events:PlanEvent[];existing:PlanRow[];nowIso:string;policy:BudgetPolicy;cfg?:CaptureConfig}):PlanRow[]{
 const cfg=input.cfg??CAPTURE_PLAN_V1;const now=Date.parse(input.nowIso);
 if(!Number.isFinite(now))throw new Error('PROPS_INVALID_CLOCK');
 const planned=new Set(input.existing.filter(p=>p.plan_version===cfg.version).map(p=>p.provider_event_id));
 const plannedSlates=new Set(input.existing.filter(p=>p.plan_version===cfg.version).map(p=>p.slate_date));
 const bySlate=new Map<string,PlanEvent[]>();
 for(const e of input.events){
  if(planned.has(e.id)||!(Date.parse(e.commenceTime)>now))continue;
  const s=slateDateOf(e.commenceTime);bySlate.set(s,[...(bySlate.get(s)??[]),e]);
 }
 const n=gamesPerSlate(input.policy,cfg);
 const out:PlanRow[]=[];
 for(const [slate,games] of [...bySlate.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
  const base=(e:PlanEvent)=>({plan_version:cfg.version,slate_date:slate,provider_event_id:e.id,home_team:e.homeTeam,away_team:e.awayTeam,
   commence_time:new Date(Date.parse(e.commenceTime)).toISOString()});
  if(plannedSlates.has(slate)){
   for(const e of games)out.push({...base(e),selected:false,selection_rank:1,arm:null,reason:'added_after_plan'});
   continue;
  }
  if(!slateFullyVisible(slate,input.nowIso,cfg))continue;
  const arm=slateArm(slate,cfg);
  // A game whose last capture opportunity has passed cannot be selected (no spend on started games).
  const open=(e:PlanEvent)=>Date.parse(e.commenceTime)-now>cfg.windows.late.toMin*MIN;
  const ranked=[...games].sort((a,b)=>hashUnit(cfg.salt,'select:'+a.id)-hashUnit(cfg.salt,'select:'+b.id)||a.id.localeCompare(b.id));
  let chosen=0;
  ranked.forEach((e,i)=>{
   if(!open(e)){out.push({...base(e),selected:false,selection_rank:i+1,arm:null,reason:'too_close_when_planned'});return;}
   if(chosen>=n){out.push({...base(e),selected:false,selection_rank:i+1,arm:null,reason:n===0?'no_budget_for_games':'budget_games_per_slate'});return;}
   chosen++;out.push({...base(e),selected:true,selection_rank:i+1,arm,reason:'selected_by_hash'});
  });
 }
 return out;
}

export type DueCapture={plan:PlanRow;captureKey:CaptureKey;window:Arm;fallback:boolean};
export type CaptureState='NOT_SELECTED'|'WAITING_FOR_WINDOW'|'DUE'|'CAPTURED'|'NO_LINES_FOUND'|'ATTEMPT_UNRESOLVED'|'MISSED'|'BUDGET_REFUSED'|'FAILED';

const inWin=(now:number,from:string,to:string)=>now>=Date.parse(from)&&now<Date.parse(to);
const RETRYABLE=new Set(['no_dfs_lines','budget_refused']);

/** State of one planned game at `nowIso` (for receipts and the dashboard). Pure. */
export function captureState(plan:PlanRow,captures:CaptureRow[],nowIso:string,cfg:CaptureConfig=CAPTURE_PLAN_V1):CaptureState{
 if(!plan.selected)return 'NOT_SELECTED';
 const now=Date.parse(nowIso);const w=captureWindows(plan.commence_time,cfg);
 const mine=captures.filter(c=>c.provider_event_id===plan.provider_event_id&&c.capture_key!=='recheck')
  .sort((a,b)=>b.claimed_at.localeCompare(a.claimed_at));
 const ok=mine.find(c=>c.outcome==='stored');
 if(ok)return 'CAPTURED';
 const last=mine[0];
 const closed=now>=Date.parse(w.lateTo);
 if(last&&last.outcome===null)return 'ATTEMPT_UNRESOLVED';
 if(last&&!RETRYABLE.has(last.outcome!))return 'FAILED';
 if(closed)return last?(last.outcome==='no_dfs_lines'?'NO_LINES_FOUND':'BUDGET_REFUSED'):'MISSED';
 const due=(plan.arm==='early'&&inWin(now,w.earlyFrom,w.earlyTo))||inWin(now,w.lateFrom,w.lateTo);
 if(last)return due?'DUE':(last.outcome==='no_dfs_lines'?'NO_LINES_FOUND':'BUDGET_REFUSED');
 return due?'DUE':'WAITING_FOR_WINDOW';
}

/**
 * Captures a tick should attempt now, in priority order, within the budget. Primaries are ordered by
 * deadline; a retry (after no PrizePicks/Pick6 lines, or a budget refusal before any call) waits and only
 * uses credits not needed by another selected game's primary in the next 24 hours; a recheck (closing
 * observation of an EARLY capture) uses only credits left after every pending primary and retry.
 */
export function dueCaptures(input:{plans:PlanRow[];captures:CaptureRow[];nowIso:string;policy:BudgetPolicy;state:BudgetState;cfg?:CaptureConfig}):
 {due:DueCapture[];deferred:{event:string;captureKey:CaptureKey;reason:string}[]}{
 const cfg=input.cfg??CAPTURE_PLAN_V1;const now=Date.parse(input.nowIso);
 if(!Number.isFinite(now))throw new Error('PROPS_INVALID_CLOCK');
 const sel=input.plans.filter(p=>p.selected&&p.plan_version===cfg.version&&Date.parse(p.commence_time)-now>cfg.windows.late.toMin*MIN);
 const caps=(id:string)=>input.captures.filter(c=>c.provider_event_id===id);
 const prim:DueCapture[]=[],retry:DueCapture[]=[],recheck:DueCapture[]=[];
 let pendingPrimaries=0;
 for(const p of sel){
  const w=captureWindows(p.commence_time,cfg);const mine=caps(p.provider_event_id);
  const primary=mine.find(c=>c.capture_key==='primary');const again=mine.find(c=>c.capture_key==='retry');
  const inEarly=p.arm==='early'&&inWin(now,w.earlyFrom,w.earlyTo),inLate=inWin(now,w.lateFrom,w.lateTo);
  if(!primary){
   if(Date.parse(p.commence_time)-now<=24*3600_000)pendingPrimaries++;
   if(inEarly||inLate)prim.push({plan:p,captureKey:'primary',window:inEarly?'early':'late',fallback:p.arm==='early'&&!inEarly});
   continue;
  }
  if(primary.outcome===null)continue;  // outcome unknown: never repeat a paid call automatically
  if(RETRYABLE.has(primary.outcome)&&!again){
   const wait=primary.outcome==='no_dfs_lines'?now-Date.parse(primary.claimed_at)>=cfg.retryAfterMin*MIN:true;
   const win=inEarly?'early':inLate?'late':null;
   if(win&&wait)retry.push({plan:p,captureKey:'retry',window:win,fallback:p.arm==='early'&&win==='late'});
   continue;
  }
  const done=[primary,again].find(c=>c?.outcome==='stored');
  if(done&&done.window_name==='early'&&!mine.some(c=>c.capture_key==='recheck')&&inWin(now,w.recheckFrom,w.recheckTo)&&
   now-Date.parse(done.claimed_at)>=cfg.recheckMinGapMin*MIN)
   recheck.push({plan:p,captureKey:'recheck',window:'late',fallback:false});
 }
 const byDeadline=(a:DueCapture,b:DueCapture)=>a.plan.commence_time.localeCompare(b.plan.commence_time)||a.plan.provider_event_id.localeCompare(b.plan.provider_event_id);
 prim.sort(byDeadline);retry.sort(byDeadline);recheck.sort(byDeadline);
 const due:DueCapture[]=[];const deferred:{event:string;captureKey:CaptureKey;reason:string}[]=[];
 let spent=0;
 const state=(extra:number)=>({used24h:input.state.used24h+spent+extra,used30d:input.state.used30d+spent+extra,
  providerRemaining:input.state.providerRemaining===null?null:input.state.providerRemaining-spent-extra});
 const afford=(reserveFor:number)=>canSpend(input.policy,state(reserveFor*cfg.creditsPerGame),cfg.creditsPerGame);
 let primariesLeft=pendingPrimaries;
 for(const d of prim){
  const r=afford(0);
  if(!r.allowed){deferred.push({event:d.plan.provider_event_id,captureKey:'primary',reason:r.reason});continue;}
  due.push(d);spent+=cfg.creditsPerGame;primariesLeft--;
 }
 for(const d of [...retry,...recheck]){
  // Leave enough for every selected game still waiting for its first capture in the next 24 hours.
  const r=afford(Math.max(0,primariesLeft));
  if(!r.allowed){deferred.push({event:d.plan.provider_event_id,captureKey:d.captureKey,reason:r.reason==='OK'?'reserved_for_primaries':r.reason});continue;}
  due.push(d);spent+=cfg.creditsPerGame;
 }
 return {due,deferred};
}

/** The next time any selected, uncaptured game's window opens (for "next planned collection"). */
export function nextWindowOpen(plans:PlanRow[],captures:CaptureRow[],nowIso:string,cfg:CaptureConfig=CAPTURE_PLAN_V1){
 const now=Date.parse(nowIso);let best:{at:string;event:string;window:Arm;matchup:string}|null=null;
 for(const p of plans){
  if(!p.selected||captures.some(c=>c.provider_event_id===p.provider_event_id&&c.capture_key==='primary'))continue;
  const w=captureWindows(p.commence_time,cfg);
  for(const [at,win] of [[p.arm==='early'?w.earlyFrom:w.lateFrom,p.arm??'late'],[w.lateFrom,'late']] as [string,Arm][]){
   if(Date.parse(at)<=now)continue;
   if(!best||at<best.at)best={at,event:p.provider_event_id,window:win,matchup:`${p.away_team} @ ${p.home_team}`};
  }
 }
 return best;
}
