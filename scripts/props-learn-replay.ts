/**
 * Historical replay of the props learning layer against layer 1 (props-nb-minutes-rate-v1).
 *   node --experimental-strip-types scripts/props-learn-replay.ts \
 *     --prior player_box_2025.csv --season player_box_2026.csv --out research/props_learn_replay_20261108
 * Inputs: the pinned SportsDataverse ESPN NBA player box scores (CC BY 4.0), checked against the
 * hashes in research/props_calibration_20261108/protocol.json.
 * Layer 1: priors from 2024-25; NB dispersion fit on 2025-26 games through 2025-12-31.
 * Learning layer: trained on 2025-26 games through 2025-12-31; tested on 2026-01-01 onward.
 * Every feature uses only games that started before the predicted game (counted and enforced).
 * PROXY lines (floor of last-10 median + 0.5), not platform lines; no sportsbook data exists
 * historically, so the market terms stay at zero. This measures probability quality, not profit.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {predictLine,type GameLog,type ModelParams} from '../src/lib/props/model.ts';
import {STATS,MODEL_VERSION,type Stat} from '../src/lib/props/contract.ts';
import {matchupFeatures,type TeamGameRow,type Matchup} from '../src/lib/props/features.ts';
import {FEATURES,MARKET_FEATURES,featureVector,fitRidgeLogistic,chooseLambda,predictLearn,artifactSha256,type LearnArtifact,type LearnRow}
 from '../src/lib/props/learn.ts';
import {summarize,pairedInterval,type EvaluationRow,type Probabilities} from '../src/lib/props/research.ts';
import {loadBoxCsv,proxyLine,statOf,priors,fitDispersion,byAthlete,MODEL_FIXED,type BoxRow} from './lib/box-csv.ts';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
const protocol=JSON.parse(readFileSync(new URL('../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
const SPLIT='2026-01-01T00:00:00.000Z';
const LEAGUE_WINDOW_MS=60*86400_000;

function pinned(path:string){
 const f=loadBoxCsv(path);
 if(protocol.sourceHashes[f.file]!==f.sha256)throw new Error('SOURCE_HASH_MISMATCH: '+f.file);
 return f;
}
const prior=pinned(arg('prior')!),season=pinned(arg('season')!),out=arg('out')!;
const pr=priors(prior.rows);
const dispersion=fitDispersion(season.rows,pr,Date.parse('2025-12-31T23:59:59Z'));
const params:ModelParams={...MODEL_FIXED,leagueRate:pr.leagueRate,dispersion};

// Team rows, time-sorted, so each game's matchup sees only a 60-day window before it.
const teamRows:TeamGameRow[]=season.rows.map(r=>({espnEventId:r.game,teamAbbr:r.team,opponentAbbr:r.opponent,gameStart:r.start,
 minutes:r.log.minutes,points:r.log.points,rebounds:r.log.rebounds,assists:r.log.assists,didNotPlay:r.log.didNotPlay}))
 .sort((a,b)=>a.gameStart.localeCompare(b.gameStart));
const lowerBound=(t:number)=>{let lo=0,hi=teamRows.length;while(lo<hi){const m=(lo+hi)>>1;if(Date.parse(teamRows[m].gameStart)<t)lo=m+1;else hi=m;}return lo;};
const matchupCache=new Map<string,Matchup>();
let checked=0,violations=0;
function matchupFor(r:BoxRow,stat:Stat):Matchup{
 const key=[r.game,r.team,stat].join('|');
 const hit=matchupCache.get(key);if(hit)return hit;
 const lock=Date.parse(r.start);
 const rows=teamRows.slice(lowerBound(lock-LEAGUE_WINDOW_MS-30*86400_000),lowerBound(lock));
 for(const x of rows){checked++;if(Date.parse(x.gameStart)>=lock)violations++;}
 const m=matchupFeatures({teamAbbr:r.team,opponentAbbr:r.opponent,home:r.home,lockAt:r.start,stat,rows});
 matchupCache.set(key,m);return m;
}

type Item={key:string;eventId:string;date:string;stat:Stat;at:string;base:Probabilities;matchup:Matchup;y:0|1};
const items:Item[]=[];
for(const rows of byAthlete(season.rows).values()){
 rows.sort((a,b)=>a.start.localeCompare(b.start));
 rows.forEach((r,i)=>{
  if(r.log.didNotPlay||r.log.minutes===null)return;
  const history:GameLog[]=rows.slice(0,i).map(x=>x.log);
  for(const h of rows.slice(0,i)){checked++;if(Date.parse(h.start)>=Date.parse(r.start))violations++;}
  for(const s of STATS){
   const y=statOf(r.log,s);
   if(y===null||y===undefined)continue;
   const line=proxyLine(history,s);if(line===null)continue;
   const p=predictLine({logs:history,prior:pr.players.get(r.athlete)??null,stat:s,line,cutoff:r.start,params});
   if(p.status!=='scored')continue;
   items.push({key:[r.game,r.athlete,s,line].join('|'),eventId:r.game,date:r.start.slice(0,10),stat:s,at:r.start,
    base:{pMore:p.pMore,pLess:p.pLess,pTie:p.pTie},matchup:matchupFor(r,s),y:y>line?1:0});
  }
 });
}
if(violations!==0)throw new Error('LEAKAGE: '+violations+' inputs at or after lock');

const train=items.filter(x=>x.at<SPLIT),test=items.filter(x=>x.at>=SPLIT);
const weights={} as Record<Stat,number[]>,lambda={} as Record<Stat,number>;
for(const s of STATS){
 const rows:(LearnRow&{at:string})[]=train.filter(x=>x.stat===s).map(x=>({x:featureVector({base:x.base,market:null,matchup:x.matchup}),y:x.y,w:1,at:x.at}));
 lambda[s]=chooseLambda(rows,MARKET_FEATURES);
 weights[s]=fitRidgeLogistic(rows,lambda[s],MARKET_FEATURES);
}
const counts=Object.fromEntries(STATS.map(s=>[s,{historical:train.filter(x=>x.stat===s).length,forward:0,forwardWithBooks:0}])) as LearnArtifact['counts'];
const artifact:LearnArtifact={modelVersion:'props-learn-v0',baseModelVersion:MODEL_VERSION,trainedAt:new Date().toISOString(),dataCutoff:SPLIT,
 features:[...FEATURES],weights,lambda,marketWeightsActive:false,counts};

const evaluation:EvaluationRow[]=test.map(x=>({key:x.key,eventId:x.eventId,date:x.date,stat:x.stat,baseline:x.base,
 candidate:predictLearn(artifact,x.stat,{base:x.base,market:null,matchup:x.matchup}),outcome:x.y?'more':'less'}));
const round=(v:number|null)=>v===null?null:+v.toFixed(5);
const byStat=Object.fromEntries(STATS.map(s=>{
 const rows=evaluation.filter(r=>r.stat===s);
 const layer1=summarize(rows.map(r=>({p:r.baseline,outcome:r.outcome})));
 const learn=summarize(rows.map(r=>({p:r.candidate,outcome:r.outcome})));
 const interval=pairedInterval(rows);
 return [s,{n:rows.length,layer1:{brier:round(layer1.brier),logLoss:round(layer1.logLoss),hitRate:round(layer1.hitRate),decisions:layer1.decisions,decisionHitRate:round(layer1.decisionHitRate)},
  learn:{brier:round(learn.brier),logLoss:round(learn.logLoss),hitRate:round(learn.hitRate),decisions:learn.decisions,decisionHitRate:round(learn.decisionHitRate)},
  brierDifference95:interval?{lower95:round(interval.lower95),upper95:round(interval.upper95),games:interval.games}:null,
  weights:Object.fromEntries(FEATURES.map((f,k)=>[f,round(weights[s][k])])),lambda:lambda[s]}];
}));
const report={generatedBy:'scripts/props-learn-replay.ts',layer1:MODEL_VERSION,candidate:'props-learn (matchup terms only; no historical sportsbook data)',
 design:'Layer-1 priors from 2024-25; dispersion and learning weights fit on 2025-26 games through 2025-12-31; scored on 2026-01-01 onward against proxy lines. Paired game-level bootstrap (1,000 replicates, seed 20261108); negative Brier difference favours the learning layer.',
 sources:[prior,season].map(f=>({file:f.file,sha256:f.sha256})),train:{from:train[0]?.date??null,to:'2025-12-31',rows:train.length},
 test:{from:'2026-01-01',to:test.reduce((m,x)=>x.date>m?x.date:m,''),rows:test.length},leakage:{checked,violations},
 dispersion,artifactSha256:artifactSha256({...artifact,trainedAt:'replay'}),byStat};
mkdirSync(out,{recursive:true});
writeFileSync(out+'/report.json',JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify({train:report.train,test:report.test,leakage:report.leakage,
 byStat:Object.fromEntries(STATS.map(s=>[s,{layer1:byStat[s].layer1.brier,learn:byStat[s].learn.brier,ci:byStat[s].brierDifference95}]))},null,1));
