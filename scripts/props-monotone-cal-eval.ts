/**
 * Research challenger props-nb-monotone-cal-v1. Research only; never used by the live worker.
 * Protocol: research/props_monotone_cal_v1_20261120/protocol.json (committed before any 2021-24 line was scored).
 *
 *   diagnose  exploratory error breakdown on the already-inspected 2025-26 season (motivation only, not evidence)
 *     node --experimental-strip-types scripts/props-monotone-cal-eval.ts diagnose --prior player_box_2025.csv \
 *       --training player_box_2026.csv --out research/props_monotone_cal_v1_20261120
 *   fit       retrospective calibrator on 2022-23 (scored from 2021-22) and forward calibrator on 2025-26
 *     node --experimental-strip-types scripts/props-monotone-cal-eval.ts fit --retro-prior player_box_2022.csv \
 *       --retro-training player_box_2023.csv --forward-prior player_box_2025.csv --forward-training player_box_2026.csv \
 *       --out research/props_monotone_cal_v1_20261120
 *   evaluate  ONE scoring of the untouched 2023-24 holdout (baseline parameters from 2022-23, backtest design)
 *     node --experimental-strip-types scripts/props-monotone-cal-eval.ts evaluate --prior player_box_2023.csv \
 *       --holdout player_box_2024.csv --fit research/props_monotone_cal_v1_20261120/fit.json --out research/props_monotone_cal_v1_20261120
 *   forward   production artifact on 2026-27 games from 2026-11-19T12:00Z (prospective; re-run as games accrue)
 *     node --experimental-strip-types scripts/props-monotone-cal-eval.ts forward --season player_box_2027.csv \
 *       --fit research/props_monotone_cal_v1_20261120/fit.json --out <dir>
 * PROXY lines (floor of last-10 median + 0.5) from earlier games only: probability quality, not returns.
 */
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {STATS} from '../src/lib/props/contract.ts';
import type {ModelParams,PriorSummary} from '../src/lib/props/model.ts';
import {fitMonotoneCalibration,calibrate,calibrationDigest,MIN_TRAINING_LINES_PER_STAT,type MonotoneCalibration} from '../src/lib/props/monotone-calibration.ts';
import {brier,logLoss,ece,reliability,confidenceBands,murphy,auc,spread,pairedGameBootstrap,
 fitSingleSlopeRecal,applyRecal,decide,type EvalLine} from '../src/lib/props/calibration-eval.ts';
import {loadBoxCsv,priors,fitDispersion,MODEL_FIXED} from './lib/box-csv.ts';
import {scoreSeason,backtestParams,type Scored} from './lib/props-season-score.ts';

const PROTOCOL_PATH='research/props_monotone_cal_v1_20261120/protocol.json';
const protocol=JSON.parse(readFileSync(new URL('../'+PROTOCOL_PATH,import.meta.url),'utf8'));
const REPS=protocol.uncertainty.replicates as number,SEED=protocol.uncertainty.seed as number;
const FORWARD_START='2026-11-19T12:00:00Z';
const FORWARD_MIN={lines:5000,games:150};
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
const need=(n:string)=>{const v=arg(n);if(!v)throw new Error('missing --'+n);return v;};
const r6=(x:number)=>Math.round(x*1e6)/1e6;

