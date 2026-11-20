/**
 * Research challenger props-nb-availability-v1: fit (2025-26 only) and holdout evaluation (2026-27). Research only.
 * Protocol: research/props_availability_v1_20261119/protocol.json (committed before any fit or holdout outcome).
 *   node --experimental-strip-types scripts/props-availability-eval.ts fit --prior player_box_2025.csv \
 *     --training player_box_2026.csv --out research/props_availability_v1_20261119
 *   node --experimental-strip-types scripts/props-availability-eval.ts evaluate --holdout player_box_2027.csv \
 *     --fit research/props_availability_v1_20261119/fit.json --out research/props_availability_v1_20261119
 * PROXY lines (floor of last-10 median + 0.5) from earlier games only. Probability quality, not returns.
 * Availability comes only from earlier box scores; nothing about the predicted game is used; unlisted = unknown.
 */
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {STATS,type Stat} from '../src/lib/props/contract.ts';
import {predictLine,type GameLog,type ModelParams,type PriorSummary} from '../src/lib/props/model.ts';
import {ADJUSTED,adjustedProbabilities,availabilityWindow,calibration,categorize,fitAdjustment,pairedGameBootstrap,
 pMoreNoTie,verdict,brier,logLoss,type Adjustment,type AvailabilityCategory,type Scored,type TeamGame} from '../src/lib/props/availability.ts';
import {loadBoxCsv,proxyLine,statOf,priors,fitDispersion,byAthlete,MODEL_FIXED,type BoxRow} from './lib/box-csv.ts';

const PROTOCOL_PATH='research/props_availability_v1_20261119/protocol.json';
const protocol=JSON.parse(readFileSync(new URL('../'+PROTOCOL_PATH,import.meta.url),'utf8'));
const REPS=protocol.uncertainty.replicates as number,SEED=protocol.uncertainty.seed as number;
const EXPLORATORY_CUT='2026-02-01T08:00:00Z'; // after every 2026-01-31 Eastern game
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
const need=(n:string)=>{const v=arg(n);if(!v)throw new Error('missing --'+n);return v;};

function pinned(path:string,role:'prior'|'training'|'holdout'){
 const f=loadBoxCsv(path),want=protocol.sources[role];
 if(f.file!==want.file||f.sha256!==want.sha256)throw new Error(`SOURCE_HASH_MISMATCH ${role}: ${f.file} ${f.sha256}`);
 return f;
}

/** Team games as their box scores list them, sorted by start, per team. */
function teamGames(rows:BoxRow[]){
 const games=new Map<string,TeamGame&{team:string}>();
 for(const r of rows){
  const k=r.team+'|'+r.game;
  const g=games.get(k)??{game:r.game,start:r.start,team:r.team,listed:new Map()};
  g.listed.set(r.athlete,{didNotPlay:r.log.didNotPlay,reason:r.reason??null});games.set(k,g);
 }
 const byTeam=new Map<string,TeamGame[]>();
 for(const g of games.values())byTeam.set(g.team,[...(byTeam.get(g.team)??[]),g]);
 for(const list of byTeam.values())list.sort((a,b)=>a.start.localeCompare(b.start));
 return byTeam;
}

type Item=Scored&{date:string;stat:Stat;category:AvailabilityCategory};
type Minutes={category:AvailabilityCategory;start:string;minutes:number;expMinutes:number;sdMinutes:number};

