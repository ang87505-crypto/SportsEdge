/** Pure helpers for the operations monitor. No network, no secrets, no clocks of their own.
 * A planned (cron) time is never reported as an execution: executions come only from real run records.
 */

const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

/** Parse one five-field cron expression (UTC) into sets of allowed values. Supports *, n, a-b, lists and steps. */
export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('CRON_INVALID');
  return parts.map((part, i) => {
    const [lo, hi] = FIELD_RANGES[i];
    const out = new Set();
    for (const item of part.split(',')) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
      if (!m) throw new Error('CRON_INVALID');
      let a = lo, b = hi;
      if (m[1] !== '*') {
        const [x, y] = m[1].split('-').map(Number);
        a = x; b = y ?? (m[2] ? hi : x);
      }
      const step = m[2] ? Number(m[2]) : 1;
      if (a < lo || b > hi || a > b || step < 1) throw new Error('CRON_INVALID');
      for (let v = a; v <= b; v += step) out.add(v);
    }
    return { any: part === '*', values: out };
  });
}

function matches(fields, d) {
  const [min, hour, dom, mon, dow] = fields;
  if (!min.values.has(d.getUTCMinutes()) || !hour.values.has(d.getUTCHours()) || !mon.values.has(d.getUTCMonth() + 1)) return false;
  // Standard cron: when both day fields are restricted, either may match.
  const domOk = dom.values.has(d.getUTCDate()), dowOk = dow.values.has(d.getUTCDay());
  if (!dom.any && !dow.any) return domOk || dowOk;
  return domOk && dowOk;
}

const MINUTE = 60_000;
const SCAN_LIMIT = 45 * 24 * 60; // monthly schedules fit inside 45 days

/** Fire times (ms, UTC) of any of `crons` in (fromMs, toMs]. */
export function firesBetween(crons, fromMs, toMs) {
  const parsed = crons.map(parseCron);
  const out = [];
  let t = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE;
  for (let n = 0; t <= toMs && n < SCAN_LIMIT * 4; t += MINUTE, n++) {
    const d = new Date(t);
    if (parsed.some(f => matches(f, d))) out.push(t);
  }
  return out;
}

/** The next `count` planned fire times strictly after `nowMs`. */
export function nextFires(crons, nowMs, count = 2) {
  if (!crons.length) return [];
  const parsed = crons.map(parseCron);
  const out = [];
  let t = Math.floor(nowMs / MINUTE) * MINUTE + MINUTE;
  for (let n = 0; out.length < count && n < SCAN_LIMIT; t += MINUTE, n++) {
    if (parsed.some(f => matches(f, new Date(t)))) out.push(t);
  }
  return out;
}

/** Cron lines of a workflow file's `schedule:` block (simple, line based; quotes optional). */
export function workflowCrons(yamlText) {
  const out = [];
  let inSchedule = false;
  for (const line of String(yamlText).split('\n')) {
    if (/^\s*schedule:\s*$/.test(line)) { inSchedule = true; continue; }
    if (inSchedule) {
      const m = /^\s*-\s*cron:\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line);
      if (m) { out.push(m[1].trim()); continue; }
      if (/^\s*$/.test(line)) continue;
      if (!/^\s{4,}/.test(line)) inSchedule = false;
    }
  }
  return out;
}

const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const at = r => Date.parse(r.run_started_at || r.created_at);

/** Compact, public view of one run. */
export function runView(r) {
  if (!r) return null;
  return {
    id: r.id, url: r.html_url, event: r.event, status: r.status, conclusion: r.conclusion ?? null,
    startedAt: iso(at(r)), finishedAt: r.status === 'completed' ? iso(Date.parse(r.updated_at)) : null,
    headSha: typeof r.head_sha === 'string' ? r.head_sha.slice(0, 40) : null,
  };
}

/**
 * Evaluate one job from its workflow state and recent runs (newest first, pull_request runs excluded by caller).
 * Status precedence: DISABLED > EXPIRED > RUNNING-only-with-no-history > FAILING > STALE > MISSED_SLOT/RAN_LATE > PENDING_FIRST_RUN > OK.
 * RAN_LATE: the latest planned time had no run inside its coverage window, but a successful run started after it
 * (GitHub sometimes starts a scheduled run many hours late). The work happened, late; it still counts as a missed slot.
 */
