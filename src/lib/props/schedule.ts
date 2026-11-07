/**
 * Daily cadence for NBA player-prop paper testing (UTC; independent of the
 * stock strategy's weekly cadence). Must match .github/workflows/props-daily.yml.
 * NBA tip-offs are mostly 23:00-03:30 UTC; lines are collected 1-9 h before
 * tip-off; settlement runs after the night's games and again later the same
 * day so late finals and stat corrections are picked up.
 *
 * The release switch is OFF in source: scheduled runs exit before any network
 * call until the owner has applied the schema, set secrets, run a manual
 * cycle, inspected its receipts, and flipped this switch in a reviewed commit.
 */
export const PROPS_RELEASE={scheduledRunsEnabled:false,paperOnly:true,realMoneyEnabled:false} as const;
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

export function nextPlannedRuns(nowIso:string,count=4){
 const now=Date.parse(nowIso);const out:{kind:ScheduledKind;at:string}[]=[];
 for(let day=0;day<3&&out.length<count;day++)for(const s of PROPS_SCHEDULE){
  const d=new Date(now);const t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+day,s.hour,s.minute);
  if(t>now&&out.length<count)out.push({kind:s.kind,at:new Date(t).toISOString()});
 }
 return out.sort((a,b)=>a.at.localeCompare(b.at));
}
