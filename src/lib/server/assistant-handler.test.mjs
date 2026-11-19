// Assistant API handler: strict input, short cache, honest replies. Fake loader; synthetic TEST-ONLY ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAssistant,resetAssistantCache,CACHE_MS} from './assistant-handler.ts';
import {makeRaw,NOW} from '../assistant/fixtures.mjs';

const ENV={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
const req=(body,contentType='application/json')=>({contentType,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
function loader(raw=makeRaw()){const f=async()=>{f.calls++;return raw;};f.calls=0;return f;}

test('cache window',()=>assert.equal(CACHE_MS,60_000));

test('only JSON with a short message and a well-formed context is accepted',async()=>{
 resetAssistantCache();const l=loader();
 for(const [body,ct] of [[{message:'hi'},'text/plain'],['{not json'],[{message:'x'.repeat(301)}],[{message:'hi',extra:1}],[{message:42}],
  [{message:'hi',context:{intent:'nope'}}],[{message:'hi',context:{lastPickIds:Array(11).fill(1)}}],[{message:'hi',context:{lastPickIds:['1']}}],
  [{message:'hi',context:{range:'last month'}}],['x'.repeat(2001)]]){
  const r=await handleAssistant(req(body,ct),ENV,l,NOW);
  assert.equal(r.status,400,JSON.stringify(body).slice(0,60));
 }
 assert.equal(l.calls,0,'nothing is read for a rejected request');
});

test('a valid question gets a reply from the ledger',async()=>{
 resetAssistantCache();const l=loader();
 const r=await handleAssistant(req({message:'how did we do last night',context:null}),ENV,l,NOW);
 assert.equal(r.status,200);
 assert.equal(r.headers.get('cache-control'),'private, no-store');
 const j=await r.json();
 assert.equal(j.status,'ok');
 assert.match(j.reply.text,/^Last night went 2–1 on entries/);
 assert.equal(j.reply.context.intent,'results');
});

test('follow-ups use the context the page sends back',async()=>{
 resetAssistantCache();const l=loader();
 const first=await (await handleAssistant(req({message:"tonight's picks"}),ENV,l,NOW)).json();
 const why=await (await handleAssistant(req({message:'why?',context:first.reply.context}),ENV,l,NOW)).json();
 assert.match(why.reply.text,/^Devin Booker More 11\.5 rebounds: 74%/);
});

test('reads are cached for a minute',async()=>{
 resetAssistantCache();const l=loader();
 await handleAssistant(req({message:'hi'}),ENV,l,NOW);
 await handleAssistant(req({message:'balance'}),ENV,l,'2026-11-09T19:00:59.000Z');
 assert.equal(l.calls,1);
 await handleAssistant(req({message:'balance'}),ENV,l,'2026-11-09T19:01:01.000Z');
 assert.equal(l.calls,2);
});

test('when the records cannot be read, the reply says so honestly',async()=>{
 resetAssistantCache();
 const down=async()=>{throw new Error('STORE_OUTCOME_UNKNOWN');};
 for(const [env,load] of [[ENV,down],[{},loader()],[{...ENV,SPORTSEDGE_PREVIEW_FIXTURES:'1'},loader()]]){
  resetAssistantCache();
  const r=await handleAssistant(req({message:'how did we do last night'}),env,load,NOW);
  assert.equal(r.status,200);
  const j=await r.json();
  assert.equal(j.reply.text,"I can't read the records right now. Try again in a minute.");
  assert.deepEqual(j.reply.suggestions,['Try again','Help']);
 }
});
