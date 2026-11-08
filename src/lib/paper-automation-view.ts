/** Read-only, plain-language status for the two paper systems. Never changes a gate. */
import type {Raw} from './props/dashboard-view.ts';

export type AutomationStatus={label:string;tone:'positive'|'warning'|'neutral'|'info';explanation:string;nextAction:string};

export function propsAutomationStatus(raw:Raw,scheduleEnabled:boolean):AutomationStatus{
 const control=raw.control?.state;
 if(!control||!['RUNNING','PAUSED','STOPPED'].includes(control))return {label:'Status unavailable',tone:'warning',
  explanation:'The control could not be verified.',nextAction:'Read the ledger before making a change.'};
 if(control!=='RUNNING')return {label:control==='PAUSED'?'Paused':'Stopped',tone:'neutral',
  explanation:'New collection and settlement runs are blocked.',nextAction:'Review the reason on the props page before resuming.'};
 if(!scheduleEnabled)return {label:'Waiting for release',tone:'warning',
  explanation:'Manual testing is on. Daily automation is still off.',
  nextAction:'Verify the first real collection and settlement, then release the daily schedule.'};
 const runs=[...raw.runs].sort((a,b)=>b.started_at.localeCompare(a.started_at));
 const last=runs[0];
 if(last&&['failed','abandoned'].includes(last.status))return {label:'Needs attention',tone:'warning',
  explanation:'The latest run did not finish successfully.',nextAction:'Open the run receipt to see what failed.'};
 if(raw.providerRemaining!==null&&raw.providerRemaining<60)return {label:'Data budget paused',tone:'warning',
  explanation:'The provider credit reserve is below the collection limit.',nextAction:'Wait for the provider allowance to reset; existing entries can still be graded.'};
 const scheduled=runs.find(r=>!r.slot_key.includes('manual')&&r.kind==='collect'&&r.status==='completed'&&r.outcome==='COMPLETED');
 if(!scheduled)return {label:'Waiting for first run',tone:'info',
  explanation:'The daily schedule is on. A completed scheduled collection has not been verified yet.',
  nextAction:'Check the receipt after the next collection slot.'};
 const age=Date.parse(raw.nowIso)-Date.parse(scheduled.finished_at??scheduled.started_at);
 if(age>36*60*60_000)return {label:'Collection overdue',tone:'warning',
  explanation:'No completed scheduled collection has been recorded in the last 36 hours.',
  nextAction:'Review recent runs and the provider budget.'};
 return {label:'Automatic',tone:'positive',
  explanation:'Daily collection is on and a scheduled collection is recorded. Eligible entries stay virtual.',
  nextAction:'No daily click needed. Follow the next run and the settled results.'};
}

/** Fixed Mountain time for the owner's overview; Intl handles daylight saving. */
export function mountainTime(iso:string|null):string{
 if(!iso||!Number.isFinite(Date.parse(iso)))return 'None yet';
 return new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'short',month:'short',day:'numeric',
  hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso));
}
