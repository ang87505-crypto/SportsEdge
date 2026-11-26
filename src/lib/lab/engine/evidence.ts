/**
 * Evidence coverage for every engine run (engine-evidence-v1). Review only: it never moves an experiment, model,
 * gate or schedule. It makes absent evidence visible instead of silent:
 *  - which domains received input on this run (sports ledger; stock weeks or the stock research ledgers; Kalshi weather
 *    forward scorecards);
 *  - which active experiments have an automatic forward evidence source, and which advance only on an owner-supplied
 *    result, with how long each has gone without any lifecycle change;
 *  - the strategies the registry records as failed, rejected or waiting for owner review.
 */
import type {Registry,Status} from './experiments.ts';

export const EVIDENCE_POLICY={version:'engine-evidence-v1',quietDays:30} as const;
const TERMINAL:Status[]=['REJECTED','FAILED','READY_FOR_REVIEW'];

export function evidenceCoverage(reg:Registry,inputs:{sportsLedger:boolean;stockWeeks:boolean;weatherForward?:boolean;fedByProducer?:readonly string[]},nowIso:string,P=EVIDENCE_POLICY){
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('EVIDENCE_INVALID_CLOCK');
 const active=reg.experiments.filter(e=>!TERMINAL.includes(e.status));
 const lastChange=(e:Registry['experiments'][number])=>e.history.reduce((m,h)=>Math.max(m,Date.parse(h.at)||0),0);
 const days=(ms:number)=>ms?Math.round((now-ms)/864e5*10)/10:null;
 // Automatic = a ledger-pairing forward spec, or an evidence producer that fed this experiment on this run
 // (stock research ledgers, weather shadow scorecards). Everything else advances only on an owner-supplied result.
 const fed=new Set(inputs.fedByProducer??[]);
 const ownerOnly=active.filter(e=>!e.forward&&!fed.has(e.id)).map(e=>({id:e.id,domain:e.domain,status:e.status,
  lastChangeAt:lastChange(e)?new Date(lastChange(e)).toISOString():null,daysSinceChange:days(lastChange(e))}));
 const byStatus=(s:Status)=>reg.experiments.filter(e=>e.status===s).map(e=>e.id);
 const gaps:{code:string;detail:string}[]=[];
 const activeIn=(d:string)=>active.filter(e=>e.domain===d).length;
 if(!inputs.sportsLedger&&activeIn('sports'))gaps.push({code:'SPORTS_LEDGER_NOT_SUPPLIED',
  detail:`${activeIn('sports')} active sports experiments; this run read no prediction ledger.`});
 if(!inputs.stockWeeks&&activeIn('stocks'))gaps.push({code:'STOCK_EVIDENCE_NOT_SUPPLIED',
  detail:`${activeIn('stocks')} active stock experiments; no forward stock weeks reach the engine. Stock evidence lives in the PAPER ledger and research forward ledgers.`});
 if(!inputs.weatherForward&&activeIn('weather'))gaps.push({code:'WEATHER_EVIDENCE_NOT_SUPPLIED',
  detail:`${activeIn('weather')} active weather experiments; this run read no forward shadow scorecard.`});
 const quiet=ownerOnly.filter(e=>e.daysSinceChange===null||e.daysSinceChange>P.quietDays);
 if(quiet.length)gaps.push({code:'NO_AUTOMATIC_EVIDENCE',
  detail:`${quiet.length} active experiments have no automatic evidence source and no lifecycle change in ${P.quietDays}+ days: ${quiet.map(e=>e.id).join(', ')}.`});
 return {policy:P,inputs:{sports:inputs.sportsLedger?'CONNECTED':'NOT_SUPPLIED',stocks:inputs.stockWeeks?'CONNECTED':'NOT_SUPPLIED',
   weather:inputs.weatherForward?'CONNECTED':'NOT_SUPPLIED'},
  experiments:{total:reg.experiments.length,active:active.length,automatic:active.length-ownerOnly.length,ownerSuppliedOnly:ownerOnly},
  outcomes:{failed:byStatus('FAILED'),rejected:byStatus('REJECTED'),readyForReview:byStatus('READY_FOR_REVIEW')},
  gaps,note:'Reporting only. No experiment, model, gate, stake or schedule changes because of this section.'};
}
