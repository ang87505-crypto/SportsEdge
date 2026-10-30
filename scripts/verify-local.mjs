// Run the core PR checks without a hosted Actions runner or service credentials.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const node = process.execPath;
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const environment = { ...process.env, SPORTSEDGE_PAPER_RUNS_ENABLED: 'false' };
const stepTimeout = 10 * 60 * 1000;
let interrupted;
let activeChild;

function stopChild(signal) {
  if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return;
  try {
    if (process.platform === 'win32') activeChild.kill(signal);
    else process.kill(-activeChild.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = signal;
    stopChild(signal);
  });
}

function testsIn(directory) {
  const files = readdirSync(join(root, directory)).filter(name => name.endsWith('.test.mjs')).sort();
  if (!files.length) throw new Error(`No tests found in ${directory}`);
  return files.map(name => `${directory}/${name}`);
}

async function run(label, executable, args) {
  if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
  console.log(`\n=== ${label} ===`);
  await new Promise((resolve, reject) => {
    let timedOut = false;
    let forceKill;
    activeChild = spawn(executable, args, {
      cwd: root, env: environment, stdio: ['ignore', 'inherit', 'inherit'],
      detached: process.platform !== 'win32',
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stopChild('SIGTERM');
      forceKill = setTimeout(() => stopChild('SIGKILL'), 5000);
    }, stepTimeout);
    const clear = () => { clearTimeout(timeout); clearTimeout(forceKill); activeChild = undefined; };
    activeChild.once('error', error => { clear(); reject(new Error(`${label}: ${error.message}`)); });
    activeChild.once('close', (code, signal) => {
      clear();
      if (timedOut) reject(new Error(`${label} exceeded its 10-minute limit`));
      else if (code !== 0 || signal || interrupted) reject(new Error(`${label} failed (${signal || code || interrupted})`));
      else resolve();
    });
  });
  console.log(`PASS: ${label}`);
}

try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24, matching CI.');
  // Resolve installed tools before starting; never let npx download a different version.
  const eslint = join(dirname(require.resolve('eslint/package.json')), 'bin/eslint.js');
  const next = require.resolve('next/dist/bin/next');
  const tsc = require.resolve('typescript/bin/tsc');
  const nodeTests = [
    'src/lib/performance-series.test.mjs', ...testsIn('src/lib/ingestion'),
    'src/lib/research-math.test.mjs', 'src/lib/result-validation.test.mjs',
    ...testsIn('src/lib/stocks'), 'src/components/alpaca-paper-ui-guard.test.mjs',
  ];
  console.log(`SportsEdge core verification — Node ${process.versions.node}. Run npm ci first to install locked dependencies.`);
  await run('Python statistics and audit tests', python, ['-m', 'unittest', 'discover', '-s', 'analytics', '-p', 'test_*.py', '-v']);
  await run('Provider, research, stock and UI safety tests', node, ['--experimental-strip-types', '--test', ...nodeTests]);
  await run('Lint', node, [eslint]);
  await run('Production build', node, [next, 'build']);
  await run('Generated route typecheck', node, [tsc, '--noEmit']);
  await run('Pinned historical-source replay', python, ['analytics/verify_reproduced_snapshot.py']);
  console.log('\nSPORTSEDGE_LOCAL_CORE_PASS');
  console.log('Browser QA and native PostgreSQL/controller races require their separate suites.');
} catch (error) {
  console.error(`\nSPORTSEDGE_LOCAL_CORE_FAILED: ${error.message}`);
  process.exitCode = interrupted === 'SIGINT' ? 130 : 1;
}
