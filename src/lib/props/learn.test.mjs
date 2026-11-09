import test from 'node:test';
import assert from 'node:assert/strict';
import {FEATURES,MARKET_FEATURES,MARKET_MIN_LINES,LAMBDA_GRID,featureVector,fitRidgeLogistic,chooseLambda,
 marketFixedZero,predictLearn,artifactSha256} from './learn.ts';

// Seeded LCG so every run sees the same synthetic data.
function rng(seed){let s=seed>>>0;return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};}
function normal(r){const u=Math.max(r(),1e-12),v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
const sigmoid=z=>1/(1+Math.exp(-z));
const TRUE=[0.1,1.0,0.6,0,0.2,-0.5,0.05,0.02,-0.1];
function synthetic(n,seed=7){
 const r=rng(seed),rows=[];
 for(let i=0;i<n;i++){
  const present=r()<0.5?1:0,rest=Math.floor(r()*4);
  const x=[1,normal(r),present*normal(r),present,present*normal(r)*0.5,normal(r)*0.3,r()<0.5?1:0,rest,rest===0?1:0];
  const p=sigmoid(x.reduce((a,v,k)=>a+v*TRUE[k],0));
  rows.push({x,y:r()<p?1:0,w:1,at:new Date(Date.UTC(2026,0,1)+i*60000).toISOString()});
 }
 return rows;
}

test('constants match the spec',()=>{
 assert.deepEqual([...FEATURES],['bias','stats_logit','books_logit','books_present','line_gap_books','opp_allowed_ratio','home','rest_days','back_to_back']);
 assert.deepEqual(MARKET_FEATURES,[2,3,4]);
 assert.equal(MARKET_MIN_LINES,150);
 assert.deepEqual(LAMBDA_GRID,[0.01,0.1,1,10]);
});

test('recovers known weights from synthetic data',()=>{
 const w=fitRidgeLogistic(synthetic(20000),0.01,[]);
 w.forEach((v,k)=>assert.ok(Math.abs(v-TRUE[k])<0.1,`${FEATURES[k]}: got ${v.toFixed(3)} want ${TRUE[k]}`));
});

test('weights pinned at zero stay exactly zero',()=>{
 const w=fitRidgeLogistic(synthetic(5000),0.1,MARKET_FEATURES);
 for(const k of MARKET_FEATURES)assert.equal(w[k],0);
 assert.ok(w.every(Number.isFinite));
});

test('sportsbook weights stay off until enough graded real lines exist',()=>{
 assert.deepEqual(marketFixedZero(0),MARKET_FEATURES);
 assert.deepEqual(marketFixedZero(149),MARKET_FEATURES);
 assert.deepEqual(marketFixedZero(150),[]);
});

test('with no forward data the fit still returns finite weights',()=>{
 const rows=synthetic(3000).map(r=>({...r,x:r.x.map((v,k)=>MARKET_FEATURES.includes(k)?0:v)}));
 const w=fitRidgeLogistic(rows,1,marketFixedZero(0));
 assert.ok(w.every(Number.isFinite));
 assert.deepEqual(MARKET_FEATURES.map(k=>w[k]),[0,0,0]);
});

test('chooseLambda picks a grid value by time-ordered validation',()=>{
 assert.ok(LAMBDA_GRID.includes(chooseLambda(synthetic(4000),[])));
});

const base={pMore:0.55,pLess:0.4,pTie:0.05};
const matchup={oppAllowedRatio:1.1,home:1,restDays:2,backToBack:0};
test('featureVector encodes books as absent when unknown, and the ratio around 1',()=>{
 const x=featureVector({base,market:null,matchup});
 assert.equal(x.length,FEATURES.length);
 assert.equal(x[0],1);
 assert.ok(Math.abs(x[1]-Math.log((0.55/0.95)/(0.4/0.95)))<1e-12);
 assert.deepEqual(x.slice(2,5),[0,0,0]);
 assert.ok(Math.abs(x[5]-0.1)<1e-12);
 assert.deepEqual(x.slice(6),[1,2,0]);
 const withBooks=featureVector({base,market:{booksAtSameLine:2,pMoreBooks:0.6,nearestBookLine:25.5,lineGap:1,flags:[]},matchup});
 assert.ok(Math.abs(withBooks[2]-Math.log(0.6/0.4))<1e-12);
 assert.deepEqual(withBooks.slice(3,5),[1,1]);
 const extreme=featureVector({base:{pMore:1,pLess:0,pTie:0},market:null,matchup});
 assert.ok(Number.isFinite(extreme[1]));
});

const artifact=(weights)=>({modelVersion:'props-learn-v1',baseModelVersion:'props-nb-minutes-rate-v1',trainedAt:'2026-11-08T10:00:00Z',
 dataCutoff:'2026-11-08T09:00:00Z',features:[...FEATURES],weights,lambda:{points:0.1,rebounds:0.1,assists:0.1},marketWeightsActive:false,
 counts:{points:{historical:1,forward:0,forwardWithBooks:0},rebounds:{historical:1,forward:0,forwardWithBooks:0},assists:{historical:1,forward:0,forwardWithBooks:0}}});
test('predictLearn is a valid distribution that keeps the tie probability',()=>{
 const identity=[0,1,0,0,0,0,0,0,0];
 const a=artifact({points:identity,rebounds:identity,assists:identity});
 const p=predictLearn(a,'points',{base,market:null,matchup});
 assert.ok(Math.abs(p.pMore+p.pLess+p.pTie-1)<1e-9);
 assert.equal(p.pTie,0.05);
 assert.ok(Math.abs(p.pMore-0.55)<1e-9);
 const shifted=predictLearn(artifact({...a.weights,points:[0.5,1,0,0,0,0,0,0,0]}),'points',{base,market:null,matchup});
 assert.ok(shifted.pMore>0.55);
});

test('artifact hash is stable under key order',()=>{
 const w=[0,1,0,0,0,0,0,0,0];
 const a=artifact({points:w,rebounds:w,assists:w});
 const reordered=Object.fromEntries(Object.entries(a).reverse());
 assert.equal(artifactSha256(a),artifactSha256(reordered));
 assert.match(artifactSha256(a),/^[a-f0-9]{64}$/);
});

test('review fix: the sportsbook line gap reaches the model even when no book posts the same line',async()=>{
 const {marketView}=await import('./market.ts');
 const q={bookmakerKey:'draftkings',providerEventId:'evtTEST000001',playerName:'Player A',stat:'points',marketKey:'player_points',line:25.5,
  overPrice:-110,underPrice:-110,providerLastUpdate:'2026-11-07T19:30:00.000Z',ingestedAt:'2026-11-07T20:00:00.000Z',lockAt:'2026-11-08T00:00:00.000Z',responseSha256:'a'.repeat(64)};
 const market=marketView({providerEventId:'evtTEST000001',playerName:'Player A',stat:'points',line:24.5},[q],null);
 const x=featureVector({base,market,matchup});
 assert.equal(x[4],1,'line_gap_books carries the 1-point gap');
 assert.deepEqual(x.slice(2,4),[0,0],'no same-line probability, so the books terms stay off');
});
