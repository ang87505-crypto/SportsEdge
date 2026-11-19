/** SYNTHETIC transport responses only. No requests reach Supabase or a sports provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const ROOT=new URL('../../../../',import.meta.url);
test('the bounded GET reader paginates observations, verifies actual outcomes and uses Eastern game dates',()=>{
 const d=mkdtempSync(join(tmpdir(),'engine-reader-')),mock=join(d,'mock.mjs'),out=join(d,'out');
 writeFileSync(mock,`
 import assert from 'node:assert/strict';
 globalThis.fetch=async(raw,opts)=>{
  const url=new URL(raw);assert.equal(url.hostname,'vfyzbliksooljxrlfadp.supabase.co');assert.equal(opts.method,'GET');
  const table=url.pathname.split('/').at(-1),offset=Number(url.searchParams.get('offset')??0);
  const includesLast=(url.searchParams.get('observation_id')??'').split(/[(),]/).includes('501');
  let rows=[];
  if(table==='props_observations'){
   assert.equal(url.searchParams.get('is_fixture'),'eq.false');
   rows=Array.from({length:offset===0?500:1},(_,i)=>({id:offset+i+1,provider_event_id:'SYNTHETIC-event',lock_at:'2026-11-16T01:00:00Z',
    recorded_at:'2026-11-15T16:00:00Z',player_name:'Synthetic Player '+(offset+i),stat:'points',line:10.5}));
  }else if(table==='props_predictions'&&includesLast){
   rows=['props-nb-minutes-rate-v1','props-learn-v1'].map((model_version,i)=>({id:i+1,observation_id:501,model_version,status:'scored',
    p_more:0.65,p_less:0.35,p_tie:0,mean:12,inputs:{games:20,expMinutes:30,sdMinutes:3},predicted_at:'2026-11-15T17:00:00Z',data_cutoff:'2026-11-15T15:00:00Z'}));
  }else if(table==='props_line_results'&&includesLast){
   rows=[{id:1,observation_id:501,revision:1,outcome:'more',actual:14,graded_at:'2026-11-16T05:00:00Z'}];
  }else if(table==='props_picks'){rows=[{id:1,prediction_id:1,status:'recorded',side:'more'}];
  }else if(table==='props_market_views'){
   assert.equal(url.searchParams.get('order'),'observation_id.asc');if(includesLast)rows=[{observation_id:501,p_more_books:0.6}];
  }
  return new Response(JSON.stringify(rows),{status:200});
 };
 `);
 const stdout=execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','--import',mock,'scripts/research-engine.ts','--registry','research/engine/registry.json',
  '--out',out,'--sports-ledger','--evaluate-forward','--now','2026-11-19T17:00:00Z'],{cwd:ROOT,encoding:'utf8',env:{...process.env,
  SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'synthetic_test_key'}});
 assert.equal(JSON.parse(stdout.trim()).status,'OK');
 const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
 assert.equal(report.domains.sports.clean,1,'the only prediction belongs to observation 501 on the second page');
 assert.equal(report.forward[0].details.pairs,1);
 assert.equal(report.forward[0].details.invalidGrades,0);
 assert.ok(report.domains.sports.ledgerRequests>=10);
});
