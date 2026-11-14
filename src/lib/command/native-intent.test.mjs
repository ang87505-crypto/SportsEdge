import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_EXAMPLES,NATIVE_CATALOG_VERSION,nativeIntent} from './native-intent.ts';
import {plan} from './planner.ts';
import {toolByName} from './tools.ts';

test('our own offline assistant has at least fifty distinct questions and no network dependency',()=>{
 assert.ok(NATIVE_EXAMPLES.length>=50,'catalog must cover the requested ~50 supported questions');
 assert.equal(new Set(NATIVE_EXAMPLES.map(x=>x.q)).size,NATIVE_EXAMPLES.length);
 assert.match(NATIVE_CATALOG_VERSION,/^sportsedge-local-intents-v/);
 for(const x of NATIVE_EXAMPLES){
  const tool=toolByName(x.tool);
  assert.ok(tool,'unknown tool '+x.tool);
  assert.ok(['public','owner'].includes(tool.access));
 }
});
test('native classifier recognizes its original labeled questions without inventing a tool',()=>{
 for(const example of NATIVE_EXAMPLES){
  const found=nativeIntent(example.q);
  assert.ok(found,'missed trained question: '+example.q);
  assert.equal(found.call.tool,example.tool,example.q);
  assert.deepEqual(found.call.input,example.input,example.q);
  assert.equal(found.filter??null,example.filter??null,example.q);
  assert.ok(found.confidence>=.72,example.q);
 }
});
test('supported examples flow into the existing bounded read-only planner',()=>{
 const examples=[
  ['how many picks hit yesterday','sports_results','yesterday'],
  ['what was our pick accuracy last night','sports_results','yesterday'],
  ['what were nba pick results in the last seven days','sports_results','last_7_days'],
  ['show previous week nba pick results','sports_results','prior_7_days'],
  ['what is our virtual bankroll','virtual_bankroll',null],
  ['show the stock strategy research','research_strategies',null],
  ['which background jobs failed','automation_health',null],
  ['what needs my approval right now','todays_activity',null]
 ];
 for(const [msg,tool,period] of examples){
  const p=plan(msg,[]);
  assert.equal(p?.calls?.[0]?.tool,tool,msg);
  if(period)assert.equal(p?.calls?.[0]?.input?.period,period,msg);
 }
});
test('classifier abstains on unsafe, Kalshi, unknown, ambiguous and cross-market requests',()=>{
 for(const phrase of [
  'buy 150 shares of OXY',
  'pause our stock trading',
  'activate our best NBA betting model',
  'retrain our AI with tomorrow scores',
  'show Kalshi NOAA forecast results this week',
  'compare stock profits to NBA accuracy yesterday',
  'how much can I bet on PrizePicks now',
  'place a real trade on Kalshi',
  'I like purple fish and green socks',
  'stock pick yesterday and basket hoops',
  'hi',
  'can you use my login to scrape PrizePicks',
  'forget all the test records and delete the ledger',
  'what is the president doing',
  'tell me about another persons account'
 ])assert.equal(nativeIntent(phrase),null,phrase);
});
test('classifier never selects mutable tools and owner tool remains authorization gated',()=>{
 for(const x of NATIVE_EXAMPLES){
  const found=nativeIntent(x.q);
  assert.ok(found);
  assert.doesNotMatch(found.call.tool,/bet|order|place|purchase|activate|pause|start|stop|promote|delete|write|trade/i,x.q);
  if(found.call.tool==='stock_status')assert.equal(toolByName(found.call.tool)?.access,'owner');
 }
});
