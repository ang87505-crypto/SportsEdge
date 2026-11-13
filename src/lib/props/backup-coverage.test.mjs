import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coverageGaps,guaranteed} from './backup-coverage.ts';

// The Vercel tick backups configured on 2026-11-12 (the schedule the observed delays were measured against). Pinned as
// a historical constant so the analysis stays true when the schedule changes (e.g. hourly backups); the live
// schedule is checked separately below.
const HOURS=[1, 13, 15, 17, 19, 21, 23];
const crons=JSON.parse(readFileSync(new URL('../../../vercel.json',import.meta.url),'utf8')).crons;
const CONFIGURED=crons.filter(c=>c.path.includes('props-tick-')).map(c=>Number(c.schedule.split(' ')[1])).sort((a,b)=>a-b);
// NBA anchor tips this season: 12:00 PM ET (17:00 UTC) through 11:00 PM ET (04:00 UTC next day).
const TIPS={tipFromMin:17*60,tipToMin:28*60};

test('every Nov 12 backup hour is still configured (a schedule change may add backups, never silently drop one)', () => {
  for (const h of HOURS) assert.ok(CONFIGURED.includes(h), `props-tick backup at ${h}:00 UTC is missing from vercel.json`);
  for (const c of crons.filter(c => c.path.includes('props-tick-'))) assert.match(c.schedule, /^0 \d{1,2} \* \* \*$/);
});

test('the configured backups are at least as good as the Nov 12 set under every delay model', () => {
  for (const d of [{min: 0, max: 0}, {min: 10, max: 38}, {min: 0, max: 60}, {min: 0, max: 75}]) {
    const now = coverageGaps({backupHoursUtc: CONFIGURED, delayMin: d, ...TIPS, stepMin: 1}).uncovered;
    const then = coverageGaps({backupHoursUtc: HOURS, delayMin: d, ...TIPS, stepMin: 1}).uncovered;
    assert.ok(now <= then, `${JSON.stringify(d)}: ${now} > ${then}`);
  }
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
