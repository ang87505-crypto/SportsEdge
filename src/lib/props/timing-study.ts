/**
 * Collection-timing study (pure, read-only): does capturing lines EARLY or LATE give better paper picks?
 *
 * Rules that keep the comparison honest:
 *  - Only prospective captures enter the EARLY vs LATE comparison: lines captured by a props-capture-v1 tick
 *    for a game whose arm was assigned (by hash, before any line was seen) in a plan row. Older slot-collect
 *    lines are reported separately as observational, never mixed in.
 *  - Intention to treat: a pick belongs to its game's assigned arm even if the EARLY window was missed.
 *  - "First observed" is the first line SportsEdge saw, never the market's opening line. "Closing" is
 *    reported only when a later observation of the same platform/player/stat exists within 90 minutes of
 *    tip-off; otherwise it is null (never invented).
 *  - Nothing is re-decided: picks, sides and probabilities are read exactly as recorded before lock.
 *  - Uncertainty: Wilson intervals per group; the EARLY-LATE difference uses a slate-cluster bootstrap and is
 *    labelled INSUFFICIENT_DATA until each arm has enough slates and graded picks.
 */
import type {Platform,Stat} from './contract.ts';

export const TIMING_STUDY_V1={version:'props-timing-v1',closingMaxMinutesToTip:90,minSlatesPerArm:20,minGradedPerArm:150,
 bootstrap:2000,seed:20261110,
 minutesToTipBuckets:[[360,Infinity,'6h+'],[180,360,'3-6h'],[60,180,'1-3h'],[0,60,'<1h']] as [number,number,string][],
 quoteAgeBuckets:[[0,60,'<=1m'],[60,300,'1-5m'],[300,1800,'5-30m'],[1800,Infinity,'>30m']] as [number,number,string][]} as const;

export type StudyInput={
 nowIso:string;
 observations:{id:number;run_id:number;platform:Platform;provider_event_id:string;player_name:string;stat:Stat;line:number;
  lock_at:string;ingested_at:string;provider_last_update:string}[];
 predictions:{id:number;observation_id:number;model_version:string;status:string;p_more:number|null;p_less:number|null}[];
 picks:{id:number;prediction_id:number;status:string;side:'more'|'less'|null;selection_version:string}[];
 results:{observation_id:number;revision:number;outcome:string}[];
 legs:{entry_id:number;pick_id:number}[];
 entries:{id:number;account_id:number;stake_cents:number}[];
 accounts:{id:number;platform:Platform}[];
 settlements:{entry_id:number;outcome:string;profit_cents:number|null}[];
 plans:{provider_event_id:string;slate_date:string;arm:'early'|'late'|null;selected:boolean;planned_at:string}[];
 captures:{run_id:number;provider_event_id:string;capture_key:string;window_name:'early'|'late';claimed_at:string}[];
 /** The stats model version whose probabilities define "the model's side" for all scored lines. */
 modelVersion:string;
};

type Outcome='win'|'loss'|'void'|'pending';
export type StudyPick={pickId:number|null;qualified:boolean;platform:Platform;event:string;slate:string|null;player:string;stat:Stat;line:number;
 side:'more'|'less';probability:number;minutesToTip:number;quoteAgeSec:number;prospective:boolean;arm:'early'|'late'|null;
 windowUsed:'early'|'late'|null;captureKey:string|null;inEntry:boolean;outcome:Outcome;
 firstObservedLine:number;lineChanges:number;closing:{line:number;minutesToTip:number}|null;clvPoints:number|null};

