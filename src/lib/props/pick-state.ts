/**
 * One unmistakable state per observed line or entry, from receipts only (never from a model estimate):
 * UPCOMING (recorded pick, game not locked), LOCKED (locked, no final result yet), WON / LOST (graded
 * More/Less against the recorded side), VOID (did not play, postponed or tie), SKIPPED (not picked).
 */
import type {PropsView} from './dashboard-view.ts';
export type LineState='UPCOMING'|'LOCKED'|'WON'|'LOST'|'VOID'|'SKIPPED'|'NOT_PICKED_GRADED';
type Line=Pick<PropsView['lines'][number],'decision'|'locked'|'result'|'correct'|'side'>;
export type Tone='positive'|'negative'|'warning'|'neutral'|'info'|'accent';

export function lineState(l:Line):LineState{
 const recorded=l.decision==='recorded'&&!!l.side;
 if(!recorded)return l.result?'NOT_PICKED_GRADED':'SKIPPED';
 if(l.result){
  if(l.result.outcome==='more'||l.result.outcome==='less')return l.correct?'WON':'LOST';
  return 'VOID';
 }
 return l.locked?'LOCKED':'UPCOMING';
}
export const LINE_STATE:Record<LineState,{label:string;tone:Tone}>={
 UPCOMING:{label:'Upcoming',tone:'info'},LOCKED:{label:'Locked · awaiting result',tone:'warning'},
 WON:{label:'Hit',tone:'positive'},LOST:{label:'Miss',tone:'negative'},VOID:{label:'Void',tone:'neutral'},
 SKIPPED:{label:'Skipped',tone:'neutral'},NOT_PICKED_GRADED:{label:'Skipped',tone:'neutral'}};

export type EntryState='OPEN'|'AWAITING_RESULTS'|'WON'|'LOST'|'REFUNDED'|'SETTLED_PAYOUT_UNKNOWN';
export function entryState(e:{settlement:{outcome:string;profitCents:number|null}|null;legs:Line[]}):EntryState{
 if(e.settlement){
  if(e.settlement.profitCents===null)return 'SETTLED_PAYOUT_UNKNOWN';
  return e.settlement.outcome==='won'?'WON':e.settlement.outcome==='refund'?'REFUNDED':'LOST';
 }
 return e.legs.some(l=>l.locked)?'AWAITING_RESULTS':'OPEN';
}
export const ENTRY_STATE:Record<EntryState,{label:string;tone:Tone}>={
 OPEN:{label:'Open · before lock',tone:'info'},AWAITING_RESULTS:{label:'Locked · awaiting results',tone:'warning'},
 WON:{label:'Won',tone:'positive'},LOST:{label:'Lost',tone:'negative'},REFUNDED:{label:'Refunded',tone:'neutral'},
 SETTLED_PAYOUT_UNKNOWN:{label:'Settled · payout unknown',tone:'neutral'}};
