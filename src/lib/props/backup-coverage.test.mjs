import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coverageGaps,guaranteed} from './backup-coverage.ts';

// The Vercel tick backups actually configured (vercel.json), read so the analysis tracks the real schedule.
const crons=JSON.parse(readFileSync(new URL('../../../vercel.json',import.meta.url),'utf8')).crons;
const HOURS=crons.filter(c=>c.path.includes('props-tick-')).map(c=>Number(c.schedule.split(' ')[1])).sort((a,b)=>a-b);
// NBA anchor tips this season: 12:00 PM ET (17:00 UTC) through 11:00 PM ET (04:00 UTC next day).
const TIPS={tipFromMin:17*60,tipToMin:28*60};

test('the configured backups are the seven odd UTC hours 13..23 and 01', () => {
  assert.deepEqual(HOURS, [1, 13, 15, 17, 19, 21, 23]);
});

test('with a steady start delay, two-hourly backups cover every late window (145 min > 120 min spacing)', () => {
  const r = coverageGaps({backupHoursUtc: HOURS, delayMin: {min: 17, max: 17}, ...TIPS});
  assert.equal(r.uncovered, 0, JSON.stringify(r.gaps));
});

test('with the start delays observed on Nov 12 (10 to 38 min) anchors at :11-:12 past even UTC hours are NOT guaranteed', () => {
  const r = coverageGaps({backupHoursUtc: HOURS, delayMin: {min: 10, max: 38}, ...TIPS, stepMin: 1});
  assert.deepEqual(r.gaps.map(g => g.fromTipUtc), ['18:11', '20:11', '22:11', '00:11', '02:11']);
  // Nov 12: the 00:10 UTC Pistons @ Wizards anchor (late window 21:10-23:35) was covered only because the 21:00
  // backup started at 21:17; the 23:00 backup started at 23:38, after the window closed.
  assert.equal(guaranteed(24 * 60 + 10, {backupHoursUtc: HOURS, delayMin: {min: 10, max: 38}}), true);
  assert.equal(guaranteed(24 * 60 + 10, {backupHoursUtc: HOURS, delayMin: {min: 5, max: 38}}), false);
  // Wider (but plausible) delays turn the edges into 14-minute holes that include common 7:10 PM ET tips.
  assert.equal(coverageGaps({backupHoursUtc: HOURS, delayMin: {min: 5, max: 45}, ...TIPS, stepMin: 1}).uncovered, 70);
});

test('hourly backups would close every gap even with 10-38 min delays (the proposed fix, not applied)', () => {
  const hourly = Array.from({length: 13}, (_, i) => (13 + i) % 24);
  assert.equal(coverageGaps({backupHoursUtc: hourly, delayMin: {min: 10, max: 38}, ...TIPS}).uncovered, 0);
});
