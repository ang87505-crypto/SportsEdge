import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarRestDays,elapsedRestDays} from './rest-calendar.ts';

test('one day off with an earlier tip is NOT a back-to-back (the elapsed-hours definition says it is)', () => {
  // Mon 8:00 PM ET -> Wed 7:30 PM ET: one full day off (Tuesday).
  const prev = '2026-11-10T01:00:00Z', lock = '2026-11-12T00:30:00Z';
  assert.equal(calendarRestDays(prev, lock), 1);
  assert.equal(elapsedRestDays(prev, lock), 0, 'the learning-layer definition calls this a back-to-back');
});

test('consecutive calendar days are a back-to-back regardless of tip times, using New York dates', () => {
  assert.equal(calendarRestDays('2026-11-10T00:00:00Z', '2026-11-11T02:30:00Z'), 0);   // Mon 7 PM -> Tue 9:30 PM ET
  assert.equal(calendarRestDays('2026-11-11T03:30:00Z', '2026-11-11T23:00:00Z'), 0);   // Mon 10:30 PM ET -> Tue 6 PM ET
});

test('longer rest is capped; unknown or impossible inputs are null, never a guess', () => {
  assert.equal(calendarRestDays('2026-11-01T00:00:00Z', '2026-11-12T00:00:00Z'), 4);
  assert.equal(calendarRestDays(null, '2026-11-12T00:00:00Z'), null);
  assert.equal(calendarRestDays('bad', '2026-11-12T00:00:00Z'), null);
  assert.equal(calendarRestDays('2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z'), null, 'a game at lock is never history');
});
