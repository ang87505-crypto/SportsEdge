// Opt-in: COMMAND_PG_TEST=1 with a disposable PostgreSQL (local `su postgres`, or PGHOST/PGUSER/PGPASSWORD for a CI
// service container). Loads database/command/command_llm_budget_v1.sql into a throwaway database and proves the shared
// budget holds under real concurrency: many separate connections (like separate Vercel instances) reserving at once can
// never commit more than the cap. Also exercises the production client (supabaseLedger) through a PostgREST shim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {supabaseLedger} from './command-ledger.ts';

const enabled = process.env.COMMAND_PG_TEST === '1';
const DB = 'command_ledger_t';
const viaHost = !!process.env.PGHOST;
const SQL = readFileSync(new URL('../../../database/command/command_llm_budget_v1.sql', import.meta.url), 'utf8');
const args = (db) => ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', db];
const run = (db, sql) => {
  const r = viaHost ? spawnSync('psql', args(db), {input: sql, encoding: 'utf8'})
    : spawnSync('su', ['postgres', '-c', `psql ${args(db).join(' ')}`], {input: sql, encoding: 'utf8'});
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const runAsync = (db, sql) => new Promise((resolve, reject) => {
  const p = viaHost ? spawn('psql', args(db)) : spawn('su', ['postgres', '-c', `psql ${args(db).join(' ')}`]);
  let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err))); p.stdin.end(sql);
});
const admin = viaHost ? 'postgres' : 'postgres';
const key = (i) => i.toString(16).padStart(32, '0');

function reset() {
  run(admin, `DROP DATABASE IF EXISTS ${DB}`); run(admin, `CREATE DATABASE ${DB}`);
  run(DB, `DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
           DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
           DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  run(DB, SQL);
}
const reserve = (k, micro, cap = 500000, perMin = 60) => `SET ROLE service_role; SELECT public.command_llm_reserve('${k}','claude-opus-5-5',${micro},${cap},${perMin});`;

test('40 concurrent connections cannot commit more than the daily cap', {skip: !enabled && 'set COMMAND_PG_TEST=1'}, async () => {
  reset();
  // cap $0.50, each reservation $0.03 → at most 16 can succeed, whatever the interleaving.
  const outs = await Promise.all(Array.from({length: 40}, (_, i) => runAsync(DB, reserve(key(i), 30000))));
  const ok = outs.map(o => JSON.parse(o.split('\n').at(-1))).filter(x => x.ok).length;
  assert.equal(ok, 16);
  assert.equal(Number(run(DB, 'SELECT committed_micro_usd FROM command_llm_days')), 480000);
  assert.ok(Number(run(DB, 'SELECT committed_micro_usd FROM command_llm_days')) <= 500000);
});

test('settle releases the unused part once; unsettled reservations stay counted; a higher cap cannot raise the day', {skip: !enabled && 'set COMMAND_PG_TEST=1'}, async () => {
  reset();
  const a = JSON.parse(run(DB, reserve(key(1), 100000)).split('\n').at(-1));
  JSON.parse(run(DB, reserve(key(2), 100000)).split('\n').at(-1));   // never settled (crashed instance)
  assert.deepEqual(JSON.parse(run(DB, `SET ROLE service_role; SELECT public.command_llm_settle(${a.id},20000);`).split('\n').at(-1)), {ok: true});
  assert.equal(JSON.parse(run(DB, `SET ROLE service_role; SELECT public.command_llm_settle(${a.id},0);`).split('\n').at(-1)).reason, 'ALREADY_SETTLED');
  assert.equal(Number(run(DB, 'SELECT committed_micro_usd FROM command_llm_days')), 120000);
  // An instance configured with a higher cap cannot raise it; a lower cap lowers it for everyone.
  assert.equal(JSON.parse(run(DB, reserve(key(3), 390000, 5000000)).split('\n').at(-1)).ok, false);
  assert.equal(JSON.parse(run(DB, reserve(key(4), 10000, 100000)).split('\n').at(-1)).reason, 'BUDGET_EXHAUSTED');
  assert.equal(Number(run(DB, 'SELECT cap_micro_usd FROM command_llm_days')), 100000);
});

test('per-client rate limit, argument checks and permissions', {skip: !enabled && 'set COMMAND_PG_TEST=1'}, async () => {
  reset();
  for (let i = 0; i < 3; i++) assert.equal(JSON.parse(run(DB, reserve(key(9), 1000, 500000, 3)).split('\n').at(-1)).ok, true);
  assert.equal(JSON.parse(run(DB, reserve(key(9), 1000, 500000, 3)).split('\n').at(-1)).reason, 'RATE_LIMITED');
  assert.throws(() => run(DB, reserve(key(1), -5)), /COMMAND_LLM_BAD_ARGS/);
  assert.throws(() => run(DB, reserve(key(1), 1000, 60_000_000)), /COMMAND_LLM_BAD_ARGS/);
  assert.throws(() => run(DB, `SET ROLE anon; SELECT public.command_llm_reserve('${key(1)}','claude-opus-5-5',1000,500000,6);`), /permission denied/);
  assert.throws(() => run(DB, `SET ROLE service_role; INSERT INTO command_llm_days VALUES ('2030-01-01',1,0);`), /permission denied/);
});

test('production client (supabaseLedger) against the real functions; fails closed on errors', {skip: !enabled && 'set COMMAND_PG_TEST=1'}, async () => {
  reset();
  const env = {SPORTSEDGE_PROPS_SUPABASE_URL: 'https://vfyzbliksooljxrlfadp.supabase.co', SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY: 'sb_secret_local_test_only_0000'};
  const shim = async (url, init) => {
    const fn = new URL(url).pathname.split('/').at(-1), a = JSON.parse(init.body);
    assert.equal(init.method, 'POST'); assert.match(fn, /^command_llm_(reserve|settle)$/);
    const call = fn === 'command_llm_reserve'
      ? `public.command_llm_reserve('${a.p_client_key}','${a.p_model}',${Number(a.p_micro_usd)},${Number(a.p_cap_micro_usd)},${Number(a.p_per_minute)})`
      : `public.command_llm_settle(${Number(a.p_id)},${Number(a.p_actual_micro_usd)})`;
    return new Response(run(DB, `SET ROLE service_role; SELECT ${call};`).split('\n').at(-1), {status: 200});
  };
  const l = supabaseLedger(env, 0.05, 6, shim);
  const r = await l.reserve({clientKey: key(5), model: 'claude-opus-5-5', microUsd: 40000});
  assert.equal(r.ok, true);
  assert.equal((await l.reserve({clientKey: key(6), model: 'claude-opus-5-5', microUsd: 40000})).reason, 'BUDGET_EXHAUSTED');
  await l.settle(r.id, 1000);
  assert.equal((await l.reserve({clientKey: key(6), model: 'claude-opus-5-5', microUsd: 40000})).ok, true);
  const down = supabaseLedger(env, 0.05, 6, async () => {throw new Error('network');});
  assert.equal((await down.reserve({clientKey: key(7), model: 'claude-opus-5-5', microUsd: 1})).reason, 'UNAVAILABLE');
  assert.equal((await supabaseLedger(env, 0.05, 6, async () => new Response('{"weird":1}')).reserve({clientKey: key(7), model: 'claude-opus-5-5', microUsd: 1})).reason, 'UNAVAILABLE');
});