function pinned(path:string,arm:'retrospective'|'forward',role:string){
 const f=loadBoxCsv(path),want=protocol.sources[arm][role];
 if(!want||f.file!==want.file||f.sha256!==want.sha256)throw new Error(`SOURCE_HASH_MISMATCH ${arm}.${role}: ${f.file} ${f.sha256}`);
 return f;
}
type Fitted={monotone:MonotoneCalibration;digest:string;recal:Record<string,{intercept:number;slope:number}>};
function fitArm(lines:Scored[]):Fitted{
 const rows=lines.map(l=>({stat:l.stat,q:l.q,y:l.y}));
 const monotone=fitMonotoneCalibration(rows,STATS);
 return {monotone,digest:calibrationDigest(monotone),recal:fitSingleSlopeRecal(rows,STATS)};
}
function toEval(lines:Scored[],fit:Fitted):EvalLine[]{
 return lines.map(l=>({game:l.game,date:l.date,stat:l.stat,y:l.y,
  p:{base:l.q,challenger:calibrate(fit.monotone,l.stat,l.q),recal:applyRecal(fit.recal[l.stat],l.q)}}));
}
function modelSummary(rs:EvalLine[],m:string){
 const meanP=rs.reduce((a,r)=>a+r.p[m],0)/rs.length,obs=rs.reduce((a,r)=>a+r.y,0)/rs.length;
 return {brier:r6(brier(rs,m)),logLoss:r6(logLoss(rs,m)),ece:r6(ece(rs,m)),auc:r6(auc(rs,m)),spread:r6(spread(rs,m)),
  murphy:murphy(rs,m),calibrationInTheLarge:r6(meanP-obs),reliability:reliability(rs,m),confidenceBands:confidenceBands(rs,m)};
}
function evaluation(rs:EvalLine[],trainingLinesPerStat:Record<string,number>,minimums?:{lines:number;games:number}){
 const games=new Set(rs.map(r=>r.game)).size;
 const boot=(sub:EvalLine[],a='challenger',b='base')=>sub.length?pairedGameBootstrap(sub,a,b,REPS,SEED):null;
 const conf=(r:EvalLine)=>Math.max(r.p.base,1-r.p.base);
 const hc=(t:number)=>{const sub=rs.filter(r=>conf(r)>=t);return {threshold:t,lines:sub.length,games:new Set(sub.map(r=>r.game)).size,
  baseline:sub.length?{brier:r6(brier(sub,'base')),hitRate:r6(sub.filter(r=>(r.p.base>=0.5)===(r.y===1)).length/sub.length)}:null,
  challenger:sub.length?{brier:r6(brier(sub,'challenger'))}:null,
  recal:sub.length?{brier:r6(brier(sub,'recal'))}:null,
  challengerVsBase:sub.length>=(t===0.7?1:200)?boot(sub):null};};
 const highConfidence={c70:hc(0.7),c80:hc(0.8),c90:hc(0.9)};
 const subgroups:Record<string,ReturnType<typeof boot>>={
  More:boot(rs.filter(r=>r.p.base>=0.5)),Less:boot(rs.filter(r=>r.p.base<0.5)),
  ...Object.fromEntries(STATS.map(s=>[s,boot(rs.filter(r=>r.stat===s))]))};
 const overall=boot(rs)!;
 const models={base:modelSummary(rs,'base'),challenger:modelSummary(rs,'challenger'),recal:modelSummary(rs,'recal')};
 const challengerVsRecal=boot(rs,'challenger','recal');
 const decision=decide({lines:rs.length,games,trainingLinesPerStat,minTrainingLinesPerStat:MIN_TRAINING_LINES_PER_STAT,
  overall,highConfidence70:highConfidence.c70.challengerVsBase,subgroups,
  resolution:{challenger:models.challenger.murphy.resolution,baseline:models.base.murphy.resolution},
  auc:{challenger:models.challenger.auc,baseline:models.base.auc},spread:{challenger:models.challenger.spread,baseline:models.base.spread},
  vsTestedRecalBrier:challengerVsRecal!.brier.difference},minimums);
 return {...decision,lines:rs.length,games,window:[rs[0]?.date??null,rs.at(-1)?.date??null],
  primary:overall,highConfidence,subgroups,
  comparator:{recalVsBase:boot(rs,'recal','base'),challengerVsRecal},
  models,
  byStat:Object.fromEntries(STATS.map(s=>{const sub=rs.filter(r=>r.stat===s);
   return [s,{lines:sub.length,base:{brier:r6(brier(sub,'base')),ece:r6(ece(sub,'base'))},challenger:{brier:r6(brier(sub,'challenger')),ece:r6(ece(sub,'challenger'))},
    challengerConfidenceBands:confidenceBands(sub,'challenger'),baseConfidenceBands:confidenceBands(sub,'base')}];}))};
}

const LIMITS=['Proxy lines, not platform lines: probability quality only, no returns or profitability.',
 'Only players who played are scored (platforms void DNPs).',
 'Recalibration uses only the baseline probability and the stat; it cannot recover information the baseline lacks.'];

