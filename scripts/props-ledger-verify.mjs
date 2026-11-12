/**
 * Read-only props ledger audit. PostgREST GET only (same guard as the preflight); no RPC, no write, no provider call.
 * For entries created in [FROM, TO) (UTC ISO dates) and the collect runs in that span it prints every leg with the
 * pick, the observed line, the stored result, the stored final box score, an independent re-grade, and the entry's
 * stored settlement vs a recomputation under the recorded PrizePicks terms. Also: account bankrolls and the graded
 * record of all recorded picks for the active selection version.
 * Usage: FROM=2026-11-10 TO=2026-11-13 node --experimental-strip-types scripts/props-ledger-verify.mjs [out.json]
 */
import {writeFileSync} from 'node:fs';
import {regrade,legOf,auditEntry} from './props-ledger-verify-lib.mjs';
import {settleEntry} from '../src/lib/props/rules.ts';

const env=process.env,url=env.SPORTSEDGE_PROPS_SUPABASE_URL??'',key=env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY??'';
let host=null;try{host=new URL(url).hostname;}catch{/* checked below */}
if(!key||host!=='vfyzbliksooljxrlfadp.supabase.co'){console.log(JSON.stringify({error:'NOT_CONFIGURED_OR_UNEXPECTED_PROJECT'}));process.exit(2);}
const FROM=env.FROM||'2026-11-09',TO=env.TO||new Date(Date.now()+86400_000).toISOString().slice(0,10);
const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),Accept:'application/json'};
async function get(path){
 const res=await fetch(`https://${host}/rest/v1/${path}`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20_000)});
 const text=await res.text();if(!res.ok)throw new Error('HTTP_'+res.status+' '+path.split('?')[0]+' '+text.slice(0,120));
 return JSON.parse(text);
}
const inList=xs=>'in.('+[...new Set(xs)].join(',')+')';
const byId=(rows,k='id')=>new Map(rows.map(r=>[Number(r[k]),r]));
const out={schemaVersion:'props-ledger-verify-v1',at:new Date().toISOString(),from:FROM,to:TO};

// Collect runs in range, with their own receipts (budget, entries / no-entry reasons).
const runs=await get(`props_runs?select=id,kind,slot_key,status,outcome,started_at,finished_at,summary&started_at=gte.${FROM}&started_at=lt.${TO}&order=id.asc&limit=500`);
out.runs=runs.map(r=>{const s=r.summary??{};const e=s.entries&&typeof s.entries==='object'?Object.fromEntries(Object.entries(s.entries).map(([p,v])=>[p,
 {made:Array.isArray(v?.entries)?v.entries.filter(x=>x?.outcome!=='REFUSED').length:0,noEntryReason:v?.noEntryReason??null}])):null;
 return {id:r.id,kind:r.kind,slot:r.slot_key,status:r.status,outcome:r.outcome,startedAt:r.started_at,
  reason:s.reason??null,budgetBefore:s.budgetBefore??null,receipt:s.receipt??null,entries:e,settlement:s.settlement??null};});

