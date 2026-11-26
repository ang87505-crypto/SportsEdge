import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreSeason,backtestParams} from './props-season-score.ts';
import {MODEL_FIXED} from './box-csv.ts';

const params={...MODEL_FIXED,leagueRate:{points:0.45,rebounds:0.18,assists:0.1},dispersion:{points:8,rebounds:6,assists:5}};
/** Synthetic box rows for one or more athletes: one game every 2 days, deterministic stats. */
function rows(athletes=['a1','a2'],n=25,{dnpAt=-1,mutateFrom=Infinity,shift=0}={}){
 const out=[];
 for(const a of athletes)for(let i=0;i<n;i++){
  const start=new Date(Date.UTC(2023,10,1)+i*2*86_400_000).toISOString();
  const dnp=i===dnpAt;
  const k=i>=mutateFrom?shift:0;
  out.push({athlete:a,name:a,team:'BOS',opponent:'NYK',home:true,game:'g'+i,start,reason:dnp?'Rest':null,
   log:{gameStart:start,didNotPlay:dnp,minutes:dnp?null:28+(i%5),points:dnp?null:12+(i*7)%9+k,
    rebounds:dnp?null:5+(i*3)%4+k,assists:dnp?null:3+(i*5)%3+k,seasonType:'regular'}});
 }
 return out;
}

test('forecasts use only earlier games: changing later games never changes an earlier forecast',()=>{
 const a=scoreSeason(rows(),params,()=>null).lines;
 const b=scoreSeason(rows(['a1','a2'],25,{mutateFrom:15,shift:20}),params,()=>null).lines;
 const before=(ls)=>ls.filter(l=>l.start<new Date(Date.UTC(2023,10,1)+15*2*86_400_000).toISOString());
 assert.ok(before(a).length>0);
 assert.deepEqual(before(a).map(l=>l.q),before(b).map(l=>l.q));
 // The mutated games' own outcomes do change, so the comparison is not vacuous.
 assert.notDeepEqual(a.map(l=>l.y),b.map(l=>l.y));
});

test('an input at the same time as the predicted game is refused as leakage',()=>{
 const r=rows(['a1'],10);
 r.push({...r[5],game:'dup'});
 assert.throws(()=>scoreSeason(r,params,()=>null),/LEAKAGE/);
});

test('DNPs are never scored, early games lack history, and leakage checks are counted',()=>{
 const s=scoreSeason(rows(['a1'],20,{dnpAt:10}),params,()=>null);
 assert.equal(s.lines.some(l=>l.game==='g10'),false);
 assert.equal(s.lines.some(l=>l.game==='g0'||l.game==='g2'),false,'needs 3 played games of history and a proxy line');
 assert.ok(s.leakage.checked>0);assert.equal(s.leakage.violations,0);
 assert.equal(s.pushes,0,'half-point proxy lines cannot push');
 for(const l of s.lines){assert.ok(l.q>0&&l.q<1);assert.ok(l.y===0||l.y===1);}
});

test('the forward window filter scores only games at or after the start, using earlier history',()=>{
 const since=new Date(Date.UTC(2023,10,1)+20*2*86_400_000).toISOString();
 const all=scoreSeason(rows(),params,()=>null).lines,fwd=scoreSeason(rows(),params,()=>null,since).lines;
 assert.ok(fwd.length>0&&fwd.every(l=>l.start>=since));
 assert.deepEqual(fwd.map(l=>l.q),all.filter(l=>l.start>=since).map(l=>l.q));
});

test('scoring is deterministic regardless of input row order',()=>{
 const r=rows();
 const a=scoreSeason(r,params,()=>null),b=scoreSeason([...r].reverse(),params,()=>null);
 assert.deepEqual(a,b);
});

test('backtest parameters come from the prior season only',()=>{
 const bp=backtestParams(rows(['p1','p2','p3'],30));
 assert.ok(bp.params.leagueRate.points>0&&bp.params.dispersion.points>0);
 assert.equal(bp.priorOf('p1').games,30);
 assert.equal(bp.priorOf('nobody'),null);
});
