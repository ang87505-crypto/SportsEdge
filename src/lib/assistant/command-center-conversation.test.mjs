import test from 'node:test';
import assert from 'node:assert/strict';
import {routeQuestion} from './domain.ts';
import {isNavigationQuestion,navigationAnswer,improvementAnswer,unsupportedQuestion} from './knowledge-guide.ts';
import {kalshiPublicAnswer} from './kalshi-answer.ts';
import {handleSiteAssistant} from '../server/site-assistant-handler.ts';
const NOW='2026-11-13T22:00:00.000Z';
const empty={checkedAt:NOW,
 weather:{state:'AWAITING_FIRST_ARCHIVE',memory:null,grade:null},
 scorecard:{state:'AWAITING_FIRST_ARCHIVE',scorecard:null}};
const unavailable={checkedAt:NOW,
 weather:{state:'ARCHIVE_UNAVAILABLE',memory:null,grade:null},
 scorecard:{state:'ARCHIVE_UNAVAILABLE',scorecard:null}};
const weather={...empty,
 weather:{state:'RECORDED',
  memory:{targetLocalDate:'2026-11-14',capturedAt:NOW,
   forecastHighF:54,bandLowF:50,bandHighF:54,estimatedBandProbabilityPpm:null},
  grade:null},
 scorecard:{state:'RECORDED',scorecard:{evaluatedDays:12,lastDate:'2026-11-12',
  meanAbsoluteErrorF:3.7,independentBandHitRate:0.58,modelScoredDays:0,modelBrier:null}}};
const graded={...weather,weather:{...weather.weather,
 grade:{observedHighF:51,hitIndependentBand:true,absoluteErrorF:3}}};
