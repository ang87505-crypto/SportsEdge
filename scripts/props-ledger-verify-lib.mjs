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

/**
 * Accounting identity for one account: realized profit must equal the sum of each settled entry's own profit, and it
 * is broken down by outcome so a record like 3 won / 6 lost at $5 Power Play (3x) visibly nets $0.00
 * (3 x +$10.00 + 6 x -$5.00). Entries with an unknown payout (Pick6) are counted and their stake reported separately;
 * they never enter profit, staked-with-known-payout or ROI. Pure.
 */
export function accountingIdentity(rows){
 const by={};let profit=0,stakedKnown=0,stakedUnknown=0,unknown=0;const problems=[];
 for(const r of rows){
  const stake=Number(r.stake_cents),p=r.profit_cents===null||r.profit_cents===undefined?null:Number(r.profit_cents);
  if(!Number.isSafeInteger(stake)||stake<=0){problems.push(`entry ${r.entry_id}: invalid stake ${r.stake_cents}`);continue;}
  if(p===null){unknown++;stakedUnknown+=stake;if(r.outcome!=='payout_unknown')problems.push(`entry ${r.entry_id}: ${r.outcome} without a profit`);continue;}
  if(!Number.isSafeInteger(p))problems.push(`entry ${r.entry_id}: non-integer profit ${r.profit_cents}`);
  if(r.outcome==='lost'&&p!==-stake)problems.push(`entry ${r.entry_id}: lost but profit ${p} != -${stake}`);
  if(r.outcome==='refund'&&p!==0)problems.push(`entry ${r.entry_id}: refund but profit ${p}`);
  if(r.outcome==='won'&&p<=0)problems.push(`entry ${r.entry_id}: won but profit ${p}`);
  const k=`${r.outcome}:${p}`;by[k]=(by[k]??0)+1;profit+=p;stakedKnown+=stake;
 }
 const terms=Object.entries(by).sort().map(([k,n])=>{const [o,p]=k.split(':');return {outcome:o,count:n,profitCents:Number(p)};});
 return {profitCents:profit,stakedKnownCents:stakedKnown,stakedUnknownCents:stakedUnknown,unknownPayout:unknown,terms,
  identityHolds:terms.reduce((s,t)=>s+t.count*t.profitCents,0)===profit,problems};
}
