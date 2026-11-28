import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDualTracksWith} from './dual-track-core.ts';

const AT=new Date('2026-11-27T11:00:00Z');
const config={base:'https://fzyjazhvkstvwwzjhlrr.supabase.co',key:'sb_secret_test'};
const event=(sport,id,home,away,last='2026-11-27T10:55:00Z',price=-120)=>({id,sport_key:sport,commence_time:'2026-11-28T00:30:00Z',
 home_team:home,away_team:away,bookmakers:[{key:'book1',markets:[{key:'h2h',last_update:last,outcomes:
  sport==='soccer_epl'?[{name:home,price:150},{name:away,price:180},{name:'Draw',price:220}]:[{name:home,price},{name:away,price:100}]}]}]});

/** In-memory PostgREST + Odds API. Enforces the odds_snapshots uniqueness key like the database does. */
function fakeWorld({nba=[event('basketball_nba','n1','Knicks','Heat')],soccer=[event('soccer_epl','e1','Arsenal','Chelsea')],
 failInsertForGame=null,dropReadback=false,failReadback=false,db={leagues:[],teams:[],games:[],odds:[],seq:0}}={}){
 const calls=[];
 const reply=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
 const fetcher=async(input,init={})=>{
  const url=new URL(String(input));const method=init.method??'GET';calls.push(method+' '+url.pathname);
  if(url.hostname==='api.the-odds-api.com'){
   assert.equal(url.searchParams.get('markets'),'h2h');assert.equal(url.searchParams.get('regions'),'us');
   return reply(url.pathname.includes('basketball_nba')?nba:soccer,200,{'x-requests-remaining':'400'});
  }
  const table=url.pathname.split('/').pop();const q=url.searchParams;
  if(method==='POST'){
   const rows=JSON.parse(init.body);
   if(table==='leagues'||table==='teams'){
    const key=table==='leagues'?'provider_league_id':'provider_team_id';
    return reply(rows.map(r=>{let x=db[table].find(e=>e[key]===r[key]);if(!x){x={...r,id:++db.seq};db[table].push(x);}return {id:x.id};}));
   }
   if(table==='games')return reply(rows.map(r=>{const x={...r,id:++db.seq};db.games.push(x);return {id:x.id};}));
   if(table==='odds_snapshots'){
    const out=[];
    for(const r of rows){
     if(failInsertForGame!==null&&db.games.find(g=>g.id===r.game_id)?.provider_event_id===failInsertForGame)return reply({message:'boom'},500);
     const k=[r.game_id,r.sportsbook,r.market,r.selection,r.observed_at,r.american_odds,r.line].join('|');
     if(db.odds.some(o=>o.k===k))continue;
     const x={...r,k,id:++db.seq};db.odds.push(x);out.push({id:x.id});
    }
    return reply(out);
   }
  }
  if(table==='games'){const id=q.get('provider_event_id').slice(3);return reply(db.games.filter(g=>g.provider_event_id===id).map(g=>({id:g.id})));}
  if(table==='odds_snapshots'){
   if(failReadback)return reply({message:'down'},503);
   const ids=q.get('id').slice(4,-1).split(',').map(Number);
   const found=db.odds.filter(o=>ids.includes(o.id)).map(o=>({id:o.id,game_id:o.game_id}));
   return reply(dropReadback?found.slice(1):found);
  }
  throw Error('unexpected '+method+' '+url);
 };
 return {db,calls,fetcher};
}

test('both sports saved: each track reports its own rows, verified by ID, and the newest provider timestamp',async()=>{
 const w=fakeWorld();
 const r=await collectDualTracksWith(config,'key',w.fetcher,AT);
 assert.equal(r.status,'refreshed');
 assert.equal(r.tracks.nba.outcome,'saved');assert.equal(r.tracks.nba.oddsInserted,2);assert.equal(r.tracks.nba.oddsVerified,2);
 assert.equal(r.tracks.soccer.outcome,'saved');assert.equal(r.tracks.soccer.oddsInserted,3);
 assert.equal(r.tracks.nba.newestSourceObservedAt,'2026-11-27T10:55:00.000Z');
 assert.equal(w.calls.filter(c=>c.startsWith('GET /v4')).length,2,'exactly two provider requests');
});
test('an EPL empty slate is reported as such and does not hide or fail the NBA save',async()=>{
 const r=await collectDualTracksWith(config,'key',fakeWorld({soccer:[]}).fetcher,AT);
 assert.equal(r.tracks.nba.outcome,'saved');assert.equal(r.tracks.soccer.outcome,'empty_slate');
 assert.equal(r.tracks.soccer.newestSourceObservedAt,null);assert.equal(r.status,'refreshed');
});
test('unchanged quotes: a second identical capture inserts nothing and says unchanged, not refreshed',async()=>{
 const w=fakeWorld();
 await collectDualTracksWith(config,'key',w.fetcher,AT);
 const r=await collectDualTracks2(w);
 assert.equal(r.tracks.nba.outcome,'unchanged');assert.equal(r.tracks.soccer.outcome,'unchanged');
 assert.equal(r.status,'no_new_quotes');assert.equal(w.db.odds.length,5);
});
async function collectDualTracks2(w){return collectDualTracksWith(config,'key',w.fetcher,AT);}
test('fresh NBA quotes cannot hide unchanged EPL quotes',async()=>{
 const w=fakeWorld();
 await collectDualTracksWith(config,'key',w.fetcher,AT);
 // Same database; the NBA book has moved its price, the EPL book has not.
 const w2=fakeWorld({db:w.db,nba:[event('basketball_nba','n1','Knicks','Heat','2026-11-27T10:58:00Z',-130)]});
 const r=await collectDualTracksWith(config,'key',w2.fetcher,AT);
 assert.equal(r.tracks.nba.outcome,'saved');assert.equal(r.tracks.soccer.outcome,'unchanged');
 assert.equal(r.tracks.soccer.newestSourceObservedAt,'2026-11-27T10:55:00.000Z');
});
test('partial failure: an EPL write failure is that sport\'s failure; NBA quotes are still saved and reported',async()=>{
 const r=await collectDualTracksWith(config,'key',fakeWorld({failInsertForGame:'e1'}).fetcher,AT);
 assert.equal(r.tracks.nba.outcome,'saved');assert.equal(r.tracks.soccer.outcome,'store_failed');
 assert.equal(r.tracks.soccer.error,'STORE_FAILED');assert.equal(r.tracks.soccer.oddsInserted,0);
 assert.equal(r.status,'partial_refresh');
});
test('rows missing on read-back are unverified, never saved',async()=>{
 const r=await collectDualTracksWith(config,'key',fakeWorld({dropReadback:true}).fetcher,AT);
 assert.equal(r.tracks.nba.outcome,'unverified');assert.equal(r.tracks.nba.oddsVerified,1);
 assert.equal(r.status,'refresh_failed');
});
test('a read-back outage is a store failure for the run, not a success',async()=>{
 const r=await collectDualTracksWith(config,'key',fakeWorld({failReadback:true}).fetcher,AT);
 assert.equal(r.tracks.nba.outcome,'store_failed');assert.equal(r.tracks.nba.error,'VERIFY_FAILED');
 assert.equal(r.status,'refresh_failed');
});
test('a provider failure on either feed happens before any database write',async()=>{
 const w=fakeWorld();
 const failing=async(input,init)=>String(input).includes('soccer_epl')?new Response('x',{status:500}):w.fetcher(input,init);
 await assert.rejects(collectDualTracksWith(config,'key',failing,AT));
 assert.equal(w.calls.filter(c=>c.startsWith('POST')).length,0);
});
