/**
 * Pure view model for the player-prop paper dashboard. Unknown stays unknown:
 * a missing result is "pending", a missing payout is null, never zero.
 * Individual pick accuracy and entry performance are computed separately.
 */
import {MODEL_VERSION,type Platform,type Stat} from './contract.ts';
import {playerKey} from './identity.ts';
import {ACTIVE_BUDGET_POLICY} from './budget.ts';

export type Raw={
 nowIso:string;
 control:{state:string;reason:string;changed_at:string}|null;
 runs:{id:number;kind:string;slot_key:string;status:string;outcome:string;started_at:string;finished_at:string|null;start_delay_seconds:number|null;summary:Record<string,unknown>}[];
 credits:{credits:number;reserved_at:string}[];
 providerRemaining:number|null;
 observations:{id:number;platform:Platform;provider_event_id:string;home_team:string;away_team:string;lock_at:string;player_name:string;stat:Stat;
  line:number;provider_last_update:string;ingested_at:string}[];
 predictions:{id:number;observation_id:number;model_version:string;status:string;reason:string;p_more:number|null;p_less:number|null;p_tie:number|null;mean:number|null;
  inputs?:Record<string,unknown>|null}[];
 picks:{id:number;prediction_id:number;status:string;side:'more'|'less'|null;reason:string;selection_version:string}[];
 results:{observation_id:number;revision:number;outcome:string;actual:number|null}[];
 accounts:{id:number;slug:string;platform:Platform;selection_version?:string;initial_cents:number;stake_cents:number;max_entries_per_day:number}[];
 entries:{id:number;account_id:number;stake_cents:number;lock_at:string;created_at:string;payout_terms_version:string|null}[];
 legs:{entry_id:number;pick_id:number}[];
 /** Per-run counts read from the durable rows (null when they could not be read). */
 runCounts?:Record<string,{decisions:number;qualifyingPicks:number;entries:number}>|null;
 settlements:{entry_id:number;outcome:string;wins:number;losses:number;voids:number;return_cents:number|null;profit_cents:number|null;settled_at:string}[];
 /** Learning loop state; absent or null until the learning tables exist. */
 model?:{active:string;previous:string|null;learningEnabled:boolean;autoSwitchEnabled:boolean;weights:Record<Stat,number[]>|null;
  events:{id:number;version:string;event:string;reason:string;detail:Record<string,unknown>;at:string}[]}|null;
 views?:{observation_id:number;books_at_same_line:number;p_more_books:number|null;line_gap:number|null;nearest_book_line:number|null;flags:string[]}[];
 report?:{period_from:string;period_to:string;model_version:string;at:string;report:{misses:Record<string,number>;voidsExcluded:number;overconfidentBands:string[]}&Record<string,unknown>}|null;
};

