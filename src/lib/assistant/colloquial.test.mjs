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
