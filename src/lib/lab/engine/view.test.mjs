import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {engineView} from './view.ts';

const reg = JSON.parse(readFileSync(new URL('../../../../research/engine/registry.json', import.meta.url), 'utf8'));

test('the /lab engine view reflects the recorded registry exactly: no invented readiness, rejected ideas listed', () => {
  const v = engineView(reg);
  assert.equal(v.total, reg.experiments.length);
  const counted = Object.values(v.counts).flatMap(c => Object.values(c)).reduce((a, n) => a + n, 0);
  assert.equal(counted, reg.experiments.length);
  assert.deepEqual(v.readyForReview, [], 'nothing is ready for review today');
  assert.ok(v.rejected.some(x => x.id === 'daily-reversal5-v1'));
  assert.ok(v.collecting.every(x => x.status !== 'REJECTED' && x.status !== 'READY_FOR_REVIEW'));
  assert.ok(v.sources.blocked.includes('nba-official-injury-report'));
});
