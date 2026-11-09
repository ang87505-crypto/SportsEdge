import test from 'node:test';
import assert from 'node:assert/strict';
import {answerProps,mountainDay} from './conversation.ts';
import {propsChatData} from './conversation-data.ts';

// Invented TEST data, unrelated to real player lines, probabilities or returns.
const NOW='2026-11-09T00:30:00Z'; // Nov 8, 5:30 PM MST.
const ctx={platform:'prizepicks'};
const line=(id,player,extra={})=>({id,player,stat:'points',line:20.5,game:`Away ${id} @ Home ${id}`,lockAt:'2026-11-09T03:00:00Z',
 ingestedAt:NOW,side:'more',recorded:true,probability:0.64,mean:23,modelVersion:'props-nb-minutes-rate-v1',result:null,correct:null,books:null,...extra});
function fixture(){return {asOf:NOW,issue:null,scheduleEnabled:true,control:{state:'RUNNING',reason:'Owner resumed'},status:'Automatic. A scheduled collection is recorded.',model:null,
 platforms:{prizepicks:{account:'test-prizepicks-v1',initialCents:50000,lines:[line(1,'Nikola Jokic'),line(2,'Devin Booker'),
  line(3,'Nikola Jokic',{stat:'rebounds',line:10.5,probability:0.66}),line(4,'Jalen Brunson'),line(5,'Jalen Williams'),
  line(6,'Stephen Curry',{lockAt:'2026-11-08T03:00:00Z',correct:false,result:{outcome:'less',actual:18}}),
  line(7,'Stephen Curry',{lockAt:'2026-11-08T03:00:00Z',correct:true,stat:'assists',result:{outcome:'more',actual:8}}),
  line(8,'Stephen Curry',{lockAt:'2026-11-08T03:00:00Z',result:{outcome:'void_dnp',actual:null}})],
  entries:[{id:1,lockAt:'2026-11-09T03:00:00Z',legIds:[1,2],profitCents:null,settled:false},
   {id:2,lockAt:'2026-11-08T03:00:00Z',legIds:[6,7],profitCents:-500,settled:true}]},
 pick6:{account:'test-pick6-v1',initialCents:50000,entries:[],lines:[line(21,'Nikola Jokic',{stat:'rebounds',line:11.5,probability:0.62})]}}};}
const ask=(q,context=ctx,data=fixture(),now=NOW)=>answerProps(q,context,data,now);

