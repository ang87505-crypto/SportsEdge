/**
 * Collection-schedule replay (offline, no network, no credentials):
 *   node --experimental-strip-types scripts/props-collection-replay.ts [--out research/props_collection_timing_20261110/report.json]
 * Replays the legacy slot schedule and the alternatives against the REAL NBA tip-offs of Nov 7-12 2026 and the
 * REAL observed scheduler delays (research/props_collection_timing_20261110/inputs.json), under the production
 * budget rules (rolling 24 h cap, 30-day cap, never-refunded reservations). The proposed tick strategy uses the
 * actual planner (src/lib/props/capture-plan.ts). It measures coverage and credits only: it does NOT know whether
 * a captured game would have produced qualifying picks, and it assumes PrizePicks/Pick6 lines were posted at
 * capture time (observed for every game we ever priced, at 60-360 minutes before tip-off; earlier is unverified).
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {planSlates,dueCaptures,captureWindows,CAPTURE_PLAN_V1,type PlanRow,type CaptureRow} from '../src/lib/props/capture-plan.ts';
import {BUDGET_POLICY_V2,type BudgetPolicy} from '../src/lib/props/budget.ts';

type Inputs={slates:Record<string,[string,string][]>;collectRuns:Record<string,unknown>[];provider:{plans:[string,number,number][]}};
const inputs=JSON.parse(readFileSync(new URL('../research/props_collection_timing_20261110/inputs.json',import.meta.url),'utf8')) as Inputs;
const games=Object.entries(inputs.slates).flatMap(([slate,gs])=>gs.map(([tip,name],i)=>({id:'g'+slate.replace(/-/g,'')+i,slate,tip:new Date(tip).toISOString(),name})));
const MIN=60_000,H=3600_000;
const slateDays=Object.keys(inputs.slates);

type Res={reserved_at:number;credits:number};
type Capture={game:string;slate:string;at:string;minutesToTip:number;window:string};
function ledger(policy:BudgetPolicy){
 const res:Res[]=[];
 return {res,used:(t:number,win:number)=>res.filter(r=>r.reserved_at>t-win&&r.reserved_at<=t).reduce((a,r)=>a+r.credits,0),
  can(t:number,c:number){return this.used(t,24*H)+c<=policy.dailyCredits&&this.used(t,30*24*H)+c<=policy.monthlyCredits;},
  add(t:number,c:number){res.push({reserved_at:t,credits:c});}};
}
/** Entries need two priced games whose locks are > 10 min after the later capture (both legs open at entry time). */
function entryFeasible(caps:Capture[]){
 for(const a of caps)for(const b of caps){if(a.game>=b.game)continue;
  const built=Math.max(Date.parse(a.at),Date.parse(b.at));
  const ta=Date.parse(games.find(g=>g.id===a.game)!.tip),tb=Date.parse(games.find(g=>g.id===b.game)!.tip);
  if(ta-built>10*MIN&&tb-built>10*MIN)return true;}
 return false;
}
function summarize(name:string,caps:Capture[],l:{res:Res[]},notes:string){
 const perSlate=slateDays.map(d=>{const c=caps.filter(x=>x.slate===d);
  return {slate:d,games:inputs.slates[d].length,priced:c.length,entryPossible:entryFeasible(c),
   minutesToTip:c.map(x=>Math.round(x.minutesToTip)).sort((a,b)=>a-b)};});
 const all=caps.map(c=>c.minutesToTip).sort((a,b)=>a-b);
 return {strategy:name,notes,creditsReserved:l.res.reduce((a,r)=>a+r.credits,0),creditsCharged:caps.length*3,
  gamesPriced:caps.length,slatesWithEntryPossible:perSlate.filter(s=>s.entryPossible).length,slates:perSlate.length,
  medianMinutesToTip:all.length?Math.round(all[Math.floor(all.length/2)]):null,perSlate};
}

