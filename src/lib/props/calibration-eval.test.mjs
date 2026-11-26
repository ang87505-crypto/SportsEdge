import test from 'node:test';
import assert from 'node:assert/strict';
import {binaryOutcome,brier,logLoss,ece,reliability,confidenceBands,murphy,auc,spread,pairedGameBootstrap,
 fitSingleSlopeRecal,applyRecal,decide,REQUIREMENTS} from './calibration-eval.ts';

const line=(game,y,p,stat='points')=>({game,date:'2024-01-01',stat,y,p});

test('pushes are excluded, not scored as a loss or a win',()=>{
 assert.equal(binaryOutcome(21,20.5),1);
 assert.equal(binaryOutcome(20,20.5),0);
 assert.equal(binaryOutcome(20,20),null);
 assert.throws(()=>binaryOutcome(Number.NaN,20.5),/INVALID_OUTCOME/);
});

test('binary Brier, log loss, ECE and reliability on a known example',()=>{
 const rs=[line('g1',1,{a:0.8}),line('g1',0,{a:0.8}),line('g2',1,{a:0.3}),line('g2',0,{a:0.3})];
 assert.ok(Math.abs(brier(rs,'a')-(0.04+0.64+0.49+0.09)/4)<1e-12);
 assert.ok(Math.abs(logLoss(rs,'a')-(-(Math.log(0.8)+Math.log(0.2)+Math.log(0.3)+Math.log(0.7))/4))<1e-12);
 // bins 0.8 and 0.3 each observe 0.5: |0.8-0.5|*0.5 + |0.3-0.5|*0.5
 assert.ok(Math.abs(ece(rs,'a')-0.25)<1e-12);
 const rel=reliability(rs,'a');
 assert.equal(rel[8].n,2);assert.equal(rel[8].observedMore,0.5);assert.equal(rel[3].meanPredicted,0.3);
});

test('confidence bands use each model\'s own direction and confidence',()=>{
 const rs=[line('g',1,{a:0.92}),line('g',0,{a:0.92}),line('g',0,{a:0.15}),line('g',1,{a:0.55})];
 const b=confidenceBands(rs,'a');
 const more90=b.find(x=>x.direction==='More'&&x.band==='0.90+');
 assert.equal(more90.n,2);assert.equal(more90.hitRate,0.5);assert.equal(more90.gap,0.42);
 const less80=b.find(x=>x.direction==='Less'&&x.band==='0.80-0.90');
 assert.equal(less80.n,1);assert.equal(less80.hitRate,1);
});

test('AUC handles ties and perfect ranking; Murphy terms are consistent',()=>{
 assert.equal(auc([line('g',0,{a:0.2}),line('g',1,{a:0.8})],'a'),1);
 assert.equal(auc([line('g',0,{a:0.5}),line('g',1,{a:0.5})],'a'),0.5);
 const rs=Array.from({length:400},(_,i)=>line('g'+(i%40),i%3===0?1:0,{a:(i%10)/10+0.05}));
 const m=murphy(rs,'a');
 // With forecasts constant within bins, Brier equals reliability - resolution + uncertainty exactly.
 assert.ok(Math.abs(brier(rs,'a')-(m.reliability-m.resolution+m.uncertainty))<1e-5);
 assert.ok(spread(rs,'a')>0);
});

test('game-clustered bootstrap is deterministic and zero for identical models',()=>{
 const rs=Array.from({length:600},(_,i)=>line('g'+(i%60),i%2,{a:0.4+(i%7)/20,b:0.4+(i%7)/20}));
 const x=pairedGameBootstrap(rs,'a','b',300,11),y=pairedGameBootstrap(rs,'a','b',300,11);
 assert.deepEqual(x,y);
 assert.equal(x.games,60);assert.equal(x.lines,600);
 for(const k of ['brier','logLoss','ece']){assert.equal(x[k].difference,0);assert.equal(x[k].lower95,0);assert.equal(x[k].upper95,0);}
 assert.equal(pairedGameBootstrap([],'a','b',10,1),null);
});

