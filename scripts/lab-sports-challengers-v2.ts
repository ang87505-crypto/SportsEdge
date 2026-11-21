/**
 * AI 2.0 sports research run: lab-sports-challengers-v2 (pre-registered in src/lib/lab/sports/challengers-v2.ts).
 * Deterministic; no AI service; no paid requests; reads only the pinned public box-score files.
 *   node --experimental-strip-types scripts/lab-sports-challengers-v2.ts --prior player_box_2025.csv --season player_box_2026.csv \
 *     --current player_box_2027.csv --out research/lab_sports_challengers_v2_20261113 [--forward]
 * --forward scores only 2026-27 games that start at or after the spec's forwardStartsAt, with weights trained on 2025-26 only
 * (prospective: those games did not exist when the spec was registered). Proxy lines: probability quality only, no returns.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import type {Stat} from '../src/lib/props/contract.ts';
import {decidePick} from '../src/lib/props/rules.ts';
import {properScore,type Probabilities} from '../src/lib/props/research.ts';
import type {ModelParams} from '../src/lib/props/model.ts';
import {loadBoxCsv,priors,fitDispersion,MODEL_FIXED} from './lib/box-csv.ts';
import {labItems,type LabHistoryItem} from './lib/lab-history.ts';
import {clusteredDifference,holm,calibration,wilson,round} from '../src/lib/lab/stats.ts';
import {calendarRestDays,elapsedRestDays} from '../src/lib/lab/sports/rest-calendar.ts';
import {CHALLENGERS_V2_SPEC as SPEC,CHALLENGERS_V2_SHA256,trainChallenger,predictChallenger,baseMore,disposition,
 type ChallengerArtifact,type ChallengerInput,type FeatureSet,type FoldComparison} from '../src/lib/lab/sports/challengers-v2.ts';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);if(i<0)throw new Error('missing --'+n);return process.argv[i+1];};
const forwardOnly=process.argv.includes('--forward');
const t0=Date.now();
const protocol=JSON.parse(readFileSync(new URL('../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
const pinned=(p:string)=>{const f=loadBoxCsv(p);if(protocol.sourceHashes[f.file!]!==f.sha256)throw new Error('SOURCE_HASH_MISMATCH '+f.file);return f;};
const prior=pinned(arg('prior')),season=pinned(arg('season'));
const current=loadBoxCsv(arg('current'));
const model=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8'));

const SPLIT='2026-01-01T00:00:00.000Z';
const BREAK_EVEN=0.577;   // 2-pick Power Play at 3x; reference only, proxy lines imply no return
const inputOf=(x:LabHistoryItem):ChallengerInput=>({base:x.base,games:x.layer1.games,expMinutes:x.layer1.expMinutes,sdMinutes:x.layer1.sdMinutes,mean:x.mean,line:x.line});
const VARIANTS:{id:string;set:FeatureSet|null}[]=[{id:'base',set:null},{id:'recal',set:'recal'},...SPEC.candidates.map(c=>({id:c.id,set:c.features}))];

function train(items:LabHistoryItem[]){
 const sorted=[...items].sort((a,b)=>a.at.localeCompare(b.at));
 return Object.fromEntries(VARIANTS.map(v=>[v.id,v.set?trainChallenger(v.set,sorted.map(x=>({stat:x.stat,y:x.y,at:x.at,input:inputOf(x)}))):null])) as Record<string,ChallengerArtifact|null>;
}

type Scored={x:LabHistoryItem;preds:Record<string,Probabilities>};
const outcome=(x:LabHistoryItem)=>x.y?'more' as const:'less' as const;

function decisionQuality(rows:Scored[],id:string){
 let q=0,qHit=0,s=0,sHit=0;const side={more:{n:0,hit:0,conf:0},less:{n:0,hit:0,conf:0}};
 for(const r of rows){
  const d=decidePick({status:'scored',...r.preds[id]});
  const moreWins=r.x.y===1;
  if(d.status==='recorded'){q++;const hit=(d.side==='more')===moreWins;if(hit)qHit++;const b=side[d.side];b.n++;b.hit+=hit?1:0;b.conf+=d.probability;}
  else{s++;const favMore=baseMore(r.preds[id])>=0.5;if(favMore===moreWins)sHit++;}
 }
 const w=wilson(qHit,q);
 return {qualified:q,coverage:round(q/rows.length,4),qualifiedHitRate:round(q?qHit/q:null,4),qualifiedHit95:[round(w.lower,4),round(w.upper,4)],
  skipped:s,skippedFavouriteHitRate:round(s?sHit/s:null,4),aboveBreakEvenReference:q?qHit/q>BREAK_EVEN:null,
  bySide:Object.fromEntries((['more','less'] as const).map(k=>[k,{n:side[k].n,hitRate:round(side[k].n?side[k].hit/side[k].n:null,4),
   meanConfidence:round(side[k].n?side[k].conf/side[k].n:null,4),gap:round(side[k].n?(side[k].conf-side[k].hit)/side[k].n:null,4)}]))};
}

function evaluate(label:string,arts:Record<string,ChallengerArtifact|null>,test:LabHistoryItem[]){
 // One observation per key (event|player|stat|line), first wins.
 const unique=[...new Map(test.map(x=>[x.key,x])).values()];
 const rows:Scored[]=unique.map(x=>({x,preds:Object.fromEntries(VARIANTS.map(v=>[v.id,predictChallenger(arts[v.id],x.stat as Stat,inputOf(x))]))}));
 const variants=VARIANTS.map(v=>{
  let b=0,l=0;for(const r of rows){const s=properScore(r.preds[v.id],outcome(r.x));b+=s.brier;l+=s.logLoss;}
  const cal=calibration(rows.map(r=>({p:baseMore(r.preds[v.id]),y:r.x.y})));
  return {id:v.id,n:rows.length,brier:round(b/rows.length,6),logLoss:round(l/rows.length,6),ece:round(cal.ece,5),decisions:decisionQuality(rows,v.id)};
 });
 const comps=SPEC.candidates.map(c=>{
  const diff=(f:'brier'|'logLoss')=>clusteredDifference(rows.map(r=>({cluster:r.x.eventId,candidate:properScore(r.preds[c.id],outcome(r.x))[f],
   reference:properScore(r.preds.recal,outcome(r.x))[f]})),SPEC.bootstrap.replicates,SPEC.bootstrap.seed);
  const brier=diff('brier'),logLoss=diff('logLoss');
  return {candidate:c.id,brier,logLossMean:logLoss?.mean??null,pImprove:brier?.pImprove??1,pAdjusted:null as number|null};
 });
 const adj=holm(comps.map(c=>c.pImprove));comps.forEach((c,i)=>{c.pAdjusted=round(adj[i],6);});
 const recalVsBase=clusteredDifference(rows.map(r=>({cluster:r.x.eventId,candidate:properScore(r.preds.recal,outcome(r.x)).brier,
  reference:properScore(r.preds.base,outcome(r.x)).brier})),SPEC.bootstrap.replicates,SPEC.bootstrap.seed);
 return {label,n:rows.length,games:new Set(rows.map(r=>r.x.eventId)).size,dates:new Set(rows.map(r=>r.x.date)).size,
  from:rows.reduce((m,r)=>!m||r.x.date<m?r.x.date:m,''),to:rows.reduce((m,r)=>r.x.date>m?r.x.date:m,''),
  variants,comparisonsVsRecal:comps,recalVsBase,diagnostics:diagnose(rows)};
}

/** How often the learning layer's elapsed-hours rest disagrees with calendar rest, on the same previous game. */
function restAudit(rows:Scored[]){
 let n=0,elapsedB2B=0,calendarB2B=0,disagree=0,calledB2BButRested=0;
 for(const r of rows){const prev=r.x.layer1.lastPlayed,cal=calendarRestDays(prev,r.x.at);if(cal===null)continue;
  const el=elapsedRestDays(prev,r.x.at);n++;if(el===0)elapsedB2B++;if(cal===0)calendarB2B++;if(el!==cal)disagree++;if(el===0&&cal>0)calledB2BButRested++;}
 return {basis:"player's previous game (layer1.lastPlayed)",lines:n,elapsedDefinitionBackToBack:elapsedB2B,calendarBackToBack:calendarB2B,
  restDaysDisagree:disagree,calledBackToBackButHadRest:calledB2BButRested,shareMislabelledBackToBack:round(n?calledB2BButRested/n:null,4)};
}

