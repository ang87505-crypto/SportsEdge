import test from 'node:test';
import assert from 'node:assert/strict';
import {pav,applyMap,fitMonotoneCalibration,calibrate,calibrationDigest,binOf,KAPPA,CHALLENGER_ID,
 MIN_TRAINING_LINES_PER_STAT} from './monotone-calibration.ts';

const STATS=['points','rebounds','assists'];
/** Deterministic synthetic lines: P(more) on a grid; outcomes drawn by a seeded LCG from truth(q). */
function synth(n,truth,stats=STATS,seed=7){
 let s=seed>>>0;const rnd=()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};
 const out=[];
 for(let i=0;i<n;i++){const q=((i*7919)%1000+0.5)/1000;out.push({stat:stats[i%stats.length],q,y:rnd()<truth(q)?1:0});}
 return out;
}

test('PAV returns the closest non-decreasing sequence and keeps sorted input',()=>{
 assert.deepEqual(pav([{y:1,w:1},{y:2,w:1},{y:3,w:1}]),[1,2,3]);
 assert.deepEqual(pav([{y:3,w:1},{y:1,w:1}]),[2,2]);
 assert.deepEqual(pav([{y:1,w:1},{y:3,w:3},{y:1,w:1},{y:4,w:1}]),[1,2.5,2.5,4]);
});

test('bins are 20 equal-width cells and q=1 falls in the last',()=>{
 assert.equal(binOf(0),0);assert.equal(binOf(0.049),0);assert.equal(binOf(0.05),1);assert.equal(binOf(1),19);
});

test('a perfectly calibrated baseline is left nearly unchanged',()=>{
 const cal=fitMonotoneCalibration(synth(60_000,q=>q),STATS);
 for(const q of [0.1,0.3,0.5,0.7,0.9])assert.ok(Math.abs(calibrate(cal,'points',q)-q)<0.03,'q='+q);
});

test('a More-side plateau is learned and Less-side calibration is kept',()=>{
 const truth=q=>q<0.5?q:Math.min(q,0.5+0.35*(q-0.5)+0.05);
 const cal=fitMonotoneCalibration(synth(90_000,truth),STATS);
 assert.ok(calibrate(cal,'points',0.93)<0.75,'high More confidence is pulled down');
 assert.ok(Math.abs(calibrate(cal,'points',0.15)-0.15)<0.03,'Less side close to identity');
});

test('output is monotone in the baseline probability for every stat (ranking kept)',()=>{
 const cal=fitMonotoneCalibration(synth(60_000,q=>0.3+0.4*q),STATS);
 for(const s of STATS){let prev=-1;for(let i=0;i<=1000;i++){const v=calibrate(cal,s,i/1000);assert.ok(v>=prev-1e-12);prev=v;}}
});

test('small or empty bins shrink to the identity / pooled map',()=>{
 // Only mid-range training data: the extreme bins are empty, so their knots are the identity.
 const rows=synth(30_000,()=>0.5).map(r=>({...r,q:0.45+0.1*r.q}));
 const cal=fitMonotoneCalibration(rows,STATS);
 const k=cal.pooled.knots;
 assert.equal(k[0].x,0.025);assert.equal(k[0].y,0.025);assert.equal(k[0].w,KAPPA);
 assert.equal(k[19].y,0.975);
 // Clamp holds at the extremes.
 assert.equal(calibrate(cal,'assists',0),0.025);
 assert.ok(calibrate(cal,'assists',1)<=0.99);
});

test('fit is deterministic and records its inputs',()=>{
 const rows=synth(30_000,q=>q*0.9);
 const a=fitMonotoneCalibration(rows,STATS),b=fitMonotoneCalibration([...rows],STATS);
 assert.equal(calibrationDigest(a),calibrationDigest(b));
 assert.equal(a.challenger,CHALLENGER_ID);
 assert.deepEqual(a.trainingLines,{points:10_000,rebounds:10_000,assists:10_000});
});

test('invalid inputs and too-small training sets are refused',()=>{
 assert.throws(()=>fitMonotoneCalibration(synth(3*(MIN_TRAINING_LINES_PER_STAT-1),q=>q),STATS),/TOO_FEW_TRAINING_LINES/);
 assert.throws(()=>fitMonotoneCalibration([...synth(30_000,q=>q),{stat:'points',q:1.2,y:1}],STATS),/INVALID_LINE/);
 assert.throws(()=>fitMonotoneCalibration([...synth(30_000,q=>q),{stat:'points',q:0.5,y:0.5}],STATS),/INVALID_LINE/);
 const cal=fitMonotoneCalibration(synth(30_000,q=>q),STATS);
 assert.throws(()=>calibrate(cal,'steals',0.5),/UNKNOWN_STAT/);
 assert.throws(()=>applyMap(cal.pooled,Number.NaN),/INVALID_PROBABILITY/);
});
