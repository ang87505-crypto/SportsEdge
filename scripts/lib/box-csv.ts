/**
 * SportsDataverse ESPN NBA player box scores (CC BY 4.0): shared CSV loader and proxy line.
 * Regular season and NBA franchises only. Used by the props fit, backtest and learning replay.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {predictLine,type GameLog,type ModelParams,type PriorSummary} from '../../src/lib/props/model.ts';
import {STATS,MODEL_VERSION,type Stat} from '../../src/lib/props/contract.ts';
import {NBA_TEAMS} from '../../src/lib/props/identity.ts';

export function parseCsv(text:string):Record<string,string>[]{
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
export type BoxRow={athlete:string;name:string;team:string;opponent:string;home:boolean;game:string;start:string;log:GameLog};
export function loadBoxCsv(path:string){
 const raw=readFileSync(path);
 const rows:BoxRow[]=[];
 for(const r of parseCsv(raw.toString('utf8'))){
  // Regular season, NBA franchises only (excludes All-Star exhibition teams).
  if(r.season_type!=='2'||!(r.team_abbreviation in NBA_TEAMS)||!(r.opponent_team_abbreviation in NBA_TEAMS))continue;
  const dnp=r.did_not_play==='true';
  const minutes=num(r.minutes);
  rows.push({athlete:r.athlete_id,name:r.athlete_display_name,team:r.team_abbreviation,opponent:r.opponent_team_abbreviation,
   home:r.home_away==='home',game:r.game_id,start:iso(r.game_date_time),
   log:{gameStart:iso(r.game_date_time),didNotPlay:dnp,minutes:dnp?null:minutes,
    points:dnp?null:num(r.points),rebounds:dnp?null:num(r.rebounds),assists:dnp?null:num(r.assists),seasonType:'regular'}});
 }
 return {rows,sha256:createHash('sha256').update(raw).digest('hex'),file:path.split('/').pop()};
}
export const statOf=(g:GameLog,s:Stat)=>(s==='points'?g.points:s==='rebounds'?g.rebounds:g.assists)!;
/** Proxy threshold from PRE-cutoff data only: floor(median of last 10 played) + 0.5. */
export function proxyLine(history:GameLog[],s:Stat){
 const v=history.filter(g=>!g.didNotPlay&&g.minutes!==null&&statOf(g,s)!==null).slice(-10).map(g=>statOf(g,s)).sort((a,b)=>a-b);
 if(v.length<3)return null;
 const med=v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;
 return Math.floor(med)+0.5;
}


/** Layer-1 hyperparameters, fixed before any evaluation (props-nb-minutes-rate-v1). */
export const MODEL_FIXED={version:MODEL_VERSION,minMinutesForRate:6,minCurrentGames:3,maxGapDays:21,minutesHalfLife:4,rateHalfLife:8,
 maxGames:20,priorStrengthMinutes:120,priorMinMinutes:300,maxMinutes:53};

export function priors(rows:BoxRow[]){
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
export const byAthlete=(rows:BoxRow[])=>{const m=new Map<string,BoxRow[]>();for(const r of rows)m.set(r.athlete,[...(m.get(r.athlete)??[]),r]);return m;};
/** Method-of-moments NB size per stat from walk-forward residuals inside the training window. */
export function fitDispersion(season:BoxRow[],prior:ReturnType<typeof priors>,until:number){
 const params:ModelParams={...MODEL_FIXED,leagueRate:prior.leagueRate,dispersion:{points:1e9,rebounds:1e9,assists:1e9}};
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

