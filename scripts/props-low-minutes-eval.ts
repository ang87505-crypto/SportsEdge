/**
 * Research challenger props-nb-low-minutes-v1: ONE chronological evaluation on untouched seasons (2013-14..2015-16).
 * Protocol: research/props_low_minutes_v1_20261124/protocol.json; pre-registration
 * docs/PROPS_CHALLENGER_LOW_MINUTES_PREREG_2026_11_24.md. Research only; production stays frozen.
 *
 *   node --experimental-strip-types scripts/props-low-minutes-eval.ts --data <dir with player_box_2012..2016.csv> \
 *     --out research/props_low_minutes_v1_20261124
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {loadBoxCsv} from './lib/box-csv.ts';
import {backtestParams,scoreLines,fitLowMinutes,lowMinutesQ,fitBeta,opponentQ,pairedDiffBy,bucket,LOW_MINUTES_MAX,type Line} from './lib/props-breakdown.ts';
import {decide} from './props-opponent-eval.ts';

const protocol=JSON.parse(readFileSync(new URL('../research/props_low_minutes_v1_20261124/protocol.json',import.meta.url),'utf8'));
const REPS=protocol.uncertainty.replicates as number,SEED=protocol.uncertainty.seed as number;
type Src={file:string;sha256:string};
function score(dir:string,prior:Src,season:Src){
 const p=loadBoxCsv(dir+'/'+prior.file),s=loadBoxCsv(dir+'/'+season.file);
 for(const [f,want] of [[p,prior],[s,season]] as const)if(f.sha256!==want.sha256)throw new Error('SOURCE_HASH_MISMATCH '+want.file+' '+f.sha256);
 const {params,priorOf}=backtestParams(p.rows);
 return scoreLines(s.rows,params,priorOf);
}
/** Combined challenger (descriptive only): opponent rate scaling, then the low-minutes adjustment on the scaled rate. */
export function combinedQ(l:Line,a:{m:number;s:number},beta:number){
 const f=l.opp===null?1:l.opp;
 return lowMinutesQ({...l,rate:l.rate*f**beta,q:opponentQ(l,beta)},a);
}

if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file://').href){
 const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);if(i<0||!process.argv[i+1])throw new Error('missing --'+n);return process.argv[i+1];};
 const dir=arg('data'),out=arg('out');
 type Tagged=Line&{adj:{m:number;s:number};beta:Record<string,number>};
 const folds:Record<string,unknown>[]=[],testLines:Tagged[]=[],diffs:ReturnType<typeof pairedDiffBy>[]=[];
 for(const f of protocol.folds){
  const fit=score(dir,f.fit.prior,f.fit.season),adj=fitLowMinutes(fit.lines),beta=fitBeta(fit.lines);
  const test=score(dir,f.test.prior,f.test.season),lines=test.lines.map(l=>({...l,adj:{m:adj.m,s:adj.s},beta})) as Tagged[];
  const q=(l:Tagged)=>lowMinutesQ(l,l.adj),low=lines.filter(l=>l.expMinutes<LOW_MINUTES_MAX);
  const d=pairedDiffBy(lines,l=>q(l as Tagged),REPS,SEED);diffs.push(d);testLines.push(...lines);
  // Descriptive: combined vs opponent alone (pairedDiffBy's baseline is l.q, so re-base the line on the opponent model).
  const asOpp=lines.map(l=>({...l,q:opponentQ(l,beta[l.stat])}));
  folds.push({label:f.label,adjustment:adj,opponentBeta:beta,fitLines:fit.lines.length,testLines:lines.length,lowMinuteLines:low.length,
   leakage:{fit:fit.leakage,test:test.leakage},paired:d,segment:pairedDiffBy(low,l=>q(l as Tagged),REPS,SEED),
   segmentBaseline:bucket(low),segmentChallenger:bucket(low.map(l=>({...l,q:q(l)}))),
   combinedVsOpponent:pairedDiffBy(asOpp,l=>combinedQ(l,adj,beta[l.stat]),REPS,SEED)});
  console.error(f.label,'m',adj.m,'s',adj.s,'brier diff',d.brier.mean.toExponential(3),'CI',d.brier.lo.toExponential(3),d.brier.hi.toExponential(3));
 }
 const pooled=pairedDiffBy(testLines,l=>lowMinutesQ(l,(l as Tagged).adj),REPS,SEED),verdict=decide(pooled,diffs);
 mkdirSync(out,{recursive:true});
 writeFileSync(out+'/results.json',JSON.stringify({generatedBy:'scripts/props-low-minutes-eval.ts',challenger:protocol.id,
  status:'ONE pre-registered chronological evaluation on untouched seasons',folds,pooled,verdict,
  baselineMeanBrier:testLines.reduce((a,l)=>a+(l.q-l.y)**2,0)/testLines.length},null,1)+'\n');
 console.log(JSON.stringify({status:'WRITTEN',verdict,pooledBrierDiff:pooled.brier,pooledLogLossDiff:pooled.logLoss.mean}));
}
