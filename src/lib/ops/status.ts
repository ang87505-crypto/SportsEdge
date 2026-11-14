/** Public operations status (written by the ops-monitor workflow). Shared by the dashboard and chat.
 * Executions always come from real GitHub runs; next planned times are labelled as plans, never as runs.
 */
export type OpsRun={id:number;url:string;event:string;status:string;conclusion:string|null;startedAt:string|null;finishedAt:string|null};
export type OpsJob={id:string;label:string;area:string;required:boolean;status:string;detail:string;historyUrl:string;
 lastRun:OpsRun|null;lastSuccess:OpsRun|null;lastFailure:OpsRun|null;running:OpsRun|null;
 slots7d:{due:number;missed:number;lastMissedAt:string|null};nextPlanned:string[];note:string|null;
 /** Runs GitHub queued over 2 hours ago that never started (absent in older files). */
 stuckQueued?:number};
export type OpsBlocker={id:string;text:string;action:string};
export type OpsStatus={schemaVersion:'ops-status-v1';generatedAt:string;monitorRun:{id:number;url:string;event:string|null}|null;
 overall:{state:'OK'|'WARN'|'ATTENTION';attention:string[]};jobs:OpsJob[];blockers:OpsBlocker[];
 site:{url:string;checkedAt:string;ok:boolean;checks:{name:string;ok:boolean;ms:number;detail:string|null}[];
  /** Which commit production serves vs main (absent in files written before the check existed). */
  deployment?:{state:string;detail:string;deployedSha:string|null;deployedRef:string|null;mainSha:string|null}};
 evidence:{props?:{state:string;controlState?:string|null;lastCompletedCollectAt?:string|null;lastCompletedSettleAt?:string|null};
  research?:{state:string;generatedAt?:string|null;overall?:string|null};
  release?:{pr:number;state:string;draft?:boolean;merged?:boolean;url?:string};
  /** Archive existence, never an assertion of Kalshi data or contract prices. */
  publicWeather?:{source:'PUBLIC_NOAA_ONLY';forecastState:'RECORDED'|'AWAITING_FIRST_ARCHIVE'|'ARCHIVE_UNAVAILABLE';
   scorecardState:'RECORDED'|'AWAITING_FIRST_ARCHIVE'|'ARCHIVE_UNAVAILABLE';
   latestTargetDate:string|null;forecastCapturedAt:string|null;lastGradedDate:string|null}};
 credentials:{name:string;store:string;usedBy:string;present:boolean|null;expiresAt:string|null;note?:string}[]};
export type OpsView={status:OpsStatus|null;mode:'live'|'unavailable';checkedAt:string;monitorStale:boolean};

/** The monitor runs every few hours and after every job; older than this, its own status is suspect. */
export const MONITOR_STALE_HOURS=8;
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown,max=400):v is string=>typeof v==='string'&&v.length<=max;
const time=(v:unknown)=>str(v,40)&&Number.isFinite(Date.parse(v as string));
const ntime=(v:unknown)=>v===null||time(v);
const githubUrl=(v:unknown)=>str(v,300)&&/^https:\/\/github\.com\/ang87505-crypto\/SportsEdge\//.test(v as string);
function run(v:unknown):boolean{
 return v===null||(obj(v)&&Number.isSafeInteger(v.id)&&githubUrl(v.url)&&str(v.event,40)&&str(v.status,40)&&
  (v.conclusion===null||str(v.conclusion,40))&&ntime(v.startedAt)&&ntime(v.finishedAt));
}

/** Refuses the whole file when it is malformed, oversized or dated in the future. */
export function parseOpsStatus(v:unknown,nowIso:string):OpsStatus|null{
 if(!obj(v)||v.schemaVersion!=='ops-status-v1'||!time(v.generatedAt)||Date.parse(v.generatedAt as string)>Date.parse(nowIso)+300_000)return null;
 if(!obj(v.overall)||!['OK','WARN','ATTENTION'].includes(v.overall.state as string)||!Array.isArray(v.overall.attention))return null;
 if(!Array.isArray(v.jobs)||v.jobs.length>30||!Array.isArray(v.blockers)||v.blockers.length>40||!obj(v.site)||!Array.isArray(v.site.checks))return null;
 for(const j of v.jobs){
  if(!obj(j)||!str(j.id,60)||!str(j.label,160)||!str(j.area,20)||typeof j.required!=='boolean'||!str(j.status,30)||!str(j.detail)||
   !githubUrl(j.historyUrl)||![j.lastRun,j.lastSuccess,j.lastFailure,j.running].every(run)||!obj(j.slots7d)||
   !Number.isSafeInteger(j.slots7d.due)||!Number.isSafeInteger(j.slots7d.missed)||!Array.isArray(j.nextPlanned)||
   j.nextPlanned.length>4||!j.nextPlanned.every(time))return null;
 }
 for(const b of v.blockers)if(!obj(b)||!str(b.id,120)||!str(b.text,600)||!str(b.action,600))return null;
 for(const c of v.site.checks)if(!obj(c)||!str(c.name,80)||typeof c.ok!=='boolean')return null;
 if(obj(v.evidence)&&v.evidence.publicWeather!==undefined){
  const x=v.evidence.publicWeather;
  if(!obj(x)||x.source!=='PUBLIC_NOAA_ONLY'||
   !['RECORDED','AWAITING_FIRST_ARCHIVE','ARCHIVE_UNAVAILABLE'].includes(x.forecastState as string)||
   !['RECORDED','AWAITING_FIRST_ARCHIVE','ARCHIVE_UNAVAILABLE'].includes(x.scorecardState as string)||
   !(x.latestTargetDate===null||(typeof x.latestTargetDate==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(x.latestTargetDate)))||
   !ntime(x.forecastCapturedAt)||!(x.lastGradedDate===null||(typeof x.lastGradedDate==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(x.lastGradedDate))))
   return null;
 }
 if(!Array.isArray(v.credentials)||v.credentials.length>20)return null;
 return v as unknown as OpsStatus;
}

