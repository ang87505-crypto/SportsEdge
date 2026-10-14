import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../../app/api/internal/alpaca-paper/draft/route.ts',import.meta.url),'utf8');
const panel=readFileSync(new URL('../../components/alpaca-paper-first-test-draft.tsx',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../../components/alpaca-paper-dashboard.tsx',import.meta.url),'utf8');
const adapter=readFileSync(new URL('./alpaca-staging-manual-preview.ts',import.meta.url),'utf8');
test('One-shot staging draft route requires cookie, same-origin and strict one-share validation',()=>{
 assert.ok(route.includes('validOwnerSession('));
 assert.ok(route.includes('OWNER_COOKIE'));
 assert.ok(route.includes('ownerSecret()'));
 assert.ok(route.includes("req.headers.get('origin')!==new URL(req.url).origin"));
 assert.ok(route.includes('validateManualPaperDraft('));
 assert.ok(route.includes("raw.length>160"));
 assert.ok(route.includes("brokerOrderSubmitted:false"));
 assert.ok(route.includes("executionPermitted:false"));
 assert.ok(!route.includes('export async function GET'));
 assert.ok(!route.includes('export async function PUT'));
 assert.ok(!route.includes('export async function DELETE'));
 assert.ok(!route.includes('export async function PATCH'));
});
test('No Alpaca order writer, secrets or auto approval can be reached by UI',()=>{
 assert.ok(dashboard.includes('<AlpacaPaperFirstTestDraft/>'));
 assert.ok(panel.includes('Save unapproved staging draft'));
 assert.ok(panel.includes('NOT an approved or submitted trade'));
 assert.ok(panel.toLowerCase().includes('staging')); // staging contract text in notices
 assert.ok(!panel.includes('ALPACA_PAPER_SECRET_KEY'));
 assert.ok(!panel.includes('NEXT_PUBLIC_'));
 assert.ok(!panel.includes('localStorage'));
 assert.ok(!adapter.includes('https://paper-api.alpaca.markets'));
 assert.ok(!adapter.includes('https://api.alpaca.markets'));
 assert.ok(!adapter.includes('ALPACA_PAPER_SECRET_KEY'));
 assert.ok(!adapter.includes('approved:true'));
 assert.ok(!adapter.includes('setTimeout'));
});
