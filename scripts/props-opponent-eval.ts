/**
 * Research challenger props-nb-opponent-rate-v1: ONE chronological evaluation on untouched seasons.
 * Protocol: research/props_opponent_rate_v1_20261124/protocol.json (committed before any 2016-17..2020-21 line was scored).
 * Pre-registration: docs/PROPS_CHALLENGER_OPPONENT_RATE_PREREG_2026_11_24.md. Research only; production stays frozen.
 *
 *   node --experimental-strip-types scripts/props-opponent-eval.ts --data <dir with player_box_YYYY.csv> \
 *     --out research/props_opponent_rate_v1_20261124
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {STATS} from '../src/lib/props/contract.ts';
import {loadBoxCsv} from './lib/box-csv.ts';
import {backtestParams,scoreLines,fitBeta,pairedDiff,pairedDiffBy,opponentQ,oppSlope,bucket,type Line} from './lib/props-breakdown.ts';

const protocol=JSON.parse(readFileSync(new URL('../research/props_opponent_rate_v1_20261124/protocol.json',import.meta.url),'utf8'));
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);if(i<0||!process.argv[i+1])throw new Error('missing --'+n);return process.argv[i+1];};
const REPS=protocol.uncertainty.replicates as number,SEED=protocol.uncertainty.seed as number;

type Src={file:string;sha256:string};
function pinned(dir:string,s:Src){
 const f=loadBoxCsv(dir+'/'+s.file);
 if(f.sha256!==s.sha256)throw new Error('SOURCE_HASH_MISMATCH '+s.file+' '+f.sha256);
 return f;
}
function score(dir:string,prior:Src,season:Src){
 const p=pinned(dir,prior),s=pinned(dir,season),{params,priorOf}=backtestParams(p.rows);
 return scoreLines(s.rows,params,priorOf);
}

export function decide(pooled:ReturnType<typeof pairedDiff>,folds:ReturnType<typeof pairedDiff>[]){
 if(pooled.brier.lo>0)return 'WORSE';
 if(pooled.brier.hi<0&&folds.every(f=>f.brier.mean<0)&&pooled.logLoss.mean<0)return 'QUALIFIES_FOR_FORWARD_TEST';
 return 'NO_CLEAR_EFFECT';
}

if(import.meta.url===new URL(process.argv[1],'file://').href){
 const dir=arg('data'),out=arg('out');
 const folds:Record<string,unknown>[]=[],testLines:Line[]=[],betas:Record<string,Record<string,number>>={};
 const diffs:ReturnType<typeof pairedDiff>[]=[];
 for(const f of protocol.folds){
  const fit=score(dir,f.fit.prior,f.fit.season),beta=fitBeta(fit.lines);
  const test=score(dir,f.test.prior,f.test.season);
  // Each test line carries its own fold's beta; the pooled statistic is over all test lines.
  for(const l of test.lines)(l as Line&{beta:number}).beta=beta[l.stat];
  const d=pairedDiff(test.lines,beta,REPS,SEED);diffs.push(d);betas[f.label]=beta;
  testLines.push(...test.lines);
  const byStat=Object.fromEntries(STATS.map(s=>[s,pairedDiff(test.lines.filter(l=>l.stat===s),beta,REPS,SEED)]));
  folds.push({label:f.label,beta,fitLines:fit.lines.length,fitLeakage:fit.leakage,testLines:test.lines.length,testLeakage:test.leakage,
   pushes:test.pushes,paired:d,byStat,
   baseline:bucket(test.lines),challenger:bucket(test.lines.map(l=>({...l,q:opponentQ(l,beta[l.stat])}))),
   residualSlope:{baseline:oppSlope(test.lines,l=>l.q,REPS,SEED),challenger:oppSlope(test.lines,l=>opponentQ(l,beta[l.stat]),REPS,SEED)}});
  console.error(f.label,'beta',JSON.stringify(beta),'brier diff',d.brier.mean.toExponential(3),'CI',d.brier.lo.toExponential(3),d.brier.hi.toExponential(3));
 }
 // Pooled over all test lines, each scored with its own fold's beta (fitted only on the preceding season).
 const pooled=pairedDiffBy(testLines,l=>opponentQ(l,(l as Line&{beta:number}).beta),REPS,SEED);
 const verdict=decide(pooled,diffs);
 mkdirSync(out,{recursive:true});
 writeFileSync(out+'/results.json',JSON.stringify({generatedBy:'scripts/props-opponent-eval.ts evaluate',challenger:protocol.id,
  status:'ONE pre-registered chronological evaluation on untouched seasons',betas,folds,pooled,verdict,
  baselineMeanBrier:testLines.reduce((a,l)=>a+(l.q-l.y)**2,0)/testLines.length},null,1)+'\n');
 console.log(JSON.stringify({status:'WRITTEN',verdict,pooledBrierDiff:pooled.brier,pooledLogLossDiff:pooled.logLoss.mean}));
}
