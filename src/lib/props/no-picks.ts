/**
 * Why there are no upcoming picks right now, from receipts only. Shared by the PrizePicks page and the assistant
 * so both give the same reason. Order: owner control, then today's capture windows (ticks) or legacy slots, then
 * budget, then what the latest collection actually found. Never infers a reason it has no receipt for.
 */
import type {CollectionStatus} from './collection-status.ts';
import type {PropsView} from './dashboard-view.ts';
import {propsSummary} from './summary.ts';

export type NoPicksCode='HAS_PICKS'|'PAUSED'|'LOCKED_AWAITING_RESULTS'|'WAITING_FOR_WINDOW'|'BUDGET_EXHAUSTED'|'NO_LINES_POSTED'|
 'NO_QUALIFYING_LINES'|'CAPTURE_FAILED'|'WINDOWS_MISSED'|'NO_GAMES_PLANNED'|'WAITING_FOR_COLLECTION'|'UNKNOWN';
export type NoPicks={code:NoPicksCode;headline:string;detail:string|null};

const fmt=(iso:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso));

export function whyNoPicks(x:{view:PropsView;status:CollectionStatus|null;nowIso:string;control:{state:string;reason:string}|null}):NoPicks{
 const up=propsSummary(x.view).upcoming;
 if(up.length)return {code:'HAS_PICKS',headline:`${up.length} upcoming pick${up.length===1?'':'s'}`,detail:null};
 const c=x.control;
 if(c&&c.state!=='RUNNING')return {code:'PAUSED',headline:`Picking is ${c.state==='PAUSED'?'paused':'stopped'} by the owner control`,detail:c.reason};
 const now=Date.parse(x.nowIso);
 const lockedToday=x.view.lines.filter(l=>l.decision==='recorded'&&l.locked&&!l.result&&now-Date.parse(l.lockAt)<18*3600_000);
 const s=x.status;
 const nextText=s?.next?`Next: ${s.next.what} at ${fmt(s.next.at)}.`:null;
 if(lockedToday.length)return {code:'LOCKED_AWAITING_RESULTS',headline:`Today's ${lockedToday.length} pick${lockedToday.length===1?' has':'s have'} locked; results come after the next grading run`,detail:nextText};
 if(!s)return {code:'UNKNOWN',headline:'Collection receipts could not be read',detail:'Nothing is assumed about why there are no picks.'};
 const b=s.budget;
 const budgetShort=b.remaining24h<3;
 const budgetText=b.nextRelease?`${b.nextRelease.credits} credit${b.nextRelease.credits===1?'':'s'} free again ${fmt(b.nextRelease.at)}.`:null;
 if(s.mode==='ticks'){
  const slate=s.slates[0];
  const games=slate?.games??[];
  if(!slate||!games.length)return {code:'NO_GAMES_PLANNED',headline:'No upcoming NBA games are planned for capture yet',
   detail:'A slate is planned once its games appear in the free events list (up to 36 hours ahead).'};
  const refused=games.filter(g=>g.state==='BUDGET_REFUSED');
  const waiting=games.filter(g=>g.state==='WAITING_FOR_WINDOW'||g.state==='DUE');
  if(refused.length&&!games.some(g=>g.state==='CAPTURED'))return {code:'BUDGET_EXHAUSTED',
   headline:`The rolling 24-hour credit cap (${b.daily}) was used up inside ${refused.map(g=>g.matchup).join(' and ')}'s window`,detail:budgetText};
  if(waiting.length){
   const w=[...waiting].sort((a,b2)=>a.window.from.localeCompare(b2.window.from))[0];
   return {code:'WAITING_FOR_WINDOW',headline:`Lines are captured inside each game's window; the next opens ${fmt(w.window.from)} (${w.matchup}, ${String(w.arm).toUpperCase()})`,
    detail:budgetShort?`Only ${b.remaining24h} of ${b.daily} credits are free right now${budgetText?'; '+budgetText:'.'}`:null};
  }
  if(games.some(g=>g.state==='CAPTURED')){
   if(slate.linesObserved===0)return {code:'NO_LINES_POSTED',headline:'PrizePicks/Pick6 had not posted lines for the captured games',detail:null};
   return {code:'NO_QUALIFYING_LINES',headline:`${slate.linesObserved} lines were captured; none met the pick rule (60–80% model confidence)`,
    detail:s.noEntryReasons.length?s.noEntryReasons.map(r=>r.text).join(' '):null};
  }
  if(games.some(g=>g.state==='FAILED'||g.state==='ATTEMPT_UNRESOLVED'))return {code:'CAPTURE_FAILED',headline:'A capture request failed or was not recorded; it is never retried automatically',detail:nextText};
  if(games.some(g=>g.state==='NO_LINES_FOUND'))return {code:'NO_LINES_POSTED',headline:'No PrizePicks/Pick6 lines were posted when the games were captured',detail:nextText};
  return {code:'WINDOWS_MISSED',headline:'No capture tick ran inside the selected games\' windows',detail:nextText};
 }
 // Legacy fixed slots.
 const last=s.executions[0];
 if(last&&last.outcome==='BUDGET_EXHAUSTED')return {code:'BUDGET_EXHAUSTED',headline:`The last collection was refused: the rolling 24-hour credit cap (${b.daily}) was already used`,detail:budgetText};
 if(last&&last.outcome==='COMPLETED'&&last.qualifyingPicks===0)return {code:'NO_QUALIFYING_LINES',headline:'The last collection found no line that met the pick rule (60–80% model confidence)',detail:nextText};
 return {code:'WAITING_FOR_COLLECTION',headline:'No picks yet for the next games',detail:nextText};
}