test('plain-language picks and slash command read recorded upcoming estimates',()=>{
 for(const q of ['who should i take tonight','/picks','show picks today','can i see tonights picks','what should i bet on','NBA picks tonight']){
  const r=ask(q);assert.match(r.text,/64%|66%/);assert.match(r.text,/out of 100 similar picks would still not win/);assert.match(r.text,/ties may be refunded/);assert.doesNotMatch(r.text,/Curry/);
 }
});
test('results synonyms exclude pending and voids from hit rate',()=>{
 for(const q of ['howd we do last night','results yesterday','did my picks hit last night','how did my bets go']){
  const r=ask(q);assert.match(r.text,/1–1/);assert.match(r.text,/50%/);assert.match(r.text,/1 tied or void/);assert.match(r.text,/actual 18/);
 }
});
test('calendar dates use Mountain time across UTC midnight and DST',()=>{
 assert.equal(mountainDay(NOW),'2026-11-08');
 assert.equal(mountainDay('2026-11-01T07:30:00Z'),'2026-11-01');
 assert.equal(mountainDay('2026-11-01T08:30:00Z'),'2026-11-01');
 const d=fixture();d.platforms.prizepicks.lines=[line(90,'Midnight Player',{lockAt:'2026-11-09T00:00:00Z',correct:true,result:{outcome:'more',actual:30}})];
 assert.match(ask('results today',ctx,d).text,/1–0/);
 assert.match(ask('results yesterday',ctx,d).text,/no recorded picks/);
});
test('misspelled names, accents and nicknames resolve only against saved players',()=>{
 for(const q of ['why jokic','why jockic','why joker','why Nikola Jokić'])assert.match(ask(q).text,/Nikola Jokic/);
 assert.match(ask('why messi').text,/could not match/);
});
test('ambiguous first name asks before choosing; full-name reply resumes intent',()=>{
 const r=ask('why jalen');assert.match(r.text,/Which player/);assert.deepEqual(r.suggestions,['Jalen Brunson','Jalen Williams']);
 assert.match(ask('Jalen Williams',r.context).text,/Jalen Williams More/);
});
test('player, stat and platform carry into natural follow-ups',()=>{
 const first=ask('why jokic');
 const second=ask('what about rebounds',first.context);assert.match(second.text,/Jokic More 10.5 rebounds/);
 const third=ask('and Pick6',second.context);assert.match(third.text,/Jokic More 11.5 rebounds/);assert.equal(third.context.platform,'pick6');
});
test('unknown request never repeats the prior answer or invents reasoning',()=>{
 const prev=ask('why jokic');
 assert.match(ask('what is the weather',prev.context).text,/did not match/);
 assert.match(ask('why messi',prev.context).text,/could not match/);
 assert.match(ask('why jokic').text,/cannot say the pros agree/);
 assert.doesNotMatch(ask('why jokic').text,/last 10|recent minutes|injury/);
});
test('no upcoming pick is offered after lock, after a result or from unrecorded rows',()=>{
 const d=fixture();d.platforms.prizepicks.lines=[line(1,'Test Player',{lockAt:NOW}),line(2,'Other Player',{recorded:false}),line(3,'Third Player',{result:{outcome:'more',actual:50}})];
 assert.match(ask('picks tonight',ctx,d).text,/no recorded, unstarted picks/);
});
test('new broad question resets player scope; unknown ledger is distinct from empty ledger',()=>{
 const p=ask('why jokic');assert.match(ask('picks tonight',p.context).text,/Booker/);
 const d=fixture();d.platforms.prizepicks.lines=[];assert.match(ask('picks tonight',ctx,d).text,/no recorded/);
 for(const issue of ['not_configured','unavailable']){
  d.issue=issue;const r=ask('what is my balance',ctx,d);assert.doesNotMatch(r.text,/\$0|\$500|0–0/);assert.match(r.text,/not connected|did not respond/);
 }
});
test('full list restores all players; naming a different player clears the previous stat',()=>{
 const p=ask('picks tonight'); // Jokic rebounds is the highest estimate.
 assert.match(ask('full list',p.context).text,/Booker/);
 const why=ask('why booker',p.context);assert.match(why.text,/Booker More 20.5 points/);
 assert.match(ask('top two picks tonight').text,/model estimate/);
 assert.match(ask('why messi rebounds',p.context).text,/could not match/);
});
test('DraftKings sportsbook question does not silently switch to Pick6',()=>{
 assert.equal(ask('draftkings odds for jokic').context.platform,'prizepicks');
});
test('unsupported date ranges are explained instead of silently counted as today',()=>{
 for(const q of ['record last 30 days','results last month','results 2026-10-01'])assert.match(ask(q).text,/do not have a complete ledger/);
});
test('stale snapshot refuses upcoming picks and lineup; stored results remain readable',()=>{
 const later='2026-11-09T00:36:00Z';
 assert.match(ask('picks tonight',ctx,fixture(),later).text,/5 minutes old/);
 assert.match(ask('copy lineup',ctx,fixture(),later).text,/5 minutes old/);
 assert.match(ask('results yesterday',ctx,fixture(),later).text,/1–1/);
});
test('copy lineup returns exact complete entry legs and no implied joint probability',()=>{
 const r=ask('copy lineup');assert.match(r.copyText,/entry #1/);assert.match(r.copyText,/Jokic More 20.5 points/);assert.match(r.copyText,/Booker More 20.5 points/);
 assert.match(r.text,/not a verified joint win probability/);assert.match(r.text,/only copies text/);
 const afterPicks=ask('copy lineup',ask('picks tonight').context);assert.ok(afterPicks.copyText,'context must not filter the second leg out');
});
test('incomplete, started, same-game and same-player entries cannot be copied',()=>{
 for(const mutate of [d=>d.platforms.prizepicks.entries[0].legIds=[1],d=>d.platforms.prizepicks.entries[0].lockAt=NOW,
  d=>d.platforms.prizepicks.lines[1].game=d.platforms.prizepicks.lines[0].game,
  d=>d.platforms.prizepicks.lines[1].player=d.platforms.prizepicks.lines[0].player]){
  const d=fixture();mutate(d);assert.equal(ask('copy lineup',ctx,d).copyText,undefined);
 }
});
test('paper profit and pick hit rate are separate; Pick6 never invents a payout',()=>{
 const r=ask('balance');assert.match(r.text,/-\$5\.00/);assert.match(r.text,/\$495\.00/);assert.match(r.text,/up to 500 entries/);
 assert.match(ask('balance on Pick6').text,/payouts depend/);assert.doesNotMatch(ask('balance on Pick6').text,/\$500/);
 const d=fixture();d.platforms.prizepicks.entries[1].profitCents=null;
 assert.match(ask('balance',ctx,d).text,/complete balance cannot be calculated/);
});
test('all-time request is scoped to loaded records; zero graded does not assert 0% accuracy',()=>{
 assert.match(ask('all time record').text,/not an all-time record/);
 const d=fixture();d.platforms.prizepicks.lines=d.platforms.prizepicks.lines.filter(l=>!l.result);
 const r=ask('record',ctx,d);assert.match(r.text,/pending/);assert.doesNotMatch(r.text,/0% hit rate/);
});
test('sportsbook consensus is same-line data; absent probabilities stay unknown',()=>{
 const d=fixture();d.platforms.prizepicks.lines[0].books={probability:0.58,count:2,gap:0,flags:['pros_disagree']};
 assert.match(ask('sportsbook odds for jokic',ctx,d).text,/2 sportsbook\(s\) averaged 58% More/);
 assert.match(ask('sportsbook odds for jokic',ctx,d).text,/pros disagree/);
 d.platforms.prizepicks.lines[0].books={probability:null,count:0,gap:1.5,flags:[]};
 assert.match(ask('sportsbook odds for jokic',ctx,d).text,/No same-line sportsbook probability/);
});
test('schedule never promises a stopped or unknown worker will run',()=>{
 const d=fixture();d.control.state='STOPPED';
 assert.match(ask('when is the next run',ctx,d).text,/blocked until you resume/);
 d.control=null;assert.match(ask('schedule',ctx,d).text,/cannot verify/);
 d.issue='not_configured';assert.match(ask('schedule',ctx,d).text,/Next planned collection/);
});
test('control requests only link to owner controls and do not claim success',()=>{
 for(const q of ['pause picking','resume','stop','retrain now','turn learning off']){
  const r=ask(q);assert.equal(r.link.href,'#props-owner-controls');assert.match(r.text,/has not changed anything/);
 }
 const d=fixture();d.issue='not_configured';assert.equal(ask('pause',ctx,d).link,undefined);
});
test('entry requests explain the available manual action',()=>{
 const r=ask('place those bets');assert.match(r.text,/cannot submit entries or move money/);assert.equal(r.copyText,undefined);
});
test('model answer distinguishes unavailable learning from trained state',()=>{
 assert.match(ask('how does the model learn').text,/cannot verify the active model/);
 const d=fixture();d.model={active:'props-learn-v1',learningEnabled:true,autoSwitchEnabled:false,challengers:[]};
 assert.match(ask('model',ctx,d).text,/500 graded lines/);assert.match(ask('model',ctx,d).text,/does not guarantee improvement/);
});
test('projection strips raw inputs, run receipts and server configuration',()=>{
 const raw={nowIso:NOW,control:{state:'RUNNING',reason:'Owner resumed',changed_at:NOW},runs:[],credits:[],providerRemaining:null,
 observations:[{id:1,platform:'prizepicks',provider_event_id:'test',home_team:'H',away_team:'A',lock_at:'2026-11-09T03:00:00Z',player_name:'Test Player',stat:'points',line:20.5,provider_last_update:NOW,ingested_at:NOW}],
 predictions:[{id:1,observation_id:1,model_version:'props-nb-minutes-rate-v1',status:'scored',reason:'ok',p_more:0.64,p_less:0.36,p_tie:0,mean:23,inputs:{private_test_marker:'must not cross'}}],
 picks:[{id:1,prediction_id:1,status:'recorded',side:'more',reason:'ok',selection_version:'props-select-v1'}],results:[],accounts:[],entries:[],legs:[],settlements:[]};
 const result=propsChatData(raw);
 assert.equal(result.platforms.prizepicks.lines[0].probability,0.64);assert.doesNotMatch(JSON.stringify(result),/private_test_marker|inputs|providerRemaining/);
 assert.equal(propsChatData(null).issue,'not_configured');assert.equal(propsChatData(null,'unavailable').issue,'unavailable');
});
