/**
 * Realistic user-language regression corpus for the free Ask SportsEdge
 * deterministic assistant. This is a finite benchmark, NOT a claim to
 * understand unrestricted natural language. No network or account access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationalText} from './colloquial.ts';
import {routeQuestion} from './domain.ts';
import {parseControlRequest,chatActionRequest} from './actions.ts';
import {isNavigationQuestion,isManualOperationQuestion,unsupportedLeagueAnswer,navigationAnswer} from './knowledge-guide.ts';

const matrix=[
 // English, abbreviations and common texting typos
 ["Tonight's picks",'sports','picks'],
 ['wer todays trdes good','stocks','performance'],
 ['how did my stockz do','stocks','performance'],
 ['kalhsi weater acuracy','kalshi','performance'],
 ['what are the stock positions','stocks','holdings'],
 ['what went wrong with the sports picks','sports','explain'],
 ['what commands can you follow','all','help'],
 ['can you stop the stock bot','stocks','controls'],
 ['please pause prizepicks','sports','controls'],
 ['why did the stock autopilot stop','stocks','explain'],
 ['how can we improv the sports model','sports','improving'],
 ['which stock research strategy beat spy','research','performance'],
 ['do we have NHL picks tonight','sports','picks'],
 ['did NBA and Kalshi perform well','all','performance'],
 ['is everything running','all','health'],
 ['what needs my approval','all','approvals'],
 ['what happened today','all','today'],
 ['what is next for all systems','all','automation']
];
test('realistic language corpus classifies domain and topic',()=>{
 for(const [message,domain,topic] of matrix){
  const actual=routeQuestion(message,null);
  assert.equal(actual.domain,domain,message+': domain');
  assert.equal(actual.topic,topic,message+': topic');
 }
});
test('changing domains overrides conversational context; short followups retain it',()=>{
 const last={domain:'stocks',topic:'performance',symbol:'OXY'};
 for(const message of ['and yesterday?','what about last week?','tell me more']){
  const r=routeQuestion(message,last);
  assert.equal(r.domain,'stocks',message);
  assert.equal(r.topic,'performance',message);
 }
 assert.equal(routeQuestion('and Kalshi?',last).domain,'kalshi');
 assert.equal(routeQuestion('what about NBA?',last).domain,'sports');
});
test('arbitrary ticker, player identity, decimal threshold or quantity never auto-corrected',()=>{
 for(const [message,literal] of [
  ['OXY BMY 12.5','oxy bmy 12.5'],
  ['Sengun 11.5 rebounds','sengun 11.5 rebounds'],
  ['BUY 100 TSLA','buy 100 tsla'],
  ['what about XYZ 800?','xyz 800']
 ])assert.ok(conversationalText(message).includes(literal),message);
});
test('negative, conditional, past and explanatory orders cannot create proposals',()=>{
 for(const message of [
  'why did you stop the stock bot',
  'how do i pause sports',
  'dont stop props',
  'stop autopilot tomorrow',
  'could you stop if we lose',
  'what happens if you sell my stocks',
  'did it buy oxy yesterday'
 ])assert.equal(parseControlRequest(message),null,message);
 for(const message of ['pause props','stop autopilot','resume prizepicks']){
  const parsed=parseControlRequest(message);
  assert.ok(parsed,message);
  assert.notEqual(parsed.verb,'trade');
 }
 // No LLM/tool can ask the allowlist to place/submit a trade.
 for(const id of ['stock-start','stock-resume','buy-oxy','kalshi-order','props-activate'])
  assert.equal(chatActionRequest(id),null,id);
});
test('navigation is link-only and manual operations are guidance-only',()=>{
 for(const [message,href] of [
  ['where can i see every prediction','/paper-betting/predictions'],
  ['where is the nba model page','/research/nba'],
  ['where can i check github actions','https://github.com/ang87505-crypto/SportsEdge/actions'],
  ['where can i see my stock fills','/stocks/alpaca'],
  ['where is our kalshi dashboard','/prediction-markets/kalshi']
 ]){
  assert.equal(isNavigationQuestion(message),true,message);
  const result=navigationAnswer(message,routeQuestion(message,null));
  const links=result.cards.flatMap(c=>c.kind==='links'?c.items:[]);
  assert.ok(links.some(x=>x.href===href),message);
  assert.ok(result.cards.every(c=>c.kind!=='action'),message);
 }
 for(const phrase of ['run collect now','how do i retrain','where do i stop the bot','deploy the site'])
  assert.equal(isManualOperationQuestion(phrase),true,phrase);
});
test('a free schedule archive is never misrepresented as live league picks',()=>{
 for(const message of ['NFL picks tonight','NHL win rate','WNBA model results','MLB betting predictions']){
  const answer=unsupportedLeagueAnswer(message);
  assert.ok(answer,message);
  assert.match(answer.text,/cannot verify an active/i);
  assert.equal(answer.cards.some(c=>c.kind==='action'),false);
 }
});
