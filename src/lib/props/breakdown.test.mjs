import test from 'node:test';
import assert from 'node:assert/strict';
import {breakdown,MIN_GROUP} from './breakdown.ts';
import {buildView} from './dashboard-view.ts';
import {makeRaw} from '../assistant/fixtures.mjs';

test('groups graded recorded picks only, with sample sizes, intervals and an overconfidence gap', () => {
  const b = breakdown(buildView(makeRaw(), 'prizepicks'));
  assert.equal(b.graded, 14);
  assert.equal(b.byStat.find(g => g.key === 'points').n, 14);
  const band = b.byBand.find(g => g.label === '65–70%');
  assert.equal(band.n, 14); assert.equal(band.hits, 9);
  assert.ok(Math.abs(band.gap - (0.66 - 9 / 14)) < 1e-9);
  assert.ok(band.low < band.hitRate && band.hitRate < band.high);
  assert.equal(band.tooSmall, true);
  assert.equal(b.bySide.length, 1);
  assert.equal(b.byModel[0].label, 'Stats model');
  assert.equal(b.sameGameEntries, 0);
  assert.match(b.note, /every group is small/);
  assert.ok(MIN_GROUP >= 30);
});

test('ungraded and skipped lines never enter a group; a same-game entry is surfaced', () => {
  const raw = makeRaw({graded: false});
  assert.equal(breakdown(buildView(raw, 'prizepicks')).graded, 0);
  const g = makeRaw();
  // Entry #8 gets legs 3 and 5 — both from the first test game.
  g.legs = g.legs.map(l => l.entry_id === 8 && l.pick_id === 2010 ? {...l, pick_id: 2005} : l);
  const b = breakdown(buildView(g, 'prizepicks'));
  assert.equal(b.sameGameEntries, 1);
});
