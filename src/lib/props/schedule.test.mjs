import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PROPS_SCHEDULE,PROPS_RELEASE,scheduledInstant,slotKey,nextPlannedRuns} from './schedule.ts';

test('workflow crons match the source schedule exactly (no duplicate or stray schedules)',()=>{
 const yml=readFileSync(new URL('../../../.github/workflows/props-daily.yml',import.meta.url),'utf8');
 const crons=[...yml.matchAll(/- cron: '([^']+)'/g)].map(m=>m[1]).sort();
 assert.deepEqual(crons,PROPS_SCHEDULE.map(s=>s.cron).sort());
 assert.match(yml,/concurrency:\n  group: props-paper\n  cancel-in-progress: false/);
});

test('a late firing keeps its original slot; a firing after midnight maps to the previous day',()=>{
 assert.equal(scheduledInstant('10 22 * * *','2026-11-07T23:40:00Z'),'2026-11-07T22:10:00.000Z');
 assert.equal(scheduledInstant('10 22 * * *','2026-11-08T00:30:00Z'),'2026-11-07T22:10:00.000Z');
 assert.equal(slotKey('collect','2026-11-07T22:10:00.000Z'),'collect-2026-11-07T22');
 assert.equal(scheduledInstant('* * * * *','2026-11-07T23:40:00Z'),null);
 assert.deepEqual(nextPlannedRuns('2026-11-07T20:00:00Z',3).map(r=>r.kind+'@'+r.at.slice(11,16)),['collect@22:10','settle@09:20','settle@15:20']);
});

test('released schedule stays paper-only and fails closed without configuration',()=>{
 assert.equal(PROPS_RELEASE.scheduledRunsEnabled,true);
 assert.equal(PROPS_RELEASE.paperOnly,true);
 assert.equal(PROPS_RELEASE.realMoneyEnabled,false);
 const worker=new URL('../../../scripts/props-worker.ts',import.meta.url).pathname;
 // A scheduled firing with no store configuration stops before any provider or ESPN call.
 const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',worker,'collect'],
  {env:{PATH:process.env.PATH,GITHUB_EVENT_NAME:'schedule',SCHEDULE_CRON:'10 22 * * *'},encoding:'utf8'});
 assert.equal(r.status,1);
 assert.equal(JSON.parse(r.stdout).status,'NOT_CONFIGURED');
 // Owner control and backfill can never run from a schedule.
 for(const kind of ['resume','stop','backfill']){
  const o=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',worker,kind],
   {env:{PATH:process.env.PATH,GITHUB_EVENT_NAME:'schedule'},encoding:'utf8'});
  assert.equal(JSON.parse(o.stdout).status,'OWNER_ACTION_NOT_SCHEDULABLE');
 }
});

test('backup slot dispatch: only a release cron of the same kind names a slot', async () => {
  const {slotCronMatches,scheduledInstant,slotKey}=await import('./schedule.ts');
  assert.equal(slotCronMatches('collect','10 19 * * *'),true);
  assert.equal(slotCronMatches('settle','20 9 * * *'),true);
  assert.equal(slotCronMatches('settle','10 19 * * *'),false);
  assert.equal(slotCronMatches('collect','0 19 * * *'),false);
  assert.equal(slotCronMatches('backfill','20 9 * * *'),false);
  // A backup run an hour after the slot gets the same key as the on-time scheduled run.
  const onTime=slotKey('collect',scheduledInstant('10 19 * * *','2026-11-10T19:12:00Z'));
  const backup=slotKey('collect',scheduledInstant('10 19 * * *','2026-11-10T20:40:00Z'));
  assert.equal(onTime,'collect-2026-11-10T19');
  assert.equal(backup,onTime);
});