/** Every played player-game: its availability category, the minutes row for fitting, and scored proxy lines. */
function build(rows:BoxRow[],params:ModelParams,priorOf:(a:string)=>PriorSummary|null,adj:Record<string,Adjustment>|null){
 const teams=teamGames(rows);
 const items:Item[]=[],minutes:Minutes[]=[];
 let checked=0,violations=0,maxIdentityGap=0;
 for(const games of byAthlete(rows).values()){
  games.sort((a,b)=>a.start.localeCompare(b.start));
  games.forEach((r,i)=>{
   if(r.log.didNotPlay||r.log.minutes===null)return;
   const history:GameLog[]=games.slice(0,i).map(x=>x.log);
   for(const h of games.slice(0,i)){checked++;if(Date.parse(h.start)>=Date.parse(r.start))violations++;}
   const tg=teams.get(r.team)??[];
   for(const g of tg)if(Date.parse(g.start)<Date.parse(r.start))checked++;
   const category=categorize(availabilityWindow(tg,r.athlete,r.start));
   const prior=priorOf(r.athlete);
   const unit=predictLine({logs:history,prior,stat:'points',line:0.5,cutoff:r.start,params});
   if(unit.status==='scored')minutes.push({category,start:r.start,minutes:r.log.minutes,expMinutes:unit.inputs.expMinutes,sdMinutes:unit.inputs.sdMinutes});
   if(!adj)return;
   for(const s of STATS){
    const y=statOf(r.log,s);if(y===null||y===undefined)continue;
    const line=proxyLine(history,s);if(line===null)continue;
    const p=predictLine({logs:history,prior,stat:s,line,cutoff:r.start,params});
    if(p.status!=='scored')continue;
    const base=pMoreNoTie(p);
    const x={rate:p.inputs.rate,expMinutes:p.inputs.expMinutes,sdMinutes:p.inputs.sdMinutes,dispersion:params.dispersion[s],line};
    maxIdentityGap=Math.max(maxIdentityGap,Math.abs(pMoreNoTie(adjustedProbabilities(x,{m:1,s:0}))-base));
    const a=ADJUSTED.includes(category)?adj[category]:null;
    const v=(z:Adjustment|null)=>z?pMoreNoTie(adjustedProbabilities(x,z)):base;
    items.push({game:r.game,date:r.start.slice(0,10),stat:s,category,y:y>line?1:0,
     p:{base,full:v(a),mean:v(a&&{m:a.m,s:0}),variance:v(a&&{m:1,s:a.s})}});
   }
  });
 }
 if(violations!==0)throw new Error('LEAKAGE: '+violations+' inputs at or after the predicted game');
 return {items,minutes,leakage:{checked,violations},maxIdentityGap:+maxIdentityGap.toExponential(3)};
}

const r6=(x:number)=>Math.round(x*1e6)/1e6;
function summary(rs:Item[]){
 const out:Record<string,unknown>={lines:rs.length,games:new Set(rs.map(r=>r.game)).size};
 if(!rs.length)return out;
 for(const m of ['base','full','mean','variance'])out[m]={brier:r6(brier(rs,m)),logLoss:r6(logLoss(rs,m))};
 out.fullVsBase=pairedGameBootstrap(rs,'full','base',REPS,SEED);
 out.meanOnlyVsBase=pairedGameBootstrap(rs,'mean','base',REPS,SEED);
 out.varianceOnlyVsBase=pairedGameBootstrap(rs,'variance','base',REPS,SEED);
 return out;
}
function evaluation(items:Item[]){
 const adjusted=items.filter(r=>ADJUSTED.includes(r.category));
 const primary=pairedGameBootstrap(adjusted,'full','base',REPS,SEED);
 const cats=['RETURNING','RECENT','UNKNOWN','CLEAR'] as AvailabilityCategory[];
 return {verdict:verdict(primary),primary,
  window:[items.reduce((m,r)=>r.date<m?r.date:m,'9999'),items.reduce((m,r)=>r.date>m?r.date:m,'')],
  categories:Object.fromEntries(cats.map(c=>{const rs=items.filter(r=>r.category===c);return [c,{lines:rs.length,games:new Set(rs.map(r=>r.game)).size}];})),
  adjusted:summary(adjusted),
  byCategory:Object.fromEntries(ADJUSTED.map(c=>[c,summary(items.filter(r=>r.category===c))])),
  byStat:Object.fromEntries(STATS.map(s=>[s,summary(adjusted.filter(r=>r.stat===s))])),
  allLines:summary(items),
  calibration:{adjusted:{base:calibration(adjusted,'base'),full:calibration(adjusted,'full')},
   allLines:{base:calibration(items,'base'),full:calibration(items,'full')}}};
}