// Entries in range and everything behind each leg.
const entries=await get(`props_entries?select=id,account_id,run_id,entry_type,pick_count,stake_cents,payout_terms_version,lock_at,created_at&created_at=gte.${FROM}&created_at=lt.${TO}&order=id.asc&limit=200`);
const accounts=await get('props_accounts?select=id,slug,platform,selection_version,initial_cents,stake_cents,max_entries_per_day&order=id.asc');
const acc=byId(accounts);
const ids=entries.map(e=>e.id);
const legs=ids.length?await get(`props_entry_legs?select=entry_id,pick_id&entry_id=${inList(ids)}`):[];
const picks=legs.length?byId(await get(`props_picks?select=id,prediction_id,run_id,selection_version,status,side,reason,decided_at&id=${inList(legs.map(l=>l.pick_id))}`)):new Map();
const preds=picks.size?byId(await get(`props_predictions?select=id,observation_id,model_version,p_more,p_less,mean,athlete_id&id=${inList([...picks.values()].map(p=>p.prediction_id))}`)):new Map();
const obs=preds.size?byId(await get(`props_observations?select=id,platform,provider_event_id,home_team,away_team,commence_time,lock_at,player_name,stat,line,provider_last_update&id=${inList([...preds.values()].map(p=>p.observation_id))}`)):new Map();
const results=obs.size?await get(`props_line_results?select=observation_id,revision,actual,outcome,player_game_id,graded_at&observation_id=${inList([...obs.keys()])}&order=revision.desc`):[];
const latest=new Map();for(const r of results)if(!latest.has(Number(r.observation_id)))latest.set(Number(r.observation_id),r);
const links=obs.size?byId(await get(`props_game_links?select=provider_event_id,espn_event_id,home_abbr,away_abbr&provider_event_id=${inList([...obs.values()].map(o=>`"${o.provider_event_id}"`))}`),'provider_event_id'):new Map();
// Box scores: the latest revision per (event, athlete) for each leg's player.
const pgIds=[...latest.values()].map(r=>r.player_game_id).filter(Boolean);
const pgById=pgIds.length?byId(await get(`props_player_games?select=id,source,espn_event_id,athlete_id,athlete_name,team_abbr,game_status,did_not_play,minutes,points,rebounds,assists,retrieved_at,revision&id=${inList(pgIds)}`)):new Map();
const athleteIds=[...preds.values()].map(p=>p.athlete_id).filter(Boolean);
const espnIds=[...links.values()].map(l=>l.espn_event_id);
const allPg=athleteIds.length&&espnIds.length?await get(`props_player_games?select=id,source,espn_event_id,athlete_id,athlete_name,team_abbr,game_status,did_not_play,minutes,points,rebounds,assists,retrieved_at,revision&athlete_id=${inList(athleteIds)}&espn_event_id=${inList(espnIds.map(x=>`"${x}"`))}&order=revision.desc`):[];
const settlements=ids.length?byId(await get(`props_entry_settlements?select=entry_id,outcome,wins,losses,voids,multiplier_milli,return_cents,profit_cents,payout_terms_version,settled_at&entry_id=${inList(ids)}`),'entry_id'):new Map();

out.entries=entries.map(e=>{
 const a=acc.get(Number(e.account_id));
 const L=legs.filter(l=>Number(l.entry_id)===Number(e.id)).map(l=>{
  const p=picks.get(Number(l.pick_id)),pr=p&&preds.get(Number(p.prediction_id)),o=pr&&obs.get(Number(pr.observation_id));
  const res=o&&latest.get(Number(o.id)),link=o&&links.get(o.provider_event_id);
  // Prefer the box-score row the grade used; otherwise the newest row for that player and game (evidence check).
  const game=(res?.player_game_id&&pgById.get(Number(res.player_game_id)))||allPg.find(g=>link&&g.espn_event_id===link.espn_event_id&&g.athlete_id===pr?.athlete_id)||null;
  const rg=o?regrade(o,game):{state:'MISSING_LINE'};
  return {pickId:Number(l.pick_id),side:p?.side??null,pickDecidedAt:p?.decided_at??null,selection:p?.selection_version??null,
   model:pr?.model_version??null,pSide:pr?(p.side==='more'?Number(pr.p_more):Number(pr.p_less)):null,mean:pr?.mean===null||pr?.mean===undefined?null:Number(pr.mean),
   player:o?.player_name??null,stat:o?.stat??null,line:o?Number(o.line):null,game:o?`${o.away_team} @ ${o.home_team}`:null,lockAt:o?.lock_at??null,
   stored:res?{outcome:res.outcome,actual:res.actual===null?null:Number(res.actual),revision:res.revision,gradedAt:res.graded_at}:null,
   boxScore:game?{source:game.source,status:game.game_status,dnp:game.did_not_play,minutes:game.minutes===null?null:Number(game.minutes),
    points:game.points,rebounds:game.rebounds,assists:game.assists,retrievedAt:game.retrieved_at,revision:game.revision}:null,
   regrade:rg,leg:rg.state==='graded'&&p?.side?legOf(p.side,rg.outcome):null};
 });
 const s=settlements.get(Number(e.id))??null;
 const audit=auditEntry({...e,platform:a?.platform,settlement:s},L,settleEntry);
 return {id:e.id,account:a?.slug,platform:a?.platform,stake:Number(e.stake_cents),created:e.created_at,lock:e.lock_at,run:e.run_id,
  settlement:s,audit,legs:L};
});

