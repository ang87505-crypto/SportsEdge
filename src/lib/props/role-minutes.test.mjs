// props-nb-role-minutes-v1: role-change minutes. Synthetic TEST-ONLY logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {predictLine} from './model.ts';

const model=JSON.parse(readFileSync(new URL('../../data/props/model_v1.json',import.meta.url),'utf8'));
const V1=model.params,ROLE={...V1,version:'props-nb-role-minutes-v1',roleChange:{recentGames:3,minShift:6}};
const CUT='2026-11-10T00:00:00Z';
// minutes listed oldest -> newest; one game every 2 days ending 2 days before the cutoff
const logs=(mins,pts=20)=>mins.map((m,i)=>({gameStart:new Date(Date.parse(CUT)-(mins.length-i)*2*86400_000).toISOString(),
 minutes:m,didNotPlay:false,points:pts,rebounds:6,assists:4}));
const run=(params,l,line=19.5,cutoff=CUT)=>predictLine({logs:l,prior:null,stat:'points',line,cutoff,params});

test('identical to layer 1 when minutes are steady or the shift is small or mixed', () => {
 for(const mins of [[30,31,29,30,32,30,31,30,29,30],[30,30,30,30,30,30,30,34,35,33],[20,20,20,20,20,20,20,30,19,30]]){
  const a=run(V1,logs(mins)),b=run(ROLE,logs(mins));
  assert.equal(b.inputs.roleShift,false,String(mins));
  assert.deepEqual({...b,inputs:{...b.inputs,roleShift:undefined}},{...a,inputs:{...a.inputs,roleShift:undefined}});
 }
});

test('a consistent promotion moves expected minutes to the recent level and never narrows uncertainty', () => {
 const promoted=logs([18,17,19,18,18,17,18,32,33,31]);
 const a=run(V1,promoted),b=run(ROLE,promoted);
 assert.equal(b.inputs.roleShift,true);
 assert.equal(b.inputs.expMinutes,32);
 assert.ok(a.inputs.expMinutes<32);
 assert.ok(b.inputs.sdMinutes>=a.inputs.sdMinutes);
 assert.ok(b.pMore>a.pMore,'more minutes -> higher chance of more');
 const demoted=run(ROLE,logs([34,35,33,34,34,35,34,20,21,19]));
 assert.equal(demoted.inputs.roleShift,true);assert.equal(demoted.inputs.expMinutes,20);
});

test('no lookahead: games at or after the cutoff never move the forecast', () => {
 const base=logs([18,17,19,18,18,17,18,19,18,17]);
 const future=[...base,{gameStart:CUT,minutes:40,didNotPlay:false,points:50,rebounds:9,assists:9},
  {gameStart:'2026-11-12T00:00:00Z',minutes:40,didNotPlay:false,points:50,rebounds:9,assists:9}];
 assert.deepEqual(run(ROLE,future),run(ROLE,base));
 assert.equal(run(ROLE,future).inputs.roleShift,false);
});

test('needs three recent and three older games; DNPs and short appearances do not count', () => {
 assert.equal(run(ROLE,logs([18,18,32,33,31])).inputs.roleShift,false);   // only 2 older games
 const withDnp=[...logs([18,17,19,18,18,17,32,33,31])];
 withDnp.push({gameStart:new Date(Date.parse(CUT)-86400_000).toISOString(),minutes:null,didNotPlay:true,points:null,rebounds:null,assists:null});
 assert.equal(run(ROLE,withDnp).inputs.roleShift,true);                   // the DNP is skipped, not counted as 0
});
