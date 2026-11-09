// Assistant understanding: synthetic TEST-ONLY player list and phrasings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {understand,NICKNAMES,MIN_INTENT_SCORE} from './understand.ts';

const PLAYERS=['Nikola Jokic','Jalen Brunson','Jalen Williams','Devin Booker','Trae Young','Giannis Antetokounmpo','Shai Gilgeous-Alexander',
 'Anthony Davis','Kevin Durant','LeBron James','Domantas Sabonis','Luka Doncic','Jayson Tatum'];
const NOW='2026-11-09T19:00:00.000Z'; // Mon Nov 9, 12:00 PM MST
const ask=(m,ctx=null)=>understand(m,ctx,PLAYERS,NOW);

// [message, expected subset, context?]
const ROWS=[
 // picks
 ['who should I take tonight',{intent:'picks',range:'today'}],['best picks',{intent:'picks'}],["today's picks",{intent:'picks',range:'today'}],
 ['what do you like',{intent:'picks'}],['give me your top plays',{intent:'picks'}],['any good picks for tonight',{intent:'picks',range:'today'}],
 ['what are the picks',{intent:'picks'}],['pp picks',{intent:'picks',platform:'prizepicks'}],['pick6 picks',{intent:'picks',platform:'pick6'}],
 ['who do you like for rebounds tonight',{intent:'picks',stat:'rebounds',range:'today'}],
 // why
 ['why booker',{intent:'why',player:'Devin Booker'}],['how come',{intent:'why'}],['explain that pick',{intent:'why'}],
 ['what makes you like it',{intent:'why'}],['why do you like trae young',{intent:'why',player:'Trae Young'}],
 // results
 ['how did we do last night',{intent:'results',range:'yesterday'}],['did my picks hit',{intent:'results'}],
 ['results yesterday',{intent:'results',range:'yesterday'}],["how'd it go",{intent:'results'}],['how did last night go',{intent:'results',range:'yesterday'}],
 ['results nov 7',{intent:'results',range:'date:2026-11-07'}],['how did we do on november 7',{intent:'results',range:'date:2026-11-07'}],
 ['results 11/7',{intent:'results',range:'date:2026-11-07'}],['dk results',{intent:'results',platform:'pick6'}],
 ['did we win last night',{intent:'results',range:'yesterday'}],['how did we do this week',{intent:'results',range:'week'}],
 // record
 ["what's my record",{intent:'record'}],['balance',{intent:'record'}],['am I up',{intent:'record'}],
 ['how are we doing this week',{intent:'record',range:'week'}],['roi',{intent:'record'}],['all time record',{intent:'record',range:'all'}],
 ['how much have I won',{intent:'record'}],['prizepicks record',{intent:'record',platform:'prizepicks'}],['hit rate overall',{intent:'record',range:'all'}],
 ['how are we doing',{intent:'record'}],
 // player
 ['jokic rebounds',{intent:'player',player:'Nikola Jokic',stat:'rebounds'}],["what's the line on brunson",{intent:'player',player:'Jalen Brunson'}],
 ['odds for tatum points',{intent:'player',player:'Jayson Tatum',stat:'points'}],['the joker boards',{intent:'player',player:'Nikola Jokic',stat:'rebounds'}],
 ['brunsen points',{intent:'player',player:'Jalen Brunson',stat:'points'}],['lebron assists over',{intent:'player',player:'LeBron James',stat:'assists',side:'more'}],
 ['sga pts',{intent:'player',player:'Shai Gilgeous-Alexander',stat:'points'}],['luka dončić',{intent:'player',player:'Luka Doncic'}],
 ['giannis',{intent:'player',player:'Giannis Antetokounmpo'}],['booker under 25.5 points',{intent:'player',player:'Devin Booker',stat:'points',side:'less'}],
 ['kd scoring',{intent:'player',player:'Kevin Durant',stat:'points'}],['ad dimes',{intent:'player',player:'Anthony Davis',stat:'assists'}],
 ['sabonis rebunds',{intent:'player',player:'Domantas Sabonis',stat:'rebounds'}],['what about the greek freak',{intent:'player',player:'Giannis Antetokounmpo'}],
 // entries / lineup
 ['show my entries',{intent:'entries'}],['open entries',{intent:'entries'}],["what's riding",{intent:'entries'}],['my lineups today',{intent:'entries',range:'today'}],
 ['give me a lineup',{intent:'lineup'}],['copy lineup',{intent:'lineup'}],['build me an entry',{intent:'lineup'}],['make me a 2 pick',{intent:'lineup'}],
 // status
 ['is it running',{intent:'status'}],["when's the next run",{intent:'status'}],['paused?',{intent:'status'}],['did it collect today',{intent:'status',range:'today'}],
 ['is everything working',{intent:'status'}],
 // model
 ['which model is active',{intent:'model'}],['is it learning',{intent:'model'}],["how's the new model doing",{intent:'model'}],['challengers',{intent:'model'}],
 ['what did the model learn',{intent:'model'}],
 // mistakes
 ['what went wrong',{intent:'mistakes'}],['why did we lose',{intent:'mistakes'}],['mistakes this week',{intent:'mistakes',range:'week'}],
 ['why did the picks miss',{intent:'mistakes'}],
 // future
 ['what will it do tonight',{intent:'future',range:'today'}],["what's next",{intent:'future'}],['plans',{intent:'future'}],['what happens next',{intent:'future'}],
 // help / smalltalk
 ['help',{intent:'help'}],['what can you do',{intent:'help'}],['',{intent:'help'}],['hi',{intent:'smalltalk'}],['thanks',{intent:'smalltalk'}],
 ['cool',{intent:'smalltalk'}],['hello there',{intent:'smalltalk'}],
 // bet
 ['place a bet',{intent:'bet'}],['put $20 on jokic',{intent:'bet',player:'Nikola Jokic'}],['enter this for me',{intent:'bet'}],
 ['bet on booker over',{intent:'bet',player:'Devin Booker',side:'more'}],['submit my entry to prizepicks',{intent:'bet'}],
 // hostile / noise
 ['<script>alert(1)</script>',{intent:'unknown'}],['🔥🔥',{intent:'unknown'}],['asdfgh',{intent:'unknown'}],
 ['DROP TABLE users;',{intent:'unknown'}],
 // follow-ups
 ['and assists?',{intent:'results',stat:'assists',followUp:true},{intent:'results'}],
 ['what about rebounds',{intent:'picks',stat:'rebounds',followUp:true},{intent:'picks'}],
 ['and points?',{intent:'player',player:'Nikola Jokic',stat:'points',followUp:true},{intent:'player',player:'Nikola Jokic',stat:'rebounds'}],
 ['why?',{intent:'why',followUp:true},{intent:'picks',lastPickIds:[4]}],
 ['what about yesterday',{intent:'results',range:'yesterday',followUp:true},{intent:'results',range:'today'}],
 ['how about brunson',{intent:'player',player:'Jalen Brunson',followUp:true},{intent:'player',player:'Nikola Jokic'}],
 ['and on pick6?',{intent:'picks',platform:'pick6',followUp:true},{intent:'picks'}],
];