// Bankrolls and graded record, from all settlements and all recorded picks (latest result revision).
const allEntries=await get('props_entries?select=id,account_id,stake_cents,created_at&order=id.asc&limit=5000');
const allSet=byId(await get('props_entry_settlements?select=entry_id,outcome,profit_cents&limit=5000'),'entry_id');
out.bankrolls=accounts.map(a=>{const mine=allEntries.filter(e=>Number(e.account_id)===Number(a.id));
 const settled=mine.filter(e=>allSet.has(Number(e.id)));const known=settled.filter(e=>allSet.get(Number(e.id)).profit_cents!==null);
 const profit=known.reduce((s,e)=>s+Number(allSet.get(Number(e.id)).profit_cents),0);
 const rec={won:0,lost:0,refund:0,payout_unknown:0};for(const e of settled)rec[allSet.get(Number(e.id)).outcome]=(rec[allSet.get(Number(e.id)).outcome]??0)+1;
 const staked=known.reduce((s,e)=>s+Number(e.stake_cents),0);
 return {account:a.slug,selection:a.selection_version,entries:mine.length,settled:settled.length,open:mine.length-settled.length,record:rec,
  profitCents:profit,stakedCents:staked,roi:staked?profit/staked:null,bankrollCents:Number(a.initial_cents)+profit,initialCents:Number(a.initial_cents)};});
const recPicks=await get('props_picks?select=id,prediction_id,side,selection_version,decided_at&status=eq.recorded&order=id.asc&limit=5000');
const rp=recPicks.length?byId(await get(`props_predictions?select=id,observation_id,model_version,p_more,p_less&id=${inList(recPicks.map(p=>p.prediction_id))}`)):new Map();
const rObs=rp.size?byId(await get(`props_observations?select=id,platform,stat,line,lock_at&id=${inList([...rp.values()].map(p=>p.observation_id))}`)):new Map();
const rRes=rObs.size?await get(`props_line_results?select=observation_id,revision,outcome&observation_id=${inList([...rObs.keys()])}&order=revision.desc`):[];
const rLatest=new Map();for(const r of rRes)if(!rLatest.has(Number(r.observation_id)))rLatest.set(Number(r.observation_id),r);
const tally={};
for(const p of recPicks){const pr=rp.get(Number(p.prediction_id)),o=pr&&rObs.get(Number(pr.observation_id)),r=o&&rLatest.get(Number(o.id));
 const k=`${p.selection_version}|${pr?.model_version}`;const t=tally[k]??={recorded:0,graded:0,hits:0,misses:0,voids:0,pending:0,brierSum:0,byStat:{},bySide:{}};
 t.recorded++;
 if(!r){t.pending++;continue;}
 const leg=legOf(p.side,r.outcome);if(leg==='void'){t.voids++;continue;}
 t.graded++;const hit=leg==='win';hit?t.hits++:t.misses++;
 const q=p.side==='more'?Number(pr.p_more):Number(pr.p_less);t.brierSum+=(q-(hit?1:0))**2;
 for(const [m,key] of [[t.byStat,o.stat],[t.bySide,p.side]]){const b=m[key]??={graded:0,hits:0,meanP:0};b.graded++;if(hit)b.hits++;b.meanP+=q;}
}
for(const t of Object.values(tally)){t.hitRate=t.graded?t.hits/t.graded:null;t.brier=t.graded?t.brierSum/t.graded:null;delete t.brierSum;
 for(const m of [t.byStat,t.bySide])for(const b of Object.values(m)){b.hitRate=b.hits/b.graded;b.meanP=b.meanP/b.graded;}}
out.pickRecord=tally;
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