const legOutcome=(side:'more'|'less',o:string|undefined):Outcome=>!o?'pending':o==='more'||o==='less'?(o===side?'win':'loss'):'void';
/** Wilson 95% interval for k successes in n trials. */
export function wilson(k:number,n:number){
 if(!n)return null;const z=1.959964,p=k/n,d=1+z*z/n,c=p+z*z/(2*n),h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));
 return [(c-h)/d,(c+h)/d] as [number,number];
}
function rng(seed:number){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const bucket=(x:number,b:readonly (readonly [number,number,string])[])=>b.find(([lo,hi])=>x>=lo&&x<hi)?.[2]??'unknown';

export function groupStats(rows:StudyPick[]){
 const graded=rows.filter(r=>r.outcome==='win'||r.outcome==='loss');const wins=graded.filter(r=>r.outcome==='win').length;
 const meanP=graded.length?graded.reduce((a,r)=>a+r.probability,0)/graded.length:null;
 const clv=rows.filter(r=>r.clvPoints!==null);
 return {lines:rows.length,graded:graded.length,wins,voids:rows.filter(r=>r.outcome==='void').length,pending:rows.filter(r=>r.outcome==='pending').length,
  hitRate:graded.length?wins/graded.length:null,ci95:wilson(wins,graded.length),meanModelProbability:meanP,
  calibrationGap:meanP===null?null:wins/graded.length-meanP,
  brier:graded.length?graded.reduce((a,r)=>a+(r.probability-(r.outcome==='win'?1:0))**2,0)/graded.length:null,
  withClosing:clv.length,meanClvPoints:clv.length?clv.reduce((a,r)=>a+r.clvPoints!,0)/clv.length:null,
  slates:new Set(rows.map(r=>r.slate).filter(Boolean)).size,games:new Set(rows.map(r=>r.event)).size};
}

/** EARLY minus LATE hit rate with a slate-cluster bootstrap (deterministic seed). */
export function compareArms(early:StudyPick[],late:StudyPick[],cfg=TIMING_STUDY_V1){
 const g=(rows:StudyPick[])=>{const m=new Map<string,{w:number;n:number}>();
  for(const r of rows){if(r.outcome!=='win'&&r.outcome!=='loss')continue;const k=r.slate??r.event;const c=m.get(k)??{w:0,n:0};c.n++;if(r.outcome==='win')c.w++;m.set(k,c);}
  return [...m.values()];};
 const E=g(early),L=g(late);
 const rate=(cl:{w:number;n:number}[])=>{const n=cl.reduce((a,c)=>a+c.n,0);return n?cl.reduce((a,c)=>a+c.w,0)/n:null;};
 const nE=E.reduce((a,c)=>a+c.n,0),nL=L.reduce((a,c)=>a+c.n,0);
 const base={earlySlates:E.length,lateSlates:L.length,earlyGraded:nE,lateGraded:nL,
  minSlatesPerArm:cfg.minSlatesPerArm,minGradedPerArm:cfg.minGradedPerArm};
 const rE=rate(E),rL=rate(L);
 if(rE===null||rL===null)return {...base,difference:null,ci95:null,verdict:'INSUFFICIENT_DATA' as const,minimumDetectableDifference:null};
 const r=rng(cfg.seed);const diffs:number[]=[];
 const draw=(cl:{w:number;n:number}[])=>{let w=0,n=0;for(let i=0;i<cl.length;i++){const c=cl[Math.floor(r()*cl.length)];w+=c.w;n+=c.n;}return n?w/n:0;};
 for(let b=0;b<cfg.bootstrap;b++)diffs.push(draw(E)-draw(L));
 diffs.sort((a,b)=>a-b);
 const ci:[number,number]=[diffs[Math.floor(0.025*diffs.length)],diffs[Math.ceil(0.975*diffs.length)-1]];
 const p=(rE*nE+rL*nL)/(nE+nL);
 const mdd=2.8*Math.sqrt(p*(1-p)*(1/nE+1/nL));   // ~80% power, two-sided 5%, ignoring clustering (optimistic)
 const enough=E.length>=cfg.minSlatesPerArm&&L.length>=cfg.minSlatesPerArm&&nE>=cfg.minGradedPerArm&&nL>=cfg.minGradedPerArm;
 const verdict=!enough?'INSUFFICIENT_DATA' as const:ci[0]>0?'EARLY_BETTER' as const:ci[1]<0?'LATE_BETTER' as const:'NO_CLEAR_DIFFERENCE' as const;
 return {...base,difference:rE-rL,ci95:ci,verdict,minimumDetectableDifference:mdd};
}

export function timingStudy(x:StudyInput,cfg=TIMING_STUDY_V1){
 const latestResult=new Map<number,{revision:number;outcome:string}>();
 for(const r of x.results){const p=latestResult.get(r.observation_id);if(!p||r.revision>p.revision)latestResult.set(r.observation_id,r);}
 const planOf=new Map(x.plans.filter(p=>p.selected).map(p=>[p.provider_event_id,p]));
 const captureOf=new Map(x.captures.map(c=>[c.run_id+'|'+c.provider_event_id,c]));
 const inEntry=new Set(x.legs.map(l=>Number(l.pick_id)));
 const track=new Map<string,StudyInput['observations']>();
 const key=(o:StudyInput['observations'][number])=>[o.platform,o.provider_event_id,o.player_name,o.stat].join('|');
 for(const o of x.observations)track.set(key(o),[...(track.get(key(o))??[]),o]);
 for(const t of track.values())t.sort((a,b)=>a.ingested_at.localeCompare(b.ingested_at)||a.id-b.id);
 const obsById=new Map(x.observations.map(o=>[o.id,o]));
 const predsByObs=new Map<number,StudyInput['predictions']>();
 for(const p of x.predictions)predsByObs.set(p.observation_id,[...(predsByObs.get(p.observation_id)??[]),p]);
 const pickByPred=new Map(x.picks.map(k=>[k.prediction_id,k]));

 const describe=(o:StudyInput['observations'][number],side:'more'|'less',probability:number,pickId:number|null,qualified:boolean):StudyPick=>{
  const cap=captureOf.get(o.run_id+'|'+o.provider_event_id)??null;
  const plan=cap?planOf.get(o.provider_event_id)??null:null;
  const prospective=!!cap&&!!plan&&Date.parse(plan.planned_at)<=Date.parse(cap.claimed_at)&&cap.capture_key!=='recheck';
  const t=track.get(key(o))!;
  const later=t.filter(v=>v.ingested_at>o.ingested_at&&Date.parse(v.ingested_at)<Date.parse(v.lock_at));
  const mtt=(v:typeof o)=>(Date.parse(v.lock_at)-Date.parse(v.ingested_at))/60000;
  const closingObs=[...later].reverse().find(v=>mtt(v)<=cfg.closingMaxMinutesToTip)??null;
  const closing=closingObs?{line:Number(closingObs.line),minutesToTip:Math.round(mtt(closingObs))}:null;
  let changes=0;for(let i=1;i<t.length;i++)if(Number(t[i].line)!==Number(t[i-1].line))changes++;
  const res=latestResult.get(o.id)?.outcome;
  return {pickId,qualified,platform:o.platform,event:o.provider_event_id,slate:plan?.slate_date??null,player:o.player_name,stat:o.stat,line:Number(o.line),
   side,probability,minutesToTip:Math.round(mtt(o)),quoteAgeSec:Math.max(0,Math.round((Date.parse(o.ingested_at)-Date.parse(o.provider_last_update))/1000)),
   prospective,arm:prospective?plan!.arm:null,windowUsed:prospective?cap!.window_name:null,captureKey:cap?.capture_key??null,
   inEntry:pickId!==null&&inEntry.has(pickId),outcome:legOutcome(side,res),firstObservedLine:Number(t[0].line),lineChanges:changes,closing,
   clvPoints:closing?Math.round((side==='more'?closing.line-Number(o.line):Number(o.line)-closing.line)*10)/10:null};
 };
 // Qualifying picks exactly as recorded (side and the probability of that side at decision time).
 const picks:StudyPick[]=[];
 for(const k of x.picks){
  if(k.status!=='recorded'||!k.side)continue;
  const pr=x.predictions.find(p=>p.id===k.prediction_id);const o=pr&&obsById.get(pr.observation_id);
  if(!pr||!o||pr.p_more===null||pr.p_less===null)continue;
  picks.push(describe(o,k.side,Number(k.side==='more'?pr.p_more:pr.p_less),Number(k.id),true));
 }
 // Every scored line under the stats model: its favoured side, qualifying or not (larger sample for signal quality).
 const lines:StudyPick[]=[];
 for(const o of x.observations){
  const pr=(predsByObs.get(o.id)??[]).find(p=>p.model_version===x.modelVersion&&p.status==='scored');
  if(!pr||pr.p_more===null||pr.p_less===null)continue;
  const side=Number(pr.p_more)>=Number(pr.p_less)?'more':'less';const k=pickByPred.get(pr.id);
  lines.push(describe(o,side,Number(side==='more'?pr.p_more:pr.p_less),k&&k.status==='recorded'?Number(k.id):null,!!k&&k.status==='recorded'));
 }
 const by=<K extends string>(rows:StudyPick[],f:(r:StudyPick)=>K|null)=>{const m:Record<string,StudyPick[]>={};
  for(const r of rows){const k=f(r);if(k===null)continue;(m[k]??=[]).push(r);}return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,groupStats(v)]));};
 const pro=picks.filter(p=>p.prospective);const proLines=lines.filter(p=>p.prospective);
 // PrizePicks simulated dollars by arm (entries whose legs all share one assigned arm); Pick6 returns are unknown.
 const accountPlatform=new Map(x.accounts.map(a=>[Number(a.id),a.platform]));
 const pickArm=new Map(picks.map(p=>[p.pickId,p.prospective?p.arm:'observational']));
 const entryArm=new Map<number,string>();
 for(const l of x.legs){const a=pickArm.get(Number(l.pick_id))??'observational';const prev=entryArm.get(Number(l.entry_id));
  entryArm.set(Number(l.entry_id),prev===undefined||prev===a?a:'mixed');}
 const dollars:Record<string,Record<string,{entries:number;settled:number;payoutKnown:number;stakeCents:number;profitCents:number;roi:number|null}>>={};
 for(const e of x.entries){
  const plat=accountPlatform.get(Number(e.account_id))??'unknown';const arm=entryArm.get(Number(e.id))??'observational';
  const g=((dollars[plat]??={})[arm]??={entries:0,settled:0,payoutKnown:0,stakeCents:0,profitCents:0,roi:null});
  g.entries++;const s=x.settlements.find(v=>Number(v.entry_id)===Number(e.id));
  if(s){g.settled++;if(s.profit_cents!==null){g.payoutKnown++;g.stakeCents+=Number(e.stake_cents);g.profitCents+=Number(s.profit_cents);}}
  g.roi=g.stakeCents?g.profitCents/g.stakeCents:null;
 }
 return {version:cfg.version,asOf:x.nowIso,
  definitions:{firstObserved:'first line SportsEdge observed (not the market opening line)',
   closing:`latest later observation of the same platform/player/stat within ${cfg.closingMaxMinutesToTip} min of tip-off; null when none`,
   clvPoints:'line points in the pick side\'s favour between the pick and the closing observation (more: closing - line; less: line - closing)',
   prospective:'captured by a props-capture-v1 tick for a game whose arm was assigned in a plan written before the capture'},
  counts:{qualifyingPicks:picks.length,prospectivePicks:pro.length,observationalPicks:picks.length-pro.length,scoredLines:lines.length,
   prospectiveLines:proLines.length,picksInEntries:picks.filter(p=>p.inEntry).length,picksWithClosing:picks.filter(p=>p.closing).length},
  picks:{byArm:by(pro,r=>r.arm),byWindowUsed:by(pro,r=>r.windowUsed),byPlatformArm:by(pro,r=>r.platform+':'+r.arm),
   byMinutesToTip:by(picks,r=>bucket(r.minutesToTip,cfg.minutesToTipBuckets)),byQuoteAge:by(picks,r=>bucket(r.quoteAgeSec,cfg.quoteAgeBuckets)),
   observational:groupStats(picks.filter(p=>!p.prospective))},
  allScoredLines:{byArm:by(proLines,r=>r.arm),byMinutesToTip:by(lines,r=>bucket(r.minutesToTip,cfg.minutesToTipBuckets))},
  comparison:{picks:compareArms(pro.filter(p=>p.arm==='early'),pro.filter(p=>p.arm==='late'),cfg),
   allScoredLines:compareArms(proLines.filter(p=>p.arm==='early'),proLines.filter(p=>p.arm==='late'),cfg)},
  entries:dollars,
  rows:picks};
}
export type TimingStudy=ReturnType<typeof timingStudy>;
