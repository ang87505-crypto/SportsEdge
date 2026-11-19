import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bearerMatches} from './bearer.ts';

test('bearer: exact match only; missing, empty or different tokens never match', () => {
  assert.equal(bearerMatches('Bearer s3cret-test', 's3cret-test'), true);
  for (const [got, tok] of [['Bearer s3cret-tes', 's3cret-test'], ['bearer s3cret-test', 's3cret-test'], [null, 's3cret-test'], ['Bearer ', ''], ['Bearer x', undefined], ['', '']])
    assert.equal(bearerMatches(got, tok), false, String(got));
});

test('the data-health route uses the constant-time check, not string equality', () => {
  const src = readFileSync(new URL('../../app/api/internal/data-health/route.ts', import.meta.url), 'utf8');
  assert.match(src, /bearerMatches\(/);
  assert.doesNotMatch(src, /supplied\s*!==/);
});
