import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tickAttention} from './tick-attention.ts';

const cap=(outcome,extra={})=>({event:'abcdef123456',key:'late',outcome,...extra});

test('a tick whose capture failed at the provider is never green, even though no run-level error occurred', () => {
  const t = tickAttention('NO_LINES_CAPTURED', {captures: [cap('provider_error')]});
  assert.equal(t.attention, true);
  assert.equal(t.reason, 'CAPTURE_PROVIDER_FAILED');
  assert.match(t.notice, /1 of 1 capture/);
  assert.equal(tickAttention('COMPLETED', {captures: [cap('stored'), cap('provider_http')]}).attention, true);
});

test('run-level failures keep their own reason', () => {
  for (const o of ['FAILED_RAW_EVIDENCE_UNRESOLVED', 'ODDS_NOT_CONFIGURED', 'EVENTS_LIST_CHARGED', 'PROVIDER_EVENTS_FAILED'])
    assert.deepEqual(tickAttention(o, {}), {attention: true, reason: o, notice: null});
});

test('expected quiet states stay green but are named distinctly: credit limit, no provider lines, nothing due, success', () => {
  assert.deepEqual(tickAttention('NO_LINES_CAPTURED', {captures: [cap('budget_refused')]}).reason, 'CREDIT_LIMITED');
  assert.equal(tickAttention('COMPLETED', {captures: [{event: 'x', skipped: 'budget_changed'}, cap('stored')]}).reason, 'CREDIT_LIMITED');
  const none = tickAttention('NO_LINES_CAPTURED', {captures: [cap('no_dfs_lines')]});
  assert.deepEqual([none.attention, none.reason], [false, 'NO_PROVIDER_LINES']);
  assert.deepEqual(tickAttention('NOTHING_DUE', {captures: []}), {attention: false, reason: 'NOTHING_DUE', notice: null});
  assert.deepEqual(tickAttention('COMPLETED', {captures: [cap('stored'), cap('event_locked')]}), {attention: false, reason: 'COMPLETED', notice: null});
  assert.equal(tickAttention('NOTHING_DUE', null).attention, false);
});

test('the worker uses tickAttention for its exit code', () => {
  const src = readFileSync(new URL('../../../scripts/props-worker.ts', import.meta.url), 'utf8');
  assert.match(src, /const t=tickAttention\(result\.outcome,result\.summary\)/);
  assert.match(src, /t\.attention\?1:0/);
});
