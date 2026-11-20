/**
 * Walk-forward proxy-line scoring of a season for props-nb-monotone-cal-v1 (research only).
 * Every model input comes from games that started strictly before the predicted game; a violation throws.
 */
import {STATS} from '../../src/lib/props/contract.ts';
import {predictLine,type GameLog,type ModelParams,type PriorSummary} from '../../src/lib/props/model.ts';
import {pMoreNoTie} from '../../src/lib/props/availability.ts';
import {binaryOutcome} from '../../src/lib/props/calibration-eval.ts';
import {proxyLine,statOf,priors,fitDispersion,byAthlete,MODEL_FIXED,type BoxRow} from './box-csv.ts';

/** Backtest design: league rates and priors from the previous season; dispersion from its own walk-forward. */
export function backtestParams(prior:BoxRow[]){
 const pr=priors(prior);
 const dispersion=fitDispersion(prior,{players:new Map(),leagueRate:pr.leagueRate},Date.parse('2100-01-01'));
 return {params:{...MODEL_FIXED,leagueRate:pr.leagueRate,dispersion} as ModelParams,priorOf:(a:string)=>pr.players.get(a)??null};
}

export type Scored={game:string;start:string;date:string;stat:string;y:0|1;q:number;
 f:{cv:number;games:number;expMinutes:number;z:number}};
/** Walk-forward scoring: every input is from a game that started strictly before the predicted game. */
export function scoreSeason(rows:BoxRow[],params:ModelParams,priorOf:(a:string)=>PriorSummary|null,since?:string){
 const out:Scored[]=[];let checked=0,violations=0,pushes=0;
 for(const games of byAthlete(rows).values()){
  games.sort((a,b)=>a.start.localeCompare(b.start));
  games.forEach((r,i)=>{
   if(r.log.didNotPlay||r.log.minutes===null)return;
   if(since&&r.start<since)return;
   const history:GameLog[]=games.slice(0,i).map(x=>x.log);
   for(const h of history){checked++;if(Date.parse(h.gameStart)>=Date.parse(r.start))violations++;}
   const prior=priorOf(r.athlete);
   for(const s of STATS){
    const actual=statOf(r.log,s);if(actual===null||actual===undefined)continue;
    const line=proxyLine(history,s);if(line===null)continue;
    const p=predictLine({logs:history,prior,stat:s,line,cutoff:r.start,params});
    if(p.status!=='scored')continue;
    const y=binaryOutcome(actual,line);if(y===null){pushes++;continue;}
    const sd=Math.sqrt(p.mean+p.mean**2/params.dispersion[s]+(p.inputs.rate*p.inputs.sdMinutes)**2);
    out.push({game:r.game,start:r.start,date:r.start.slice(0,10),stat:s,y,q:pMoreNoTie(p),
     f:{cv:p.inputs.expMinutes>0?p.inputs.sdMinutes/p.inputs.expMinutes:1,games:p.inputs.games,expMinutes:p.inputs.expMinutes,z:Math.abs(p.mean-line)/sd}});
   }
  });
 }
 if(violations!==0)throw new Error('LEAKAGE: '+violations+' inputs at or after the predicted game');
 out.sort((a,b)=>a.start.localeCompare(b.start)||a.game.localeCompare(b.game)||a.stat.localeCompare(b.stat)||a.q-b.q);
 return {lines:out,leakage:{checked,violations},pushes};
}