/** Exploratory error breakdown of the BASE model's qualified picks, by pre-lock characteristics. Not a test. */
function diagnose(rows:Scored[]){
 const picks=rows.map(r=>{const d=decidePick({status:'scored',...r.preds.base});if(d.status!=='recorded')return null;
  const i=inputOf(r.x);return {r,side:d.side,conf:d.probability,hit:(d.side==='more')===(r.x.y===1),
   cv:i.expMinutes>0?i.sdMinutes/i.expMinutes:1,games:i.games,gap:Math.abs(i.mean-i.line)/Math.max(1,i.line),
   rest:r.x.matchup.restDays,b2b:r.x.matchup.backToBack,opp:r.x.matchup.oppAllowedRatio,calRest:calendarRestDays(r.x.layer1.lastPlayed,r.x.at)};}).filter(Boolean) as
  {r:Scored;side:'more'|'less';conf:number;hit:boolean;cv:number;games:number;gap:number;rest:number;b2b:number;opp:number;calRest:number|null}[];
 const group=(name:string,keyOf:(p:typeof picks[number])=>string)=>{
  const m=new Map<string,typeof picks>();for(const p of picks){const k=keyOf(p);m.set(k,[...(m.get(k)??[]),p]);}
  return {by:name,groups:[...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>{const hits=v.filter(p=>p.hit).length,w=wilson(hits,v.length);
   const conf=v.reduce((a,p)=>a+p.conf,0)/v.length;return {key:k,n:v.length,hitRate:round(hits/v.length,4),meanConfidence:round(conf,4),
    gap:round(conf-hits/v.length,4),hit95:[round(w.lower,3),round(w.upper,3)]};})};
 };
 const band=(x:number,cuts:number[],labels:string[])=>labels[cuts.findIndex(c=>x<c)===-1?labels.length-1:cuts.findIndex(c=>x<c)];
 return {note:'Exploratory: base-model qualified picks on proxy lines. Groups suggest hypotheses; they are not evidence of an effect.',
  picks:picks.length,groups:[
  group('stat',p=>p.r.x.stat),group('side',p=>p.side),
  group('confidence',p=>band(p.conf,[0.65,0.7,0.75],['60-65%','65-70%','70-75%','75-80%'])),
  group('minutes_cv',p=>band(p.cv,[0.15,0.3,0.5],['<0.15','0.15-0.30','0.30-0.50','>=0.50'])),
  group('games_of_history',p=>band(p.games,[6,11,21],['<=5','6-10','11-20','>20'])),
  group('model_vs_line_gap',p=>band(p.gap,[0.15,0.25,0.4],['<15%','15-25%','25-40%','>=40%'])),
  group('rest',p=>p.b2b?'back-to-back':p.rest>=3?'3+ days':'1-2 days'),
  group('opponent_allowed',p=>band(p.opp,[0.95,1.05],['tough (<0.95)','average','weak (>1.05)'])),
  group('rest_calendar_corrected',p=>p.calRest===null?'unknown':p.calRest===0?'back-to-back':p.calRest>=2?'2+ days':'1 day'),
 ],restDefinitionAudit:restAudit(rows)};
}