test('constants',()=>{
 assert.equal(MIN_INTENT_SCORE,1);
 assert.equal(NICKNAMES['joker'],'Nikola Jokic');
 assert.equal(NICKNAMES['sga'],'Shai Gilgeous-Alexander');
});

test(`phrasings map to intents and entities (${ROWS.length} rows)`,()=>{
 assert.ok(ROWS.length>80);
 const failures=[];
 for(const [m,want,ctx] of ROWS){
  const p=ask(m,ctx??null);
  const got={intent:p.intent,player:p.player&&'name' in p.player?p.player.name:undefined,stat:p.stat??undefined,side:p.side??undefined,
   platform:p.platform??undefined,range:p.range??undefined,followUp:p.followUp||undefined};
  for(const [k,v] of Object.entries(want))if(got[k]!==v)failures.push(`${JSON.stringify(m)}: ${k} got ${JSON.stringify(got[k])} want ${JSON.stringify(v)}`);
 }
 assert.deepEqual(failures,[]);
});

test('a first name shared by two players asks which one, never picks one',()=>{
 for(const m of ['jalen','jalen points','why jalen']){
  const p=ask(m);
  assert.deepEqual(p.player,{ambiguous:['Jalen Brunson','Jalen Williams']},m);
 }
});

test('an unknown player is reported, not guessed',()=>{
 assert.deepEqual(ask("what's the line on zzzz smith").player,{unknown:'zzzz smith'});
 assert.equal(ask('best picks').player,null);
});

test('dates resolve in New Mexico time',()=>{
 // 00:30 MST on Nov 9 is still the night of Nov 8 for "last night".
 assert.equal(understand('how did last night go',null,PLAYERS,'2026-11-09T07:30:00.000Z').range,'yesterday');
 assert.equal(understand('results nov 7',null,PLAYERS,'2026-01-03T19:00:00.000Z').range,'date:2025-11-07','a future date means last year');
});
