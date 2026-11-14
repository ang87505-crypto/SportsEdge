/**
 * Command Center 2.0: deterministic planner (works with no language model). Turns a question plus the previous
 * answer's tool calls into read-only tool calls, so follow-ups like "and last week?", "compare that with the week
 * before" or "which ones missed?" refer back to the last answer. Questions it does not recognise return null and go
 * to the existing SportsEdge assistant (the fallback), which already answers picks, lineups, stocks, lab and ops.
 * Answer text is composed from the tool data, never from canned results.
 */
import type {ToolCall} from './session.ts';
import type {Period} from './tools.ts';
import type {ToolResult} from './tools.ts';

const norm=(s:string)=>s.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const PERIOD_WORDS:[RegExp,Period][]=[
 [/\b(last|previous|prior) week\b|\bweek before\b|\bthe 7 days before\b/,'prior_7_days'],
 [/\bthis week\b|\b(last|past) (7|seven) days\b|\bpast week\b|\bweekly\b/,'last_7_days'],
 [/\byesterday\b|\blast night\b/,'yesterday'],
 [/\btoday\b|\btonight\b/,'today'],
 [/\ball time\b|\boverall\b|\bever\b|\bso far\b|\bin total\b/,'all'],
];
export function periodsIn(t:string):Period[]{
 const found:{p:Period;at:number}[]=[];
 for(const [re,p] of PERIOD_WORDS){const m=re.exec(t);if(m&&!found.some(f=>f.p===p))found.push({p,at:m.index});}
 // "last week" must not also count as "this week"
 return found.sort((a,b)=>a.at-b.at).map(f=>f.p);
}
const COUNTERPART:Record<Period,Period>={today:'yesterday',yesterday:'today',last_7_days:'prior_7_days',prior_7_days:'last_7_days',all:'last_7_days'};

export type Plan={calls:ToolCall[];filter?:'misses'|'hits'};

export function plan(message:string,last:ToolCall[]):Plan|null{
 const t=norm(message);
 const prev=last[0];
 const prevPeriod=(prev?.input.period??prev?.input.a) as Period|undefined;
 const periods=periodsIn(t);
 const sportsy=/\b(picks?|predictions?|hit rate|accuracy|results?|record|did we do|how did we|virtual|prizepicks|net|profit)\b/.test(t);
 // Comparison, including "how does that compare with last week?"
 if(/\b(compare|compared|comparison|versus|vs|better than|worse than|than the)\b/.test(t)&&(sportsy||prev||periods.length)){
  // "compare THAT with yesterday": the previous answer's period is the first side.
  const refersBack=/\b(that|this|it|those|these)\b/.test(t)&&periods.length===1&&prevPeriod&&prevPeriod!==periods[0];
  const a=refersBack?prevPeriod:periods[0]??prevPeriod??'last_7_days';
  const b=refersBack?periods[0]:periods.find(p=>p!==a)??(periods.length===1&&prevPeriod&&prevPeriod!==a?prevPeriod:COUNTERPART[a]);
  return {calls:[{tool:'compare_periods',input:{a,b}}]};
 }
 if(/\b(bankroll|balance|virtual money|how much (virtual )?money)\b/.test(t))return {calls:[{tool:'virtual_bankroll',input:{}}]};
 if(/\b(upcoming|next picks|picks coming up|not locked)\b/.test(t))return {calls:[{tool:'upcoming_picks',input:{}}]};
 if(/\b(rejected ideas?|hypothes\w*|research engine|learning engine|ready for review)\b|\bideas?\b.*\brejected\b|\brejected\b.*\b(ideas?|experiments?)\b/.test(t))
  return {calls:[{tool:'research_experiments',input:{status:/\brejected\b/.test(t)?'rejected':/\bready\b/.test(t)?'ready_for_review':'all'}}]};
 if(/\b(experiments?|challengers?|forward (test|sample)|sample progress|which layers)\b/.test(t))
  return {calls:[{tool:'learning_lab',input:{}},{tool:'research_experiments',input:{status:'active'}}]};
 if(/\b(job health|jobs? (failing|failed|status)|alerts?|monitor)\b/.test(t))return {calls:[{tool:'automation_health',input:{}}]};
 if(/\b(stock (status|autopilot)|autopilot status|stock bot status)\b/.test(t))return {calls:[{tool:'stock_status',input:{}}]};
 if(/\b(strategy|strategies|stock research)\b/.test(t)&&!/\bdaily\b/.test(t))return {calls:[{tool:'research_strategies',input:{}}]};
 // Follow-ups on the previous sports answer.
 const followUp=/^(and|what about|how about|same for|now|ok|okay)\b/.test(t)||t.split(' ').length<=4;
 if(prev&&(prev.tool==='sports_results'||prev.tool==='compare_periods')){
  if(/\b(miss|missed|misses|wrong|lost)\b/.test(t))return {calls:[{tool:'sports_results',input:{period:periods[0]??prevPeriod??'yesterday'}}],filter:'misses'};
  if(/\b(hits?|right|correct|won)\b/.test(t)&&!/\bhit rate\b/.test(t))return {calls:[{tool:'sports_results',input:{period:periods[0]??prevPeriod??'yesterday'}}],filter:'hits'};
  if(periods.length&&followUp)return {calls:[{tool:'sports_results',input:{period:periods[0]}}]};
 }
 if(sportsy&&periods.length&&/\b(hit rate|accuracy|how did (we|our|the picks)|results?|record|did we do)\b/.test(t))
  return {calls:[{tool:'sports_results',input:{period:periods[0]}}]};
 return null;
}

