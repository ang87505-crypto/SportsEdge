import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
let src=await readFile(new URL('../server/collect/odds-collector.ts',import.meta.url),'utf8');
src=src.replace('import "server-only";','')
 .replace('"@/lib/ingestion/normalize"',JSON.stringify(new URL('./normalize.ts',import.meta.url).href))
 .replace('"@/lib/ingestion/snapshot-rows"',JSON.stringify(new URL('./snapshot-rows.ts',import.meta.url).href))
 .replace('"@/lib/ingestion/collection-policy"',JSON.stringify(new URL('./collection-policy.ts',import.meta.url).href));
const js=ts.transpileModule(src,{compilerOptions:{
 module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;
const {collectSelectedTracks,collectDualTracks}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const original={
 SUPABASE_URL:process.env.SUPABASE_URL,
 SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY,
 ODDS_API_KEY:process.env.ODDS_API_KEY
};
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY='sb_secret_synthetic_test';
process.env.ODDS_API_KEY='synthetic';
process.on('exit',()=>{
 for(const [key,value] of Object.entries(original)){
  if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
function mock({failedSport=null,remaining=100}={}){
 const sources=[],writes=[];
 const fn=async (url,options={})=>{
  const target=new URL(String(url));
  if(target.hostname==='api.the-odds-api.com'){
   sources.push(target.pathname);
   if(failedSport&&target.pathname.includes(failedSport))return {
    ok:false,status:503,headers:new Headers(),json:async()=>[]
   };
   return {ok:true,status:200,headers:new Headers({'x-requests-remaining':String(remaining)}),
    json:async()=>[]};
  }
  assert.equal(target.hostname,'example.supabase.co');
  assert.equal(options.method,'POST');
  writes.push(target.pathname);
  return {ok:true,status:201,json:async()=>[{id:1}]};
 };
 return {fn,sources,writes};
}
test('NBA-only request does not call soccer feed, incurs one HTTP source request',async()=>{
 const x=mock(),r=await collectSelectedTracks(['nba'],x.fn);
 assert.equal(x.sources.length,1);
 assert.match(x.sources[0],/basketball_nba/);
 assert.equal(r.providerRequestsMade,1);
 assert.deepEqual(r.selectedTracks,['nba']);
 assert.ok(r.tracks.nba);assert.equal(r.tracks.soccer,undefined);
});
test('soccer-only request never fetches NBA odds',async()=>{
 const x=mock(),r=await collectSelectedTracks(['soccer'],x.fn);
 assert.equal(x.sources.length,1);
 assert.match(x.sources[0],/soccer_epl/);
 assert.deepEqual(r.selectedTracks,['soccer']);
});
test('existing dual-track interface still performs both provider calls',async()=>{
 const x=mock(),r=await collectDualTracks(x.fn);
 assert.equal(x.sources.length,2);
 assert.equal(r.providerRequestsMade,2);
 assert.ok(r.tracks.nba&&r.tracks.soccer);
});
test('invalid or repeated tracks rejected before provider charge',async()=>{
 const x=mock();
 for(const value of [[],['nba','nba'],['nhl'],['nba','soccer','nba']])
  await assert.rejects(()=>collectSelectedTracks(value,x.fn));
 assert.deepEqual(x.sources,[]);assert.deepEqual(x.writes,[]);
});
test('second provider failure cannot partially ingest earlier market',async()=>{
 const x=mock({failedSport:'soccer_epl'});
 await assert.rejects(()=>collectSelectedTracks(['nba','soccer'],x.fn),/soccer request failed/);
 assert.equal(x.sources.length,2);assert.deepEqual(x.writes,[]);
});
test('zero remaining quota stops second provider call before any DB write',async()=>{
 const x=mock({remaining:0});
 await assert.rejects(()=>collectSelectedTracks(['nba','soccer'],x.fn),/quota too low/);
 assert.equal(x.sources.length,1);assert.deepEqual(x.writes,[]);
});
