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

test('scheduled firings exit before any network call while released OFF',()=>{
 assert.equal(PROPS_RELEASE.scheduledRunsEnabled,false);
 const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',new URL('../../../scripts/props-worker.ts',import.meta.url).pathname,'collect'],
  {env:{PATH:process.env.PATH,GITHUB_EVENT_NAME:'schedule',SCHEDULE_CRON:'10 22 * * *'},encoding:'utf8'});
 assert.equal(r.status,0);
 assert.deepEqual(JSON.parse(r.stdout),{status:'SCHEDULED_RUNS_RELEASED_OFF',kind:'collect',providerCalls:0});
 const owner=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',new URL('../../../scripts/props-worker.ts',import.meta.url).pathname,'resume'],
  {env:{PATH:process.env.PATH,GITHUB_EVENT_NAME:'schedule'},encoding:'utf8'});
 assert.equal(JSON.parse(owner.stdout).status,'OWNER_ACTION_NOT_SCHEDULABLE');
});
