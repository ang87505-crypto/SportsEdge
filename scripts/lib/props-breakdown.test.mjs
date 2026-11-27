import test from 'node:test';
import assert from 'node:assert/strict';
import {opponentFactors,scoreLines,opponentQ,fitBeta,BETA_GRID,clusteredMean,applyKnots,bucket,breakdown,MIN_OPP_GAMES,pairedDiff,mulberry32} from './props-breakdown.ts';
import {MODEL_FIXED} from './box-csv.ts';

const params={...MODEL_FIXED,leagueRate:{points:0.5,rebounds:0.2,assists:0.1},dispersion:{points:30,rebounds:20,assists:15}};
const day=i=>new Date(Date.UTC(2025,9,20)+i*86400e3).toISOString();
function row(athlete,team,opponent,game,start,minutes,points,rebounds=5,assists=3){
 return {athlete,name:athlete,team,opponent,home:true,game,start,
  log:{gameStart:start,didNotPlay:false,minutes,points,rebounds,assists,seasonType:'regular'}};
}

test('opponent factors use only games that started strictly before, never same-time games, and need 10 games',()=>{
 const rows=[];
 for(let i=0;i<14;i++){
  // Team G concedes double the per-minute points that team S concedes. Two games share each start time.
  rows.push(row('a'+i,'X','G','g'+i,day(i),30,30),row('b'+i,'Y','S','s'+i,day(i),30,15));
 }
 const f=opponentFactors(rows);
 for(let i=0;i<MIN_OPP_GAMES;i++)assert.equal(f.get(`g${i}|G|points`).factor,null,'fewer than 10 earlier games: unknown');
 const g=f.get(`g${MIN_OPP_GAMES}|G|points`).factor,s=f.get(`s${MIN_OPP_GAMES}|S|points`).factor;
 assert.ok(Math.abs(g-4/3)<1e-12&&Math.abs(s-2/3)<1e-12,'G concedes 1.0/min vs league 0.75/min');
 assert.equal(f.get(`g${MIN_OPP_GAMES}|G|points`).games,MIN_OPP_GAMES,'the game itself and the same-time game are excluded');
 // A later outlier game cannot change an earlier factor.
 const later=[...rows,row('z','X','G','late',day(30),30,300)];
 assert.equal(opponentFactors(later).get(`g12|G|points`).factor,f.get(`g12|G|points`).factor);
});

test('scored lines reproduce the frozen baseline and refuse any leakage',()=>{
 const rows=[];
 for(let i=0;i<20;i++)rows.push(row('p','X','G','g'+i,day(i),28+(i%3),10+(i%7)),row('q','Y','S','s'+i,day(i),20,8+(i%5)));
 const {lines,leakage}=scoreLines(rows,params,()=>null);
 assert.equal(leakage.violations,0);assert.ok(lines.length>30);
 for(const l of lines){
  assert.ok(Math.abs(opponentQ(l,0)-l.q)<2e-5,'beta 0 is the baseline (rounded stored inputs)');
  assert.ok(l.line%1===0.5);
 }
 const bad=rows.map(r=>r.game==='g5'?{...r,log:{...r.log,gameStart:day(40)}}:r);
 assert.throws(()=>scoreLines(bad,params,()=>null),/LEAKAGE/);
});

test('the challenger moves P(more) with the opponent only, and only for a positive beta',()=>{
 const base={rate:0.5,expMinutes:30,sdMinutes:4,dispersion:30,line:14.5};
 const lo=opponentQ({...base,opp:0.9},1),mid=opponentQ({...base,opp:null},1),hi=opponentQ({...base,opp:1.1},1);
 assert.ok(lo<mid&&mid<hi);
 assert.equal(opponentQ({...base,opp:1.1},0),opponentQ({...base,opp:null},0));
 assert.throws(()=>opponentQ({...base,opp:1},1.6),/RANGE/);
 assert.deepEqual(BETA_GRID,[0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,1.1,1.2,1.3,1.4,1.5]);
});

test('beta is fitted per stat on one season; no opponent signal fits beta 0',()=>{
 const mk=(n,signal,rnd=mulberry32(11))=>Array.from({length:n},(_,i)=>{
  const opp=[0.85,1,1.15][i%3],l={game:'g'+i,stat:['points','rebounds','assists'][Math.floor(i/3)%3],rate:0.5,expMinutes:30,sdMinutes:4,dispersion:30,line:14.5,opp};
  const truth=opponentQ(l,signal?1:0),u=rnd();
  return {...l,q:opponentQ(l,0),y:u<truth?1:0};
 });
 const withSignal=fitBeta(mk(6000,true)),without=fitBeta(mk(6000,false));
 assert.ok(withSignal.points>=0.5,'a real opponent effect is found');
 for(const s of ['points','rebounds','assists'])assert.ok(without[s]<=0.3,'no effect: beta near 0, ties go to the smaller value');
});

test('bootstrap, buckets and the calibrator map are deterministic and correct',()=>{
 const items=Array.from({length:200},(_,i)=>({game:'g'+(i%40),v:i%2?1:-1}));
 assert.deepEqual(clusteredMean(items,200,7),clusteredMean(items,200,7));
 const b=bucket([{q:0.7,y:1,game:'a'},{q:0.2,y:1,game:'b'}]);
 assert.equal(b.lines,2);assert.equal(b.hitRate,0.5);assert.ok(Math.abs(b.gap-(0.75-0.5))<1e-9);assert.ok(Math.abs(b.bias-(1-0.45))<1e-9);
 const k=[{x:0.2,y:0.3},{x:0.8,y:0.7}];
 assert.equal(applyKnots(k,0.1),0.3);assert.equal(applyKnots(k,0.9),0.7);assert.ok(Math.abs(applyKnots(k,0.5)-0.5)<1e-12);
 assert.ok(breakdown([]).overall.all===null);
 const lines=Array.from({length:60},(_,i)=>({game:'g'+(i%12),stat:'points',rate:0.5,expMinutes:30,sdMinutes:4,dispersion:30,line:14.5,
  opp:i%2?1.1:0.9,q:opponentQ({rate:0.5,expMinutes:30,sdMinutes:4,dispersion:30,line:14.5,opp:null},0),y:i%2}));
 const d=pairedDiff(lines,{points:1,rebounds:0,assists:0},200,3);
 assert.ok(d.brier.mean<0,'moving toward the generous-opponent outcomes lowers Brier');
});