function fitAll(minutes:Minutes[]){
 const cats=['RETURNING','RECENT','CLEAR','UNKNOWN'] as AvailabilityCategory[];
 const fitted=Object.fromEntries(cats.map(c=>{const rs=minutes.filter(m=>m.category===c);return [c,rs.length>=2?fitAdjustment(rs):null];}));
 const adjustments=Object.fromEntries(ADJUSTED.map(c=>{const f=fitted[c];if(!f)throw new Error('NO_TRAINING_ROWS '+c);return [c,{m:f.m,s:f.s}];}));
 return {adjustments,detail:fitted};
}

const mode=process.argv[2];
const out=need('out');mkdirSync(out,{recursive:true});
if(mode==='fit'){
 const prior=pinned(need('prior'),'prior'),training=pinned(need('training'),'training');
 const pr=priors(prior.rows);
 const params:ModelParams={...MODEL_FIXED,leagueRate:pr.leagueRate,dispersion:fitDispersion(training.rows,pr,Date.parse('2025-12-31T23:59:59Z'))};
 const priorOf=(a:string)=>pr.players.get(a)??null;
 const all=build(training.rows,params,priorOf,null);
 const season=fitAll(all.minutes);
 // Exploratory chronological split inside the (previously inspected) training season: descriptive only.
 const early=fitAll(all.minutes.filter(m=>m.start<EXPLORATORY_CUT));
 const scored=build(training.rows,params,priorOf,early.adjustments);
 const exploratory=evaluation(scored.items.filter(r=>r.date>=EXPLORATORY_CUT.slice(0,10)));
 const fit={generatedBy:'scripts/props-availability-eval.ts fit',protocol:PROTOCOL_PATH,
  sources:[prior,training].map(f=>({file:f.file,sha256:f.sha256,regularSeasonRows:f.rows.length})),
  trainingParams:{priors:'2024-25',dispersionThrough:'2025-12-31',dispersion:params.dispersion},
  playerGames:all.minutes.length,leakage:all.leakage,
  adjustments:season.adjustments,detail:season.detail,
  exploratorySplit:{label:'2025-26, previously inspected season; descriptive only',fitThrough:'2026-01-31',adjustments:early.adjustments,
   detail:early.detail,identityCheckMaxGap:scored.maxIdentityGap,...exploratory}};
 writeFileSync(out+'/fit.json',JSON.stringify(fit,null,1)+'\n');
 console.log(JSON.stringify({adjustments:fit.adjustments,detail:fit.detail,exploratory:{verdictIfPrimary:exploratory.verdict,primary:exploratory.primary,categories:exploratory.categories}},null,1));
}else if(mode==='evaluate'){
 const holdout=pinned(need('holdout'),'holdout');
 const fit=JSON.parse(readFileSync(need('fit'),'utf8'));
 const production=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8'));
 const players=production.players as Record<string,PriorSummary>;
 const built=build(holdout.rows,production.params as ModelParams,a=>players[a]??null,fit.adjustments);
 const result={generatedBy:'scripts/props-availability-eval.ts evaluate',protocol:PROTOCOL_PATH,candidate:'props-nb-availability-v1',
  baseline:'props-nb-minutes-rate-v1 (src/data/props/model_v1.json, exactly as the live worker scores)',
  source:{file:holdout.file,sha256:holdout.sha256,regularSeasonRows:holdout.rows.length},
  adjustments:fit.adjustments,fitSources:fit.sources,leakage:built.leakage,identityCheckMaxGap:built.maxIdentityGap,
  bootstrap:{replicates:REPS,seed:SEED,unit:'game'},...evaluation(built.items),
  limitations:['Proxy lines, not PrizePicks lines; probability quality only, no returns.',
   'Only players who played are scored (platforms void DNPs).',
   'Early-season holdout (four weeks); adjusted lines are a small share, so intervals are wide.',
   'Absence reasons are ESPN box-score wording from earlier games; pre-game injury status is unknown and never used.']};
 writeFileSync(out+'/report.json',JSON.stringify(result,null,1)+'\n');
 console.log(JSON.stringify({verdict:result.verdict,primary:result.primary,window:result.window,categories:result.categories},null,1));
}else throw new Error('usage: fit | evaluate');