const pr24=priors(prior.rows);
const prodParams=model.params as ModelParams;
const prodPrior=(a:string)=>model.players[a]?{games:model.players[a].games,minutes:model.players[a].minutes,points:model.players[a].points,
 rebounds:model.players[a].rebounds,assists:model.players[a].assists}:null;
const paramsAll:ModelParams={...MODEL_FIXED,leagueRate:pr24.leagueRate,dispersion:fitDispersion(season.rows,pr24,Date.parse('2100-01-01T00:00:00Z'))};
const all25=labItems(season.rows,paramsAll,a=>pr24.players.get(a)??null);
const cur=labItems(current.rows,prodParams,prodPrior);
const arts2=train(all25.items);
let folds;
if(forwardOnly){
 const fwd=cur.items.filter(x=>x.at>=SPEC.forwardStartsAt);
 if(!fwd.length)throw new Error('NO_FORWARD_GAMES_YET');
 folds=[evaluate('forward (prospective)',arts2,fwd)];
}else{
 const params1:ModelParams={...MODEL_FIXED,leagueRate:pr24.leagueRate,dispersion:fitDispersion(season.rows,pr24,Date.parse('2025-12-31T23:59:59Z'))};
 const f1=labItems(season.rows,params1,a=>pr24.players.get(a)??null);
 const f1train=f1.items.filter(x=>x.at<SPLIT),f1test=f1.items.filter(x=>x.at>=SPLIT);
 const fold1=evaluate('fold1-2025-26-second-half (exploratory)',train(f1train),f1test);
 console.error('fold1',(Date.now()-t0)/1000);
 const fold2=evaluate('fold2-2026-27-to-date (out of season)',arts2,cur.items.filter(x=>x.at<SPEC.forwardStartsAt));
 folds=[fold1,fold2];
}
const byId=(f:typeof folds[number],id:string)=>{const c=f.comparisonsVsRecal.find(x=>x.candidate===id)!;return {candidate:id,brier:c.brier,logLossMean:c.logLossMean,pAdjusted:c.pAdjusted} as FoldComparison;};
const dispositions=forwardOnly?null:Object.fromEntries(SPEC.candidates.map(c=>[c.id,disposition(byId(folds[0],c.id),byId(folds[1],c.id))]));
const artifact={experimentId:SPEC.id,specSha256:CHALLENGERS_V2_SHA256,trainedOn:'all 2025-26 proxy lines',variants:arts2};
const report={generatedBy:'scripts/lab-sports-challengers-v2.ts',experimentId:SPEC.id,specSha256:CHALLENGERS_V2_SHA256,
 preRegistrationCommit:'035625f',evidence:forwardOnly?'prospective':'retrospective',
 caveats:['Proxy lines (floor of last-10 median + 0.5), not platform lines: probability quality only; no virtual or real return is implied.',
  'Fold 1 reuses a season earlier studies inspected; fold 2 is out of season for every trained weight; prospective scoring starts '+SPEC.forwardStartsAt+'.',
  'Diagnostics are exploratory groupings of the base model and are not tests.','Nothing here changes the active model, picks, entries, stakes or budgets.'],
 sources:[...[prior,season].map(f=>({file:f.file,sha256:f.sha256,pinned:true})),{file:current.file,sha256:current.sha256,pinned:false}],
 leakage:{checked:all25.checked+cur.checked,violations:all25.violations+cur.violations},
 spec:SPEC,folds,dispositions,artifact,runtimeSeconds:Math.round((Date.now()-t0)/1000)};
