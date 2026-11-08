/**
 * Chronological evaluation and frozen-artifact builder for props-nb-minutes-rate-v1.
 *   node --experimental-strip-types scripts/props-model-fit.ts evaluate \
 *     --prior player_box_2025.csv --season player_box_2026.csv --fit-until 2026-01-31 --out research/props_baseline_20261107
 *   node --experimental-strip-types scripts/props-model-fit.ts freeze \
 *     --season player_box_2026.csv --out src/data/props/model_v1.json
 *   node --experimental-strip-types scripts/props-model-fit.ts backtest \
 *     --prior player_box_2025.csv --season player_box_2026.csv --label 2025-26 --out <file.json>
 *     (parameters fit on the prior season ONLY; the whole target season is out of sample;
 *      the frozen selection rule is applied to PROXY lines; no dollar results are produced)
 * Inputs: SportsDataverse ESPN NBA player box scores (CC BY 4.0), regular season only.
 * Hyperparameters are fixed in FIXED below before any evaluation; only league per-minute
 * rates (prior season) and NB dispersion (training window) are estimated from data.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {predictLine,poissonMeanBaseline,nbPmf,type ModelParams} from '../src/lib/props/model.ts';
import {STATS,MODEL_VERSION,type Stat} from '../src/lib/props/contract.ts';
import {decidePick,SELECTION_RULE_V1} from '../src/lib/props/rules.ts';
import {loadBoxCsv as load,proxyLine,statOf,priors,fitDispersion,byAthlete,MODEL_FIXED as FIXED} from './lib/box-csv.ts';

function arg(n:string){const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;}
type Score={n:number;brier:number;logloss:number;logscore:number;hits:number;meanP:number;bins:{n:number;p:number;y:number}[]};
const newScore=():Score=>({n:0,brier:0,logloss:0,logscore:0,hits:0,meanP:0,bins:Array.from({length:10},()=>({n:0,p:0,y:0}))});
function add(sc:Score,pMore:number,y:number,line:number,pmfActual:number){
 const o=y>line?1:0;const p=Math.min(1-1e-9,Math.max(1e-9,pMore));
 sc.n++;sc.brier+=(p-o)**2;sc.logloss+=-(o*Math.log(p)+(1-o)*Math.log(1-p));sc.logscore+=-Math.log(Math.max(pmfActual,1e-12));
 sc.hits+=Number((p>=0.5)===(o===1));sc.meanP+=p;
 const b=sc.bins[Math.min(9,Math.floor(p*10))];b.n++;b.p+=p;b.y+=o;
}
const finish=(sc:Score)=>({n:sc.n,brier:+(sc.brier/sc.n).toFixed(5),logloss:+(sc.logloss/sc.n).toFixed(5),
 meanNegLogPmf:+(sc.logscore/sc.n).toFixed(4),directionalAccuracy:+(sc.hits/sc.n).toFixed(4),meanPMore:+(sc.meanP/sc.n).toFixed(4),
 reliability:sc.bins.filter(b=>b.n>0).map((b,i)=>({bin:i,n:b.n,meanPredicted:+(b.p/b.n).toFixed(4),observedMore:+(b.y/b.n).toFixed(4)}))});

const mode=process.argv[2];
if(mode==='evaluate'){
 const prior=load(arg('prior')!),season=load(arg('season')!),until=Date.parse(arg('fit-until')!+'T23:59:59Z'),out=arg('out')!;
 const pr=priors(prior.rows);
 const dispersion=fitDispersion(season.rows,pr,until);
 const params:ModelParams={...FIXED,leagueRate:pr.leagueRate,dispersion};
 const scores:Record<string,Record<Stat,Score>>={model:{} as Record<Stat,Score>,seasonMeanPoisson:{} as Record<Stat,Score>,last10Poisson:{} as Record<Stat,Score>};
 for(const k of Object.keys(scores))for(const s of STATS)scores[k][s]=newScore();
 const unscorable:Record<string,number>={};let leakageChecks=0;
 for(const rows of byAthlete(season.rows).values()){
  rows.sort((a,b)=>a.start.localeCompare(b.start));
  rows.forEach((r,i)=>{
   if(Date.parse(r.start)<=until||r.log.didNotPlay||r.log.minutes===null||r.log.points===null||r.log.rebounds===null||r.log.assists===null)return;
   const history=rows.slice(0,i).map(x=>x.log);
   if(history.some(h=>Date.parse(h.gameStart)>=Date.parse(r.start)))throw new Error('LEAKAGE');
   leakageChecks++;
   for(const s of STATS){
    const line=proxyLine(history,s);if(line===null){unscorable.no_proxy_line=(unscorable.no_proxy_line??0)+1;continue;}
    const p=predictLine({logs:history,prior:pr.players.get(r.athlete)??null,stat:s,line,cutoff:r.start,params});
    const b1=poissonMeanBaseline(history,s,line,r.start,null),b2=poissonMeanBaseline(history,s,line,r.start,10);
    if(p.status!=='scored'||!b1||!b2){if(p.status!=='scored')unscorable[p.reason]=(unscorable[p.reason]??0)+1;continue;}
    const y=statOf(r.log,s);
    add(scores.model[s],p.pMore,y,line,nbPmf(y,p.mean,p.inputs.size>=1e9?Infinity:p.inputs.size));
    add(scores.seasonMeanPoisson[s],b1.pMore,y,line,nbPmf(y,Math.max(b1.mean,0.05),Infinity));
    add(scores.last10Poisson[s],b2.pMore,y,line,nbPmf(y,Math.max(b2.mean,0.05),Infinity));
   }
  });
 }
 const report={generatedBy:'scripts/props-model-fit.ts evaluate',modelVersion:MODEL_VERSION,
  design:'Walk-forward, per player-game; history strictly before tipoff; dispersion fit on season games up to fit-until; evaluated after it. Proxy lines (no historical DFS lines purchased): floor(median of last 10 played)+0.5. Conditional on playing (DNP void on both platforms).',
  sources:{prior:{file:prior.file,sha256:prior.sha256},season:{file:season.file,sha256:season.sha256},license:'CC BY 4.0, SportsDataverse (ESPN NBA player box scores)'},
  fitUntil:arg('fit-until'),params,leakageChecks,unscorable,
  results:Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,Object.fromEntries(STATS.map(s=>[s,finish(v[s])]))]))};
 mkdirSync(out,{recursive:true});
 writeFileSync(out+'/evaluation.json',JSON.stringify(report,null,1)+'\n');
 console.log(JSON.stringify({dispersion,summary:Object.fromEntries(Object.entries(report.results).map(([k,v])=>[k,Object.fromEntries(STATS.map(s=>[s,{n:v[s].n,brier:v[s].brier,logloss:v[s].logloss,nll:v[s].meanNegLogPmf}]))]))},null,1));
}else if(mode==='backtest'){
 const prior=load(arg('prior')!),season=load(arg('season')!),out=arg('out')!,label=arg('label')??'';
 const pr=priors(prior.rows);
 // Dispersion from the PRIOR season's own walk-forward (league-rate priors only): no target-season data.
 const dispersion=fitDispersion(prior.rows,{players:new Map(),leagueRate:pr.leagueRate},Date.parse('2100-01-01'));
 const params:ModelParams={...FIXED,leagueRate:pr.leagueRate,dispersion};
 const scores:Record<string,Record<Stat,Score>>={model:{} as Record<Stat,Score>,seasonMeanPoisson:{} as Record<Stat,Score>,last10Poisson:{} as Record<Stat,Score>};
 for(const k of Object.keys(scores))for(const s of STATS)scores[k][s]=newScore();
 type Band={n:number;hits:number};
 const bands:Record<string,Band>={'0.60-0.65':{n:0,hits:0},'0.65-0.70':{n:0,hits:0},'0.70-0.80':{n:0,hits:0}};
 const byStat=Object.fromEntries(STATS.map(s=>[s,{n:0,hits:0}])) as Record<Stat,Band>;
 const skipped:Record<string,Band>={below_threshold:{n:0,hits:0},extreme_disagreement:{n:0,hits:0},tie_risk:{n:0,hits:0}};
 const months:Record<string,{model:Score;last10:Score;picks:Band}>={};
 const unscorable:Record<string,number>={};let lines=0;
 for(const rows of byAthlete(season.rows).values()){
  rows.sort((a,b)=>a.start.localeCompare(b.start));
  rows.forEach((r,i)=>{
   if(r.log.didNotPlay||r.log.minutes===null||r.log.points===null||r.log.rebounds===null||r.log.assists===null)return;
   const history=rows.slice(0,i).map(x=>x.log);
   if(history.some(h=>Date.parse(h.gameStart)>=Date.parse(r.start)))throw new Error('LEAKAGE');
   const month=r.start.slice(0,7);
   months[month]??={model:newScore(),last10:newScore(),picks:{n:0,hits:0}};
   for(const s of STATS){
    const line=proxyLine(history,s);if(line===null){unscorable.no_proxy_line=(unscorable.no_proxy_line??0)+1;continue;}
    const p=predictLine({logs:history,prior:pr.players.get(r.athlete)??null,stat:s,line,cutoff:r.start,params});
    const b1=poissonMeanBaseline(history,s,line,r.start,null),b2=poissonMeanBaseline(history,s,line,r.start,10);
    if(p.status!=='scored'||!b1||!b2){if(p.status!=='scored')unscorable[p.reason]=(unscorable[p.reason]??0)+1;continue;}
    lines++;
    const y=statOf(r.log,s);const size=p.inputs.size>=1e9?Infinity:p.inputs.size;
    add(scores.model[s],p.pMore,y,line,nbPmf(y,p.mean,size));
    add(scores.seasonMeanPoisson[s],b1.pMore,y,line,nbPmf(y,Math.max(b1.mean,0.05),Infinity));
    add(scores.last10Poisson[s],b2.pMore,y,line,nbPmf(y,Math.max(b2.mean,0.05),Infinity));
    add(months[month].model,p.pMore,y,line,nbPmf(y,p.mean,size));
    add(months[month].last10,b2.pMore,y,line,nbPmf(y,Math.max(b2.mean,0.05),Infinity));
    const d=decidePick({status:'scored',pMore:p.pMore,pLess:p.pLess,pTie:p.pTie});
    const side=p.pMore>=p.pLess?'more':'less';
    const hit=(side==='more'?y>line:y<line)?1:0;
    if(d.status==='recorded'){
     const band=d.probability<0.65?'0.60-0.65':d.probability<0.70?'0.65-0.70':'0.70-0.80';
     bands[band].n++;bands[band].hits+=hit;byStat[s].n++;byStat[s].hits+=hit;
     months[month].picks.n++;months[month].picks.hits+=hit;
    }else if(skipped[d.reason]){skipped[d.reason].n++;skipped[d.reason].hits+=hit;}
   }
  });
 }
 const rate=(b:Band)=>({n:b.n,hitRate:b.n?+(b.hits/b.n).toFixed(4):null});
 const recorded=Object.values(bands).reduce((a,b)=>({n:a.n+b.n,hits:a.hits+b.hits}),{n:0,hits:0});
 const report={generatedBy:'scripts/props-model-fit.ts backtest',label,modelVersion:MODEL_VERSION,selectionVersion:SELECTION_RULE_V1.version,
  design:'Parameters (league per-minute rates, NB dispersion) fit on the prior season only; every regular-season player-game of the target season is predicted from strictly earlier games; conditional on playing. PROXY lines: floor(median of last 10 played)+0.5. Not platform lines; no dollar results.',
  sources:{prior:{file:prior.file,sha256:prior.sha256},season:{file:season.file,sha256:season.sha256},license:'CC BY 4.0, SportsDataverse (ESPN NBA player box scores)'},
  params:{leagueRate:pr.leagueRate,dispersion},scoredLines:lines,unscorable,
  results:Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,Object.fromEntries(STATS.map(s=>[s,finish(v[s])]))])),
  selection:{rule:SELECTION_RULE_V1,recorded:rate(recorded),qualifyingShare:+(recorded.n/lines).toFixed(4),
   byBand:Object.fromEntries(Object.entries(bands).map(([k,b])=>[k,rate(b)])),byStat:Object.fromEntries(STATS.map(s=>[s,rate(byStat[s])])),
   skipped:Object.fromEntries(Object.entries(skipped).map(([k,b])=>[k,rate(b)])),breakEvenTwoPickPower:+Math.sqrt(1/3).toFixed(4)},
  monthly:Object.entries(months).sort(([a],[b])=>a.localeCompare(b)).map(([m,v])=>({month:m,lines:v.model.n,
   modelBrier:v.model.n?+(v.model.brier/v.model.n).toFixed(4):null,last10Brier:v.last10.n?+(v.last10.brier/v.last10.n).toFixed(4):null,picks:rate(v.picks)}))};
 writeFileSync(out,JSON.stringify(report,null,1)+'\n');
 console.log(JSON.stringify({label,lines,dispersion,recorded:report.selection.recorded,byBand:report.selection.byBand,skipped:report.selection.skipped,
  brier:Object.fromEntries(Object.entries(report.results).map(([k,v])=>[k,STATS.map(s=>v[s].brier)]))}));
}else if(mode==='freeze'){
 const season=load(arg('season')!),out=arg('out')!;
 const pr=priors(season.rows);
 const dispersion=fitDispersion(season.rows,pr,Date.parse('2100-01-01'));
 // Prior summaries are keyed by ESPN athlete id; display name/team are kept for identity checks only.
 const latest=new Map<string,{name:string;team:string;start:string}>();
 for(const r of season.rows){const l=latest.get(r.athlete);if(!l||r.start>l.start)latest.set(r.athlete,{name:r.name,team:r.team,start:r.start});}
 const players=Object.fromEntries([...pr.players].filter(([,p])=>p.games>0).sort(([a],[b])=>a.localeCompare(b)).map(([id,p])=>[id,
  {name:latest.get(id)!.name,lastTeam:latest.get(id)!.team,games:p.games,minutes:Math.round(p.minutes*10)/10,points:p.points,rebounds:p.rebounds,assists:p.assists}]));
 const artifact={modelVersion:MODEL_VERSION,frozenAt:new Date().toISOString().slice(0,10),
  source:{file:season.file,sha256:season.sha256,license:'CC BY 4.0, SportsDataverse (ESPN NBA player box scores)',seasonType:'regular'},
  params:{...FIXED,leagueRate:pr.leagueRate,dispersion},players};
 mkdirSync(out.split('/').slice(0,-1).join('/'),{recursive:true});
 writeFileSync(out,JSON.stringify(artifact)+'\n');
 console.log(JSON.stringify({players:Object.keys(players).length,leagueRate:pr.leagueRate,dispersion}));
}else{console.error('usage: props-model-fit.ts evaluate|freeze ...');process.exit(2);}