test('bootstrap detects a clearly better model and clusters by game',()=>{
 const rs=Array.from({length:4000},(_,i)=>{const y=i%4===0?1:0;return line('g'+(i%200),y,{good:0.25,bad:0.6});});
 const x=pairedGameBootstrap(rs,'good','bad',500,3);
 assert.ok(x.brier.upper95<0&&x.logLoss.upper95<0&&x.ece.upper95<0);
 // Point ECE difference equals the direct computation.
 assert.ok(Math.abs(x.ece.difference-(ece(rs,'good')-ece(rs,'bad')))<1e-6);
});

test('single-slope recal recovers a known log-odds distortion',()=>{
 let s=5;const rnd=()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};
 const rows=Array.from({length:40_000},(_,i)=>{const q=0.05+0.9*((i*37)%1000)/1000,z=Math.log(q/(1-q));
  const t=1/(1+Math.exp(-(-0.2+0.6*z)));return {stat:'points',q,y:rnd()<t?1:0};});
 const c=fitSingleSlopeRecal(rows,['points']).points;
 assert.ok(Math.abs(c.intercept+0.2)<0.05&&Math.abs(c.slope-0.6)<0.05,JSON.stringify(c));
 assert.ok(Math.abs(applyRecal({intercept:0,slope:1},0.7)-0.7)<1e-9);
});

const iv=(d,l,u)=>({difference:d,lower95:l,upper95:u});
const pr=(b,l=b,e=b)=>({games:600,lines:30_000,brier:b,logLoss:l,ece:e});
const good=()=>({lines:30_000,games:600,trainingLinesPerStat:{points:9000,rebounds:9000,assists:9000},minTrainingLinesPerStat:2000,
 overall:pr(iv(-0.002,-0.003,-0.001)),highConfidence70:pr(iv(-0.01,-0.02,-0.005)),
 subgroups:{More:pr(iv(-0.003,-0.004,-0.001)),Less:pr(iv(0,-0.001,0.001)),points:pr(iv(-0.002,-0.003,0))},
 resolution:{challenger:0.009,baseline:0.01},auc:{challenger:0.62,baseline:0.621},spread:{challenger:0.1,baseline:0.15},
 vsTestedRecalBrier:-0.0002});

test('verdict rules follow the pre-registration exactly',()=>{
 assert.equal(decide(good()).verdict,'QUALIFIES_FOR_FORWARD_TEST');
 assert.equal(decide({...good(),games:499}).verdict,'INSUFFICIENT_EVIDENCE');
 assert.equal(decide({...good(),trainingLinesPerStat:{points:1999}}).verdict,'INSUFFICIENT_EVIDENCE');
 assert.equal(decide({...good(),overall:pr(iv(0.002,0.001,0.003),iv(-0.1,-0.2,0.1))}).verdict,'FAILS');
 assert.equal(decide({...good(),overall:pr(iv(-0.002,-0.003,-0.001),iv(0.01,0.005,0.02))}).verdict,'FAILS');
 // Each single unmet requirement downgrades to NO_CLEAR_EFFECT.
 assert.equal(decide({...good(),overall:pr(iv(-0.001,-0.002,0.0001),iv(-0.002,-0.003,-0.001),iv(-0.002,-0.003,-0.001))}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(decide({...good(),overall:pr(iv(-0.002,-0.003,-0.001),iv(-0.002,-0.003,-0.001),iv(0,-0.001,0.001))}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(decide({...good(),highConfidence70:null}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(decide({...good(),subgroups:{...good().subgroups,Less:pr(iv(0.002,0.0001,0.004))}}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(decide({...good(),resolution:{challenger:0.0079,baseline:0.01}}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(decide({...good(),auc:{challenger:0.618,baseline:0.6201}}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(decide({...good(),spread:{challenger:0.07,baseline:0.15}}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(decide({...good(),vsTestedRecalBrier:0}).verdict,'NO_CLEAR_EFFECT');
 assert.equal(REQUIREMENTS.minLines,20_000);
});