if(report.leakage.violations)throw new Error('LEAKAGE '+report.leakage.violations);
mkdirSync(arg('out'),{recursive:true});
writeFileSync(arg('out')+(forwardOnly?'/forward.json':'/report.json'),JSON.stringify(report,null,1)+'\n');
for(const f of folds){
 console.log(`\n${f.label}: ${f.n} lines, ${f.games} games, ${f.dates} dates (${f.from}..${f.to})`);
 for(const v of f.variants)console.log(' ',v.id.padEnd(12),'brier',v.brier,'logloss',v.logLoss,'ece',v.ece,'qualified',v.decisions.qualified,
  'hit',v.decisions.qualifiedHitRate,'More',JSON.stringify(v.decisions.bySide.more),'Less',JSON.stringify(v.decisions.bySide.less));
 for(const c of f.comparisonsVsRecal)console.log('  vs recal',c.candidate.padEnd(12),'dBrier',c.brier?.mean.toFixed(6),'[',c.brier?.lower95.toFixed(6),c.brier?.upper95.toFixed(6),'] Holm p',c.pAdjusted,'dLogLoss',c.logLossMean?.toFixed(6));
 console.log('  recal vs base dBrier',f.recalVsBase?.mean.toFixed(6),'[',f.recalVsBase?.lower95.toFixed(6),f.recalVsBase?.upper95.toFixed(6),']');
}
if(dispositions)for(const [k,d] of Object.entries(dispositions))console.log('DISPOSITION',k,d.status,'-',d.reason);
