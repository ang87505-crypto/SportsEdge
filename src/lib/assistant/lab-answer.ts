/**
 * Ask SportsEdge answers about the AI Learning Lab and variable PAPER staking. Pure and rule-based (no AI service).
 * Every sentence is built from a stored report, a ledger row or the saved props snapshot. Retrospective evidence,
 * forward evidence, live virtual stakes and research (shadow) stakes are always named as such.
 */
import type {Reply,Card} from './answer.ts';
import type {Raw} from '../props/dashboard-view.ts';
import {normalize} from './understand.ts';
import {VERDICT_TEXT,type LabView} from '../lab/view.ts';
import {explainEntries,accuracyByBand,gradedPicks,reasonText} from '../lab/staking-view.ts';
import {METHOD_TEXT,type Method} from '../lab/staking.ts';

export type LabTopic='learned'|'features'|'player_fail'|'mistakes'|'better'|'calibration'|'psychology'|'money_vs_accuracy'|
 'lineup_why'|'stake_why'|'stake_best_ev'|'stake_risk_today'|'stake_flat'|'stake_overconfident'|'skip_high_conf'|'overview';

/** Lab questions are recognised before any other routing; null means "not a lab question". */
export function labTopic(message:string):LabTopic|null{
 const t=normalize(message);
 if(/\bwhy did we (choose|pick|build|make|take|select|enter) (this|that|the|our|these|those|tonight is|today is|last night is)? ?(lineup|entry|entries|lineups)\b|\bwhy (this|that) (lineup|entry)\b/.test(t))return 'lineup_why';
 if(/\$\d+(\.\d+)? instead of \$\d+|\bentry (was|is) \$\d|\bwhy (was|is) (this|that|the) entry\b|\bstake (size|sizing)\b|\bwhy (did|was) (we|it) (stake|bet) \$/.test(t))return 'stake_why';
 if(/\b(highest|best|most) (estimated )?(expected value|ev)\b|\bexpected value\b.*\b(lineup|entry|entries)\b/.test(t))return 'stake_best_ev';
 if(/\b(how much|what).*\b(risking|at risk|exposure|exposed)\b|\brisking today\b/.test(t))return 'stake_risk_today';
 if(/\bflat (staking|stake|stakes)\b|\bvariable (staking|stake|stakes|sizing)\b|\bdynamic (staking|sizing)\b|\bkelly\b/.test(t))return 'stake_flat';
 if(/\bskip(ped)? a (high|highly) ?confidence\b|\bskip(ped)?\b.*\bhigh ?confidence\b|\bwhy (did we|was) .*skip/.test(t))return 'skip_high_conf';
 if(/\boverconfident\b|\bover confident\b/.test(t))return 'stake_overconfident';
 if(/\bhow accurate are (our|the) \d+|\b\d+ ?(%|percent) (predictions|picks|confidence)\b|\bprobabilities\b.*\b(accurate|calibrat\w*)\b|\bcalibrat\w*\b/.test(t))return 'calibration';
 if(/\bpsycholog\w*\b|\bsentiment\b|\binvestor behavio\w*\b/.test(t))return 'psychology';
 if(/\bmore (virtual )?money\b.*\b(predict\w*|correct\w*|accura\w*)\b|\bjust predicting\b|\bmaking money or\b/.test(t))return 'money_vs_accuracy';
 if(/\bwhich (features|layers|signals)\b|\bfeatures? (actually )?(improve|help|matter)\b|\bwhat (features|layers) (help|work)\b/.test(t))return 'features';
 if(/\bwhy did\b.*\bprediction\b.*\b(fail|miss|wrong)\b|\bprediction (fail|failed|miss|missed)\b/.test(t))return 'player_fail';
 if(/\bmistakes?\b.*\b(learn\w*|prevent\w*|avoid\w*)\b|\blearning to prevent\b|\brepeated mistakes?\b|\bwarning flags?\b/.test(t))return 'mistakes';
 if(/\bhow much better\b|\bnew model\b.*\bbetter\b|\bis the (new|challenger) model\b/.test(t))return 'better';
 if(/\bwhat did (our|the) (ai|lab|system) learn\b|\bwhat (did|has) (our|the) ai (learn|learned)\b|\b(our|the) ai learn\w*\b|\blearning lab\b/.test(t))return 'learned';
 return null;
}

