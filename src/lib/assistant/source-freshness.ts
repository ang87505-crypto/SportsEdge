/**
 * Existing public operations receipts explain when sports/stock/research
 * workflows last ran. This helper NEVER contacts a provider, private
 * broker, paid API, control endpoint, or the data stores themselves.
 */
import type {QuestionRoute} from './domain.ts';
import type {Reply} from './answer.ts';
import {conversationalText} from './colloquial.ts';
import {mt,type OpsJob,type OpsView} from '../ops/status.ts';

export function isFreshnessQuestion(message:string):boolean{
 const s=conversationalText(message);
 if(!s)return false;
 // Avoid stealing write/control, historical model selection or backfill asks.
 if(/\b(retrain|train|promote|activate|deploy|merge|backfill|execute|trigger|resume|pause|start|stop)\b/.test(s))return false;
 return /\b(stale|fresh|out of date|up to date|not updated|not updating|last updated|last refreshed|last collected|refresh status|refreshing|how old (?:is|are)|when was (?:it|the|our|my) (?:last )?(?:updated|refreshed|collected)|latest (?:data|records|snapshot)|data (?:age|freshness)|is .* updated)\b/.test(s);
}
const TARGETS:Record<string,{areas:string[];label:string;href:string}>={
 sports:{areas:['sports'],label:'Sports picks and capture receipts',href:'/paper-betting/props'},
 stocks:{areas:['stocks'],label:'Stock PAPER decisions and monitoring',href:'/stocks/paper-auto'},
 research:{areas:['research'],label:'Stock strategy research',href:'/stocks/research'},
 kalshi:{areas:[],label:'Independent public weather research',href:'/prediction-markets/kalshi'},
 all:{areas:['sports','stocks','research'],label:'Automation monitor',href:'/automation'}
};
const ghWorkflow=(url:string)=>/^https:\/\/github\.com\/ang87505-crypto\/SportsEdge\/actions\/workflows\/[a-z0-9-]+\.ya?ml$/.test(url);
function runInfo(j:OpsJob):string{
 // Runs and successful data publication are different. Only describe
 // completed GitHub workflow receipts, never invent source observations.
 const confirmed=j.lastSuccess?.startedAt?'last successful workflow started '+mt(j.lastSuccess.startedAt):
  'no successful workflow recorded';
 const latest=j.lastRun?.conclusion?
  '; most recent run: '+j.lastRun.conclusion:
  j.running?'; a run is currently recorded as running':'';
 const planned=j.nextPlanned?.[0]?'; next planned '+mt(j.nextPlanned[0])+' (not yet a run)':'';
 return '- '+j.label+': '+j.status+'; '+confirmed+latest+planned+'.';
}
export function freshnessAnswer(q:QuestionRoute,view:OpsView|null):Reply{
 const target=TARGETS[q.domain??'all']??TARGETS.all;
 const cards:{label:string;href:string}[]=[
  {label:target.label,href:target.href},
  {label:'Automation monitor',href:'/automation'}
 ];
 const context={domain:q.domain??'all',topic:'automation' as const};
 const status=view?.status;
 if(!status){
  return {text:'The operations monitor has no verified current snapshot available. I cannot say whether the records are fresh, stale, missing or zero. Open the linked page for the most recent source evidence.',
   cards:[{kind:'links',items:cards}],
   suggestions:['Is any automation broken?','Why no picks tonight?'],context};
 }
 const jobs=status.jobs.filter(j=>target.areas.includes(j.area));
 const max=6;
 const available=jobs.slice(0,max).filter(j=>ghWorkflow(j.historyUrl))
  .map(j=>({label:j.label,href:j.historyUrl}));
 const links=[...new Map([...cards,...available].map(c=>[c.href,c])).values()].slice(0,8);
 const age=view?.monitorStale?' (monitor itself is stale; treat results as unverified now)':'';
 const header='Operations monitor last published '+mt(status.generatedAt)+age+'.';
 const lines=jobs.length?jobs.slice(0,max).map(runInfo).join('\n'):
  'No dedicated workflow for this requested source is tracked by the current operations monitor.';
 const extra=q.domain==='kalshi'?
  'Independent NOAA or CPI memory has separate source receipts. These job statuses cannot establish a Kalshi market price, an active forecast model, or live betting opportunities.':
  'A workflow success proves only that the run reported success. It does not prove every event, price, score, fill or archived source record was captured or graded.';
 return {text:header+'\n'+lines+'\n\n'+extra+' The latest result on its own does not establish data accuracy or investment returns.',
  cards:[{kind:'links',items:links}],
  suggestions:['Why no picks tonight?','What needs my approval?'],context};
}
