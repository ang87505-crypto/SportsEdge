// Shared SportsDataverse box-score loader: synthetic TEST-ONLY rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadBoxCsv,proxyLine} from './lib/box-csv.ts';

const head='season_type,game_id,game_date_time,athlete_id,athlete_display_name,team_abbreviation,home_away,opponent_team_abbreviation,did_not_play,minutes,points,rebounds,assists';
const csv=[head,
 '2,401,2026-01-02T19:00:00-0500,11,"Test, Alpha",BOS,home,NY,false,31,24,7,5',
 '2,401,2026-01-02T19:00:00-0500,12,Test Bravo,NY,away,BOS,true,,,,',
 '3,402,2026-02-15T20:00:00-0500,13,All Star,EAST,home,WEST,false,20,10,2,2',
 '1,403,2025-10-05T19:00:00-0400,14,Preseason,BOS,home,NY,false,20,10,2,2'].join('\n');

test('loads regular-season NBA rows with opponent and home/away',()=>{
 const dir=mkdtempSync(join(tmpdir(),'box-'));const file=join(dir,'box.csv');writeFileSync(file,csv);
 const {rows,sha256,file:name}=loadBoxCsv(file);
 assert.equal(rows.length,2);
 assert.match(sha256,/^[a-f0-9]{64}$/);
 assert.equal(name,'box.csv');
 const a=rows.find(r=>r.athlete==='11');
 assert.deepEqual([a.name,a.team,a.opponent,a.home,a.game,a.start],['Test, Alpha','BOS','NY',true,'401','2026-01-03T00:00:00.000Z']);
 assert.deepEqual([a.log.minutes,a.log.points,a.log.rebounds,a.log.assists,a.log.didNotPlay],[31,24,7,5,false]);
 const b=rows.find(r=>r.athlete==='12');
 assert.deepEqual([b.home,b.log.didNotPlay,b.log.minutes,b.log.points],[false,true,null,null]);
});

test('proxy line is floor(median of the last 10 played) + 0.5, and needs 3 games',()=>{
 const g=v=>({gameStart:'2026-01-01T00:00:00Z',didNotPlay:false,minutes:30,points:v,rebounds:v,assists:v,seasonType:'regular'});
 assert.equal(proxyLine([g(10),g(20)],'points'),null);
 assert.equal(proxyLine([g(10),g(20),g(30)],'points'),20.5);
 assert.equal(proxyLine([g(10),g(21),g(30),g(40)],'points'),25.5);
 assert.equal(proxyLine([...Array(12)].map((_,i)=>g(i)),'points'),6.5);
});
