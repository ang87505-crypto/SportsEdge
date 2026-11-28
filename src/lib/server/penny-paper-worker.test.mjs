import test from 'node:test';
import assert from 'node:assert/strict';
import {freezePennyEntries,settlePennyEntries,readPennyStudy} from './penny-paper-worker.ts';
import {PENNY_PAPER_POLICY,PENNY_PAPER_SHA256} from '../lab/penny-paper.ts';
import {PropsStoreError} from './props-store.ts';
const at='2026-11-20T18:00:00Z';
function world({missing=false,conflict=false}={}){
 const t={props_penny_cohorts:[{id:PENNY_PAPER_POLICY.id,policy_sha256:conflict?'f'.repeat(64):PENNY_PAPER_SHA256,registered_at:'2026-11-20T12:00:00Z'}],
 props_entries:[{id:7,created_at:'2026-11-20T17:00:00Z',lock_at:'2026-11-21T00:00:00Z'},{id:6,created_at:'2026-11-19T17:00:00Z',lock_at:'2026-11-21T00:00:00Z'}],
 props_penny_entries:[],props_penny_settlements:[],props_line_results:[],props_penny_tampering:[]},writes=[];
 const store={async select(table,query){
  if(missing&&table.startsWith('props_penny_'))throw new PropsStoreError('DB_42P01',true);
  let rows=t[table]??[];for(const part of query.split('&')){const [k,...rest]=part.split('='),v=decodeURIComponent(rest.join('='));
   if(v.startsWith('eq.'))rows=rows.filter(r=>String(r[k])===v.slice(3));
   if(v.startsWith('gte.'))rows=rows.filter(r=>r[k]>=v.slice(4));if(v.startsWith('gt.'))rows=rows.filter(r=>r[k]>v.slice(3));
   if(v.startsWith('lte.'))rows=rows.filter(r=>r[k]<=v.slice(4));
   if(v.startsWith('in.('))rows=rows.filter(r=>v.slice(4,-1).split(',').includes(String(r[k])));
  }return rows;},
  async insert(table,rows){writes.push({table,rows});
   const saved=rows.map(r=>table==='props_penny_entries'?{...r,id:1,probability_ppm:414050,stake_cents:8,reference_stake_cents:10,
    reason:'SIZED',recorded_at:at,lock_at:'2026-11-21T00:00:00Z',record_sha256:'a'.repeat(64),inputs:{legs:[{pick_id:1,observation_id:10},{pick_id:2,observation_id:20}]}}:
    {...r,id:1,revision:1,outcome:'won',return_cents:24,profit_cents:16,reference_return_cents:30,reference_profit_cents:20,recorded_at:'2026-11-21T04:00:00Z'});
   t[table].push(...saved);return saved;},async rpc(){throw Error('no RPC or broker calls');}};
 return {t,writes,store,now:()=>at};
}
test('missing schema and conflicting policies cannot create fake readiness or stakes',async()=>{
 const m=world({missing:true});assert.equal((await freezePennyEntries(m)).status,'NOT_MIGRATED');assert.equal(m.writes.length,0);
 await assert.rejects(freezePennyEntries(world({conflict:true})),/POLICY_CONFLICT/);
});
test('forward freeze sends source IDs only; the database owns money and excludes pre-cohort entries',async()=>{
 const w=world(),r=await freezePennyEntries(w);assert.equal(r.recorded,1);
 assert.deepEqual(w.writes[0],{table:'props_penny_entries',rows:[{cohort_id:PENNY_PAPER_POLICY.id,source_entry_id:7}]});
 assert.equal((await freezePennyEntries(w)).recorded,0);
});
test('settlement waits for both available grades, reuses frozen source identity and never repeats a known grade set',async()=>{
 const w=world();await freezePennyEntries(w);const d={...w,now:()=>'2026-11-21T05:00:00Z'};
 assert.equal((await settlePennyEntries(d)).pending,1);
 w.t.props_line_results.push({id:11,observation_id:10,revision:1,graded_at:'2026-11-21T04:00:00Z'},
  {id:21,observation_id:20,revision:1,graded_at:'2026-11-21T04:00:00Z'},
  {id:22,observation_id:20,revision:2,graded_at:'2026-11-22T04:00:00Z'});
 assert.equal((await settlePennyEntries(d)).settlements,1);assert.deepEqual(w.writes.at(-1).rows,[{penny_entry_id:1,grade_ids:[11,21]}]);
 assert.equal((await settlePennyEntries(d)).settlements,0);
 const snapshot=await readPennyStudy(d);assert.equal(snapshot.summary.variable.realizedProfitCents,16);
 w.t.props_penny_tampering.push({id:1});await assert.rejects(readPennyStudy(d),/INTEGRITY/);
});