export function evaluateJob(job, { workflowState, runs, crons, nowMs, activeSinceMs = -Infinity }) {
  const graceMs = (job.graceMinutes ?? 120) * MINUTE;
  const coverBeforeMs = (job.coverBeforeMinutes ?? 0) * MINUTE;
  const completed = runs.filter(r => r.status === 'completed');
  const ok = completed.filter(r => r.conclusion === 'success');
  const bad = completed.filter(r => ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion));
  const latestCompleted = completed[0] ?? null;
  let consecutiveFailures = 0;
  for (const r of completed) {
    if (r.conclusion === 'success') break;
    if (['failure', 'timed_out', 'startup_failure'].includes(r.conclusion)) consecutiveFailures++;
  }
  // A run GitHub accepted but never started (seen 2026-11-11: a worker run queued for 3+ hours while later ones
  // completed). It is not "running": report it separately so it is neither hidden nor mistaken for progress.
  const stuck = runs.filter(r => ['queued', 'waiting', 'pending', 'requested'].includes(r.status) && nowMs - Date.parse(r.created_at) > 2 * 3600_000);
  const running = runs.find(r => r.status !== 'completed' && !stuck.includes(r)) ?? null;
  // Slots: due planned fires in the last 7 days, covered by any real run that started within the slot window.
  const lookback = nowMs - 7 * 24 * 3600_000;
  // Slots before the workflow existed are not misses.
  const due = firesBetween(crons, Math.max(lookback, activeSinceMs), nowMs - graceMs);
  const allFires = firesBetween(crons, lookback - 24 * 3600_000, nowMs + 45 * 24 * 3600_000);
  const missed = [];
  for (const fire of due) {
    const nextFire = allFires.find(f => f > fire) ?? fire + 24 * 3600_000;
    const end = Math.min(nextFire, fire + 6 * 3600_000);
    const covered = runs.some(r => at(r) >= fire - coverBeforeMs && at(r) < end);
    if (!covered) missed.push(fire);
  }
  const lastDue = due.at(-1) ?? null;
  const lastDueMissed = lastDue !== null && missed.includes(lastDue);
  // A success that started after the slot's coverage window but before the next planned time is that slot, late.
  const nextAfterLast = lastDue === null ? null : (allFires.find(f => f > lastDue) ?? lastDue + 24 * 3600_000);
  const lateSuccess = lastDue === null ? null : ok.map(at).find(t => t > lastDue && t < nextAfterLast) ?? null;
  const lastSuccessMs = ok[0] ? at(ok[0]) : null;
  const staleMs = (job.staleAfterHours ?? 48) * 3600_000;
  const expired = job.expiresAt && nowMs >= Date.parse(job.expiresAt);
  const planned = nextFires(crons, nowMs, 2).filter(t => !job.expiresAt || t < Date.parse(job.expiresAt));

  let status = 'OK', detail = 'Last run succeeded.';
  if (workflowState && workflowState !== 'active') {
    status = expired ? 'RETIRED' : 'DISABLED';
    detail = expired ? 'Temporary job retired after its window ended.' : `Workflow is ${workflowState}; scheduled runs will not start.`;
  } else if (expired) {
    status = 'EXPIRED'; detail = 'Its release window has ended; it should retire itself on its next run.';
  } else if (latestCompleted && consecutiveFailures > 0) {
    status = 'FAILING'; detail = `${consecutiveFailures} failed run${consecutiveFailures > 1 ? 's' : ''} since the last success.`;
  } else if (!ok.length && !runs.length) {
    status = 'PENDING_FIRST_RUN'; detail = 'No run has happened yet. The next planned time is not an execution.';
  } else if (!ok.length && running) {
    status = 'RUNNING'; detail = 'First run in progress.';
  } else if (lastSuccessMs !== null && nowMs - lastSuccessMs > staleMs && crons.length) {
    status = 'STALE'; detail = `No successful run for more than ${job.staleAfterHours} hours.`;
  } else if (lastDueMissed && lateSuccess !== null) {
    status = 'RAN_LATE';
    detail = `The latest planned time (${iso(lastDue).slice(11, 16)} UTC) ran ${((lateSuccess - lastDue) / 3600_000).toFixed(1)} h late; it succeeded.`;
  } else if (lastDueMissed) {
    status = 'MISSED_SLOT'; detail = 'The latest planned time passed without a run; GitHub may have dropped it.';
  } else if (!crons.length && !ok.length) {
    status = 'PENDING_FIRST_RUN'; detail = 'Runs only when dispatched.';
  }
  if (stuck.length) detail += ` ${stuck.length} run${stuck.length > 1 ? 's' : ''} queued by GitHub for over 2 hours without starting (oldest ${iso(Date.parse(stuck.at(-1).created_at)).slice(0, 16).replace('T', ' ')} UTC).`;
  const scheduled = ok.filter(r => r.event === 'schedule');
  return {
    status, detail, workflowState: workflowState ?? null,
    running: runView(running), lastRun: runView(runs[0]), lastSuccess: runView(ok[0]), lastFailure: runView(bad[0]),
    lastScheduledSuccess: runView(scheduled[0]), consecutiveFailures,
    slots7d: { due: due.length, missed: missed.length, lastMissedAt: iso(missed.at(-1)) },
    nextPlanned: planned.map(iso), schedule: crons, stuckQueued: stuck.length,
  };
}

