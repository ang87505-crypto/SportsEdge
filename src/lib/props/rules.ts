/**
 * Frozen v1 rules: individual-pick grading, selection, entry construction and
 * simulated settlement for PrizePicks Player Picks and DraftKings Pick6.
 * Pure and deterministic; money in integer cents; multipliers in thousandths.
 *
 * Sources read 2026-11-07 (see docs/NBA_PLAYER_PROPS_PAPER_2026_11_07.md):
 *  - PrizePicks payouts help page and Reboots page: standard Power Play 2..6 picks
 *    = 3x, 6x, 10x, 20x, 37.5x; a tie or DNP reverts the lineup one tier;
 *    2-pick Power with 1 correct + 1 tie/DNP -> 1.5x; with 1 losing + 1 tie -> loss;
 *    "Lineups with multiple athletes playing in the same game may have reduced payout rates".
 *  - Pick6 NBA rules: a stat equal to the line is VOID; at least two teams per set;
 *    a player once per set; postponed outside the scoring period -> void.
 *    Pick6 prizes page: Base Payouts "vary by sport"; Extra Winnings depend on
 *    other entrants; contest rules: if no entry wins, the pool is split among the
 *    most correct entries. No NBA base table is published -> returns are UNKNOWN.
 */
import type {Platform} from './contract.ts';
import type {MarketView} from './market.ts';
import {SELECTION_VERSION} from './contract.ts';

// ---------------------------------------------------------------- grading
export type LineOutcome='more'|'less'|'tie'|'void_dnp'|'void_postponed';
export type GradeInput={line:number;stat:'points'|'rebounds'|'assists';lockAt:string;nowIso:string;
 game:{status:'final'|'postponed'|'canceled'|'in_progress'|'scheduled'|'unknown'}|null;
 player:{didNotPlay:boolean;points:number|null;rebounds:number|null;assists:number|null}|null;
 /** True only when the final box score was parsed completely (no rejected rows). */
 boxComplete:boolean};
export type Grade={state:'graded';outcome:LineOutcome;actual:number|null}|{state:'pending';reason:string};
/** Hours after the scheduled start that a postponed game may still be graded (Pick6 scoring period, conservatively). */
export const POSTPONEMENT_WINDOW_HOURS=36;

export function gradeLine(g:GradeInput):Grade{
 const now=Date.parse(g.nowIso),lock=Date.parse(g.lockAt);
 if(!Number.isFinite(now)||!Number.isFinite(lock))return {state:'pending',reason:'invalid_clock'};
 if(now<=lock)return {state:'pending',reason:'not_started'};
 const windowClosed=now>lock+POSTPONEMENT_WINDOW_HOURS*3600_000;
 if(!g.game||g.game.status==='unknown')return {state:'pending',reason:'no_verified_result'};
 if(g.game.status==='postponed'||g.game.status==='canceled'){
  return windowClosed?{state:'graded',outcome:'void_postponed',actual:null}:{state:'pending',reason:'postponed_waiting'};
 }
 if(g.game.status!=='final')return {state:'pending',reason:'not_final'};
 if(!g.boxComplete)return {state:'pending',reason:'incomplete_box_score'};
 // Absent from a complete final box score, or listed DNP: void on both platforms (never zero).
 if(!g.player||g.player.didNotPlay)return {state:'graded',outcome:'void_dnp',actual:null};
 const v=g.stat==='points'?g.player.points:g.stat==='rebounds'?g.player.rebounds:g.player.assists;
 if(v===null)return {state:'pending',reason:'missing_stat'};
 return {state:'graded',outcome:v>g.line?'more':v<g.line?'less':'tie',actual:v};
}

// ---------------------------------------------------------------- selection
export const SELECTION_RULE_V1={version:SELECTION_VERSION,minSideProbability:0.60,maxSideProbability:0.80,maxTieProbability:0.05};
export type PickDecision={status:'recorded';side:'more'|'less';probability:number;reason:'edge_band'}|
 {status:'skipped';side:null;probability:number|null;reason:'unscorable'|'below_threshold'|'extreme_disagreement'|'tie_risk'|'pros_disagree'};
export function decidePick(p:{status:'scored'|'unscorable';pMore:number|null;pLess:number|null;pTie:number|null}):PickDecision{
 const R=SELECTION_RULE_V1;
 if(p.status!=='scored'||p.pMore===null||p.pLess===null||p.pTie===null)return {status:'skipped',side:null,probability:null,reason:'unscorable'};
 if(p.pTie>R.maxTieProbability)return {status:'skipped',side:null,probability:null,reason:'tie_risk'};
 const side=p.pMore>=p.pLess?'more':'less';const prob=side==='more'?p.pMore:p.pLess;
 if(prob<R.minSideProbability)return {status:'skipped',side:null,probability:prob,reason:'below_threshold'};
 // A very large disagreement with the posted line most often means information the model lacks.
 if(prob>R.maxSideProbability)return {status:'skipped',side:null,probability:prob,reason:'extreme_disagreement'};
 return {status:'recorded',side,probability:prob,reason:'edge_band'};
}

