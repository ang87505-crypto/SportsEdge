import test from 'node:test';
import assert from 'node:assert/strict';
import {kalshiPlatformStore,KalshiStoreError} from './kalshi-platform-store.ts';
const env={SUPABASE_URL:'https://fzyjazhvkstvwwzjhlrr.supabase.co',SUPABASE_SECRET_KEY:'synthetic-secret-key-for-offline-tests'};
test('private store pins the configured app project and refuses fixture previews or a caller-selected host',()=>{
 for(const extra of [{SUPABASE_URL:'https://attacker.invalid'},{SUPABASE_URL:env.SUPABASE_URL+'?key=foo'},
  {SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co'},{SPORTSEDGE_PREVIEW_FIXTURES:'1'}])
  assert.throws(()=>kalshiPlatformStore({...env,...extra}),KalshiStoreError);
 assert.throws(()=>kalshiPlatformStore({}),/NOT_CONFIGURED/);
});
test('table and RPC allowlists reject unrelated database access before a request',async()=>{
 let calls=0;const s=kalshiPlatformStore(env,async()=>{calls++;return new Response('[]');});
 await assert.rejects(s.select('props_entries','select=*'),/TABLE_NOT_ALLOWED/);
 await assert.rejects(s.insert('users',[{}]),/TABLE_NOT_ALLOWED/);
 await assert.rejects(s.rpc('exec_sql',{}),/RPC_NOT_ALLOWED/);assert.equal(calls,0);
});
test('minimal successful inserts and void RPCs accept an empty 204 response',async()=>{
 const s=kalshiPlatformStore(env,async(url,opts)=>{
  assert.ok(url.startsWith(env.SUPABASE_URL+'/rest/v1/'));assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.apikey,env.SUPABASE_SECRET_KEY);return new Response(null,{status:204});
 });
 await s.insert('kalshi_demo_receipts',[{intent_id:'synthetic'}]);
 assert.equal(await s.rpc('kalshi_set_demo_control',{p_state:'STOPPED',p_fingerprint:null}),null);
});
test('lost write responses are unknown, sanitized and never retried automatically',async()=>{
 let calls=0;const s=kalshiPlatformStore(env,async()=>{calls++;throw Error(env.SUPABASE_SECRET_KEY);});
 await assert.rejects(s.rpc('kalshi_begin_run',{p_slot:'test'}),e=>e instanceof KalshiStoreError&&e.outcomeUnknown&&!e.message.includes(env.SUPABASE_SECRET_KEY));
 assert.equal(calls,1);
});
test('database refusals expose only a bounded code, never raw SQL or key-bearing diagnostics',async()=>{
 const s=kalshiPlatformStore(env,async()=>new Response(JSON.stringify({message:'KALSHI_DEMO_DAILY_LIMIT private '+env.SUPABASE_SECRET_KEY}),{status:400}));
 await assert.rejects(s.rpc('kalshi_begin_run',{}),e=>e.code==='KALSHI_DEMO_DAILY_LIMIT'&&!e.outcomeUnknown&&!e.message.includes(env.SUPABASE_SECRET_KEY));
});
test('a hosted row cap cannot silently truncate an order history, while deliberate latest-row queries remain valid',async()=>{
 const s=kalshiPlatformStore(env,async(_url,opts)=>{
  assert.equal(opts.headers.Prefer,'count=exact');
  return new Response('[{"id":1}]',{headers:{'content-range':'0-0/1200'}});
 });
 await assert.rejects(s.select('kalshi_demo_receipts','select=*&order=id.asc&limit=1501'),/INCOMPLETE_READ/);
 assert.deepEqual(await s.select('kalshi_demo_receipts','select=*&order=id.desc&limit=1'),[{id:1}]);
 const empty=kalshiPlatformStore(env,async()=>new Response('[]',{headers:{'content-range':'*/0'}}));
 assert.deepEqual(await empty.select('kalshi_demo_receipts','select=*&limit=1501'),[]);
});