const pct=(x:number|null|undefined)=>x===null||x===undefined?'not available':(x*100).toFixed(1)+'%';
const usd=(c:number|null|undefined)=>c===null||c===undefined?'none settled':(c<0?'−':'')+'$'+(Math.abs(c)/100).toFixed(2);
type PR={label:string;picks:number;graded:number;correct:number;hitRate:number|null;pending:number;meanConfidence:number|null;settled:number;open:number;netCents:number|null};

/** Plain-language answer composed from the tool data. */
export function compose(results:ToolResult[],filter?:Plan['filter']):string{
 const out:string[]=[];
 for(const r of results){
  if(!r.ok){out.push(r.error??'That record is unavailable right now.');continue;}
  const d=r.data as Record<string,unknown>;
  if(r.tool==='sports_results'){
   const x=d as unknown as PR&{rows:{player:string;side:string;line:number;stat:string;correct:boolean|null}[]};
   if(!x.picks){out.push(`${x.label}: no recorded picks.`);continue;}
   if(filter){
    const sel=x.rows.filter(row=>row.correct===(filter==='hits'));
    out.push(`${x.label}: ${sel.length} ${filter}${sel.length?': '+sel.slice(0,8).map(s=>`${s.player} ${s.side==='less'?'Less':'More'} ${s.line} ${s.stat}`).join('; '):''}.`);
    continue;
   }
   out.push(`${x.label}: ${x.correct} of ${x.graded} graded picks hit (${pct(x.hitRate)}), against an average stated confidence of ${pct(x.meanConfidence)}. ${x.pending} still pending. Virtual net from ${x.settled} settled entries: ${usd(x.netCents)}.`+
    (x.graded&&x.graded<30?' That is a small sample, so it says little about skill.':''));
  }else if(r.tool==='compare_periods'){
   const a=d.a as PR,b=d.b as PR;
   const diff=a.hitRate!==null&&b.hitRate!==null?((a.hitRate-b.hitRate)*100):null;
   const side=(x:PR)=>x.graded?`${x.label}: ${pct(x.hitRate)} on ${x.graded} graded picks, net ${usd(x.netCents)}.`:`${x.label}: no graded picks.`;
   out.push(`${side(a)} ${side(b)}`+
    (diff===null?' One of the periods has no graded picks, so there is nothing to compare yet.':` Difference: ${diff>=0?'+':''}${diff.toFixed(1)} points.`+
     (Math.min(a.graded,b.graded)<100?' With fewer than 100 graded picks in a period, a gap this size can be chance.':'')));
  }else if(r.tool==='virtual_bankroll'){
   const p=d.prizepicks as {balanceCents:number|null;netCents:number|null;roi:number|null;record:{won:number;lost:number;refund:number};openEntries:number};
   out.push(`Virtual PrizePicks balance ${usd(p.balanceCents)} (net ${usd(p.netCents)}, ROI ${pct(p.roi)}), record ${p.record.won}–${p.record.lost} with ${p.openEntries} open. Paper money only.`);
  }else if(r.tool==='upcoming_picks'){
   const u=r.data as {player:string;side:string;line:number;stat:string;probability:number}[];
   out.push(u.length?`${u.length} recorded picks have not locked yet. Most confident: ${u.slice(0,3).map(x=>`${x.player} ${x.side==='less'?'Less':'More'} ${x.line} ${x.stat} (${pct(x.probability)})`).join('; ')}. These are model outputs, not recommendations.`
    :'No recorded picks are waiting to lock right now.');
  }else if(r.tool==='learning_lab'){
   const f=d.forward as {graded:number;dates:number;games:number}|null,m=d.minimums as {lines:number;dates:number;games:number};
   const a=d.active as {version:string}|null;
   out.push(`Active sports model: ${a?.version??'unknown'}. Forward test status: ${String(d.forwardStatus).replaceAll('_',' ')}`+
    (f?` (${f.graded}/${m.lines} graded lines, ${f.dates}/${m.dates} dates, ${f.games}/${m.games} games).`:'.')+' Nothing is promoted automatically; a challenger needs the forward minimums and the owner\'s review.');
  }else if(r.tool==='research_experiments'){
   const c=d.counts as Record<string,number>,ready=d.readyForReview as string[];
   const fw=d.forwardTests as {candidate:string;baseline:string;status:string;progress:{observations:number;dates:number|null;clusters:number|null}|null;minimums:{observations:number;dates:number|null;clusters:number|null}}[];
   out.push(`Learning engine: ${Object.entries(c).filter(([,n])=>n).map(([k,n])=>`${n} ${k.replaceAll('_',' ').toLowerCase()}`).join(', ')}. `+
    (ready.length?`Ready for your review: ${ready.join(', ')}.`:'Nothing is ready for review.')+
    fw.map(f=>` Forward test ${f.candidate} vs ${f.baseline}: ${f.status.replaceAll('_',' ').toLowerCase()}`+(f.progress?` (${f.progress.observations}/${f.minimums.observations} paired lines, ${f.progress.dates??0}/${f.minimums.dates??0} dates, ${f.progress.clusters??0}/${f.minimums.clusters??0} games).`:'.')).join(''));
  }else if(r.tool==='automation_health'){
   const jobs=d.jobs as {label:string;status:string;required:boolean}[];
   const bad=jobs.filter(j=>!/^(OK|SUCCESS|PASSING|HEALTHY|IDLE|SCHEDULED|NOT_DUE)$/i.test(j.status));
   out.push(`${jobs.length} background jobs tracked${d.monitorStale?' (the monitor itself is stale, so treat this as old)':''}. `+
    (bad.length?`Needing attention: ${bad.slice(0,6).map(j=>`${j.label} (${j.status.toLowerCase()})`).join(', ')}.`:'None report a problem.'));
  }else if(r.tool==='research_strategies'){
   out.push(`Stock research (inactive candidates, never trading): ${String(d.overall)}`);
  }else if(r.tool==='stock_status'){
   if(d.registered===false){out.push('No stock PAPER autopilot experiment is registered.');continue;}
   out.push(`Stock PAPER autopilot gate: ${String(d.gateMode)}. Last check ${d.lastCheckOk===null?'has not run':d.lastCheckOk?'passed':'was blocked: '+(d.blockers as string[]).join(', ')}.`+
    ` ${d.unresolvedIntents} unresolved order intents, ${d.criticalAlerts} unacknowledged critical alerts. Paper account only.`);
  }else if(r.tool==='todays_activity'){
   const today=d.today as {text:string}[],ap=d.approvals as {text:string}[];
   out.push(`${(d.health as {headline:string}).headline}. ${today.length?'Today: '+today.slice(0,4).map(x=>x.text).join('; ')+'.':'Nothing recorded yet today.'}`+(ap.length?` Waiting on you: ${ap.map(a=>a.text).join('; ')}.`:''));
  }
 }
 return out.join('\n\n');
}

export function suggestionsFor(calls:ToolCall[]):string[]{
 const t=calls[0]?.tool;
 if(t==='sports_results')return ['Which ones missed?','Compare with the week before','Virtual bankroll'];
 if(t==='compare_periods')return ['Which ones missed?','Show active experiments','Is everything running?'];
 if(t==='learning_lab')return ['How did we do this week?','Show job health','Upcoming picks'];
 return ['How did we do this week?','Compare with the week before','Show active experiments'];
}
