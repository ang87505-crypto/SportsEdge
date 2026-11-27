/**
 * EXPLORATORY error breakdown of the frozen NBA props baseline (props-nb-minutes-rate-v1) on proxy lines.
 * Research only: reads local SportsDataverse box-score CSVs; no network, database, provider or production change.
 *
 *   node --experimental-strip-types scripts/props-error-breakdown.ts \
 *     --season 2023-24:player_box_2023.csv:player_box_2024.csv --season 2024-25:player_box_2024.csv:player_box_2025.csv \
 *     --season 2025-26:player_box_2025.csv:player_box_2026.csv \
 *     --calibrator <fit.json from PR #208, research/props_monotone_cal_v1_20261120> --out research/props_error_breakdown_20261124
 *
 * Each --season is label:priorCsv:scoredCsv. The calibrator applied is the RETROSPECTIVE map (fit on 2022-23 only),
 * which is out of sample for 2023-24 onward. Seasons used here were inspected by earlier studies: motivation only.
 */
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {STATS} from '../src/lib/props/contract.ts';
import {loadBoxCsv} from './lib/box-csv.ts';
import {backtestParams,scoreLines,breakdown,applyKnots,oppSlope,clusteredMean,type Line,type Knot} from './lib/props-breakdown.ts';

export const RETRO_CALIBRATOR_DIGEST='48d148d8f08a32d5f3b61afedd1d9991acfd0a0bea249a5f749f9eddabbb8257';
const REPS=1000,SEED=20261124;
const args=process.argv.slice(2),vals=(n:string)=>args.flatMap((a,i)=>a==='--'+n?[args[i+1]]:[]);
const one=(n:string)=>{const v=vals(n);if(v.length!==1)throw new Error('need exactly one --'+n);return v[0];};

const cal=JSON.parse(readFileSync(one('calibrator'),'utf8'));
const retro=cal.retrospective?.monotone;
if(cal.retrospective?.digest!==RETRO_CALIBRATOR_DIGEST||
 createHash('sha256').update(JSON.stringify(retro)).digest('hex')!==RETRO_CALIBRATOR_DIGEST)throw new Error('CALIBRATOR_DIGEST_MISMATCH');
const calQ=(l:Line)=>applyKnots(retro.byStat[l.stat].knots as Knot[],l.q);

const out:Record<string,unknown>={generatedBy:'scripts/props-error-breakdown.ts',
 status:'EXPLORATORY: every season here was inspected by earlier studies; findings motivate a hypothesis, they are not evidence',
 calibrator:{applied:'retrospective (fit on 2022-23 only)',digest:RETRO_CALIBRATOR_DIGEST},
 definitions:{gap:'mean confidence of the chosen side minus its hit rate (positive = overconfident)',
  bias:'mean(y - q) on P(more): positive = the stat lands above the line more often than predicted',
  opponent:'opponent allowed per-minute rate / league per-minute rate, this season, games strictly before; null before 10 games'},
 bootstrap:{replicates:REPS,seed:SEED,cluster:'game'},seasons:{}};
for(const spec of vals('season')){
 const [label,priorPath,seasonPath]=spec.split(':');
 const prior=loadBoxCsv(priorPath),season=loadBoxCsv(seasonPath);
 const {params,priorOf}=backtestParams(prior.rows);
 const scored=scoreLines(season.rows,params,priorOf);
 const ls=scored.lines;
 const oppSlopes=Object.fromEntries([...STATS,'all'].map(s=>{const x=s==='all'?ls:ls.filter(l=>l.stat===s);
  return [s,{baseline:oppSlope(x,l=>l.q,REPS,SEED),calibrated:oppSlope(x,calQ,REPS,SEED)}];}));
 const lowMinutes=ls.filter(l=>l.expMinutes<15);
 (out.seasons as Record<string,unknown>)[label]={sources:[{file:prior.file,sha256:prior.sha256,role:'prior'},{file:season.file,sha256:season.sha256,role:'scored'}],
  leakage:scored.leakage,pushes:scored.pushes,lines:ls.length,
  baseline:breakdown(ls),calibrated:breakdown(ls,calQ),
  opponentResidualSlope:oppSlopes,
  lowMinutesGapCalibrated:clusteredMean(lowMinutes.map(l=>{const q=calQ(l),c=Math.max(q,1-q);return {game:l.game,v:c-(q>=0.5?l.y:1-l.y)};}),REPS,SEED)};
 console.error(label,'lines',ls.length,'leakage',scored.leakage.violations);
}
const dir=one('out');mkdirSync(dir,{recursive:true});
writeFileSync(dir+'/breakdown-exploratory.json',JSON.stringify(out,null,1)+'\n');
console.log(JSON.stringify({status:'WRITTEN',file:dir+'/breakdown-exploratory.json'}));