export const OPS_STATUS_URL='https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/ops-status/status.json';
export const OPS_LABELS:Record<string,{label:string;tone:'positive'|'warning'|'negative'|'neutral'|'info'}>={
 OK:{label:'Healthy',tone:'positive'},RUNNING:{label:'Running now',tone:'info'},
 PENDING_FIRST_RUN:{label:'First run pending',tone:'neutral'},MISSED_SLOT:{label:'Missed a planned time',tone:'warning'},
 RAN_LATE:{label:'Ran late',tone:'warning'},
 RELEASED_OFF:{label:'Released off',tone:'neutral'},
 STALE:{label:'Stale',tone:'negative'},FAILING:{label:'Failing',tone:'negative'},DISABLED:{label:'Disabled',tone:'negative'},
 EXPIRED:{label:'Window ended',tone:'neutral'},RETIRED:{label:'Retired',tone:'neutral'},UNKNOWN:{label:'Unknown',tone:'warning'},
};
export const opsLabel=(s:string)=>OPS_LABELS[s]??{label:s,tone:'warning' as const};

const MT=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
export const mt=(iso:string|null|undefined)=>iso&&Number.isFinite(Date.parse(iso))?MT.format(new Date(iso)):'none yet';

/** What is waiting on the owner, from the monitor's live blockers (each with its exact next step). */
export function opsApprovalsText(view:OpsView):string{
 const s=view.status;
 if(!s)return 'The operations monitor has not published a status yet, so I cannot list what is waiting on you.';
 const when=`As of ${mt(s.generatedAt)}${view.monitorStale?' (this check is old)':''}`;
 if(!s.blockers.length)return `${when}, the operations monitor lists nothing waiting on you.`;
 return `${when}, ${s.blockers.length} item${s.blockers.length===1?'':'s'} need${s.blockers.length===1?'s':''} you:\n`+
  s.blockers.map(b=>`- ${b.text} Next step: ${b.action}`).join('\n');
}

/** Plain-words summary for chat. Never calls a planned time a run. */
export function opsSummaryText(view:OpsView):string{
 const s=view.status;
 if(!s)return 'The operations monitor has not published a status yet, so I cannot confirm which background jobs ran. Planned schedules are not evidence of a run.';
 const lines=[`Checked ${mt(s.generatedAt)}${view.monitorStale?' (this check is old; the monitor itself may be late)':''}. Overall: ${s.overall.state==='OK'?'all required jobs healthy':s.overall.state==='WARN'?'working, with warnings':'needs attention'}.`];
 for(const j of s.jobs.filter(j=>j.area!=='ops')){
  const last=j.lastSuccess?`last success ${mt(j.lastSuccess.startedAt)}`:'no successful run yet';
  const next=j.nextPlanned[0]?`; next planned ${mt(j.nextPlanned[0])} (planned, not yet run)`:'';
  lines.push(`- ${j.label}: ${opsLabel(j.status).label} — ${last}${next}.`);
 }
 const publicWeather=s.evidence?.publicWeather;
 if(publicWeather){
  const status=publicWeather.forecastState==='RECORDED'?
   'archived for '+publicWeather.latestTargetDate+' (captured '+mt(publicWeather.forecastCapturedAt)+')':
   publicWeather.forecastState==='AWAITING_FIRST_ARCHIVE'?'no recent verified archive found':
   'archive check unavailable';
  lines.push('Independent NOAA weather memory: '+status+
   '; scorecard '+publicWeather.scorecardState+'. This is public research, not Kalshi quotes or a market edge.');
 }
 if(s.blockers.length)lines.push('Needs attention: '+s.blockers.map(b=>b.text).join(' '));
 lines.push(`Live site check: ${s.site.ok?'all pages and chat answered':'some checks failed'}.`);
 const d=s.site.deployment;
 if(d&&obj(d)&&str(d.state,40)&&str(d.detail,400)&&d.state!=='UNKNOWN')lines.push(`Deployment: ${d.detail}`);
 return lines.join('\n');
}
