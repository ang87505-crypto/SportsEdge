/**
 * Daily cadence for NBA player-prop paper testing (UTC; independent of the
 * stock strategy's weekly cadence). Must match .github/workflows/props-daily.yml.
 * NBA tip-offs are mostly 23:00-03:30 UTC; lines are collected 1-9 h before
 * tip-off; settlement runs after the night's games and again later the same
 * day so late finals and stat corrections are picked up.
 *
 * Release switch: scheduled runs exit before any network call while it is false.
 * Rollback = set it back to false (or dispatch pause/stop; the ledger keeps every receipt).
 * The 22:10 collect is a no-spend fallback: the 24 h credit window is rolling, so a
 * 19:10 run can be refused if the previous day's collect started late.
 */
/** Owner-approved 2026-11-07; merged only after a verified real collect-and-settle cycle. */
export const PROPS_RELEASE={scheduledRunsEnabled:true,paperOnly:true,realMoneyEnabled:false} as const;
export const PROPS_SCHEDULE=[
 {kind:'settle',cron:'20 9 * * *',hour:9,minute:20},
 {kind:'settle',cron:'20 15 * * *',hour:15,minute:20},
 {kind:'collect',cron:'10 19 * * *',hour:19,minute:10},
 {kind:'collect',cron:'10 22 * * *',hour:22,minute:10},
] as const;
export type ScheduledKind='collect'|'settle';

/** The scheduled instant this cron firing was meant for (GitHub may start it late). */
export function scheduledInstant(cron:string,nowIso:string):string|null{
 const s=PROPS_SCHEDULE.find(x=>x.cron===cron);if(!s)return null;
 const now=new Date(nowIso);
 const t=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),s.hour,s.minute));
 // A firing that slipped past midnight belongs to the previous day's slot.
 if(t.getTime()>now.getTime())t.setUTCDate(t.getUTCDate()-1);
 return t.toISOString();
}
export const slotKey=(kind:string,scheduled:string)=>`${kind}-${scheduled.slice(0,13)}`;
/** True when `cron` is one of the release's scheduled slots for exactly this run kind. */
export function slotCronMatches(kind:string,cron:string):boolean{
 return PROPS_SCHEDULE.some(s=>s.cron===cron&&s.kind===kind);
}

export function nextPlannedRuns(nowIso:string,count=4){
 const now=Date.parse(nowIso);const out:{kind:ScheduledKind;at:string}[]=[];
 for(let day=0;day<3&&out.length<count;day++)for(const s of PROPS_SCHEDULE){
  const d=new Date(now);const t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+day,s.hour,s.minute);
  if(t>now&&out.length<count)out.push({kind:s.kind,at:new Date(t).toISOString()});
 }
 return out.sort((a,b)=>a.at.localeCompare(b.at));
}

/**
 * Event-aware collection (props-capture-v1, src/lib/props/capture-plan.ts). OFF until the owner approves:
 * while tickEnabled is false every scheduled or backup tick exits before any database or provider call,
 * and the legacy collect slots above keep running unchanged. When it is turned on, the legacy scheduled
 * collects stand down (SUPERSEDED_BY_TICK) so the two never compete for the same credits; settles are unchanged.
 * Rollback: set tickEnabled back to false (plans, claims and outcomes are append-only and stay as receipts).
 */
export const PROPS_COLLECTION_V2={tickEnabled:false,planVersion:'props-capture-v1'} as const;
/** GitHub tick crons (props-tick.yml). Off-minute to avoid the top-of-hour queue; harmless while released off. */
export const PROPS_TICK_CRONS=['7,37 11-23 * * *','7,37 0-4 * * *'] as const;
/** Tick slot key: one per 30-minute bucket of the actual start, so GitHub and Vercel starts in one bucket dedupe. */
export function tickSlotKey(nowIso:string){
 const t=Date.parse(nowIso);if(!Number.isFinite(t))throw new Error('PROPS_INVALID_CLOCK');
 const b=new Date(Math.floor(t/1_800_000)*1_800_000).toISOString();
 return `collect-tick-${b.slice(0,16)}`;
}
export const ticksReleased=()=>(PROPS_COLLECTION_V2.tickEnabled as boolean)===true&&(PROPS_RELEASE.scheduledRunsEnabled as boolean)===true;
