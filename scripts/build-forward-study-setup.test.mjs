import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forwardSetupSql} from './build-forward-study-setup.ts';
import {PENNY_PAPER_POLICY,PENNY_PAPER_SHA256} from '../src/lib/lab/penny-paper.ts';
import {canonicalJson} from '../src/lib/props/normalize.ts';
test('reviewable setup is reproducible, refuses a wrong/partial database, and freezes the same cross-runtime policy',()=>{
 const sql=forwardSetupSql();assert.equal(sql,readFileSync(new URL('../database/props/forward_studies_setup.sql',import.meta.url),'utf8'));
 assert.ok(sql.includes(PENNY_PAPER_SHA256));assert.ok(sql.includes(canonicalJson(PENNY_PAPER_POLICY)));
 assert.ok(sql.includes('WRONG_DATABASE'));assert.ok(sql.includes('PARTIAL_LAB_SCHEMA'));assert.ok(sql.includes('PARTIAL_PENNY_SCHEMA'));
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|SECURITY DEFINER|UPDATE public\.props_entries/i);
});
