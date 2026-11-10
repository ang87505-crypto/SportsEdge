import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCron,firesBetween,nextFires,workflowCrons,evaluateJob,rollUp,keyExpiry} from './ops-monitor-lib.mjs';

const T = s => Date.parse(s);
const run = (startedAt, conclusion = 'success', event = 'schedule', status = 'completed') =>
  ({id: T(startedAt), html_url: 'https://github.com/x/runs/1', event, status, conclusion, run_started_at: startedAt,
    created_at: startedAt, updated_at: startedAt, head_sha: 'a'.repeat(40)});

test('cron parsing: lists, ranges, steps and weekdays', () => {
  assert.deepEqual([...parseCron('20 15,16,17,18 * * 1-5')[1].values], [15, 16, 17, 18]);
  assert.deepEqual([...parseCron('*/20 * * * *')[0].values], [0, 20, 40]);
  assert.throws(() => parseCron('61 * * * *'), /CRON_INVALID/);
  assert.throws(() => parseCron('* * *'), /CRON_INVALID/);
});

test('fires: weekday stock slots skip the weekend; monthly lands on the 3rd', () => {
  const fires = firesBetween(['20 11 * * 1-5'], T('2026-11-06T00:00Z'), T('2026-11-10T00:00Z'));
  assert.deepEqual(fires.map(f => new Date(f).toISOString()), ['2026-11-06T11:20:00.000Z', '2026-11-09T11:20:00.000Z']);
  assert.equal(new Date(nextFires(['23 4 3 * *'], T('2026-11-10T00:00Z'), 1)[0]).toISOString(), '2026-12-03T04:23:00.000Z');
  assert.equal(new Date(nextFires(['17 2 * * 2-6'], T('2026-11-10T01:00Z'), 1)[0]).toISOString(), '2026-11-10T02:17:00.000Z');
});

test('workflow cron extraction reads every workflow in the repository', () => {
  assert.deepEqual(workflowCrons(readFileSync(new URL('../.github/workflows/paper-auto-worker.yml', import.meta.url), 'utf8')),
    ['50 13,14 * * 1-5', '20 15,16,17,18 * * 1-5', '35 20,21 * * 1-5']);
  assert.deepEqual(workflowCrons(readFileSync(new URL('../.github/workflows/research-collect.yml', import.meta.url), 'utf8')), ['17 2 * * 2-6']);
  assert.deepEqual(workflowCrons('on:\n  workflow_dispatch:\n'), []);
});

const job = {id: 'j', staleAfterHours: 30, graceMinutes: 120, required: true};
const daily = ['10 22 * * *'];

test('a planned time is never an execution: no runs means PENDING_FIRST_RUN with planned times only', () => {
  const e = evaluateJob(job, {workflowState: 'active', runs: [], crons: daily, nowMs: T('2026-11-10T12:00Z')});
  assert.equal(e.status, 'PENDING_FIRST_RUN');
  assert.equal(e.lastRun, null);
  assert.equal(e.lastSuccess, null);
  assert.equal(e.nextPlanned[0], '2026-11-10T22:10:00.000Z');
});

test('healthy, failing, missed and stale jobs', () => {
  const now = T('2026-11-10T12:00Z');
  const healthy = evaluateJob(job, {workflowState: 'active', crons: daily, nowMs: now,
    runs: [run('2026-11-09T22:40Z'), run('2026-11-08T22:30Z')]});
  assert.equal(healthy.status, 'OK');
  assert.equal(healthy.lastSuccess.startedAt, '2026-11-09T22:40:00.000Z');
  const failing = evaluateJob(job, {workflowState: 'active', crons: daily, nowMs: now,
    runs: [run('2026-11-09T22:40Z', 'failure'), run('2026-11-08T22:30Z')]});
  assert.equal(failing.status, 'FAILING');
  assert.equal(failing.consecutiveFailures, 1);
  const missed = evaluateJob({...job, staleAfterHours: 48}, {workflowState: 'active', crons: daily, nowMs: now, runs: [run('2026-11-08T22:30Z')]});
  assert.equal(missed.status, 'MISSED_SLOT');
  assert.equal(missed.slots7d.missed >= 1, true);
  const stale = evaluateJob(job, {workflowState: 'active', crons: daily, nowMs: T('2026-11-12T12:00Z'), runs: [run('2026-11-08T22:30Z')]});
  assert.equal(stale.status, 'STALE');
});