/** Legacy collect: events (reserved 1, charged 0) then the earliest games with > 20 min to tip, within 10 h, max 2. */
function legacy(name:string,slots:{h:number;m:number}[],delayMin:(day:number,slot:number)=>number|null,policy=BUDGET_POLICY_V2,opts:{events:number;lateLimit:number|null;notes:string}){
 const l=ledger(policy);const caps:Capture[]=[];const done=new Set<string>();
 const days=[...new Set(slateDays)];
 const starts:{t:number}[]=[];
 days.forEach((d,di)=>slots.forEach((s,si)=>{const dl=delayMin(di,si);if(dl===null)return;
  const sched=Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10),s.h,s.m);
  if(opts.lateLimit!==null&&dl>opts.lateLimit)return;   // SKIPPED_LATE spends nothing
  starts.push({t:sched+dl*MIN});}));
 starts.sort((a,b)=>a.t-b.t);
 for(const {t} of starts){
  if(!l.can(t,opts.events+3))continue;
  if(opts.events)l.add(t,opts.events);
  const open=games.filter(g=>!done.has(g.id)&&Date.parse(g.tip)-t>20*MIN&&Date.parse(g.tip)-t<=10*H).sort((a,b)=>a.tip.localeCompare(b.tip));
  let n=0;
  for(const g of open){if(n>=policy.maxEventsPerRun||!l.can(t,3))break;l.add(t,3);done.add(g.id);n++;
   caps.push({game:g.id,slate:g.slate,at:new Date(t).toISOString(),minutesToTip:(Date.parse(g.tip)-t)/MIN,window:'slot'});}
 }
 return summarize(name,caps,l,opts.notes);
}

/** Proposed ticks: the real planner; ticks only at the given UTC hours (+ minute offset), e.g. Vercel backups alone. */
function ticks(name:string,hours:number[],offsetMin:number,policy:BudgetPolicy,notes:string,extraEveryMin:number|null=null){
 const l=ledger(policy);const caps:Capture[]=[];let plans:PlanRow[]=[];const claims:CaptureRow[]=[];
 const t0=Date.UTC(2026,10,6,12),t1=Date.UTC(2026,10,13,6);
 const times:number[]=[];
 for(let t=t0;t<=t1;t+=H){const h=new Date(t).getUTCHours();if(hours.includes(h))times.push(t+offsetMin*MIN);}
 if(extraEveryMin)for(let t=t0;t<=t1;t+=extraEveryMin*MIN)times.push(t);
 times.sort((a,b)=>a-b);
 for(const t of times){
  const now=new Date(t).toISOString();
  const events=games.filter(g=>Date.parse(g.tip)>t&&Date.parse(g.tip)<=t+36*H).map(g=>({id:g.id,commenceTime:g.tip,homeTeam:'H'+g.id,awayTeam:'A'+g.id}));
  plans=[...plans,...planSlates({events,existing:plans,nowIso:now,policy}).map(p=>({...p,planned_at:now}))];
  const state={used24h:l.used(t,24*H),used30d:l.used(t,30*24*H),providerRemaining:null};
  for(const d of dueCaptures({plans,captures:claims,nowIso:now,policy,state}).due){
   if(!l.can(t,3))continue;l.add(t,3);
   claims.push({provider_event_id:d.plan.provider_event_id,capture_key:d.captureKey,window_name:d.window,claimed_at:now,outcome:'stored',dfs_lines:30});
   const g=games.find(x=>x.id===d.plan.provider_event_id)!;
   caps.push({game:g.id,slate:g.slate,at:now,minutesToTip:(Date.parse(g.tip)-t)/MIN,window:d.window+(d.fallback?' (fallback)':'')});
  }
 }
 const r=summarize(name,caps,l,notes);
 const arms=Object.fromEntries(slateDays.map(d=>[d,plans.find(p=>p.slate_date===d&&p.selected)?.arm??null]));
 return {...r,armBySlate:arms,windows:caps.reduce((a:Record<string,number>,c)=>{a[c.window]=(a[c.window]??0)+1;return a;},{})};
}

const GH=[220,212,410,354,265,634,508,467,360];      // every observed GitHub schedule delay (min), collects and settles
const VERCEL=[61,68,73];
const out:Record<string,unknown>={generatedBy:'scripts/props-collection-replay.ts',inputs:'research/props_collection_timing_20261110/inputs.json',
 assumptions:['PrizePicks/Pick6 lines exist whenever a game is priced (seen for all 6 priced games, 60-360 min before tip; earlier is unverified).',
  'GitHub delays cycle through every delay observed Nov 8-10; Vercel backups start 61-73 min after their slot hour (observed).',
  'Coverage only: whether a priced game yields qualifying picks is not modelled (observed qualifying rate 10/36, 20/78, 24/106 lines).'],
 actual:inputs.collectRuns,strategies:[] as unknown[]};
const S=out.strategies as unknown[];
S.push(legacy('legacy slots, on time (19:10 + 22:10 UTC)',[{h:19,m:10},{h:22,m:10}],()=>0,BUDGET_POLICY_V2,{events:1,lateLimit:150,notes:'Best case for the current schedule.'}));
S.push(legacy('legacy slots, observed GitHub delays, no backup (Nov 8-9 reality)',[{h:19,m:10},{h:22,m:10}],(d,s)=>GH[(d*2+s)%GH.length],BUDGET_POLICY_V2,
 {events:1,lateLimit:null,notes:'As it ran before the 150-minute late rule and the Vercel backups.'}));
