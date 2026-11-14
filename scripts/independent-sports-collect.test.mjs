import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseCsv,sourceFor,freezeSportsSnapshot,collectIndependentSports} from './independent-sports-collect.mjs';
const now='2026-11-13T18:00:00.000Z';
const nfl=[
 'game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,away_rest,home_rest,away_moneyline,home_moneyline,spread_line',
 '2026_10_CAR_NO,2026,REG,10,2026-11-15,13:00,CAR,,NO,,7,7,110,-130,2.5',
 '2026_09_NYJ_BUF,2026,REG,9,2026-11-08,13:00,NYJ,20,BUF,23,6,7,135,-160,3.5',
 '2025_09_NYJ_BUF,2025,REG,9,2025-11-08,13:00,NYJ,20,BUF,23,6,7,135,-160,3.5',''
].join('\r\n');
const nhl=[
 'game_id,season_full,game_type,game_date,game_time,home_team_abbr,away_team_abbr,home_score,away_score,game_state,venue',
 '2026020233,20262027,R,2026-11-11,2026-11-11T23:00:00Z,NYR,TOR,3,2,OFF,"Madison Square Garden"',
 '2026020257,20262027,R,2026-11-13,2026-11-13T23:00:00Z,NYR,BOS,3,1,LIVE,"Madison Square Garden"',
 '2025020257,20252026,R,2025-11-13,2025-11-13T23:00:00Z,NYR,BOS,2,1,OFF,"Madison Square Garden"',''
].join('\n');
const tmp=()=>mkdtempSync(join(tmpdir(),'sportsedge-independent-'));
test('source catalog is fixed and paid bookmaker APIs are absent',()=>{
 assert.equal(sourceFor('nfl',now).season,2026);
 assert.equal(sourceFor('nhl',now).season,2027);
 assert.equal(sourceFor('nhl',now).url,'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nhl_schedules/nhl_schedule_2027.csv');
 assert.throws(()=>sourceFor('kalshi',now),/NOT_ALLOWED/);
 assert.throws(()=>sourceFor('nba',now),/NOT_ALLOWED/);
});
test('RFC4180 parser supports quoted venue commas, CRLF and throws on corrupt rows',()=>{
 assert.deepEqual(parseCsv('a,b\r\n1,"hello, ""world"""\r\n'),[{a:'1',b:'hello, "world"'}]);
 assert.throws(()=>parseCsv('a,b\n1,"oops'),/UNCLOSED/);
 assert.throws(()=>parseCsv('a,b\n1,2,3'),/RAGGED/);
 assert.throws(()=>parseCsv('a,a\n1,2'),/BAD_HEADER/);
});
test('NFL saves only whitelisted schedule and older source-reported scores, never bookmaker odds',()=>{
 const a=freezeSportsSnapshot('nfl',nfl,now);
 assert.equal(a.season,2026);
 assert.equal(a.rows,2);
 assert.equal(a.sourceReportedResults,1);
 assert.equal(a.games[0].homeScore,23);
 assert.equal(a.games[1].homeScore,null);
 assert.equal(a.games[1].state,'UNVERIFIED_OR_FUTURE');
 assert.equal('home_moneyline' in a.games[0],false);
 assert.equal('spread_line' in a.games[0],false);
 assert.equal('odds' in a,false);
 assert.equal(a.id.length,64);
 const b=freezeSportsSnapshot('nfl',nfl,now);
 assert.deepEqual(a,b);
});
test('NHL preserves completed past results and refuses same-day/active game scores',()=>{
 const a=freezeSportsSnapshot('nhl',nhl,now);
 assert.equal(a.season,2027);
 assert.equal(a.rows,2);
 assert.equal(a.sourceReportedResults,1);
 const done=a.games.find(g=>g.date==='2026-11-11');
 assert.equal(done.state,'SOURCE_REPORTED_RESULT');
 assert.equal(done.homeScore,3);
 const live=a.games.find(g=>g.date==='2026-11-13');
 assert.equal(live.homeScore,null);
 assert.equal(live.state,'UNVERIFIED_OR_FUTURE');
 assert.equal('venue' in done,false);
});
test('collector makes exactly one fixed GET and never repeats a completed date',async()=>{
 const root=tmp(),requests=[];
 try{
  const fetcher=async(url,opts)=>{
   requests.push(url);
   assert.equal(opts.method,'GET');
   assert.equal(opts.credentials,'omit');
   assert.match(url,/nflverse/);
   return new Response(nfl,{headers:{'content-type':'text/csv'}});
  };
  const first=await collectIndependentSports({league:'nfl',root,now:()=>now,fetcher});
  assert.equal(first.status,'ARCHIVED');assert.equal(first.sourceCalls,1);
  assert.equal(requests.length,1);
  const saved=JSON.parse(readFileSync(first.path,'utf8'));
  assert.equal(saved.games.length,2);
  const again=await collectIndependentSports({league:'nfl',root,now:()=>now,fetcher});
  assert.equal(again.status,'ALREADY_ARCHIVED');assert.equal(again.sourceCalls,0);
  assert.equal(requests.length,1);
  assert.equal(again.path,first.path);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('NHL collector uses separate path and exactly one SportsDataverse release GET',async()=>{
 const root=tmp(),requests=[];
 try{
  const result=await collectIndependentSports({league:'nhl',root,now:()=>now,
   fetcher:async(url,opts)=>{requests.push(url);assert.equal(opts.method,'GET');return new Response(nhl);}});
  assert.equal(result.status,'ARCHIVED');assert.match(result.path,/independent-sports\/nhl\/snapshots/);
  assert.equal(requests.length,1);
  assert.ok(requests[0].endsWith('nhl_schedule_2027.csv'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('tampering never triggers overwrite or a second source request',async()=>{
 const root=tmp(),requests=[];
 try{
  const fetcher=async()=>{requests.push(1);return new Response(nfl);};
  const r=await collectIndependentSports({league:'nfl',root,now:()=>now,fetcher});
  const saved=JSON.parse(readFileSync(r.path,'utf8'));saved.games[0].homeScore=999;
  writeFileSync(r.path,JSON.stringify(saved));
  await assert.rejects(collectIndependentSports({league:'nfl',root,now:()=>now,fetcher}),/INTEGRITY/);
  assert.equal(requests.length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('schema drift and over-limit responses fail closed without creating archives',async()=>{
 const root=tmp();try{
  const bad=nfl.replace('away_team','wrong_team');
  await assert.rejects(collectIndependentSports({league:'nfl',root,now:()=>now,
   fetcher:async()=>new Response(bad)}),/SCHEMA_CHANGED/);
  assert.equal(existsSync(join(root,'independent-sports','nfl','snapshots',now.slice(0,10)+'.json')),false);
  await assert.rejects(collectIndependentSports({league:'nfl',root,now:()=>now,
   fetcher:async()=>new Response('a'.repeat(6_000_001))}),/TOO_LARGE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects fake settled scores on the same date even when provider reports both scores',()=>{
 const inPlay=nfl.replace('2026-11-08','2026-11-13');
 const r=freezeSportsSnapshot('nfl',inPlay,now);
 assert.equal(r.sourceReportedResults,0);
 assert.equal(r.games[0].homeScore,null);
});
