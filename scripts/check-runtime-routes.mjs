// Post-build guard: authenticated API routes must run per request. Under Cache
// Components a GET handler that reads no Request-time API is prerendered, and
// its build-time (unauthenticated) response is then served to every caller.
// Run after `next build`. Reads only local build output.
import {readFile} from 'node:fs/promises';

const RUNTIME_ONLY=['/api/internal','/api/research','/api/sports'];
const manifest=JSON.parse(await readFile(new URL('../.next/prerender-manifest.json',import.meta.url),'utf8'));
const prerendered=Object.keys(manifest.routes??{}).filter(route=>
  RUNTIME_ONLY.some(prefix=>route===prefix||route.startsWith(prefix+'/')));
if(prerendered.length){
  console.error('Runtime-only API routes were prerendered at build time:\n  '+prerendered.join('\n  ')+
    '\nCall `await connection()` (next/server) or a Request-time API before reading the request.');
  process.exit(1);
}
console.log(`OK: no prerendered routes under ${RUNTIME_ONLY.join(', ')}.`);