test('slots before the workflow existed are not counted as missed', () => {
  const e = evaluateJob(job, {workflowState: 'active', runs: [], crons: daily, nowMs: T('2026-11-10T12:00Z'), activeSinceMs: T('2026-11-09T23:00Z')});
  assert.equal(e.slots7d.due, 0);
  assert.equal(e.status, 'PENDING_FIRST_RUN');
});

test('a manual or early dispatch covers a slot when the job allows it', () => {
  const decision = {...job, coverBeforeMinutes: 180, staleAfterHours: 100};
  const e = evaluateJob(decision, {workflowState: 'active', crons: ['20 11 * * 1-5'], nowMs: T('2026-11-09T16:00Z'),
    runs: [run('2026-11-09T09:02Z', 'success', 'workflow_dispatch'), run('2026-11-06T11:40Z'), run('2026-11-05T11:31Z'),
      run('2026-11-04T11:25Z'), run('2026-11-03T12:50Z')]});
  assert.equal(e.status, 'OK');
  assert.equal(e.slots7d.missed, 0);
  const late = evaluateJob(decision, {workflowState: 'active', crons: ['20 11 * * 1-5'], nowMs: T('2026-11-09T16:00Z'),
    runs: [run('2026-11-06T11:40Z')]});
  assert.equal(late.status, 'MISSED_SLOT');
});

test('disabled workflows and expired temporary jobs', () => {
  const now = T('2026-11-12T00:00Z');
  assert.equal(evaluateJob(job, {workflowState: 'disabled_inactivity', crons: daily, nowMs: now, runs: [run('2026-11-11T22:20Z')]}).status, 'DISABLED');
  const temp = {...job, required: false, expiresAt: '2026-11-11T07:00:00Z'};
  assert.equal(evaluateJob(temp, {workflowState: 'disabled_manually', crons: ['43 * * * *'], nowMs: now, runs: []}).status, 'RETIRED');
  const exp = evaluateJob(temp, {workflowState: 'active', crons: ['43 * * * *'], nowMs: now, runs: [run('2026-11-11T06:43Z')]});
  assert.equal(exp.status, 'EXPIRED');
  assert.deepEqual(exp.nextPlanned, []);
});

test('roll-up: required problems decide; optional ones only warn when severe', () => {
  assert.equal(rollUp([{id: 'a', required: true, status: 'OK'}, {id: 'b', required: false, status: 'MISSED_SLOT'}]).state, 'OK');
  assert.equal(rollUp([{id: 'a', required: true, status: 'MISSED_SLOT'}]).state, 'WARN');
  assert.deepEqual(rollUp([{id: 'a', required: true, status: 'FAILING'}]), {state: 'ATTENTION', attention: ['a']});
});

test('key expiry is read from the token payload only', () => {
  const jwt = 'x.' + Buffer.from(JSON.stringify({role: 'service_role', exp: 2000000000})).toString('base64url') + '.sig';
  assert.equal(keyExpiry(jwt), '2033-05-18T03:33:20.000Z');
  assert.equal(keyExpiry('sb_secret_abc'), 'NO_EXPIRY');
  assert.equal(keyExpiry(''), 'NOT_SET');
  assert.equal(keyExpiry('opaque'), 'UNKNOWN_FORMAT');
});

test('alert: owner-pending steps are not alerts; the body carries a stable problem list and no secrets', async () => {
  const {alertProblems, alertBody} = await import('./ops-alert.mjs');
  const status = {generatedAt: '2026-11-10T02:00:00Z', monitorRun: {url: 'https://github.com/r/1'}, blockers: [
    {id: 'stock-first-session', text: 'PR #102 waits for you', action: 'see doc'},
    {id: 'job:props-daily', text: 'Props failing', action: 'open run'},
    {id: 'site', text: 'Site down', action: 'open site'}]};
  const p = alertProblems(status);
  assert.deepEqual(p.map(x => x.id), ['job:props-daily', 'site']);
  const body = alertBody(status, p);
  assert.match(body, /<!-- ops-alert-ids: job:props-daily,site -->/);
  assert.match(body, /Posted automatically/);
  assert.equal(alertProblems({blockers: [{id: 'props-control', text: '', action: ''}]}).length, 0);
});
