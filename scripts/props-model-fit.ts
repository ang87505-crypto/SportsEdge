/**
 * Chronological evaluation and frozen-artifact builder for props-nb-minutes-rate-v1.
 *   node --experimental-strip-types scripts/props-model-fit.ts evaluate \
 *     --prior player_box_2025.csv --season player_box_2026.csv --fit-until 2026-01-31 --out research/props_baseline_20261107
 *   node --experimental-strip-types scripts/props-model-fit.ts freeze \
 *     --season player_box_2026.csv --out src/data/props/model_v1.json
 * Inputs: SportsDataverse ESPN NBA player box scores (CC BY 4.0), regular season only.
 * Hyperparameters are fixed in FIXED below before any evaluation; only league per-minute
 * rates (prior season) and NB dispersion (training window) are estimated from data.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {predictLine,poissonMeanBaseline,nbPmf,type GameLog,type PriorSummary,type ModelParams} from '../src/lib/props/model.ts';
import {STATS,MODEL_VERSION,type Stat} from '../src/lib/props/contract.ts';
import {NBA_TEAMS} from '../src/lib/props/identity.ts';

const FIXED={version:MODEL_VERSION,minMinutesForRate:6,minCurrentGames:3,maxGapDays:21,minutesHalfLife:4,rateHalfLife:8,
 maxGames:20,priorStrengthMinutes:120,priorMinMinutes:300,maxMinutes:53};

function arg(n:string){const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;}
function parseCsv(text:string):Record<string,string>[]{
 const rows:string[][]=[];let row:string[]=[],cell='',q=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}
  else if(ch==='"')q=true;else if(ch===','){row.push(cell);cell='';}
  else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(ch!=='\r')cell+=ch;
 }
 if(cell||row.length){row.push(cell);rows.push(row);}
 const [head,...body]=rows;
 return body.filter(r=>r.length===head.length).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]])));
}
const iso=(s:string)=>{const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?([+-]\d\d)(\d\d)$/.exec(s);
 return m?new Date(`${m[1]}${m[2]}:${m[3]}`).toISOString():new Date(s).toISOString();};
const num=(s:string)=>s===''?null:Number(s);
type Row={athlete:string;name:string;team:string;game:string;start:string;log:GameLog};
function load(path:string){
 const raw=readFileSync(path);
 const rows:Row[]=[];
 for(const r of parseCsv(raw.toString('utf8'))){
  // Regular season, NBA franchises only (excludes All-Star exhibition teams).
  if(r.season_type!=='2'||!(r.team_abbreviation in NBA_TEAMS)||!(r.opponent_team_abbreviation in NBA_TEAMS))continue;
  const dnp=r.did_not_play==='true';
  const minutes=num(r.minutes);
  rows.push({athlete:r.athlete_id,name:r.athlete_display_name,team:r.team_abbreviation,game:r.game_id,start:iso(r.game_date_time),
   log:{gameStart:iso(r.game_date_time),didNotPlay:dnp,minutes:dnp?null:minutes,
    points:dnp?null:num(r.points),rebounds:dnp?null:num(r.rebounds),assists:dnp?null:num(r.assists),seasonType:'regular'}});
 }
 return {rows,sha256:createHash('sha256').update(raw).digest('hex'),file:path.split('/').pop()};
}
function priors(rows:Row[]){
 const m=new Map<string,PriorSummary>();
 const league={minutes:0,points:0,rebounds:0,assists:0};
 for(const r of rows){
  const g=r.log;if(g.didNotPlay||g.minutes===null||g.minutes<=0||g.points===null||g.rebounds===null||g.assists===null)continue;
  const p=m.get(r.athlete)??{games:0,minutes:0,points:0,rebounds:0,assists:0};
  p.games++;p.minutes+=g.minutes;p.points+=g.points;p.rebounds+=g.rebounds;p.assists+=g.assists;m.set(r.athlete,p);
  league.minutes+=g.minutes;league.points+=g.points;league.rebounds+=g.rebounds;league.assists+=g.assists;
 }
 const leagueRate=Object.fromEntries(STATS.map(s=>[s,Math.round(league[s]/league.minutes*1e6)/1e6])) as Record<Stat,number>;
 return {players:m,leagueRate};
}
const byAthlete=(rows:Row[])=>{const m=new Map<string,Row[]>();for(const r of rows)m.set(r.athlete,[...(m.get(r.athlete)??[]),r]);return m;};
const statOf=(g:GameLog,s:Stat)=>(s==='points'?g.points:s==='rebounds'?g.rebounds:g.assists)!;
/** Proxy threshold from PRE-cutoff data only: floor(median of last 10 played) + 0.5. */
function proxyLine(history:GameLog[],s:Stat){
 const v=history.filter(g=>!g.didNotPlay&&g.minutes!==null&&statOf(g,s)!==null).slice(-10).map(g=>statOf(g,s)).sort((a,b)=>a-b);
 if(v.length<3)return null;
 const med=v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;
 return Math.floor(med)+0.5;
}

/** Method-of-moments NB size per stat from walk-forward residuals inside the training window. */
function fitDispersion(season:Row[],prior:ReturnType<typeof priors>,until:number){
 const params:ModelParams={...FIXED,leagueRate:prior.leagueRate,dispersion:{points:1e9,rebounds:1e9,assists:1e9}};
 const acc=Object.fromEntries(STATS.map(s=>[s,{sq:0,mu:0,mu2:0,minVar:0,n:0}])) as Record<Stat,{sq:number;mu:number;mu2:number;minVar:number;n:number}>;
 for(const rows of byAthlete(season).values()){
  rows.sort((a,b)=>a.start.localeCompare(b.start));
  rows.forEach((r,i)=>{
   if(Date.parse(r.start)>until||r.log.didNotPlay||r.log.minutes===null||r.log.points===null)return;
   const logs=rows.slice(0,i).map(x=>x.log);
   for(const s of STATS){
    const p=predictLine({logs,prior:prior.players.get(r.athlete)??null,stat:s,line:0.5,cutoff:r.start,params});
    if(p.status!=='scored')continue;
    const a=acc[s];const y=statOf(r.log,s);
    a.sq+=(y-p.mean)**2;a.mu+=p.mean;a.mu2+=p.mean**2;a.minVar+=(p.inputs.rate*p.inputs.sdMinutes)**2;a.n++;
   }
  });
 }
 return Object.fromEntries(STATS.map(s=>{const a=acc[s];const inv=(a.sq-a.mu-a.minVar)/a.mu2;
  return [s,inv>0?Math.round(1/inv*1e4)/1e4:1e6];})) as Record<Stat,number>;
}

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
