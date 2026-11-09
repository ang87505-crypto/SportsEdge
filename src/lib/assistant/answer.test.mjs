// Assistant answers on a synthetic TEST-ONLY ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {answer,rangeBounds} from './answer.ts';
import {makeData,makeRaw,NOW} from './fixtures.mjs';
import {propsSummary} from '../props/summary.ts';
import {buildView} from '../props/dashboard-view.ts';

const P=(o={})=>({intent:'help',player:null,stat:null,side:null,platform:null,range:null,followUp:false,...o});

test('results for last night, in plain words, with the same numbers as the page',()=>{
 const r=answer(P({intent:'results',range:'yesterday'}),makeData());
 assert.equal(r.text,'Last night went 2–1 on entries: #7 won +$10.00, #8 lost −$5.00, #9 won +$10.00. Picks hit 9 of 14 (64%). Balance $515.00.');
 assert.ok(r.suggestions.length>=2&&r.suggestions.length<=4);
});

test('results before grading say so and give no numbers',()=>{
 const r=answer(P({intent:'results',range:'yesterday'}),makeData({graded:false}));
 assert.equal(r.text,"Last night's games aren't graded yet. Results usually appear after the morning grading run.");
 assert.doesNotMatch(r.text,/\d/);
});

test("tonight's picks: the top two from different games",()=>{
 const r=answer(P({intent:'picks',range:'today'}),makeData());
 assert.equal(r.text,'Top two for tonight: Devin Booker More 11.5 rebounds (74%) and Trae Young More 9.5 assists (68%). Different games, so they fit one entry.');
 assert.deepEqual(r.context.lastPickIds,[21,22]);
 assert.equal(r.cards[0].kind,'picks');
 assert.equal(r.cards[0].items.length,3);
});

test('picks before today\'s collection: no picks yet, and when the next collection is',()=>{
 const r=answer(P({intent:'picks',range:'today'}),makeData({tonight:false}));
 assert.equal(r.text,'No picks for tonight yet. The next line collection is Mon, Nov 9, 12:10 PM MST.');
});

test('picks filtered by stat keep only that stat',()=>{
 const r=answer(P({intent:'picks',stat:'rebounds'}),makeData());
 assert.deepEqual(r.context.lastPickIds,[21,23]);
 assert.match(r.text,/Devin Booker More 11\.5 rebounds/);
 assert.doesNotMatch(r.text,/assists/);
});

test('why explains the pick from the last answer, with the overconfidence note above 70%',()=>{
 const r=answer(P({intent:'why'}),{...makeData(),context:{lastPickIds:[21]}});
 assert.match(r.text,/^Devin Booker More 11\.5 rebounds: 74%\. Stats: 12\.5 expected\./);
 assert.match(r.text,/above 70% the model has been overconfident/);
 const plain=answer(P({intent:'why',player:{name:'Trae Young'}}),makeData());
 assert.doesNotMatch(plain.text,/overconfident/);
});

test('record uses the same numbers as the PrizePicks page',()=>{
 const data=makeData();
 const s=propsSummary(buildView(makeRaw(),'prizepicks'));
 const r=answer(P({intent:'record'}),data);
 assert.equal(s.balanceCents,51500);
 assert.equal(r.text,'Balance $515.00 (+$15.00 since the $500.00 start). Entries 2–1. Picks hit 9 of 14 (64.3%) over the last two weeks.');
});

test('a player answer lists each platform line with the estimate, decision and result',()=>{
 const r=answer(P({intent:'player',player:{name:'Devin Booker'}}),makeData());
 assert.match(r.text,/^Devin Booker: /);
 assert.match(r.text,/PrizePicks rebounds 11\.5: model More 74%, picked More; locks Mon, Nov 9, 7:00 PM MST\./);
 assert.match(r.text,/DraftKings Pick6 points 26\.5: model More 55%, skipped;/);
 const one=answer(P({intent:'player',player:{name:'Devin Booker'},stat:'points'}),makeData());
 assert.doesNotMatch(one.text,/rebounds/);
});

test('entries: open ones first, each with its legs',()=>{
 const r=answer(P({intent:'entries'}),makeData({graded:false}));
 assert.equal(r.text,'3 open entries, 0 settled.');
 assert.equal(r.cards[0].kind,'entries');
 assert.match(r.cards[0].items[0].detail,/Last Night Player/);
});

test('lineup: a copy-ready two-pick lineup from different games',()=>{
 const r=answer(P({intent:'lineup'}),makeData());
 assert.equal(r.cards[0].kind,'lineup');
 assert.equal(r.cards[0].text,'Devin Booker More 11.5 rebounds; Trae Young More 9.5 assists');
 assert.match(r.text,/Enter it in PrizePicks yourself/);
});

test('"last night" just after midnight still means the previous evening',()=>{
 const b=rangeBounds('yesterday','2026-11-09T07:30:00.000Z');
 assert.equal(b.label,'Last night');
 assert.ok(b.from<='2026-11-09T01:00:00.000Z'&&'2026-11-09T01:00:00.000Z'<b.to,JSON.stringify(b));
 assert.equal(b.from,'2026-11-08T07:00:00.000Z');
 assert.equal(rangeBounds('date:2026-11-07',NOW).label,'Nov 7');
});

test('every reply offers 2 to 4 suggestions',()=>{
 for(const intent of ['picks','why','results','record','player','entries','lineup'])
  for(const opts of [{},{graded:false,tonight:false}]){
   const r=answer(P({intent,player:intent==='player'||intent==='why'?{name:'Devin Booker'}:null}),makeData(opts));
   assert.ok(r.suggestions.length>=2&&r.suggestions.length<=4,intent+' '+r.suggestions.length);
  }
});
