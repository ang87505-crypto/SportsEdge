import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationalText} from './colloquial.ts';
test('corrects common informal spelling without LLM tokens',()=>{
 for(const [input,parts] of [
  ['wer todays trdes good',['today','trades','perform']],
  ['were todays trades good',['today','stock','trades','perform']],
  ['how can we improv from here',['improve']],
  ['how much did the kalhsi forcast change',['kalshi','forecast']],
  ['how did our stoks perfomance do',['stocks','performance']],
  ['whats the yesturday resutls',['what is','yesterday','results']],
  ['tell me the algoritm accurracy',['algorithm','accuracy']],
  ['what are the algorythm imprOvments',['algorithm','improvements']],
 ])for(const part of parts)assert.ok(conversationalText(input).includes(part),input+' -> '+part+'; got '+conversationalText(input));
});
test('does not correct unknown player names, ticker symbols, numbers or order quantities',()=>{
 assert.equal(conversationalText('OXY BMY AAPL 11.5 $500'), 'oxy bmy aapl 11.5 $500');
 assert.ok(conversationalText('Sengun 13.5 rebounds').includes('sengun 13.5 rebounds'));
 assert.equal(conversationalText('Can you buy 100 TSLA?'),'can you buy 100 tsla');
 assert.ok(conversationalText('PAUSE stock autopilot').includes('pause'));
 assert.equal(conversationalText(''), '');
});
test('bounds input and leaves unrelated words unchanged without hallucinating an intent',()=>{
 assert.equal(conversationalText('x'.repeat(301)),'');
 assert.equal(conversationalText('purple elephants consume translucent ideas'),'purple elephants consume translucent ideas');
 assert.equal(conversationalText('futures trading'),'futures trading');
});
test('normalizes natural performance and improvement phrasings',()=>{
 assert.equal(conversationalText("Were today's trades good?"),'how did today stock trades perform');
 assert.equal(conversationalText('were trades today good'),'how did today stock trades perform');
 assert.equal(conversationalText('what do we do from here'),'how can we improve from here');
 assert.equal(conversationalText('how can we get better from here'),'how can we improve from here');
});

test('short chat slang and misspelled operational vocabulary stay bounded',()=>{
 for(const [text,want] of [
  ['r u checking stocks rn','are you checking stocks right now'],
  ['pls show kalish wheatherz','please show kalshi weather'],
  ['whr is the dashbord','where is the dashboard'],
  ['ystrdy botz failed','yesterday bots failed'],
  ['wat commnads can you do','what commands can you do'],
  ['can you retarin the algorythm','can you retrain the algorithm'],
  ['show oppertunities for kalhsi','show opportunities for kalshi']
 ])assert.equal(conversationalText(text),want,text);
});
test('mis-spelled commands cannot alter ticker, quantity, player or odds values',()=>{
 assert.equal(conversationalText('pause OXY buy AAPL 125 @ 11.5'), 'pause oxy buy aapl 125 11.5');
 assert.equal(conversationalText('Why 12.5 rebounds for Sengun?'),'why 12.5 rebounds for sengun');
 assert.equal(conversationalText('XYZ 9000 moneymade'),'xyz 9000 moneymade');
});

test('short-form assistant availability text is repaired without implying a site outage',()=>{
 for(const message of ['y rnt worky','y rnt u worky','why rnt you workin','why are not you wrkng']){
  const normalized=conversationalText(message);
  assert.match(normalized,/why are you not working|why are not you working/,message+' -> '+normalized);
 }
 assert.equal(conversationalText('r u worky'),'are you working');
 assert.equal(conversationalText('Is SportsEdge down?'),'is sportsedge down');
 assert.equal(conversationalText('why are my stocks not working'),'why are my stocks not working');
});
