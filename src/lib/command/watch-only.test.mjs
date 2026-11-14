import test from 'node:test';
import assert from 'node:assert/strict';
import {callTool,toolByName} from './tools.ts';
import {plan,compose} from './planner.ts';
import {handleCommand} from '../server/command-handler.ts';

const nowIso='2026-11-14T20:00:00.000Z';
const obs=(id,event,name,day,platform='prizepicks')=>({
 id,platform,provider_event_id:event,home_team:'Test Home',away_team:'Test Away',
 lock_at:day+'T23:00:00.000Z',player_name:name,stat:'rebounds',line:8.5,
 provider_last_update:day+'T17:59:00.000Z',
 ingested_at:day+'T18:00:00.000Z',recorded_at:day+'T18:00:10.000Z'
});
const pred=(id,prob,day)=>({
 id,observation_id:id,model_version:'props-nb-minutes-rate-v1',status:'scored',athlete_id:String(1234+id),
 p_more:prob,p_less:1-prob,p_tie:0,
 data_cutoff:day+'T17:55:00.000Z',predicted_at:day+'T18:00:20.000Z'
});
const grade=(id,actual)=>({observation_id:id,revision:1,outcome:actual>8.5?'more':'less',actual,graded_at:'2026-11-14T03:00:00.000Z'});
const data={
 nowIso,windowStart:'2026-10-01T00:00:00.000Z',control:{state:'RUNNING',reason:'TEST'},
 observations:[obs(1,'nba-111','Winner One','2026-11-13'),obs(2,'nba-222','Loser Two','2026-11-13'),obs(3,'nba-333','Pending Three','2026-11-14')],
 predictions:[pred(1,.65,'2026-11-13'),pred(2,.72,'2026-11-13'),pred(3,.55,'2026-11-14')],
 picks:[],results:[grade(1,10),grade(2,7)],entryLegs:[]
};
const ports=(o={})=>({nowIso,ownerAccess:false,
 sports:async()=>null,ops:async()=>null,research:async()=>null,lab:async()=>null,
 accounts:async()=>{throw Error('owner access must not run');},watch:async()=>data,...o});
const ask=(input)=>callTool('watch_only',input,ports());
test('Watch Only is a public read-only tool with bounded validated arguments',async()=>{
 const tool=toolByName('watch_only');
 assert.ok(tool);
 assert.equal(tool.access,'public');
 for(const input of [
  {period:'future',threshold:'60'},
  {period:'today',threshold:'90'},
  {period:'today',threshold:'all',platform:'betfair'},
  {period:'today',threshold:'all',bet:true}
 ]){
  const r=await ask(input);
  assert.equal(r.ok,false);
  assert.match(r.error,/INVALID_INPUT/);
 }
});
test('all persisted qualifying lines are counted without any wager, $5 or odds call',async()=>{
 const r=await ask({period:'yesterday',threshold:'60'});
 assert.equal(r.ok,true);
 assert.equal(r.data.uniqueLines,2);
 assert.equal(r.data.distinctGames,2);
 assert.equal(r.data.wins,1);
 assert.equal(r.data.losses,1);
 assert.equal(r.data.hitRate,.5);
 assert.equal(r.data.pending,0);
 assert.equal(r.data.sourceRows,2);
 assert.equal(r.data.from,'2026-11-13');
 assert.equal(r.data.to,'2026-11-13');
 assert.equal(r.cards.some(c=>c.kind==='table'&&c.rows.length===2),true);
 assert.ok(r.sources.some(x=>x.href==='/paper-betting/watch'));
 assert.doesNotMatch(JSON.stringify(r),/profitCents|stakeCents|orderId|entryId|hypotheticalNet/);
 const answer=compose([r]);
 assert.match(answer,/2 distinct saved lines/);
 assert.match(answer,/50.0%/);
 assert.match(answer,/NOT actual or virtual bets/);
 const high=await ask({period:'yesterday',threshold:'70',platform:'prizepicks'});
 assert.equal(high.data.uniqueLines,1);
 assert.equal(high.data.losses,1);
 assert.equal(high.data.hitRate,0);
 const today=await ask({period:'today',threshold:'all'});
 assert.equal(today.data.uniqueLines,1);
 assert.equal(today.data.pending,1);
 assert.equal(today.data.hitRate,null);
});
test('missing source and unavailable records cannot be turned into zero picks',async()=>{
 const r=await callTool('watch_only',{period:'today',threshold:'60'},ports({watch:async()=>null}));
 assert.equal(r.ok,false);
 assert.match(r.error,/unavailable/);
 const error=await callTool('watch_only',{period:'today',threshold:'60'},ports({watch:async()=>{throw Error('db offline');}}));
 assert.equal(error.ok,false);
 assert.match(error.error,/unavailable/);
});
test('no trading or money controls can leak into the Watch Only planner',()=>{
 const cases=[
  ['How did all 60%+ predictions do yesterday?','yesterday','60'],
  ['How did our watch only lines do today?','today','all'],
  ['List all captured lines from last week','prior_7_days','all'],
  ['Which saved lines did we track this week?','last_7_days','all'],
  ['How accurate were the 80% predictions yesterday?','yesterday','80']
 ];
 for(const [q,period,threshold] of cases){
  const p=plan(q,[]);
  assert.equal(p?.calls[0].tool,'watch_only',q);
  assert.equal(p?.calls[0].input.period,period,q);
  assert.equal(p?.calls[0].input.threshold,threshold,q);
 }
 const prev=[{tool:'watch_only',input:{period:'today',threshold:'60',platform:'all'}}];
 assert.equal(plan('and yesterday?',prev)?.calls[0].input.period,'yesterday');
 assert.equal(plan('what about 70%?',prev)?.calls[0].input.threshold,'70');
 assert.equal(plan('which ones missed?',prev)?.filter,'misses');
 for(const q of ['Why no bets tonight?','Compare our Kalshi weather and NBA picks yesterday',
  'How did our stock picks compare with NBA this week?','Stop the stock bot and show lines'])
  assert.notEqual(plan(q,[])?.calls[0]?.tool,'watch_only',q);
});

test('complete no-bet conversation answers from saved records and carries 60% threshold into follow-up',async()=>{
 let reads=0,legacy=0;
 const p=ports({watch:async()=>{reads++;return data;}});
 async function q(message,session){
  const res=await handleCommand({
   contentType:'application/json',
   text:async()=>JSON.stringify({message,...(session?{session}:{})}),
   clientKey:'synthetic-watch-only'
  },{},{
   ports:p,
   legacy:async()=>{legacy++;return {text:'UNEXPECTED_LEGACY',cards:[],suggestions:[],context:{domain:'sports'}};}
  });
  assert.equal(res.status,200);
  return res.json();
 }
 const first=await q('How did all 60%+ predictions do yesterday?');
 assert.equal(first.mode,'tools');
 assert.match(first.reply.text,/2 distinct saved lines/);
 assert.match(first.reply.text,/50\.0%/);
 assert.equal(first.session.last[0].tool,'watch_only');
 const next=await q('what about 70%?',first.session);
 assert.equal(next.mode,'tools');
 assert.equal(next.session.last[0].input.threshold,'70');
 assert.equal(next.session.last[0].input.period,'yesterday');
 assert.match(next.reply.text,/1 distinct saved lines/);
 assert.equal(legacy,0);
 assert.equal(reads,2);
});