/**
 * props-select-v2: the v1 rule on the active model's probabilities, plus one extra skip. A pick the
 * sportsbooks clearly lean against is most often one where the model is missing news.
 */
export function decidePickV2(p:Parameters<typeof decidePick>[0],market:MarketView|null):PickDecision{
 const d=decidePick(p);
 if(d.status==='recorded'&&market?.flags.includes('pros_disagree'))return {status:'skipped',side:null,probability:d.probability,reason:'pros_disagree'};
 return d;
}

// ---------------------------------------------------------------- entries
export type EntryCandidate={pickId:number;platform:Platform;eventId:string;playerKey:string;teamAbbr:string;probability:number;lockAt:string};
/**
 * Documented correlation restriction (no joint model in v1): every leg of an
 * entry comes from a DIFFERENT game and a different player. This also avoids
 * PrizePicks' same-game payout reductions and satisfies Pick6's two-team rule.
 * Greedy by probability; leftover picks are never forced into an entry.
 */
export function buildEntries(cands:EntryCandidate[],o:{platform:Platform;picksPerEntry:number;maxEntries:number;nowIso:string;lockBufferMs:number}){
 const now=Date.parse(o.nowIso);
 const pool=cands.filter(c=>c.platform===o.platform&&Date.parse(c.lockAt)-now>o.lockBufferMs)
  .sort((a,b)=>b.probability-a.probability||a.lockAt.localeCompare(b.lockAt)||a.pickId-b.pickId);
 const used=new Set<number>();const entries:EntryCandidate[][]=[];
 for(const seed of pool){
  if(entries.length>=o.maxEntries)break;
  if(used.has(seed.pickId))continue;
  const legs=[seed];
  for(const c of pool){
   if(legs.length>=o.picksPerEntry)break;
   if(used.has(c.pickId)||legs.some(l=>l.pickId===c.pickId||l.eventId===c.eventId||l.playerKey===c.playerKey))continue;
   legs.push(c);
  }
  if(legs.length<o.picksPerEntry)continue;
  legs.forEach(l=>used.add(l.pickId));entries.push(legs);
 }
 return entries;
}

// ---------------------------------------------------------------- settlement
export const PRIZEPICKS_TERMS_V1={version:'prizepicks-power-standard-20261107',
 source:'https://www.prizepicks.com/help-center/payouts',retrieved:'2026-11-07',
 powerMilli:{2:3000,3:6000,4:10000,5:20000,6:37500} as Record<number,number>,
 twoPickOneWinOneVoidMilli:1500};
export type LegResult='win'|'loss'|'void';
export type Settlement={outcome:'won'|'lost'|'refund'|'payout_unknown';multiplierMilli:number|null;returnCents:number|null;
 profitCents:number|null;termsVersion:string|null;wins:number;losses:number;voids:number};

export function legResult(side:'more'|'less',outcome:LineOutcome):LegResult{
 if(outcome==='more'||outcome==='less')return outcome===side?'win':'loss';
 return 'void';  // tie (Pick6 void; PrizePicks reboot/revert) or DNP or postponed
}
export function settleEntry(platform:Platform,stakeCents:number,legs:LegResult[]):Settlement{
 if(!Number.isSafeInteger(stakeCents)||stakeCents<=0||legs.length<2||legs.length>6)throw new Error('PROPS_INVALID_ENTRY');
 const wins=legs.filter(l=>l==='win').length,losses=legs.filter(l=>l==='loss').length,voids=legs.filter(l=>l==='void').length;
 const counts={wins,losses,voids};
 if(platform==='pick6')
  // Peer-to-peer pool: even a losing set can share a pool when nobody wins. Never invent a return.
  return {outcome:'payout_unknown',multiplierMilli:null,returnCents:null,profitCents:null,termsVersion:null,...counts};
 const T=PRIZEPICKS_TERMS_V1;
 const done=(outcome:'won'|'lost'|'refund',milli:number):Settlement=>{
  const product=stakeCents*milli;
  if(product%1000!==0)throw new Error('PROPS_NON_INTEGER_RETURN');
  const ret=product/1000;
  return {outcome,multiplierMilli:milli,returnCents:ret,profitCents:ret-stakeCents,termsVersion:T.version,...counts};
 };
 if(losses>0)return done('lost',0);                       // Power Play: every remaining pick must hit
 const active=legs.length-voids;
 if(active===0)return done('refund',1000);
 if(active===1){
  if(legs.length===2)return done('won',T.twoPickOneWinOneVoidMilli);
  // A 3+ pick lineup reverted to one live pick is not covered by the captured table.
  return {outcome:'payout_unknown',multiplierMilli:null,returnCents:null,profitCents:null,termsVersion:T.version,...counts};
 }
 return done('won',T.powerMilli[active]);
}
