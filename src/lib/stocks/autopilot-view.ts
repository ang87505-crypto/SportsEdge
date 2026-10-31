/** Plain-language view of the recurring PAPER autopilot for the owner page. Pure; no I/O. */
import type {PaperAutoLedger} from './paper-auto-ledger.ts';

export type AutopilotTone='positive'|'warning'|'neutral'|'info';
export type AutopilotHeadline={label:'Running'|'Trading now'|'Stopped'|'Paused'|'Needs attention';tone:AutopilotTone;
 explanation:string;canStart:boolean;reasons:string[]};

const BLOCKERS:Record<string,string>={UNRESOLVED_SUBMISSION:'An order is waiting to be confirmed.',
 EXTERNAL_OPEN_ORDER:'The paper account has an order the autopilot did not place.',
 UNEXPLAINED_POSITION:'The paper account holds a stock the autopilot did not buy.',
 ACCOUNT_MISMATCH:'The keys point at a different Alpaca account.',LEASE_HELD:'Another run is in progress.'};

/** The one status the owner sees first, with the reason behind it. */
export function headline(l:PaperAutoLedger):AutopilotHeadline{
 const s=l.status,reasons:string[]=[];
 if(s.unacknowledgedCriticalAlerts>0)reasons.push(`${s.unacknowledgedCriticalAlerts} critical alert${s.unacknowledgedCriticalAlerts===1?'':'s'} to review.`);
 if(s.unresolvedIntents>0)reasons.push('An order is waiting to be confirmed with Alpaca.');
 for(const b of s.lastCheckBlockers.slice(0,3))reasons.push(BLOCKERS[b.split(':')[0]]??`Last check: ${b}.`);
 const blockedStart=s.unacknowledgedCriticalAlerts>0||s.unresolvedIntents>0;
 if(s.gateMode==='ARMED'){
  if(s.state==='EXECUTING')return {label:'Trading now',tone:'info',reasons,canStart:false,
   explanation:'A trade run is working right now.'};
  if(s.state==='READY')return {label:'Running',tone:'positive',reasons,canStart:false,
   explanation:'Autopilot is on. It picks stocks every Monday morning and trades them the same day.'};
  return {label:'Needs attention',tone:'warning',reasons:reasons.length?reasons:['The last account check is missing or out of date.'],
   canStart:false,explanation:'Autopilot is on, but it will not trade until this is cleared.'};
 }
 if(s.gateMode==='PAUSED')return {label:'Paused',tone:'neutral',reasons,canStart:!blockedStart,
  explanation:'Paused by you. Press Start to check the account and switch it back on.'};
 return {label:blockedStart?'Needs attention':'Stopped',tone:blockedStart?'warning':'neutral',reasons,canStart:!blockedStart,
  explanation:blockedStart?'Autopilot is off and something needs a look before it can start.':
   'Autopilot is off. Press Start to run a quick account check and switch it on.'};
}

const RUN_KIND:Record<string,string>={decision:'Weekly pick',execute:'Trade run',reconcile:'Account check',
 monitor:'Daily close'};
const RUN_SUMMARY:Record<string,string>={RECORDED:'Picks recorded',DUPLICATE:'Picks already recorded',
 SHADOW_PLAN_ONLY:'Planned trades (practice mode: nothing sent)',ORDERS_COMPLETE:'Orders filled',
 ORDERS_WORKING:'Orders waiting to fill',PLAN_HOLD:'Already holding the picks',
 NO_EXECUTABLE_DECISION_TODAY:'Nothing to trade today',OUTSIDE_EXECUTION_WINDOW:'Outside trading hours',
 GATE_STOPPED:'Skipped: autopilot is stopped',GATE_PAUSED:'Skipped: autopilot is paused',CLEAN:'Account matches the records',
 NOT_CLEAN:'Account does not match the records',DAILY_RECORDED:'Daily result recorded',BEFORE_CLOSE:'Too early for the daily result',
 NOT_A_SESSION:'Market closed',MARK_WINDOW_PASSED:'Daily result window passed'};
export type ActivityItem={runId:string;what:string;result:string;tone:AutopilotTone;at:string};

/** Recent worker runs in plain words, newest first. */
export function activity(l:PaperAutoLedger,limit=8):ActivityItem[]{
 return [...l.runs].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,limit).map(r=>{
  const code=(r.summary??'').split(/[:\s]/)[0];
  const tone:AutopilotTone=r.status==='failed'?'warning':r.status==='blocked'?'neutral':r.status==='running'?'info':'positive';
  return {runId:r.runId,what:RUN_KIND[r.kind]??r.kind,at:r.startedAt,tone,
   result:RUN_SUMMARY[code]??(r.status==='running'?'In progress':r.status==='failed'?`Failed${code?`: ${code}`:''}`:
    code||r.status)};
 });
}

/** Net filled shares per symbol from the autopilot's own orders. */
export function holdings(l:PaperAutoLedger):{symbol:string;shares:number}[]{
 const net=new Map<string,number>();
 for(const i of l.intents){
  const q=Number(i.filledQty);
  if(!Number.isFinite(q)||q<=0)continue;
  net.set(i.symbol,(net.get(i.symbol)??0)+(i.side==='buy'?q:-q));
 }
 return [...net].filter(([,q])=>q>0).map(([symbol,shares])=>({symbol,shares})).sort((a,b)=>a.symbol.localeCompare(b.symbol));
}

/** The latest weekly decision in plain words. */
export function latestPicks(l:PaperAutoLedger){
 const d=[...l.decisions].sort((a,b)=>b.session.localeCompare(a.session))[0];
 if(!d)return null;
 const text=d.outcome==='TARGETS'?'Picked':d.outcome==='HOLD_NO_TARGETS'?'No stocks qualified this week':
  d.outcome==='MISSED'?'Missed (the 8 AM check ran late)':'Skipped (data problem)';
 return {session:d.session,outcome:d.outcome,text,targets:d.targets,reasons:d.reasons};
}

// ---------------------------------------------------------------- schedule
const NY='America/New_York';
function nyParts(t:number){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:NY,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(t).map(x=>[x.type,x.value]));
 return {y:+p.year,m:+p.month,d:+p.day,h:+p.hour,min:+p.minute,wd:p.weekday as string};
}
/** The UTC instant of a New York wall-clock time (handles daylight saving). */
export function nyInstant(y:number,m:number,d:number,h:number,min:number):number{
 let t=Date.UTC(y,m-1,d,h+5,min);
 for(let k=0;k<2;k++){const p=nyParts(t);t+=((h-p.h)*60+(min-p.min))*60_000+(Date.UTC(y,m-1,d)-Date.UTC(p.y,p.m-1,p.d));}
 return t;
}
function nextAt(now:number,h:number,min:number,days:string[]):number{
 const p=nyParts(now);
 for(let k=0;k<8;k++){
  const base=new Date(Date.UTC(p.y,p.m-1,p.d+k));
  const t=nyInstant(base.getUTCFullYear(),base.getUTCMonth()+1,base.getUTCDate(),h,min);
  if(t>now&&days.includes(nyParts(t).wd))return t;
 }
 return NaN;
}
/** When the scheduled jobs next run (market holidays move a Monday pick to the next trading day). */
export function nextRuns(now:number){
 const weekdays=['Mon','Tue','Wed','Thu','Fri'];
 return {pick:nextAt(now,8,0,['Mon']),trade:nextAt(now,9,50,weekdays),close:nextAt(now,16,35,weekdays)};
}
