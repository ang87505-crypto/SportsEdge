import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../../app/api/internal/alpaca-paper/staging/route.ts',import.meta.url),'utf8');
const panel=readFileSync(new URL('../../components/alpaca-staging-stop-panel.tsx',import.meta.url),'utf8');
const dash=readFileSync(new URL('../../components/alpaca-paper-dashboard.tsx',import.meta.url),'utf8');
const operator=readFileSync(new URL('./alpaca-staging-operator.ts',import.meta.url),'utf8');
test('Staging owner-only API is cookie guarded, requires same-origin and explicit HALT action',()=>{
 assert.ok(route.includes('validOwnerSession('));
 assert.ok(route.includes('ownerSecret()'));
 assert.ok(route.includes('OWNER_COOKIE'));
 assert.ok(route.includes("req.headers.get('origin')!==new URL(req.url).origin"));
 assert.ok(route.includes("action!=='halt'"));
 assert.ok(route.includes('getStagingPaperStatus()'));
 assert.ok(route.includes('haltStagingPaperExecution()'));
 assert.ok(route.includes('private, no-store'));
 assert.ok(!route.includes('export async function DELETE'));
 assert.ok(!route.includes('export async function PUT'));
 assert.ok(!route.includes('export async function PATCH'));
});
test('Server target is fixed staging DB, never Alpaca or Production',()=>{
 assert.ok(operator.includes("STAGING_HOST='mcaxfaaohyencpspalfe.supabase.co'"));
 assert.ok(operator.includes('sportsedge_paper_stage_halt'));
 assert.ok(operator.includes('sportsedge_paper_stage_status'));
 assert.ok(!operator.includes('paper-api.alpaca.markets'));
 assert.ok(!operator.includes('https://api.alpaca.markets'));
 assert.ok(!operator.includes('localStorage'));
 assert.ok(!operator.includes('console.log'));
});
test('Owner dashboard contains no automatic trade button or credential field for staging',()=>{
 assert.ok(dash.includes('<AlpacaStagingStopPanel/>'));
 assert.ok(panel.includes('Record staging emergency STOP'));
 assert.ok(panel.includes('No order writer is connected'));
 assert.ok(panel.includes('HALTED BY DESIGN'));
 assert.ok(!panel.includes('SUPABASE_SERVICE_ROLE_KEY'));
 assert.ok(!panel.includes('SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY'));
 assert.ok(!panel.includes('Submit order'));
});
