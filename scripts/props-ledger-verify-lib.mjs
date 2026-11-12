/** Pure re-grading for the props ledger audit. Grades only from stored final box scores; never from a prediction. */
export const STAT_KEY={points:'points',rebounds:'rebounds',assists:'assists'};

/** Independent grade of one line from its stored box-score row (null row = no evidence yet). */
export function regrade(obs,game){
 if(!game)return {state:'NO_BOX_SCORE'};
 if(game.game_status==='postponed'||game.game_status==='canceled')return {state:'graded',outcome:'void_postponed',actual:null};
 if(game.did_not_play)return {state:'graded',outcome:'void_dnp',actual:null};
 const v=game[STAT_KEY[obs.stat]];
 if(v===null||v===undefined)return {state:'MISSING_STAT'};
 const line=Number(obs.line),actual=Number(v);
 return {state:'graded',outcome:actual>line?'more':actual<line?'less':'tie',actual};
}
export const legOf=(side,outcome)=>outcome==='more'||outcome==='less'?(outcome===side?'win':'loss'):'void';

/** Compare one entry's stored settlement with an independent recomputation. `settle` is the documented terms function. */
export function auditEntry(entry,legs,settle){
 const problems=[];
 for(const l of legs){
  if(l.pickDecidedAt&&l.lockAt&&Date.parse(l.pickDecidedAt)>=Date.parse(l.lockAt))problems.push(`pick ${l.pickId} decided after lock`);
  if(l.regrade.state==='graded'&&l.stored&&l.stored.outcome!==l.regrade.outcome)
   problems.push(`pick ${l.pickId}: stored ${l.stored.outcome} vs box score ${l.regrade.outcome} (${l.regrade.actual})`);
  if(l.regrade.state==='graded'&&l.stored&&l.regrade.actual!==null&&Number(l.stored.actual)!==l.regrade.actual)
   problems.push(`pick ${l.pickId}: stored actual ${l.stored.actual} vs box score ${l.regrade.actual}`);
 }
 if(Date.parse(entry.created_at)>=Date.parse(entry.lock_at))problems.push('entry created at/after lock');
 const allGraded=legs.every(l=>l.regrade.state==='graded');
 const expected=allGraded?settle(entry.platform,Number(entry.stake_cents),legs.map(l=>legOf(l.side,l.regrade.outcome))):null;
 const s=entry.settlement;
 if(expected&&s){
  if(s.outcome!==expected.outcome)problems.push(`settlement ${s.outcome} vs recomputed ${expected.outcome}`);
  if((s.profit_cents===null?null:Number(s.profit_cents))!==expected.profitCents)problems.push(`profit ${s.profit_cents} vs recomputed ${expected.profitCents}`);
 }
 const state=!allGraded?(s?'SETTLED_BUT_UNGRADED':'PENDING_RESULTS'):!s?'GRADED_NOT_SETTLED':problems.length?'MISMATCH':'VERIFIED';
 return {state:problems.length&&state!=='MISMATCH'?'MISMATCH':state,expected,problems};
}