const mode=process.argv[2];
const out=need('out');mkdirSync(out,{recursive:true});
if(mode==='diagnose'){
 const prior=pinned(need('prior'),'forward','trainingPrior'),training=pinned(need('training'),'forward','training');
 const pr=priors(prior.rows);
 const params:ModelParams={...MODEL_FIXED,leagueRate:pr.leagueRate,dispersion:fitDispersion(training.rows,pr,Date.parse('2025-12-31T23:59:59Z'))};
 const s=scoreSeason(training.rows,params,a=>pr.players.get(a)??null);
 const test=s.lines.filter(l=>l.start>='2026-01-01');
 const gap=(sub:Scored[])=>{const c=sub.map(l=>Math.max(l.q,1-l.q)),h=sub.map((l):number=>(l.q>=0.5)===(l.y===1)?1:0);
  const mc=c.reduce((a,b)=>a+b,0)/sub.length,mh=h.reduce((a,b)=>a+b,0)/sub.length;
  return {lines:sub.length,meanConfidence:r6(mc),hitRate:r6(mh),gap:r6(mc-mh)};};
 const by=(key:(l:Scored)=>string)=>{const g=new Map<string,Scored[]>();for(const l of test)g.set(key(l),[...(g.get(key(l))??[]),l]);
  return Object.fromEntries([...g.keys()].sort().map(k=>[k,gap(g.get(k)!)]));};
 const band=(l:Scored)=>{const c=Math.max(l.q,1-l.q);return (c>=0.9?'0.90+':c>=0.8?'0.80-0.90':c>=0.7?'0.70-0.80':c>=0.6?'0.60-0.70':'0.50-0.60')+(l.q>=0.5?' More':' Less');};
 const diag={generatedBy:'scripts/props-monotone-cal-eval.ts diagnose',status:'EXPLORATORY: 2025-26 was inspected by earlier studies; this motivated the hypothesis and is not evidence',
  sources:[prior,training].map(f=>({file:f.file,sha256:f.sha256})),window:'2026-01-01 to season end',leakage:s.leakage,lines:test.length,
  byBandAndDirection:by(band),
  byLineDistanceZ:by(l=>l.f.z<0.25?'a <0.25':l.f.z<0.5?'b 0.25-0.5':l.f.z<0.75?'c 0.5-0.75':l.f.z<1?'d 0.75-1':'e >=1'),
  byExpectedMinutes:by(l=>l.f.expMinutes<15?'a <15':l.f.expMinutes<25?'b 15-25':l.f.expMinutes<32?'c 25-32':'d 32+'),
  byHistoryGames:by(l=>l.f.games<6?'a 3-5':l.f.games<11?'b 6-10':'c 11-20'),
  byMinutesCv:by(l=>l.f.cv<0.08?'a <0.08':l.f.cv<0.12?'b 0.08-0.12':l.f.cv<0.18?'c 0.12-0.18':l.f.cv<0.28?'d 0.18-0.28':'e >=0.28'),
  byStat:by(l=>l.stat)};
 writeFileSync(out+'/diagnostics-2025-26-exploratory.json',JSON.stringify(diag,null,1)+'\n');
 console.log(JSON.stringify({lines:diag.lines,byBandAndDirection:diag.byBandAndDirection},null,1));
}else if(mode==='fit'){
 const rp=pinned(need('retro-prior'),'retrospective','trainingPrior'),rt=pinned(need('retro-training'),'retrospective','training');
 const fp=pinned(need('forward-prior'),'forward','trainingPrior'),ft=pinned(need('forward-training'),'forward','training');
 const retroBase=backtestParams(rp.rows);
 const retroScored=scoreSeason(rt.rows,retroBase.params,retroBase.priorOf);
 const fpr=priors(fp.rows);
 const fParams:ModelParams={...MODEL_FIXED,leagueRate:fpr.leagueRate,dispersion:fitDispersion(ft.rows,fpr,Date.parse('2025-12-31T23:59:59Z'))};
 const fwdScored=scoreSeason(ft.rows,fParams,a=>fpr.players.get(a)??null);
 const retrospective=fitArm(retroScored.lines),forward=fitArm(fwdScored.lines);
 const fit={generatedBy:'scripts/props-monotone-cal-eval.ts fit',protocol:PROTOCOL_PATH,challenger:'props-nb-monotone-cal-v1',
  retrospective:{sources:[rp,rt].map(f=>({file:f.file,sha256:f.sha256,regularSeasonRows:f.rows.length})),
   baselineParams:{design:'backtest: priors and dispersion from 2021-22 only',dispersion:retroBase.params.dispersion,leagueRate:retroBase.params.leagueRate},
   leakage:retroScored.leakage,pushes:retroScored.pushes,lines:retroScored.lines.length,...retrospective},
  forward:{sources:[fp,ft].map(f=>({file:f.file,sha256:f.sha256,regularSeasonRows:f.rows.length})),
   baselineParams:{design:'PR #191 training pipeline: 2024-25 priors, dispersion through 2025-12-31',dispersion:fParams.dispersion},
   leakage:fwdScored.leakage,pushes:fwdScored.pushes,lines:fwdScored.lines.length,...forward}};
 writeFileSync(out+'/fit.json',JSON.stringify(fit,null,1)+'\n');
 console.log(JSON.stringify({retrospective:{lines:fit.retrospective.lines,trainingLines:retrospective.monotone.trainingLines,digest:retrospective.digest,recal:retrospective.recal},
  forward:{lines:fit.forward.lines,digest:forward.digest,recal:forward.recal}},null,1));
}else if(mode==='evaluate'){
 const prior=pinned(need('prior'),'retrospective','training'),holdout=pinned(need('holdout'),'retrospective','holdout');
 const fit=JSON.parse(readFileSync(need('fit'),'utf8'));
 if(calibrationDigest(fit.retrospective.monotone)!==fit.retrospective.digest)throw new Error('FIT_DIGEST_MISMATCH');
 const base=backtestParams(prior.rows);
 const scored=scoreSeason(holdout.rows,base.params,base.priorOf);
 const rs=toEval(scored.lines,fit.retrospective);
 const result={generatedBy:'scripts/props-monotone-cal-eval.ts evaluate',protocol:PROTOCOL_PATH,challenger:'props-nb-monotone-cal-v1',
  arm:'retrospective untouched 2023-24 holdout (decides the verdict)',
  baseline:'props-nb-minutes-rate-v1 algorithm, backtest design: priors and dispersion from 2022-23 only',
  source:{file:holdout.file,sha256:holdout.sha256,regularSeasonRows:holdout.rows.length},prior:{file:prior.file,sha256:prior.sha256},
  calibratorDigest:fit.retrospective.digest,leakage:scored.leakage,pushes:scored.pushes,
  bootstrap:{replicates:REPS,seed:SEED,unit:'game'},...evaluation(rs,fit.retrospective.monotone.trainingLines),limitations:LIMITS};
 writeFileSync(out+'/report.json',JSON.stringify(result,null,1)+'\n');
 console.log(JSON.stringify({verdict:result.verdict,requirements:result.requirements,lines:result.lines,games:result.games,primary:result.primary,
  highConfidence70:result.highConfidence.c70,comparator:result.comparator},null,1));
}else if(mode==='forward'){
 const season=loadBoxCsv(need('season'));
 if(season.file!=='player_box_2027.csv')throw new Error('FORWARD_EXPECTS_player_box_2027.csv');
 const fit=JSON.parse(readFileSync(need('fit'),'utf8'));
 if(calibrationDigest(fit.forward.monotone)!==fit.forward.digest)throw new Error('FIT_DIGEST_MISMATCH');
 const production=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8'));
 const players=production.players as Record<string,PriorSummary>;
 const scored=scoreSeason(season.rows,production.params as ModelParams,a=>players[a]??null,FORWARD_START);
 const rs=toEval(scored.lines,fit.forward);
 const games=new Set(rs.map(r=>r.game)).size;
 const sufficient=rs.length>=FORWARD_MIN.lines&&games>=FORWARD_MIN.games;
 const result={generatedBy:'scripts/props-monotone-cal-eval.ts forward',protocol:PROTOCOL_PATH,challenger:'props-nb-monotone-cal-v1',
  arm:'prospective forward window (production artifact)',windowStart:FORWARD_START,minimum:FORWARD_MIN,
  source:{file:season.file,sha256:season.sha256,regularSeasonRows:season.rows.length},calibratorDigest:fit.forward.digest,
  leakage:scored.leakage,pushes:scored.pushes,
  ...(sufficient?evaluation(rs,fit.forward.monotone.trainingLines,FORWARD_MIN):{verdict:'INSUFFICIENT_EVIDENCE' as const,lines:rs.length,games}),limitations:LIMITS};
 writeFileSync(out+'/forward-report.json',JSON.stringify(result,null,1)+'\n');
 console.log(JSON.stringify({verdict:result.verdict,lines:rs.length,games,source:result.source},null,1));
}else throw new Error('usage: diagnose | fit | evaluate | forward');