function fakePorts(kalshi=async()=>weather){
 const calls={sports:0,accounts:0,broker:0,research:0,kalshi:0};
 return {calls,ports:{
  access:{ownerAccess:false,ownerExpiresAt:null},
  sports:async()=>{calls.sports++;throw Error('SPORTS_SHOULD_NOT_BE_CALLED');},
  accounts:async()=>{calls.accounts++;throw Error('PRIVATE_SHOULD_NOT_BE_CALLED');},
  broker:async()=>{calls.broker++;throw Error('BROKER_SHOULD_NOT_BE_CALLED');},
  research:async()=>{calls.research++;throw Error('RESEARCH_SHOULD_NOT_BE_CALLED');},
  kalshi:async()=>{calls.kalshi++;return kalshi();}
 }};
}
async function ask(message,context=null,ps=fakePorts()){
 const req={contentType:'application/json',text:async()=>JSON.stringify({message,context})};
 const response=await handleSiteAssistant(req,{},NOW,ps.ports);
 return {http:response.status,...await response.json()};
}
test('natural language, colloquial spelling and domain switches route safely',()=>{
 for(const [question,domain,topic] of [
  ["were today's trades good",'stocks','performance'],
  ['wer todays trdes good','stocks','performance'],
  ['how did my stoks perfomance do','stocks','performance'],
  ['Kalshi bets','kalshi','overview'],
  ['how is kalhsi forcast acuracy','kalshi','performance'],
  ['are there real kalhsi opportunitites','kalshi','opportunity'],
  ['How did NBA and Kalshi do?','all','performance'],
  ['what did the stock model learn','research','explain'],
  ["Tonight's picks",'sports','picks']
 ]){const route=routeQuestion(question,null);assert.equal(route.domain,domain,question);assert.equal(route.topic,topic,question);}
});
test('followups preserve last topic/domain when next user sentence is indirect',()=>{
 const stocks={domain:'stocks',topic:'performance'};
 assert.deepEqual((({domain,topic})=>({domain,topic}))(routeQuestion('and yesterday?',stocks)),stocks);
 assert.deepEqual((({domain,topic})=>({domain,topic}))(routeQuestion('how can we improve from here',stocks)),
  {domain:'stocks',topic:'improving'});
 assert.equal(routeQuestion('how can we improve from here',null).domain,'all');
 assert.equal(routeQuestion('and how accurate is it',{domain:'kalshi',topic:'overview'}).domain,'kalshi');
 assert.equal(routeQuestion('tell me about stoks',{domain:'kalshi',topic:'overview'}).domain,'stocks');
});
test('the same message never silently interprets Kalshi markets as sports bets or stock orders',async()=>{
 const ps=fakePorts();
 const r=await ask('Are there real Kalshi opportunities yet?',null,ps);
 assert.equal(r.http,200);
 assert.equal(r.reply.context.domain,'kalshi');
 assert.match(r.reply.text,/no verified real kalshi market opportunity/i);
 assert.match(r.reply.text,/no authorized live bid/i);
 assert.equal(ps.calls.kalshi,1);
 assert.equal(ps.calls.sports,0);
 assert.equal(ps.calls.accounts,0);
 assert.equal(ps.calls.broker,0);
 assert.equal(r.reply.cards.some(c=>c.kind==='action'),false);
});
test('missing and unavailable archives are unknown rather than zero model accuracy or false wins',()=>{
 const q=routeQuestion('how accurate is kalshi weather research',null);
 const a=kalshiPublicAnswer(q,empty);
 assert.match(a.text,/no verified independent weather scorecard/i);
 assert.doesNotMatch(a.text,/0% accuracy|0 wins|guaranteed/i);
 const b=kalshiPublicAnswer(q,unavailable);
 assert.match(b.text,/unavailable/i);
 assert.doesNotMatch(b.text,/0% accuracy/i);
 const c=kalshiPublicAnswer(q,graded);
 assert.match(c.text,/12 distinct graded climate day/i);
 assert.match(c.text,/58\.0%/);
 assert.match(c.text,/not a betting win rate/i);
 assert.match(c.text,/preliminary/i);
 assert.doesNotMatch(c.text,/12 kalshi bets|profits? of/i);
});
test('navigation questions return exact internal routes instead of invented facts',()=>{
 for(const [query,path] of [
  ['where can i find my stock fill records?','/stocks/alpaca'],
  ['where do i see our kalshi weather forecasts?','/prediction-markets/kalshi'],
  ['show me the research dashboard','/stocks/research'],
  ['where can i check scheduled jobs','/automation'],
  ['where can i find nba sports games','/sports'],
  ['where is the learning lab page','/lab']
 ]){
  assert.equal(isNavigationQuestion(query),true,query);
  const r=navigationAnswer(query,routeQuestion(query,null));
  assert.ok(r.cards.flatMap(c=>c.kind==='links'?c.items:[]).some(i=>i.href===path),query);
 }
 assert.equal(isNavigationQuestion('show me the latest trades'),false);
});
test('unsupported queries explicitly point to sources instead of inventing a metric',async()=>{
 const ps=fakePorts();
 const r=await ask('purple elephants are everywhere?',null,ps);
 assert.match(r.reply.text,/cannot reliably identify/i);
 assert.ok(r.reply.cards.some(c=>c.kind==='links'));
 assert.deepEqual(ps.calls,{sports:0,accounts:0,broker:0,research:0,kalshi:0});
});
test('nonowner stock question fails closed without revealing account or inventing fills',async()=>{
 const ps=fakePorts();
 const r=await ask("were today's trades good",null,ps);
 assert.equal(r.reply.context.domain,'stocks');
 assert.match(r.reply.text,/sign in/i);
 assert.doesNotMatch(r.reply.text,/\+\$|\-\$|\bprofit was\b/i);
 assert.equal(ps.calls.accounts,0);assert.equal(ps.calls.broker,0);
});
test('stock/sports/Kalshi improvement advice stays research-only with real destination links',()=>{
 for(const domain of ['sports','stocks','research','kalshi']){
  const r=improvementAnswer({domain,topic:'improving'});
  assert.equal(r.context.domain,domain);
  assert.ok(r.cards.some(c=>c.kind==='links'));
  assert.equal(r.cards.some(c=>c.kind==='action'),false);
 }
 assert.match(improvementAnswer({domain:'kalshi',topic:'improving'}).text,/no real kalshi opportunity/i);
 assert.match(improvementAnswer({domain:'stocks',topic:'improving'}).text,/strategy remains frozen/i);
});
test('unknown context and unrelated words do not turn into owner controls',async()=>{
 const ps=fakePorts();
 const a=await ask('can you start Kalshi bets?',null,ps);
 assert.match(a.reply.text,/cannot be enabled from chat/i);
 assert.equal(a.reply.cards.some(c=>c.kind==='action'),false);
 assert.equal(ps.calls.accounts,0);assert.equal(ps.calls.broker,0);
 assert.equal(routeQuestion('qwerty stocks',null).topic,'overview');
});
