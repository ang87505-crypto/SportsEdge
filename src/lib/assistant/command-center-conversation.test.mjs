import test from 'node:test';
import assert from 'node:assert/strict';
import {routeQuestion} from './domain.ts';
import {isNavigationQuestion,navigationAnswer,improvementAnswer,unsupportedQuestion,isManualOperationQuestion,manualOperationAnswer,supportedCommandsAnswer,unsupportedLeagueAnswer,isAssistantAvailabilityQuestion} from './knowledge-guide.ts';
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

test('informal natural wording and short followups select the right domain without switching to an order',()=>{
 for(const [message,domain,topic] of [
  ['r our botz working rn','all','automation'],
  ['wer stockz trdes good','stocks','performance'],
  ['Kalhsi oppertunities rn','kalshi','opportunity'],
  ['how are nhl picks tonight','sports','picks'],
  ['which nba model is better','sports','performance'],
  ['can you stop?','all','controls'],
  ['why did you stop the stock bot','stocks','explain'],
  ['which commands can you follow','all','help']
 ]){
  const q=routeQuestion(message,null);
  assert.equal(q.domain,domain,message);
  assert.equal(q.topic,topic,message);
 }
 assert.equal(routeQuestion('and what about yesterday?',{domain:'stocks',topic:'performance'}).domain,'stocks');
 assert.equal(routeQuestion('what about kalshi?',{domain:'stocks',topic:'performance'}).domain,'kalshi');
});
test('navigation supports messy destination requests but does not steal a data question',()=>{
 for(const [message,path] of [
  ['whr is the dashbord for all predictions','/paper-betting/predictions'],
  ['where do i see every line','/paper-betting/predictions'],
  ['where do i find stock backtest page','/stocks/research'],
  ['where can i open my kalshi weather dashboard','/prediction-markets/kalshi'],
  ['where do i find the logs','https://github.com/ang87505-crypto/SportsEdge/actions'],
  ['send me the link to the automation monitor','/automation'],
  ['which page has the nba model','/research/nba']
 ]){
  assert.equal(isNavigationQuestion(message),true,message);
  const a=navigationAnswer(message,routeQuestion(message,null));
  assert.ok(a.cards.flatMap(c=>c.kind==='links'?c.items:[]).some(x=>x.href===path),message);
  assert.ok(a.cards.every(c=>c.kind!=='action'));
 }
 for(const message of ['show me the latest trades','how many predictions hit yesterday','did the collector run?'])
  assert.equal(isNavigationQuestion(message),false,message);
});
test('manual operations are routed to documented owner controls, never run',async()=>{
 for(const message of [
  'run collect now','can you retrain our model','how do i stop the stock bot',
  'deploy the site','how can i backfill the game scores','enable the collector'
 ]){
  const ps=fakePorts();
  assert.equal(isManualOperationQuestion(message),true,message);
  const r=await ask(message,null,ps);
  assert.equal(r.http,200);
  assert.match(r.reply.text,/nothing was changed/i);
  assert.equal(r.reply.cards.some(c=>c.kind==='action'),false);
  assert.ok(r.reply.cards.some(c=>c.kind==='links'));
  assert.deepEqual(ps.calls,{sports:0,accounts:0,broker:0,research:0,kalshi:0},message);
 }
 assert.equal(isManualOperationQuestion('Did the collector run?'),false);
 assert.equal(isManualOperationQuestion('When did you retrain?'),false);
});
test('help catalog answers supported questions and cites working pages without claiming execution',async()=>{
 const ps=fakePorts();
 const a=await ask('what commands can you follow',null,ps);
 assert.equal(a.http,200);
 assert.match(a.reply.text,/saved sports predictions/i);
 assert.match(a.reply.text,/cannot place bets/i);
 assert.ok(a.reply.cards.some(c=>c.kind==='links'));
 assert.deepEqual(ps.calls,{sports:0,accounts:0,broker:0,research:0,kalshi:0});
 assert.equal(supportedCommandsAnswer().context.topic,'help');
});
test('new leagues are not silently treated as NBA prop picks',async()=>{
 for(const message of ['what about NFL picks tonight?','are NHL predictions available?','what is WNBA win rate?']){
  const ps=fakePorts();
  const r=await ask(message,null,ps);
  assert.equal(r.http,200);
  assert.match(r.reply.text,/cannot verify an active/i);
  assert.match(r.reply.text,/nba props/i);
  assert.ok(r.reply.cards.some(c=>c.kind==='links'));
  assert.deepEqual(ps.calls,{sports:0,accounts:0,broker:0,research:0,kalshi:0});
  assert.ok(unsupportedLeagueAnswer(message));
 }
});
test('trading commands are never interpreted as already submitted trades',async()=>{
 const ps=fakePorts();
 const r=await ask('buy OXY',null,ps);
 assert.equal(r.http,200);
 assert.match(r.reply.text,/cannot submit/i);
 assert.match(r.reply.text,/no trade was sent/i);
 assert.equal(r.reply.cards.some(c=>c.kind==='action'),false);
 assert.equal(ps.calls.accounts,0);
 assert.equal(ps.calls.broker,0);
});
test('valid lab context survives previous-turn parsing and invalid context remains rejected',async()=>{
 const ps=fakePorts();
 const req={contentType:'application/json',text:async()=>JSON.stringify({
  message:'where is the learning lab page',context:{domain:'all',topic:'lab'}})};
 const response=await handleSiteAssistant(req,{},NOW,ps.ports);
 assert.equal(response.status,200);
 const r=await response.json();
 assert.ok(r.reply.cards.some(c=>c.kind==='links'));
 const bad={contentType:'application/json',text:async()=>JSON.stringify({
  message:'help',context:{domain:'all',topic:'DROP TABLE'}})};
 assert.equal((await handleSiteAssistant(bad,{},NOW,ps.ports)).status,400);
});

test('assistant-vs-site status questions remain separate and require no private loads',async()=>{
 for(const message of ['y rnt worky','y rnt u worky','why rnt you workin','why did you stop working']){
  const ps=fakePorts();
  assert.equal(isAssistantAvailabilityQuestion(message),true,message);
  const r=await ask(message,{domain:'stocks',topic:'performance'},ps);
  assert.equal(r.http,200,message);
  assert.equal(r.reply.context.domain,'all',message);
  assert.match(r.reply.text,/do not continue editing code/i,message);
  assert.match(r.reply.text,/nothing was started or changed/i,message);
  assert.ok(r.reply.cards.flatMap(c=>c.kind==='links'?c.items:[])
   .some(item=>item.href==='/automation'),message);
  assert.equal(r.reply.cards.some(c=>c.kind==='action'),false,message);
  assert.deepEqual(ps.calls,{sports:0,accounts:0,broker:0,research:0,kalshi:0},message);
 }
});
test('site failures and automation questions do not become assistant availability replies',()=>{
 for(const message of [
  'is sportsedge site down','why is the site not working',
  'why are stocks not working','why is the NBA bot not working',
  'are the workflows failing','what happened to the jobs'
 ]){
  assert.equal(isAssistantAvailabilityQuestion(message),false,message);
 }
 assert.deepEqual((({domain,topic})=>({domain,topic}))(routeQuestion('is SportsEdge site down',null)),
  {domain:'all',topic:'health'});
 assert.deepEqual((({domain,topic})=>({domain,topic}))(routeQuestion('why is the site not working',null)),
  {domain:'all',topic:'health'});
});