const pct=(x:number|null|undefined,d=1)=>x===null||x===undefined?'—':(x*100).toFixed(d)+'%';
const money=(c:number)=>(c<0?'−':'')+'$'+(Math.abs(c)/100).toFixed(2);
const signed=(x:number|null)=>x===null?'—':(x>0?'+':'')+x.toFixed(5);
const LAB_LINK:Card={kind:'links',items:[{label:'AI Learning Lab',href:'/lab'},{label:'PrizePicks picks',href:'/paper-betting/props'}]};
const SUGGEST=['Which features actually improve our predictions?','What mistakes are we learning to prevent?','How accurate are our 80% predictions actually?','Would flat staking have performed better?'];
const reply=(text:string,cards:Card[]=[],extra:Partial<Reply>={}):Reply=>({text,cards:[...cards,LAB_LINK],suggestions:SUGGEST,context:{domain:'all',topic:'lab'},...extra});
const etDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));

function forwardLine(v:LabView){
 const s=v.samples.forward;
 if(v.forwardStatus==='not_migrated')return 'Forward lab tracking is built but not switched on yet: the owner must apply database/props/props_lab_v1.sql. No forward lab evidence exists.';
 if(v.forwardStatus==='not_configured'||v.forwardStatus==='unavailable')return 'Forward lab records could not be read here, so no forward result is reported.';
 if(!s)return 'Forward tracking is on, but no forward report has been written yet (the first one follows the next morning settle).';
 return `Forward evidence so far: ${s.graded} graded of ${s.frozenLines} frozen lines across ${s.dates} date(s) and ${s.games} game(s); the registered minimums are ${v.samples.minimums.lines} lines, ${v.samples.minimums.dates} dates and ${v.samples.minimums.games} games.`;
}

function layerTable(v:LabView):Card{
 return {kind:'table',title:'Each layer, measured with and without it (Brier change; negative = better)',columns:['Layer','2025-26 second half','2026-27 to date','Forward'],
  rows:v.layers.map(l=>[l.label,...l.retro.map(r=>r.verdict==='not_tested'?'Not tested':`${VERDICT_TEXT[r.verdict]} (${signed(r.brierChange)})`),
   l.forward?VERDICT_TEXT[l.forward.verdict]:'—'])};
}

