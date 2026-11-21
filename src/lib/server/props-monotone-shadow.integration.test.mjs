// Disposable PostgreSQL only. Synthetic identities and probabilities; never a real forward observation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import model from '../../data/props/model_v1.json' with {type:'json'};
import {pgFetch,psql,resetDb,testClockSql} from './props-pg-kit.mjs';
import {propsStore} from './props-store.ts';
import {recordMonotoneShadows} from './props-monotone-shadow.ts';
import {MONOTONE_SHADOW} from '../props/monotone-shadow.ts';
import {MODEL_VERSION} from '../props/contract.ts';

test('real PostgreSQL accepts the shadow once, preserves tie mass and source ID, and refuses a clock-crossed lock',
 {skip:process.env.PROPS_PG_TEST!=='1'&&'requires disposable local PostgreSQL'},async()=>{
 const db='props_monotone_it',dir=mkdtempSync(join(tmpdir(),'props-monotone-')),clockFile=join(dir,'clock.sql');
 writeFileSync(clockFile,testClockSql);
 resetDb(db,[new URL('../../../database/props/props_v1.sql',import.meta.url).pathname,clockFile]);
 let databaseNow='2026-11-23T20:00:00Z';const at=databaseNow,lock='2026-11-23T20:12:00Z';
 const store=propsStore({SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',
  SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'},pgFetch(db,()=>databaseNow));
 await store.rpc('props_set_control',{p_state:'RUNNING',p_reason:'synthetic test',p_actor:'owner-test'});
 const run=await store.rpc('props_begin_run',{p_kind:'collect',p_slot:'monotone_TEST',p_worker:'test:monotone',p_scheduled_for:null,p_lease_seconds:900});
 assert.equal(run.outcome,'STARTED');const runId=run.runId;
 const [raw]=await store.insert('props_raw_responses',[{run_id:runId,source:'the_odds_api',endpoint:'event_odds',
  external_id:'evtTESTmonotone',http_status:200,received_at:at,content_sha256:'a'.repeat(64),body:{synthetic:true}}],{select:'id'});
 const [o]=await store.insert('props_observations',[{run_id:runId,raw_response_id:raw.id,provider:'the_odds_api',
  platform:'prizepicks',bookmaker_key:'prizepicks',provider_event_id:'evtTESTmonotone',home_team:'Test Home',away_team:'Test Away',
  commence_time:lock,lock_at:lock,player_name:'Test Player',stat:'points',market_key:'player_points',period:'full_game',line:22,
  provider_last_update:at,ingested_at:at,normalizer_version:'props-normalize-v1',response_sha256:'a'.repeat(64),source_fields:{synthetic:true}}],{select:'id'});
 const [p]=await store.insert('props_predictions',[{observation_id:o.id,run_id:runId,model_version:MODEL_VERSION,
  status:'scored',reason:'ok',athlete_id:'123',p_more:.72,p_less:.18,p_tie:.1,mean:23,data_cutoff:at,inputs:{synthetic:true}}],{select:'id'});
 const d={store,model,now:()=>at},baseline={id:p.id,observationId:o.id,status:'scored',athleteId:'123',
  pMore:.72,pLess:.18,pTie:.1,mean:23,dataCutoff:at},observation={id:o.id,stat:'points',lockAt:lock};
 assert.equal((await recordMonotoneShadows(d,runId,[baseline],[observation])).written,1);
 assert.equal((await recordMonotoneShadows(d,runId,[baseline],[observation])).written,0);
 const saved=await store.select('props_predictions','select=id,p_more,p_less,p_tie,inputs,predicted_at&model_version=eq.'+MONOTONE_SHADOW.model);
 assert.equal(saved.length,1);assert.equal(saved[0].p_tie,.1);assert.equal(saved[0].inputs.baselinePredictionId,p.id);
 assert.ok(Math.abs(saved[0].p_more+saved[0].p_less+saved[0].p_tie-1)<1e-12);
 assert.equal(Date.parse(saved[0].predicted_at),Date.parse(at));
 assert.equal((await store.select('props_picks','select=id')).length,0);
 assert.equal((await store.select('props_entries','select=id')).length,0);
 databaseNow=lock;const refused=await recordMonotoneShadows(d,runId,[baseline],[observation]);
 assert.equal(refused.status,'ATTENTION');assert.equal(refused.code,'PROPS_PREDICTION_AFTER_LOCK');
 const immutable=psql(db,'SET ROLE service_role; UPDATE public.props_predictions SET p_more=0.1;');
 assert.equal(immutable.ok,false);
});
