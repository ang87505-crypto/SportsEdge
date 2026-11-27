import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fitLowMinutes,lowMinutesQ,opponentQ,LOW_MINUTES_MAX} from './lib/props-breakdown.ts';
import {combinedQ} from './props-low-minutes-eval.ts';

const line=(extra={})=>({game:'g',athlete:'a',stat:'points',line:6.5,q:0,rate:0.5,expMinutes:12,sdMinutes:3,dispersion:30,opp:null,actualMinutes:10,...extra});
const withQ=l=>({...l,q:opponentQ(l,0)});

test('the low-minutes challenger changes only lines below 15 expected minutes, and m=1, s=0 reproduces the baseline',()=>{
 const low=withQ(line()),high=withQ(line({expMinutes:LOW_MINUTES_MAX,line:7.5}));
 assert.ok(Math.abs(lowMinutesQ(low,{m:1,s:0})-low.q)<1e-12);
 assert.equal(lowMinutesQ(high,{m:0.5,s:1}),high.q,'at or above 15 minutes: untouched');
 assert.ok(lowMinutesQ(low,{m:0.9,s:0.5})<low.q,'fewer expected minutes lowers P(more)');
 assert.throws(()=>lowMinutesQ(low,{m:0,s:0}),/INVALID_ADJUSTMENT/);
});

test('m and s come from realized minutes of unique low-minute player-games only (one row per game per player)',()=>{
 const rows=[];
 for(let i=0;i<200;i++)for(const stat of ['points','rebounds','assists'])
  rows.push(line({game:'g'+i,stat,actualMinutes:i%2?9:9.6,expMinutes:12,sdMinutes:0.1}));
 rows.push(line({game:'big',expMinutes:30,actualMinutes:60}));   // above the segment: ignored
 const a=fitLowMinutes(rows);
 assert.equal(a.n,200,'three stat lines of one player-game count once');
 assert.ok(Math.abs(a.m-0.775)<1e-4,'(9+9.6)/2/12');
 assert.ok(a.s>0&&a.s<0.05);
});

test('the combined descriptive arm applies the opponent scaling first, then the minutes adjustment',()=>{
 const l=withQ(line({opp:1.1}));
 assert.ok(Math.abs(combinedQ(l,{m:1,s:0},0)-l.q)<1e-12,'both neutral: baseline');
 assert.ok(Math.abs(combinedQ(l,{m:1,s:0},1)-opponentQ(l,1))<1e-12,'minutes neutral: opponent model');
});

test('the protocol pins untouched 2013-14..2015-16 seasons and fits on the season before each',()=>{
 const p=JSON.parse(readFileSync(new URL('../research/props_low_minutes_v1_20261124/protocol.json',import.meta.url),'utf8'));
 assert.deepEqual(p.folds.map(f=>f.test.season.file),['player_box_2014.csv','player_box_2015.csv','player_box_2016.csv']);
 for(const f of p.folds){const y=Number(f.test.season.file.slice(11,15));
  assert.equal(f.fit.season.file,`player_box_${y-1}.csv`);assert.equal(f.fit.prior.file,`player_box_${y-2}.csv`);assert.equal(f.test.prior.file,`player_box_${y-1}.csv`);}
 assert.match(p.decision.promotion,/^none/);assert.match(p.design.fit,/no line outcome is used/);
});