export function labAnswer(message:string,v:LabView,raw:Raw|null,nowIso:string):Reply{
 const topic=labTopic(message)??'overview';
 const fwd=forwardLine(v);
 switch(topic){
 case 'features':{
  const helps=v.layers.filter(l=>l.retro[0]?.verdict==='helps').map(l=>l.label);
  const later=v.layers.filter(l=>l.retro[1]&&l.retro[1].verdict!=='not_tested');
  return reply(`Retrospective test on ${v.samples.retro[0]?.testRows.toLocaleString()} proxy lines from the second half of 2025-26: ${helps.length?helps.join(', ')+' each improved probability quality, and the improvement survives a Holm correction for the '+(v.retroVariants[0]?.variants.length??0)+'-variant family':'no layer showed a clear improvement'}. `+
   `On ${v.samples.retro[1]?.testRows.toLocaleString()} lines from 2026-27 so far (weights trained before the season), ${later.every(l=>l.retro[1].verdict==='no_clear_effect')?'none of those gains is distinguishable from zero yet':'results: '+later.map(l=>l.label+' '+VERDICT_TEXT[l.retro[1].verdict].toLowerCase()).join(', ')}. `+
   `The sportsbook layer has no history and the injury/rotation layer has no reliable pre-lock data, so neither is claimed. ${fwd} Proxy lines rank hypotheses; only forward results can promote anything.`,[layerTable(v)]);
 }
 case 'learned':{
  const day=new Date(Date.parse(nowIso)-86400_000).toISOString();
  const recent=v.history.lab.filter(e=>e.at>=day);
  const verdicts=recent.filter(e=>e.event==='layer_accepted'||e.event==='layer_rejected');
  const freezes=recent.filter(e=>e.event==='freeze_run');
  const frozen=freezes.reduce((s,e)=>s+Number((e.detail as {frozen?:number}).frozen??0),0);
  const head=verdicts.length?`In the last day the lab recorded ${verdicts.length} layer verdict(s): `+verdicts.map(e=>`${(e.detail as {layer?:string}).layer} ${e.event==='layer_accepted'?'accepted':'rejected'}`).join(', ')+'.':
   freezes.length?`In the last day the lab froze ${frozen} variant forecast(s) before lock across ${freezes.length} run(s); no layer verdict is due until the forward minimums are met.`:
   'Nothing new was learned in the last day: no forward lab report or verdict was recorded.';
  return reply(`${head} ${fwd}\n\nWhat is established so far (retrospective, proxy lines): recalibrating the stats model's confidence is the largest gain; role/minutes and matchup add small gains in 2025-26 that are not yet visible in 2026-27. Biggest recurring miss pattern: ${v.mistakes?.patterns.find(p=>(p.lift??0)>1)?.what.toLowerCase()??'none identified'}.`,[layerTable(v)]);
 }
 case 'mistakes':{
  const m=v.mistakes,w=v.warnings;
  if(!m||!w)return reply('No mistake diagnosis is stored yet.');
  const distinctive=m.patterns.filter(p=>(p.lift??0)>1.1);
  const helpful=w.effects.filter(e=>e.verdict==='would_help');
  return reply(`From ${m.picks.toLocaleString()} ${m.source} picks (${m.misses.toLocaleString()} misses), the patterns that are more common among misses than hits: `+
   (distinctive.length?distinctive.map(p=>`${p.what.toLowerCase()} (${p.misses} misses, ${p.lift}× as common as among hits; pre-lock: ${p.preLock})`).join('; '):'none')+'.\n\n'+
   `Pre-lock warning flags (research only, never applied to picks): `+(helpful.length?helpful.map(e=>`"${e.text}" — flagged picks hit ${pct(e.flaggedHitRate)} vs ${pct(e.unflaggedHitRate)}; skipping them avoids ${e.missesAvoided} misses but also rejects ${e.goodRejected} good picks`).join('; '):'none shows a reliable effect')+
   `.\n\n${v.coverageGaps.join(' ')} No psychology or motive is inferred.`,
   [{kind:'table',title:`Warning flags on ${w.source} picks`,columns:['Flag','Flagged','Hit rate (flagged / not)','Skip would avoid / reject','Verdict'],
    rows:w.effects.filter(e=>e.flagged>0).map(e=>[e.text,String(e.flagged),`${pct(e.flaggedHitRate)} / ${pct(e.unflaggedHitRate)}`,`${e.missesAvoided} / ${e.goodRejected}`,e.verdict.replaceAll('_',' ')])}]);
 }
 case 'player_fail':{
  if(!raw)return reply('Sports records are unavailable here, so I cannot look up that prediction.');
  const t=normalize(message);
  const res=new Map(raw.results.map(r=>[r.observation_id,r]));
  // Full name first (as whole words), then a surname of 3+ letters; never a partial token like "2" inside "12".
  const words=` ${t} `,graded=raw.observations.filter(o=>res.has(o.id));
  const full=graded.filter(o=>words.includes(` ${normalize(o.player_name)} `));
  const sur=graded.filter(o=>{const s=normalize(o.player_name).split(' ').pop()!;return s.length>=3&&/^[a-z]+$/.test(s)&&words.includes(` ${s} `);});
  const lines=(full.length?full:sur).sort((a,b)=>b.player_name.length-a.player_name.length||b.lock_at.localeCompare(a.lock_at));
  const o=lines[0];
  if(!o)return reply('Name a player with a graded line, for example "Why did the Jokic prediction fail?". I only explain lines that have a stored result.');
  const p=raw.predictions.find(x=>x.observation_id===o.id&&x.model_version==='props-nb-minutes-rate-v1');
  const r=res.get(o.id)!;
  const inputs=(p?.inputs??{}) as {expMinutes?:number;games?:number;lastPlayed?:string};
  const side=p&&p.p_more!==null&&p.p_less!==null?(Number(p.p_more)>=Number(p.p_less)?'more':'less'):null;
  const view=(raw.views??[]).find(x=>x.observation_id===o.id);
  const facts=[`Line: ${o.player_name} ${o.stat} ${Number(o.line)}; result ${r.outcome}${r.actual!==null?` (${r.actual})`:''}.`,
   p?`Stats model: mean ${Number(p.mean).toFixed(1)}, ${side} at ${pct(side==='more'?Number(p.p_more):Number(p.p_less))}, expected minutes ${inputs.expMinutes?.toFixed(1)??'—'} from ${inputs.games??'—'} games.`:'No stats-model forecast is stored for this line.',
   view?.p_more_books!=null?`Sportsbooks at the same line: ${pct(Number(view.p_more_books))} More${side&&(Number(view.p_more_books)>=0.5?'more':'less')!==side?' — they leaned the other way':''}.`:'No sportsbook quoted the same line.',
   'Actual minutes are graded in the lab report, not in this snapshot; the lab classifies each miss as minutes collapse, minutes surge, sportsbooks right, matchup against, or production per minute.'];
  return reply((side&&r.outcome!==side&&(r.outcome==='more'||r.outcome==='less')?'The prediction missed. ':r.outcome===side?'That prediction did not fail; it was correct. ':'')+facts.join(' '));
 }
 case 'better':{
  const ev=v.history.production.find(e=>e.event==='eligible'||e.event==='shadow_start');
  const d=(ev?.detail??{}) as {candidateBrier?:number;activeBrier?:number;lines?:number;activeVersion?:string};
  const f0=v.retroVariants[0]?.variants,base=f0?.find(x=>x.id==='base'),best=f0?.filter(x=>x.brier!==null).sort((a,b)=>a.brier!-b.brier!)[0];
  return reply(`Active model: ${v.active?.version??'unknown'}. `+(ev&&d.candidateBrier!==undefined?`Newest production challenger ${ev.version}: Brier ${d.candidateBrier?.toFixed(4)} vs active ${d.activeBrier?.toFixed(4)} on ${d.lines??'?'} forward lines (${ev.event==='eligible'?'passed the gate':'still shadowing; not proven better'}). `:'No production challenger has a forward comparison recorded yet. ')+
   (base&&best?`Retrospectively, the best lab variant (${best.label}) lowers Brier from ${base.brier} to ${best.brier} on 2025-26 proxy lines (${((1-best.brier!/base.brier!)*100).toFixed(1)}% better) — a hypothesis until forward lines confirm it. `:'')+fwd);
 }
 case 'calibration':{
  const real=raw?accuracyByBand(raw):null;
  const retro=v.retroVariants[0]?.variants;
  const top=real?.bands.at(-1);
  const t=(real?`From ${real.picks} real graded PrizePicks/Pick6 picks: `+real.bands.filter(b=>b.n).map(b=>`stated ${b.band} hit ${pct(b.hitRate)} (n=${b.n}, 95% CI ${pct(b.lower)}–${pct(b.upper)})`).join('; ')+'. ':'Real graded picks are unavailable here. ')+
   (top&&top.n&&top.hitRate!==null&&top.meanStated!==null?`Our highest-confidence picks (about ${pct(top.meanStated,0)} stated) actually hit ${pct(top.hitRate)}. `:'')+
   (retro?`Retrospectively, calibration error falls from ${pct(retro.find(x=>x.id==='base')?.ece)} (stats model) to ${pct(retro.find(x=>x.id==='base+recalibration')?.ece)} after recalibration. `:'')+
   'A stated 80% is a model output, not a verified 80%; staking research uses the observed rate and its lower bound.';
  return reply(t,real?[{kind:'bars',title:'Stated vs observed hit rate (real graded picks)',items:real.bands.filter(b=>b.n).map(b=>({label:`${b.band} (n=${b.n})`,value:b.hitRate??0,display:pct(b.hitRate),marker:b.meanStated}))}]:[]);
 }
 case 'psychology':{
  const s=v.stocks;
  if(!s||s.state==='not_run')return reply('Not yet, and there is no evidence either way. Three psychology layers built from price and volume (attention spikes, volatility shocks, one-month overreaction) are registered as a research-only ablation on the live weekly strategy, with exposure-matched SPY benchmarks, 10 and 25 bps costs and Holm-adjusted tests; it runs only when the owner dispatches the manual research workflow. News sentiment, earnings surprises, search attention and crowd concentration are not tested because no lawful timestamped data is collected. The weekly stock strategy and the Monday supervised PAPER release are unchanged.');
  return reply(`${s.summary} The weekly stock strategy and the Monday supervised PAPER release are unchanged.`,s.verdicts?[{kind:'table',title:'Stock psychology layers (research only)',columns:['Layer','Verdict'],rows:s.verdicts.map(x=>[x.layer,x.verdict])}]:[]);
 }
 case 'money_vs_accuracy':{
  if(!raw)return reply('Sports records are unavailable here.');
  const g=gradedPicks(raw),k=g.filter(p=>p.correct).length;
  const pp=raw.accounts.filter(a=>a.platform==='prizepicks').map(a=>a.id);
  const s=raw.settlements.filter(x=>raw.entries.some(e=>e.id===x.entry_id&&pp.includes(e.account_id))&&x.profit_cents!==null);
  const net=s.reduce((a,x)=>a+Number(x.profit_cents),0),staked=s.length*500;
  return reply(`Two different questions. Accuracy: ${g.length} real graded picks hit ${pct(g.length?k/g.length:null)} (break-even for a 2-pick Power Play is 57.7% per pick). Money: ${s.length} settled PrizePicks virtual entries ${net>=0?'made':'lost'} ${money(Math.abs(net))} on ${money(staked)} staked${staked?` (ROI ${pct(net/staked)})`:''}. Pick6 payouts are unknown and never counted. `+
   'More correct picks only become more virtual money when BOTH legs of an entry hit; at this sample size neither figure is statistically established. All figures are virtual.');
 }
 case 'lineup_why':{
  if(!raw)return reply('Sports records are unavailable here.');
  const all=explainEntries(raw);
  const id=Number(/\bentry (\d+)\b/.exec(normalize(message))?.[1]??NaN);
  const e=(Number.isFinite(id)?all.find(x=>x.entryId===id):null)??all.at(-1);
  if(!e)return reply('No virtual lineup has been recorded yet, so there is no choice to explain. Ask "Why no picks today?" for the slot receipts.');
  const games=new Set(e.legs.map(l=>l.player)).size;
  return reply(`Lineup ${e.entryId} (${e.platform}, locked ${e.lockAt.slice(0,16).replace('T',' ')} UTC): ${e.legs.map(l=>`${l.player} ${l.side} ${l.line} ${l.stat} (model ${pct(l.stated)})`).join(' + ')}. `+
   `Why these: each leg passed the frozen pick rule (60–80% on one side, tie risk at most 5%); the entry builder then takes the highest-probability picks first and requires ${games} different players from different games, so no two legs share a game. `+
   `Stake: the live flat $5. ${e.settled?`Result: ${e.profitCents===null?'payout unknown (Pick6)':money(e.profitCents)+' virtual'}. `:'Not settled yet. '}`+
   `Calibration check: ${e.legs.map(l=>l.observed===null?`${l.player}: too few graded picks at ${pct(l.stated,0)} to verify`:`${l.player}: picks like this hit ${pct(l.observed)}`).join('; ')}.`,
   [{kind:'table',title:`Lineup ${e.entryId}`,columns:['Leg','Pick','Model','Observed at that confidence'],rows:e.legs.map(l=>[l.player,`${l.side} ${l.line} ${l.stat}`,pct(l.stated),l.observed===null?`n=${l.n} (too few)`:`${pct(l.observed)} (n=${l.n})`])}]);
 }
 case 'stake_why':case 'skip_high_conf':case 'stake_best_ev':case 'stake_risk_today':{
  if(!raw)return reply('Sports records are unavailable here.');
  const all=explainEntries(raw);
  if(topic==='stake_risk_today'){
   const today=etDate(nowIso);
   const mine=all.filter(e=>etDate(e.createdAt)===today);
   const live=raw.entries.filter(e=>etDate(e.created_at)===today);
   const open=raw.entries.filter(e=>!raw.settlements.some(s=>s.entry_id===e.id));
   const research=(m:Method)=>mine.reduce((s,e)=>s+e.research[m].stakeCents,0);
   return reply(`Live virtual stakes today: ${money(live.reduce((s,e)=>s+e.stake_cents,0))} on ${live.length} entr${live.length===1?'y':'ies'} (limit $15 per account per day); ${money(open.reduce((s,e)=>s+e.stake_cents,0))} is open across ${open.length} unsettled entr${open.length===1?'y':'ies'}. `+
    `Research (shadow) recommendations for the same entries: ${(['confidence','expected_value','kelly','edge_gate'] as Method[]).map(m=>`${METHOD_TEXT[m].split(':')[0]} ${money(research(m))}`).join(', ')}. Shadow amounts are never placed.`);
  }
  if(topic==='stake_best_ev'){
   const open=all.filter(e=>!e.settled&&Date.parse(e.lockAt)>Date.parse(nowIso));
   const pool=open.length?open:all.slice(-6);
   const ranked=pool.filter(e=>e.assessment.evMid!==null).sort((a,b)=>b.assessment.evMid!-a.assessment.evMid!);
   if(!ranked.length)return reply(`${open.length?'No open':'No recent'} PrizePicks entry has an estimated expected value: either the payout table is unknown (Pick6) or there are not yet ${100} real graded picks at that confidence to estimate the true hit rate. That uncertainty is itself the answer: the research methods would stake $0.`);
   const e=ranked[0];
   return reply(`${open.length?'Highest estimated expected value among open entries':'No entry is open; most recent best'}: entry ${e.entryId} (${e.legs.map(l=>`${l.player} ${l.side} ${l.line} ${l.stat}`).join(' + ')}). Calibrated chance both legs hit ${pct(e.assessment.jointMid)} (cautious ${pct(e.assessment.jointLow)}) vs 33.3% break-even; estimated return ${pct(e.assessment.evMid)} per $1 (cautious ${pct(e.assessment.evLow)}). This is an estimate from ${e.calibrationPicks} real graded picks, not a promise.`);
  }
  if(topic==='skip_high_conf'){
   const skipped=raw.picks.filter(k=>k.status==='skipped'&&(k.reason==='extreme_disagreement'||k.reason==='pros_disagree'||k.reason==='tie_risk'));
   const zero=all.filter(e=>e.research.edge_gate.stakeCents===0).slice(-3);
   return reply(`Pick rules: ${skipped.filter(k=>k.reason==='extreme_disagreement').length} line(s) were skipped because the model was ABOVE 80% (a very large disagreement with the posted line usually means the line knows something — injury or role — the model does not), ${skipped.filter(k=>k.reason==='pros_disagree').length} because sportsbooks clearly disagreed, and ${skipped.filter(k=>k.reason==='tie_risk').length} for tie risk. `+
    (zero.length?`Staking research: the $5-or-nothing rule would have skipped ${zero.length} recent entr${zero.length===1?'y':'ies'}, e.g. entry ${zero[zero.length-1].entryId} because ${reasonText(zero[zero.length-1].research.edge_gate.reason)}. `:'')+'High stated confidence alone is never a reason to enter.');
  }
  const t=normalize(message);
  const id=Number(/\bentry (\d+)\b/.exec(t)?.[1]??NaN);
  const e=(Number.isFinite(id)?all.find(x=>x.entryId===id):null)??all.at(-1);
  if(!e)return reply('No virtual entry is recorded yet, so there is no stake to explain.');
  const rows=(Object.keys(e.research) as Method[]).map(m=>[METHOD_TEXT[m].split(':')[0],money(e.research[m].stakeCents),reasonText(e.research[m].reason)]);
  return reply(`Entry ${e.entryId} (${e.platform}, ${e.legs.map(l=>`${l.player} ${l.side} ${l.line} ${l.stat} at ${pct(l.stated)} stated, ${l.observed===null?'too few graded picks to verify':pct(l.observed)+' observed'}`).join(' + ')}): `+
   `the LIVE virtual stake was ${money(e.liveStakeCents)} — every live entry uses the flat $5 policy, which is unchanged. Any other amount (for example $2) is a RESEARCH recommendation recorded in shadow, never placed. `+
   `Here the research methods recommend: ${rows.map(r=>`${r[0]} ${r[1]}`).join(', ')}. Main reason: ${reasonText(e.research.expected_value.reason)}.`,
   [{kind:'table',title:`Entry ${e.entryId}: live vs research stakes`,columns:['Method','Stake','Why'],rows:[['Live (recorded)',money(e.liveStakeCents),'flat $5 policy'],...rows]}]);
 }
 case 'stake_flat':case 'stake_overconfident':{
  const f=v.staking.forward,r=v.staking.retro?.folds[0];
  const fx=f?`Forward shadow stakes: ${f.settled} settled entr${f.settled===1?'y':'ies'} over ${f.dates} date(s) (${f.pending} pending, ${f.payoutUnknown} Pick6 not valued). `+f.verdicts.map(x=>`${METHOD_TEXT[x.method].split(':')[0]}: ${x.verdict.replaceAll('_',' ')}`).join('; ')+'. ':
   'No forward shadow stake has settled yet (the lab tables must be applied first). ';
  if(topic==='stake_overconfident'){
   const s=r?.comparison.sensitivity;
   return reply(`If every leg's true hit rate were lower than our calibrated estimate, retrospective replays (500 simulations each, ${r?.comparison.entries} entries) give flat $5 an expected result of `+(s?s.map(x=>`${money(x.methods.find(m=>m.method==='flat')!.expectedPnlCents)} at −${(x.shift*100).toFixed(0)} pts (loss chance ${pct(x.methods.find(m=>m.method==='flat')!.probabilityOfLoss,0)})`).join(', '):'—')+
    `. The research methods respond by staking less or nothing: Kelly already declines whenever stated confidence is more than 5 points above observed accuracy. These replays use proxy lines; real platform lines are harder. ${fx}`,
    s?[{kind:'table',title:'Overconfidence sensitivity (retrospective, simulated)',columns:['Legs worse by','Flat $5','EV-sized','Quarter-Kelly'],
     rows:s.map(x=>[`${(x.shift*100).toFixed(0)} pts`,...(['flat','expected_value','kelly'] as Method[]).map(m=>{const q=x.methods.find(y=>y.method===m)!;return `${money(q.expectedPnlCents)} (loss ${pct(q.probabilityOfLoss,0)})`;})])}]:[]);
  }
  return reply(`${fx}Retrospectively (${r?.comparison.entries} proxy-line entries), confidence- and EV-sized stakes matched flat $5 exactly because the estimated edge was always large; quarter-Kelly staked only ${r?.comparison.methods.find(m=>m.method==='kelly')?.staked} entries and made less. Verdict so far: no method is better than flat, and none will be called better until ${v.staking.gate.minSettledEntries} settled forward entries over ${v.staking.gate.minDates} dates show a Holm-adjusted improvement. Live stakes stay at a flat $5.`,
   r?[{kind:'table',title:'Retrospective staking comparison (same entries, proxy lines)',columns:['Method','Staked','Skipped','Virtual P&L','ROI','Max drawdown'],
    rows:r.comparison.methods.map(m=>[METHOD_TEXT[m.method].split(':')[0],String(m.staked),String(m.skipped),money(m.pnlCents),pct(m.roi),pct(m.maxDrawdown)])}]:[]);
 }
 default:
  return reply(`AI Learning Lab: active model ${v.active?.version??'unknown'}; ${v.testing.productionShadows.length} production challenger(s) shadowing (limit 3) and ${v.testing.labVariants} research variants frozen per line in a separate ledger. ${fwd} ${v.promotion.why}`,[layerTable(v)]);
 }
}
