import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {publishIntake,restoreIntake,intakeIndex} from './research-intake-archive.ts';
const root=()=>mkdtempSync(join(tmpdir(),'intake-archive-'));
function fixture(dir,at='2026-11-19T12:00:00Z',partial=false){
 mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'manifest.json'),JSON.stringify({items:[{id:'openalex:W123',checksum:'a'.repeat(64)}]}));
 writeFileSync(join(dir,'report.json'),JSON.stringify({retrievedAt:at,sources:{openalex:{connected:partial?'PARTIAL':'VERIFIED_THIS_RUN'}},literature:{reviewQueue:1,quarantined:0}}));
 writeFileSync(join(dir,'literature-leads.json'),JSON.stringify([{sourceId:'openalex',sourceItemId:'W123',retrievedAt:at,content:{title:'SYNTHETIC',retrievedAt:at},quality:{status:'REVIEW_QUEUE',publicationAgeDays:1}}]));
}
test('durable objects deduplicate across runs; dated receipts and frozen source content stay immutable',()=>{
 const data=root(),out=root();fixture(out);
 const first=publishIntake(data,out,'100-1','a'.repeat(40));assert.equal(first.receipt.objectsAdded,1);
 const replay=publishIntake(data,out,'100-1','a'.repeat(40));assert.equal(replay.alreadyPublished,true);
 fixture(out,'2026-11-20T12:00:00Z');const second=publishIntake(data,out,'101-1','a'.repeat(40));
 assert.equal(second.receipt.objectsReused,1);assert.equal(second.receipt.objectsAdded,0);
 assert.equal(readdirSync(join(data,'research-intake','objects')).length,1);
 fixture(out,'2026-11-21T12:00:00Z');assert.throws(()=>publishIntake(data,out,'100-1','a'.repeat(40)),/IMMUTABLE/);
 writeFileSync(join(out,'literature-leads.json'),JSON.stringify([{sourceId:'openalex',sourceItemId:'NEW',content:{title:'changed content'}}]));
 assert.throws(()=>publishIntake(data,out,'100-1','a'.repeat(40)),/IMMUTABLE/);
 assert.equal(readdirSync(join(data,'research-intake','objects')).length,1,'refused replay cannot create new content');
 assert.equal(intakeIndex(readFileSync(join(data,'research-intake/index.jsonl'),'utf8')).length,2);
});
test('once-daily restore uses only successful verified state; partial collection stays visible and is retried',()=>{
 const data=root(),out=root(),state=root();fixture(out);
 publishIntake(data,out,'100-1','a'.repeat(40));assert.equal(restoreIntake(data,state,'2026-11-19T18:00:00Z').collect,false);
 assert.equal(restoreIntake(data,state,'2026-11-20T18:00:00Z').collect,true);
 fixture(out,'2026-11-20T12:00:00Z',true);publishIntake(data,out,'101-1','a'.repeat(40));
 assert.equal(restoreIntake(data,state,'2026-11-20T15:00:00Z').collect,false,'partial retries are bounded');
 const r=restoreIntake(data,state,'2026-11-20T18:00:00Z');assert.equal(r.restored,'100-1');assert.equal(r.collect,true);
});
test('a report without verified per-source states cannot publish a successful receipt',()=>{
 const data=root(),out=root();fixture(out);
 const p=join(out,'report.json'),report=JSON.parse(readFileSync(p,'utf8'));report.sources={};writeFileSync(p,JSON.stringify(report));
 assert.throws(()=>publishIntake(data,out,'100-1','a'.repeat(40)),/INTAKE_BAD_REPORT/);
 assert.deepEqual(readdirSync(data),[]);
});
