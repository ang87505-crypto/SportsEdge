/**
 * "Are we ready for Monday?" — the supervised first stock PAPER session, item by item, from receipts only.
 * Pre-session items can be READY now; session items are ON_THE_DAY until the session's own receipts exist.
 * A planned time, a successful workflow, a shadow plan or an unfilled intent never counts as a fill.
 */
import type {PaperAutoLedger} from '../stocks/paper-auto-ledger.ts';
import {nextRuns} from '../stocks/autopilot-view.ts';
import type {OpsView} from '../ops/status.ts';

export type CheckState='READY'|'NOT_YET'|'BLOCKED'|'ON_THE_DAY'|'OWNER_ONLY';
export type ReadinessItem={id:string;label:string;state:CheckState;detail:string};
export type Readiness={session:string;ready:boolean;verdict:string;items:ReadinessItem[]};

const NY=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const MT=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const ACCOUNT_CHECK_HOURS=26;

/** Owner ledger is null for visitors (or when unavailable): those items say so instead of guessing. */
export function mondayReadiness(x:{nowIso:string;ops:OpsView|null;ledger:PaperAutoLedger|null;ownerSignedIn:boolean}):Readiness{
 const now=Date.parse(x.nowIso);
 const pickAt=nextRuns(now).pick;
 const session=Number.isFinite(pickAt)?NY.format(new Date(pickAt)):'';
 // While the session day is underway, judge that day rather than the following week.
 const todayNy=NY.format(new Date(now));
 const day=new Date(now).toLocaleDateString('en-US',{timeZone:'America/New_York',weekday:'short'})==='Mon'?todayNy:session;
 const l=x.ledger,s=l?.status;
 const owner=(id:string,label:string):ReadinessItem=>({id,label,state:'OWNER_ONLY',
  detail:x.ownerSignedIn?'The owner ledger could not be read right now.':'Sign in as the owner to check this.'});
 const items:ReadinessItem[]=[];
 // 1. Correct PAPER account: the ledger reader refuses anything but alpaca-paper with real money off.
 items.push(l?{id:'account',label:'Correct Alpaca PAPER account',state:'READY',
  detail:`PAPER account${l.experiment.brokerAccountNumberSuffix?' ending '+l.experiment.brokerAccountNumberSuffix:''}; the ledger refuses any non-paper or real-money record.`}:owner('account','Correct Alpaca PAPER account'));
 // 2. Owner ARM.
 items.push(s?{id:'arm',label:'Owner session and ARM',state:s.gateMode==='ARMED'?'READY':'NOT_YET',
  detail:s.gateMode==='ARMED'?`Armed by ${s.gateChangedBy==='owner'?'you':s.gateChangedBy} at ${MT.format(new Date(s.gateChangedAt))}.`:
   `Autopilot is ${s.gateMode.toLowerCase()}. Sign in on /stocks/paper-auto and press Start before the session (I never arm it for you).`}:owner('arm','Owner session and ARM'));
 // 3. Clean account check within 26 hours.
 if(s){
  const fresh=!!s.lastCheckAt&&now-Date.parse(s.lastCheckAt)<=ACCOUNT_CHECK_HOURS*3600_000;
  items.push({id:'check',label:`Clean account check within ${ACCOUNT_CHECK_HOURS} hours`,
   state:s.lastCheckOk===true&&fresh?'READY':s.lastCheckOk===false?'BLOCKED':'NOT_YET',
   detail:s.lastCheckAt?`Last check ${MT.format(new Date(s.lastCheckAt))}: ${s.lastCheckOk?'clean':'not clean'}${s.lastCheckBlockers.length?' ('+s.lastCheckBlockers.join(', ')+')':''}.${fresh?'':' Too old for the gate; Start runs a new one.'}`:
    'No account check recorded yet; Start runs one.'});
 }else items.push(owner('check',`Clean account check within ${ACCOUNT_CHECK_HOURS} hours`));
 // 4. Protections: nothing unresolved, no unacknowledged critical alert, limits present.
 if(s){
  const lim:Record<string,number>=s.limits??{},problems=[s.unresolvedIntents?`${s.unresolvedIntents} unresolved order intent(s)`:'',s.unacknowledgedCriticalAlerts?`${s.unacknowledgedCriticalAlerts} critical alert(s) to review`:''].filter(Boolean);
  items.push({id:'protections',label:'Broker-order and risk protections',state:problems.length?'BLOCKED':'READY',
   detail:problems.length?problems.join('; ')+'.':!Number.isFinite(lim.maxOrderNotionalCents)?'No unresolved orders or critical alerts.':`Limits in force: $${(lim.maxOrderNotionalCents/100).toLocaleString()} per order, $${(lim.maxDailyNotionalCents/100).toLocaleString()} per day, `+
    `${lim.maxOrdersPerDay} orders per day, drawdown stop ${(lim.drawdownStopBps/100).toFixed(0)}%.`});
 }else items.push(owner('protections','Broker-order and risk protections'));
 // 5. The reviewed release branch stays protected.
 const rel=x.ops?.status?.evidence.release;
 items.push(rel?{id:'release',label:'Reviewed release (PR #'+rel.pr+') protected',state:rel.merged?'BLOCKED':'READY',
  detail:rel.merged?'The release PR is already merged; this should not happen before the gate passes.':'Open and unmerged, as required until the gate passes. The manual execute uses its pinned, reviewed head.'}:
  {id:'release',label:'Reviewed release protected',state:'NOT_YET',detail:'The operations monitor has not reported the release PR state.'});
 // 6. Fresh weekly decision for the session.
 const decision=(l?.decisions??[]).find(d=>d.session===day)??null;
 items.push(l?{id:'decision',label:'Fresh weekly decision',state:decision?'READY':'ON_THE_DAY',
  detail:decision?`Decision for ${day}: ${decision.outcome}; targets ${decision.targets.join(', ')||'none'}.`:`Made at 8:00 AM ET on ${day} (planned, not yet run).`}:owner('decision','Fresh weekly decision'));
 // 7–10. Session receipts.
 const filled=l?(l.intents??[]).filter(i=>Number(i.filledQty)>0&&i.createdAt.slice(0,10)>=day):[];
 items.push(l?{id:'fills',label:'Real PAPER orders with confirmed fills',state:filled.length?'READY':'ON_THE_DAY',
  detail:filled.length?`${filled.length} intent(s) report broker fills: ${filled.map(i=>`${i.side} ${i.filledQty} ${i.symbol}`).join(', ')}.`:
   'None yet. Only intents with a broker-confirmed filled quantity count; plans, shadow orders and successful workflows do not.'}:owner('fills','Real PAPER orders with confirmed fills'));
 const after=(iso:string)=>iso.slice(0,10)>=day;
 const events=l?.gateEvents??[],runs=l?.runs??[];
 const stop=events.find(e=>after(e.at)&&e.actor==='owner'&&e.toMode==='STOPPED')??null;
 const restart=stop?events.find(e=>e.at>stop.at&&e.actor==='owner'&&e.toMode==='ARMED')??null:null;
 const recon=stop?runs.find(r=>r.kind==='reconcile'&&r.startedAt>=stop.at&&(!restart||r.startedAt<=restart.at)&&/^CLEAN/.test(r.summary??''))??null:null;
 items.push(l?{id:'stop-start',label:'Owner Stop, clean reconciliation, then Start',state:stop&&restart&&recon?'READY':'ON_THE_DAY',
  detail:stop&&restart&&recon?'Stop, a CLEAN reconcile and the restart are recorded.':'After the fills and before the 2:00 PM MT close: press Stop, let the account check come back clean, then press Start.'}:
  owner('stop-start','Owner Stop, clean reconciliation, then Start'));
 const mark=(l?.daily??[]).find(m=>m.session===day)??null;
 items.push(l?{id:'mark',label:'Same-session after-close mark',state:mark?'READY':'ON_THE_DAY',
  detail:mark?`Recorded ${MT.format(new Date(mark.capturedAt))}.`:'Recorded automatically after the close once the restart is in place.'}:owner('mark','Same-session after-close mark'));
 const gate=x.ops?.status?.blockers.find(b=>b.id==='stock-first-session');
 items.push({id:'gate',label:'Release-gate evidence',state:x.ops?.status?(gate?'ON_THE_DAY':'READY'):'NOT_YET',
  detail:!x.ops?.status?'The operations monitor is unavailable.':gate?gate.text:'The monitor reports the first-session gate as passed.'});

 const pre=items.filter(i=>['account','arm','check','protections','release'].includes(i.id));
 const ready=pre.every(i=>i.state==='READY');
 const missing=pre.filter(i=>i.state!=='READY');
 const verdict=ready?`Pre-session items are ready for ${day}. The fills, reconciliation, Stop/Start and close mark can only be verified on the day.`:
  !l?`I can only confirm the public items. ${x.ownerSignedIn?'The owner ledger could not be read.':'Sign in as the owner to check the account, ARM state and protections.'}`:
  `Not ready yet for ${day}: ${missing.map(i=>i.label.toLowerCase()).join('; ')}.`;
 return {session:day,ready,verdict,items};
}