/**
 * Receipt-level checks for the props worker: a workflow can succeed while the work it exists for did not happen
 * (every collect refused by the budget, the provider failing, settles never completing). Uses the ledger's own
 * outcomes, never the workflow conclusion. Thresholds leave room for legitimate quiet days (budget-limited slots,
 * no NBA games). Returns [{id,text,action}].
 */
export function propsReceiptBlockers(props, nowMs, {collectHours = 48, settleHours = 36} = {}) {
  const out = [];
  if (!props || props.state !== 'OK' || props.controlState !== 'RUNNING') return out;
  const hoursSince = t => (t && Number.isFinite(Date.parse(t)) ? (nowMs - Date.parse(t)) / 3600_000 : Infinity);
  const lastCollect = props.lastCollect ? `${props.lastCollect.outcome ?? props.lastCollect.status}` : 'none';
  if (hoursSince(props.lastCompletedCollectAt) > collectHours)
    out.push({id: 'props-no-collect', text: `No props collect has completed with lines in ${collectHours} hours (latest outcome: ${lastCollect}). Workflow runs may still be green.`,
      action: 'PrizePicks page → Collection status shows each slot\'s outcome (budget exhausted, provider error, no games). Open the latest props-daily run for the receipt.'});
  if (hoursSince(props.lastCompletedSettleAt) > settleHours)
    out.push({id: 'props-no-settle', text: `No props settle has completed in ${settleHours} hours (latest: ${props.lastSettle ? props.lastSettle.outcome ?? props.lastSettle.status : 'none'}).`,
      action: 'Open the latest props-daily settle run; pending picks stay pending until a settle completes.'});
  return out;
}

/** Overall roll-up: required jobs decide health; optional jobs only warn. */
export function rollUp(jobs) {
  const severity = { FAILING: 3, DISABLED: 3, STALE: 3, MISSED_SLOT: 2, RAN_LATE: 1, EXPIRED: 1, PENDING_FIRST_RUN: 1, RUNNING: 0, OK: 0, RETIRED: 0 };
  const attention = jobs.filter(j => (j.required ? severity[j.status] >= 2 : severity[j.status] >= 3));
  return { state: attention.some(j => severity[j.status] >= 3) ? 'ATTENTION' : attention.length ? 'WARN' : 'OK',
    attention: attention.map(j => j.id) };
}

/** Decode a Supabase JWT's `exp` without verifying it; returns an ISO date or a fixed label. Never returns the key. */
export function keyExpiry(key) {
  if (!key) return 'NOT_SET';
  if (/^sb_secret_/.test(key)) return 'NO_EXPIRY';
  const parts = key.split('.');
  if (parts.length !== 3) return 'UNKNOWN_FORMAT';
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return Number.isFinite(payload.exp) ? new Date(payload.exp * 1000).toISOString() : 'NO_EXPIRY';
  } catch { return 'UNKNOWN_FORMAT'; }
}