S.push(legacy('legacy slots + 150-min late rule + Vercel backup (current production)',[{h:19,m:10},{h:22,m:10}],(d,s)=>Math.min(GH[(d*2+s)%GH.length],VERCEL[(d+s)%3]),BUDGET_POLICY_V2,
 {events:1,lateLimit:150,notes:'The backup fires 61-73 min after the slot; GitHub always later.'}));
S.push(legacy('legacy slots, events list not reserved',[{h:19,m:10},{h:22,m:10}],(d,s)=>Math.min(GH[(d*2+s)%GH.length],VERCEL[(d+s)%3]),BUDGET_POLICY_V2,
 {events:0,lateLimit:150,notes:'Same schedule; the free events call no longer reserves 1 credit.'}));
S.push(legacy('one early fixed slot 16:10 UTC (9:10 AM MT) + backup',[{h:16,m:10}],(d)=>VERCEL[d%3],BUDGET_POLICY_V2,{events:0,lateLimit:150,notes:'Early-day collection, same 2-game cap.'}));
S.push(legacy('three fixed slots 16:10/19:10/22:10 + backups',[{h:16,m:10},{h:19,m:10},{h:22,m:10}],(d,s)=>VERCEL[(d+s)%3],BUDGET_POLICY_V2,{events:0,lateLimit:150,
 notes:'Multiple timed collections; the daily cap is shared, so later slots only help when earlier ones could not spend.'}));
const VH=[13,15,17,19,21,23,1];
S.push(ticks('PROPOSED: event-aware ticks, Vercel backups only (GitHub assumed dropped)',VH,30,BUDGET_POLICY_V2,'props-capture-v1 with the current 7/day, 200/30-day policy.'));
S.push(ticks('PROPOSED: event-aware ticks, Vercel + GitHub every 30 min',VH,30,BUDGET_POLICY_V2,'GitHub ticks add chances; dedupe makes extras harmless.',30));
S.push(ticks('allocation: ticks with props share raised to 13/day, 400/30 days (owner decision)',VH,30,{...BUDGET_POLICY_V2,dailyCredits:13,monthlyCredits:400},
 'Within the same 500-credit plan only if the moneyline refresh keeps < 40/30 days (it used 0 this period on this key).'));
S.push(ticks('larger plan: 20K credits/month, props 24/day (all games, one snapshot)',VH,30,{...BUDGET_POLICY_V2,dailyCredits:30,monthlyCredits:900},'Not purchased.'));
// Monthly arithmetic for plan sizes (credits per game snapshot = 3; ~7.5 NBA games per day during the season).
out.planArithmetic=inputs.provider.plans.map(([name,usd,credits])=>{
 const propsShare=name==='Starter'?200:Math.floor(credits*0.75);   // illustrative: leave 25% for the NBA/EPL refresh
 const perDay=Math.floor(propsShare/30);
 return {plan:name,usdPerMonth:usd,creditsPerMonth:credits,assumedPropsShare:propsShare,snapshotsPerDay:Math.floor(perDay/3),
  gamesPerDayOneSnapshot:Math.min(7.5,Math.floor(perDay/3)),
  snapshotsPerGamePerDay:Math.floor(perDay/3/7.5),
  // First-posting time by binary search over 24 h of 5-minute historical snapshots: ~9 lookups x (10 x 3 markets) credits.
  historicalAvailabilityStudyGamesPerMonthWithQuarterOfShare:name==='Starter'?0:Math.floor(propsShare*0.25/(9*10*3))};
});
const i=process.argv.indexOf('--out');
const text=JSON.stringify(out,null,1);
if(i>0)writeFileSync(process.argv[i+1],text+'\n');
for(const s of S as {strategy:string;gamesPriced:number;slatesWithEntryPossible:number;slates:number;creditsReserved:number;creditsCharged:number;medianMinutesToTip:number|null;perSlate:{priced:number}[]}[])
 console.log(`${s.strategy}\n  priced ${s.gamesPriced} games (${s.perSlate.map(p=>p.priced).join('/')}) · entry possible on ${s.slatesWithEntryPossible}/${s.slates} slates · reserved ${s.creditsReserved} · charged ${s.creditsCharged} · median ${s.medianMinutesToTip} min before tip`);
console.log(JSON.stringify(out.planArithmetic));
void captureWindows;void CAPTURE_PLAN_V1;
