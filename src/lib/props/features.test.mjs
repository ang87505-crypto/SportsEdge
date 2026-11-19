import test from 'node:test';
import assert from 'node:assert/strict';
import {matchupFeatures,OPP_WINDOW_GAMES,REST_CAP} from './features.ts';

// Synthetic TEST-ONLY rows. Each game: two players per side, 30 minutes each.
const day=n=>new Date(Date.UTC(2026,10,1+n,0,0,0)).toISOString();
function game(n,home,away,{homePerMin=0.6,awayPerMin=0.6}={}){
 const row=(team,opp,perMin,k)=>({espnEventId:String(401000000+n*100+k),teamAbbr:team,opponentAbbr:opp,gameStart:day(n),
  minutes:30,points:Math.round(30*perMin),rebounds:6,assists:4,didNotPlay:false});
 // Players on `away` face `home`: their output is what `home` allows.
 return [row(home,away,homePerMin,0),row(home,away,homePerMin,1),row(away,home,awayPerMin,0),row(away,home,awayPerMin,1)]
  .map(r=>({...r,espnEventId:String(401000000+n)}));
}
// DEF allows 0.4 points/min, WEAK allows 0.8; everyone else 0.6.
const rows=[];
for(let n=0;n<16;n++){
 rows.push(...game(n,'DEF','AAA',{awayPerMin:0.4}));
 rows.push(...game(n,'WEAK','BBB',{awayPerMin:0.8}));
 rows.push(...game(n,'CCC','DDD'));
}
const base={teamAbbr:'TEAM',opponentAbbr:'DEF',home:true,lockAt:day(20),stat:'points',rows};

test('constants match the spec',()=>{
 assert.equal(OPP_WINDOW_GAMES,15);
 assert.equal(REST_CAP,3);
});

test('a strong defence gives a ratio below 1 and a weak one above 1',()=>{
 assert.ok(matchupFeatures(base).oppAllowedRatio<0.8);
 assert.ok(matchupFeatures({...base,opponentAbbr:'WEAK'}).oppAllowedRatio>1.2);
 assert.equal(matchupFeatures(base).home,1);
 assert.equal(matchupFeatures({...base,home:false}).home,0);
});

test('back-to-back, two days off, and no previous game',()=>{
 const mine=n=>game(n,'TEAM','ZZZ');
 const b2b=matchupFeatures({...base,rows:[...rows,...mine(19)]});
 assert.deepEqual([b2b.restDays,b2b.backToBack],[0,1]);
 const two=matchupFeatures({...base,rows:[...rows,...mine(17)]});
 assert.deepEqual([two.restDays,two.backToBack],[2,0]);
 const long=matchupFeatures({...base,rows:[...rows,...mine(5)]});
 assert.deepEqual([long.restDays,long.backToBack],[3,0]);
 const none=matchupFeatures(base);
 assert.deepEqual([none.restDays,none.backToBack],[3,0]);
});

test('no peeking: rows at or after lock never change any output',()=>{
 const future=[...game(20,'TEAM','DEF',{homePerMin:2,awayPerMin:2}),...game(25,'DEF','EEE',{awayPerMin:3})];
 assert.deepEqual(matchupFeatures({...base,rows:[...rows,...future]}),matchupFeatures(base));
});

test('fewer than 5 opponent games gives a neutral ratio',()=>{
 const few=rows.filter(r=>!(r.opponentAbbr==='DEF'||r.teamAbbr==='DEF')||Date.parse(r.gameStart)>=Date.parse(day(12)));
 assert.equal(matchupFeatures({...base,rows:few}).oppAllowedRatio,1);
});
