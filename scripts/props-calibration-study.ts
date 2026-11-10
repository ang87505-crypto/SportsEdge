/** Reproducible research only. Does not import the betting worker or access any account. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {predictLine,type GameLog,type PriorSummary,type ModelParams} from '../src/lib/props/model.ts';
import {temperatureScale,properScore,summarize,pairedInterval,type EvaluationRow,type Probabilities} from '../src/lib/props/research.ts';
import {MODEL_VERSION,STATS,type Stat} from '../src/lib/props/contract.ts';
import {NBA_TEAMS} from '../src/lib/props/identity.ts';

const protocol=JSON.parse(readFileSync(new URL('../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
function csv(text:string){
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
  else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(c!=='\r')cell+=c;}
 if(cell||row.length){row.push(cell);rows.push(row);}
 const [head,...body]=rows;return body.filter(r=>r.length===head.length).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]])));
}
type Row={athlete:string;game:string;start:string;log:GameLog};
function load(path:string,expected:string){
 const raw=readFileSync(path),sha256=createHash('sha256').update(raw).digest('hex');
 if(sha256!==expected)throw new Error('SOURCE_HASH_MISMATCH: '+path);
 const rows:Row[]=[];
 for(const r of csv(raw.toString())){
  if(r.season_type!=='2'||!(r.team_abbreviation in NBA_TEAMS)||!(r.opponent_team_abbreviation in NBA_TEAMS))continue;
  const dnp=r.did_not_play==='true',v=(s:string)=>dnp||s===''?null:Number(s);
  const start=new Date(r.game_date_time.replace(/([+-]\d\d)(\d\d)$/,'$1:$2')).toISOString();
  const log:GameLog={gameStart:start,didNotPlay:dnp,minutes:v(r.minutes),points:v(r.points),rebounds:v(r.rebounds),assists:v(r.assists),seasonType:'regular'};
  if([log.minutes,log.points,log.rebounds,log.assists].some(x=>x!==null&&(!Number.isFinite(x)||x<0)))throw new Error('INVALID_SOURCE_VALUE');
  rows.push({athlete:r.athlete_id,game:r.game_id,start,log});
 }
 return {rows,sha256};
}
const statOf=(g:GameLog,s:Stat)=>g[s];
function group(rows:Row[]){const groups=new Map<string,Row[]>();for(const r of rows){const g=groups.get(r.athlete)??[];g.push(r);groups.set(r.athlete,g);}return [...groups.values()].map(g=>g.sort((a,b)=>a.start.localeCompare(b.start)));}
function priorSummary(rows:Row[]){
 const players=new Map<string,PriorSummary>();const totals={minutes:0,points:0,rebounds:0,assists:0};
 for(const r of rows){const g=r.log;if(g.didNotPlay||g.minutes===null||g.minutes<=0||STATS.some(s=>g[s]===null))continue;
  const p=players.get(r.athlete)??{games:0,minutes:0,points:0,rebounds:0,assists:0};p.games++;p.minutes+=g.minutes;totals.minutes+=g.minutes;
  for(const s of STATS){p[s]+=g[s]!;totals[s]+=g[s]!;}players.set(r.athlete,p);}
 return {players,leagueRate:Object.fromEntries(STATS.map(s=>[s,Math.round(totals[s]/totals.minutes*1e6)/1e6])) as Record<Stat,number>};
}
const priorPath=arg('prior'),seasonPath=arg('season'),out=arg('out');
if(!priorPath||!seasonPath||!out)throw new Error('usage: props-calibration-study.ts --prior FILE --season FILE --out DIRECTORY');
const prior=load(priorPath,protocol.sourceHashes['player_box_2025.csv']),season=load(seasonPath,protocol.sourceHashes['player_box_2026.csv']);
const pr=priorSummary(prior.rows),groups=group(season.rows);
const params:ModelParams={version:MODEL_VERSION,minMinutesForRate:6,minCurrentGames:3,maxGapDays:21,minutesHalfLife:4,rateHalfLife:8,
 maxGames:20,priorStrengthMinutes:120,priorMinMinutes:300,maxMinutes:53,leagueRate:pr.leagueRate,dispersion:{points:1e9,rebounds:1e9,assists:1e9}};
const acc=Object.fromEntries(STATS.map(s=>[s,{sq:0,mu:0,mu2:0,minVar:0}])) as Record<Stat,{sq:number;mu:number;mu2:number;minVar:number}>;
const fitUntil=Date.parse(protocol.dispersionFitThrough+'T23:59:59Z');
for(const rows of groups)for(let i=0;i<rows.length;i++){
 const r=rows[i];if(Date.parse(r.start)>fitUntil||r.log.didNotPlay||r.log.minutes===null||STATS.some(s=>r.log[s]===null))continue;
 for(const stat of STATS){const p=predictLine({logs:rows.slice(0,i).map(x=>x.log),prior:pr.players.get(r.athlete)??null,stat,line:0.5,cutoff:r.start,params});
  if(p.status!=='scored')continue;const a=acc[stat];a.sq+=(r.log[stat]!-p.mean)**2;a.mu+=p.mean;a.mu2+=p.mean**2;a.minVar+=(p.inputs.rate*p.inputs.sdMinutes)**2;}
}
for(const s of STATS){const a=acc[s],inv=(a.sq-a.mu-a.minVar)/a.mu2;params.dispersion[s]=inv>0?Math.round(1/inv*1e4)/1e4:1e6;}
type Sample={eventId:string;date:string;stat:Stat;p:Probabilities;outcome:'more'|'less';key:string};
const calibration:Sample[]=[],confirmation:Sample[]=[];let chronologyChecks=0;
for(const rows of groups)for(let i=0;i<rows.length;i++){
 const r=rows[i];if(r.start.slice(0,10)<protocol.calibrationFrom||r.log.didNotPlay||r.log.minutes===null||STATS.some(s=>r.log[s]===null))continue;
 const history=rows.slice(0,i).map(x=>x.log);
 if(history.some(h=>Date.parse(h.gameStart)>=Date.parse(r.start)))throw new Error('CHRONOLOGY_VIOLATION');chronologyChecks++;
 for(const stat of STATS){
  const v=history.filter(g=>!g.didNotPlay&&g.minutes!==null&&statOf(g,stat)!==null).slice(-10).map(g=>g[stat]!).sort((a,b)=>a-b);
  if(v.length<3)continue;const median=v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2,line=Math.floor(median)+0.5;
  const p=predictLine({logs:history,prior:pr.players.get(r.athlete)??null,stat,line,cutoff:r.start,params});if(p.status!=='scored')continue;
  const sample:Sample={key:r.game+'|'+r.athlete+'|'+stat,eventId:r.game,date:r.start.slice(0,10),stat,
   p:{pMore:p.pMore,pLess:p.pLess,pTie:p.pTie},outcome:r.log[stat]!>line?'more':'less'};
  if(sample.date<=protocol.calibrationThrough)calibration.push(sample);else confirmation.push(sample);
 }
}
const temperatures={} as Record<Stat,number>;
const fitting=Object.fromEntries(STATS.map(stat=>{
 const use=calibration.filter(x=>x.stat===stat);if(use.length<500)throw new Error('INSUFFICIENT_CALIBRATION_SAMPLE');
 const grid=(protocol.temperatureGrid as number[]).map(temperature=>({temperature,
  logLoss:use.reduce((a,x)=>a+properScore(temperatureScale(x.p,temperature),x.outcome).logLoss,0)/use.length}));
 temperatures[stat]=[...grid].sort((a,b)=>a.logLoss-b.logLoss||a.temperature-b.temperature)[0].temperature;
 return [stat,{n:use.length,grid,selected:temperatures[stat]}];
}));
const paired:EvaluationRow[]=confirmation.map(x=>({key:x.key,eventId:x.eventId,date:x.date,stat:x.stat,baseline:x.p,
 candidate:temperatureScale(x.p,temperatures[x.stat]),outcome:x.outcome}));
const baseline=summarize(paired.map(x=>({p:x.baseline,outcome:x.outcome}))),candidate=summarize(paired.map(x=>({p:x.candidate,outcome:x.outcome})));
const byStat=Object.fromEntries(STATS.map(s=>[s,{baseline:summarize(paired.filter(x=>x.stat===s).map(x=>({p:x.baseline,outcome:x.outcome}))),
 candidate:summarize(paired.filter(x=>x.stat===s).map(x=>({p:x.candidate,outcome:x.outcome})))}]));
const report={protocolId:protocol.id,generatedBy:'scripts/props-calibration-study.ts',design:protocol.historicalLimit,
 sourceHashes:{prior:prior.sha256,season:season.sha256},chronologyChecks,fitThrough:protocol.dispersionFitThrough,params,
 calibration:fitting,confirmation:{from:protocol.historicalConfirmationFrom,through:confirmation.map(x=>x.date).sort().at(-1),
  games:new Set(paired.map(x=>x.eventId)).size,dates:new Set(paired.map(x=>x.date)).size,baseline,candidate,byStat,
  pairedBrierInterval:pairedInterval(paired,protocol.forwardReviewGate.bootstrapReplicates,protocol.forwardReviewGate.bootstrapSeed)},
 promotionEnabled:false,profitabilityDemonstrated:false};
mkdirSync(out,{recursive:true});writeFileSync(out+'/evaluation.json',JSON.stringify(report,null,2)+'\n');
const baselineRaw=readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url));
const artifact={protocolId:protocol.id,candidateVersion:protocol.candidate,baselineVersion:MODEL_VERSION,
 baselineArtifactSha256:createHash('sha256').update(baselineRaw).digest('hex'),forwardStartsAt:protocol.forwardStartsAt,
 baselineCanonicalSha256:createHash('sha256').update(JSON.stringify(JSON.parse(baselineRaw.toString()))).digest('hex'),
 temperatures,reviewGate:protocol.forwardReviewGate,
 historical:{design:protocol.historicalLimit,n:baseline.n,games:report.confirmation.games,dates:report.confirmation.dates,
  from:protocol.historicalConfirmationFrom,through:report.confirmation.through,baseline,candidate,byStat,interval:report.confirmation.pairedBrierInterval}};
writeFileSync(out+'/candidate.json',JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({temperatures,chronologyChecks,confirmation:{n:baseline.n,baselineBrier:baseline.brier,candidateBrier:candidate.brier,
 baselineLogLoss:baseline.logLoss,candidateLogLoss:candidate.logLoss,interval:report.confirmation.pairedBrierInterval},promotionEnabled:false},null,2));
