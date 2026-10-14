import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../../app/api/internal/nba-paper/run/route.ts',import.meta.url),'utf8');
const code=readFileSync(new URL('./nba-paper-once.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../../app/paper-betting/page.tsx',import.meta.url),'utf8');
test('Owner virtual research run is not a public sportsbook order API',()=>{
 for(const s of ['validOwnerSession','OWNER_COOKIE','ownerSecret',
  "req.headers.get('origin')","rpc/research_place",
  "PREVIEW_EXPIRED_OR_CHANGED","RECEIPT_UNVERIFIED"])
  assert.ok((code+route).includes(s),s);
 assert.ok(route.includes('export async function GET'));
 assert.ok(route.includes('export async function POST'));
 assert.ok(!route.includes('export async function DELETE'));
 assert.ok(!code.includes('SPORTSEDGE_INGEST_TOKEN'));
 assert.ok(!code.includes('NEXT_PUBLIC_'));
 assert.ok(!code.includes('https://api.the-odds-api.com'));
 assert.ok(!code.includes('nba-elo-100x10-v1'));
 assert.ok(page.includes('NbaPaperRunPanel'));
});