export function buildView(r:Raw,platform:Platform,opts:{record?:'current'|'v1'}={}){
 const now=Date.parse(r.nowIso);
 const latestResult=new Map<number,Raw['results'][number]>();
 for(const x of r.results){const p=latestResult.get(x.observation_id);if(!p||x.revision>p.revision)latestResult.set(x.observation_id,x);}
 const corrected=new Set(r.results.filter(x=>x.revision>1).map(x=>x.observation_id));
 const pickByPred=new Map(r.picks.map(k=>[k.prediction_id,k]));
 // Several model versions can score one line (stats model, active learning model, shadows).
 // Show the one a pick was recorded from, else the active model's, else the stats model's.
 const active=r.model?.active??MODEL_VERSION;
 const predsOf=new Map<number,Raw['predictions']>();
 for(const p of r.predictions)predsOf.set(p.observation_id,[...(predsOf.get(p.observation_id)??[]),p]);
 const predByObs=new Map([...predsOf.entries()].map(([obs,ps])=>[obs,ps.find(p=>pickByPred.has(p.id))??
  ps.find(p=>p.model_version===active)??ps.find(p=>p.model_version===MODEL_VERSION)??ps[0]]));
 const viewByObs=new Map((r.views??[]).map(v=>[v.observation_id,v]));
 const lines=r.observations.filter(o=>o.platform===platform).map(o=>{
  const pred=predByObs.get(o.id)??null;const pick=pred?pickByPred.get(pred.id)??null:null;const res=latestResult.get(o.id)??null;
  const side=pick?.side??null;
  const correct=side&&res&&(res.outcome==='more'||res.outcome==='less')?res.outcome===side:null;
  return {id:o.id,player:o.player_name,stat:o.stat,line:Number(o.line),game:`${o.away_team} @ ${o.home_team}`,lockAt:o.lock_at,
   quoteAgeMinutes:Math.round((Date.parse(o.ingested_at)-Date.parse(o.provider_last_update))/60000),ingestedAt:o.ingested_at,
   modelVersion:pred?.model_version??null,predictionStatus:pred?.status??'missing',predictionReason:pred?.reason??null,
   pMore:pred?.p_more===null||pred?.p_more===undefined?null:Number(pred.p_more),pLess:pred?.p_less===null||pred?.p_less===undefined?null:Number(pred.p_less),
   mean:pred?.mean===null||pred?.mean===undefined?null:Number(pred.mean),
   decision:pick?.status??'none',side,decisionReason:pick?.reason??null,
   result:res?{outcome:res.outcome,actual:res.actual===null?null:Number(res.actual),corrected:corrected.has(o.id)}:null,
   locked:Date.parse(o.lock_at)<=now,correct,
   market:(()=>{const v=viewByObs.get(o.id);return v?{booksAtSameLine:Number(v.books_at_same_line),pMoreBooks:v.p_more_books===null?null:Number(v.p_more_books),
    lineGap:v.line_gap===null?null:Number(v.line_gap),nearestBookLine:v.nearest_book_line===null?null:Number(v.nearest_book_line),flags:v.flags??[]}:null;})(),
   oppAllowedRatio:(()=>{const m=(pred?.inputs as {matchup?:{oppAllowedRatio?:unknown}}|null|undefined)?.matchup?.oppAllowedRatio;return typeof m==='number'?m:null;})()};
 }).sort((a,b)=>b.lockAt.localeCompare(a.lockAt)||a.player.localeCompare(b.player));

 // Individual accuracy: recorded picks with a graded more/less result only.
 const graded=lines.filter(l=>l.decision==='recorded'&&l.correct!==null);
 const voided=lines.filter(l=>l.decision==='recorded'&&l.result&&!['more','less'].includes(l.result.outcome)).length;
 // Probability quality across ALL scored lines with a more/less result (Brier on P(more)).
 const scored=lines.filter(l=>l.pMore!==null&&l.result&&['more','less'].includes(l.result.outcome));
 const brier=scored.length?scored.reduce((a,l)=>a+(l.pMore!-(l.result!.outcome==='more'?1:0))**2,0)/scored.length:null;

 // After a learning model takes over, new entries go to the v2 accounts; the v1 record stays one tab away.
 const learnActive=/^props-learn-v[0-9]+$/.test(r.model?.active??'');
 const wanted=opts.record==='v1'||!learnActive?'props-select-v1':'props-select-v2';
 const account=r.accounts.find(a=>a.platform===platform&&a.selection_version===wanted)??
  r.accounts.find(a=>a.platform===platform&&!a.selection_version)??null;
 const pickToLine=new Map<number,typeof lines[number]>();
 for(const l of lines){const pred=predByObs.get(l.id);const pk=pred&&pickByPred.get(pred.id);if(pk)pickToLine.set(pk.id,l);}
 const entries=account?r.entries.filter(e=>e.account_id===account.id).map(e=>{
  const s=r.settlements.find(x=>x.entry_id===e.id)??null;
  return {id:e.id,stakeCents:Number(e.stake_cents),createdAt:e.created_at,lockAt:e.lock_at,terms:e.payout_terms_version,
   legs:r.legs.filter(l=>l.entry_id===e.id).map(l=>pickToLine.get(l.pick_id)).filter((x):x is typeof lines[number]=>!!x),
   settlement:s?{outcome:s.outcome,wins:s.wins,losses:s.losses,voids:s.voids,
    returnCents:s.return_cents===null?null:Number(s.return_cents),profitCents:s.profit_cents===null?null:Number(s.profit_cents),settledAt:s.settled_at}:null};
 }).sort((a,b)=>b.id-a.id):[];
 const settled=entries.filter(e=>e.settlement);
 const known=settled.filter(e=>e.settlement!.profitCents!==null);
 const unknownPayout=settled.filter(e=>e.settlement!.profitCents===null);
 const openStake=entries.filter(e=>!e.settlement||e.settlement.profitCents===null).reduce((a,e)=>a+e.stakeCents,0);
 const profit=known.reduce((a,e)=>a+e.settlement!.profitCents!,0);
 const bankroll=account&&platform==='prizepicks'?{initialCents:Number(account.initial_cents),realizedProfitCents:profit,
  balanceCents:Number(account.initial_cents)+profit,openStakeCents:openStake,settledKnown:known.length}:null;

 const day=r.nowIso.slice(0,10);
 const used24h=r.credits.filter(c=>now-Date.parse(c.reserved_at)<86400_000).reduce((a,c)=>a+Number(c.credits),0);
 const used30d=r.credits.reduce((a,c)=>a+Number(c.credits),0);
 const runs=[...r.runs].sort((a,b)=>b.id-a.id);
 const lastOk=(k:string)=>runs.find(x=>x.kind===k&&x.status==='completed'&&x.outcome==='COMPLETED')??null;
 const lastFailure=runs.find(x=>x.status==='failed'||x.status==='abandoned')??null;
 // Learning loop: readable weights and each version's latest state, with its graded shadow lines.
 const gradedObs=new Set(r.results.filter(x=>latestResult.get(x.observation_id)===x&&['more','less','tie'].includes(x.outcome)).map(x=>x.observation_id));
 const obsById=new Map(r.observations.map(o=>[o.id,o]));
 const keyOf=(id:number)=>{const o=obsById.get(id);return o?[o.provider_event_id,playerKey(o.player_name),o.stat,Number(o.line)].join('|'):null;};
 const round=(x:number|undefined)=>x===undefined?0:Math.round(x*100)/100;
 const model=r.model?{active:r.model.active,previous:r.model.previous,learningEnabled:r.model.learningEnabled,autoSwitchEnabled:r.model.autoSwitchEnabled,
  lastTrainedAt:[...r.model.events].filter(e=>e.event==='created').sort((a,b)=>b.id-a.id)[0]?.at??null,
  weights:r.model.weights?Object.fromEntries(Object.entries(r.model.weights).map(([s,w])=>[s,{stats:round(w[1]),books:round(w[2]),matchup:round(w[5])}])) as Record<Stat,{stats:number;books:number;matchup:number}>:null,
  challengers:(()=>{const seen=new Set<string>();const out:{version:string;state:string;reason:string;detail:Record<string,unknown>;at:string;gradedLines:number}[]=[];
   for(const e of [...r.model.events].sort((a,b)=>b.id-a.id)){if(seen.has(e.version))continue;seen.add(e.version);
    const keys=new Set(r.predictions.filter(p=>p.model_version===e.version&&gradedObs.has(p.observation_id)).map(p=>keyOf(p.observation_id)).filter(Boolean));
    out.push({version:e.version,state:e.event,reason:e.reason,detail:e.detail??{},at:e.at,gradedLines:keys.size});}
   return out;})()}:null;
 return {platform,day,lines,model,report:r.report??null,
  accuracy:{recordedPicks:lines.filter(l=>l.decision==='recorded').length,graded:graded.length,correct:graded.filter(l=>l.correct).length,
   hitRate:graded.length?graded.filter(l=>l.correct).length/graded.length:null,voided,pending:lines.filter(l=>l.decision==='recorded'&&!l.result).length,
   brierAllScored:brier,brierN:scored.length},
  entries,entryStats:{total:entries.length,open:entries.filter(e=>!e.settlement).length,settled:settled.length,
   won:settled.filter(e=>e.settlement!.outcome==='won').length,lost:settled.filter(e=>e.settlement!.outcome==='lost').length,
   allLegsHit:settled.filter(e=>e.settlement!.losses===0&&e.settlement!.wins>0).length,payoutUnknown:unknownPayout.length},
  bankroll,account,
  automation:{control:r.control,runs:runs.slice(0,12),lastCollect:lastOk('collect'),lastSettle:lastOk('settle'),lastFailure,
   budget:{used24h,used30d,daily:ACTIVE_BUDGET_POLICY.dailyCredits,monthly:ACTIVE_BUDGET_POLICY.monthlyCredits,floor:ACTIVE_BUDGET_POLICY.providerFloor,providerRemaining:r.providerRemaining}}};
}
export type PropsView=ReturnType<typeof buildView>;
/** Entries the worker can actually make per day: only the accounts of the active selection version (one per platform). */
export const dailyEntryCap=(...accounts:(PropsView['account']|null|undefined)[])=>
 accounts.reduce((sum,a)=>sum+(a?Number(a.max_entries_per_day):0),0);
