import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {secIntakeV2} from './sec-intake-v2.ts';
import {parseCompanyFactsV2,asOfKind} from './sec-pit-v2.ts';
import {checksum} from './provenance.ts';

const rows=[
 {start:'2024-07-01',end:'2024-09-30',val:130,accn:'0000000123-24-000001',form:'10-Q',filed:'2024-11-05'},
 {start:'2024-01-01',end:'2024-09-30',val:360,accn:'0000000123-24-000001',form:'10-Q',filed:'2024-11-05'},
 {start:'2024-07-01',end:'2024-09-30',val:130,accn:'0000000123-25-000001',form:'10-Q',filed:'2025-02-05'},
 {start:'2024-07-01',end:'2024-09-30',val:140,accn:'0000000123-25-000002',form:'10-Q/A',filed:'2025-02-10'}];
const body={cik:123,entityName:'TEST ONLY',facts:{'us-gaap':{Revenues:{units:{USD:rows}},Unused:{units:{USD:rows}}}}};

test('the stored source subset reproduces duration-aware facts and preserves amended filing availability',()=>{
 const r=secIntakeV2(body,'0000000123','2026-11-21',['2024-11-06','2025-02-11']);
 assert.equal(r.archive.sourcePayloadSha256,checksum(r.archive.sourcePayload));
 assert.equal(r.archive.sourcePayload.facts['us-gaap'].Unused,undefined);
 assert.deepEqual(parseCompanyFactsV2(r.archive.sourcePayload).facts,r.archive.facts);
 assert.equal(r.archive.factsChecksumSha256,checksum(r.archive.facts));
 assert.equal(asOfKind(r.archive.facts,'Revenues','quarter','2025-02-10').value,130);
 assert.equal(asOfKind(r.archive.facts,'Revenues','quarter','2025-02-11').value,140);
 assert.equal(r.diagnostics.restatements.trueRestatements,1);
 assert.ok(r.diagnostics.durationAmbiguity.endsWithSeveralDurations>0);
 assert.equal(r.diagnostics.pointInTime.asOfLeaks,0);
});

test('thin or mismatched CIK history stays explicitly unusable; future filings fail the point-in-time check',()=>{
 const r=secIntakeV2(body,'0000000999','2024-11-06',['2024-11-06']);
 assert.equal(r.diagnostics.identity.usable,false);
 assert.ok(r.diagnostics.identity.flags.includes('MAPPED_CIK_MISMATCH'));
 assert.ok(r.diagnostics.identity.flags.includes('HISTORY_STARTS_AFTER_WINDOW'));
 assert.ok(r.diagnostics.identity.flags.includes('FEW_FACTS'));
 assert.equal(r.diagnostics.pointInTime.ok,false);
 assert.equal(r.diagnostics.pointInTime.filedAfterRetrieval,2);
});

test('the real collector adds v2 without extra requests and keeps its archived v1 facts intact (synthetic network)',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sec-v2-intake-')),preload=join(dir,'fetch.mjs');
 writeFileSync(preload,`const body=${JSON.stringify(body)};globalThis.fetch=async input=>{const u=String(input);return new Response(JSON.stringify(u.includes('company_tickers')?{'0':{cik_str:123,ticker:'TEST'}}:body),{status:200});};`);
 const run=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--import',preload,
  new URL('../../../scripts/research-intake-collect.ts',import.meta.url).pathname,'--out',dir,'--tickers','TEST'],
 {env:{...process.env,SEC_EDGAR_USER_AGENT:'SportsEdge test (test@example.invalid)'},stdio:'pipe'});
 const report=JSON.parse(readFileSync(join(dir,'report.json'),'utf8'));
 const saved=JSON.parse(readFileSync(join(dir,'sec-companyfacts/CIK0000000123.json'),'utf8'));
 // These old synthetic filings are still archived and audited, but never become a successful fresh collection.
 assert.equal(run.status,1);assert.equal(report.sec[0].quality.stale,true);
 assert.equal(report.requests,2);assert.equal(saved.facts.length,4);assert.equal(saved.v2.facts.length,4);
 assert.equal(report.sec[0].v2.schema,'sec-pit-v2');
 assert.equal(saved.v2.sourcePayloadSha256,checksum(saved.v2.sourcePayload));
});
