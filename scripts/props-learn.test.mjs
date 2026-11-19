// CLI guard rails for the learning worker: no network, no credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const run=(args,env={})=>{
 const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',new URL('./props-learn.ts',import.meta.url).pathname,...args],
  {env:{PATH:process.env.PATH,...env},encoding:'utf8'});
 return {code:r.status,out:JSON.parse(r.stdout.trim().split('\n').pop()||'{}')};
};

test('unknown kinds print usage',()=>{
 const r=run(['dance']);
 assert.equal(r.code,2);assert.equal(r.out.status,'USAGE');
});

test('a scheduled run refuses owner actions before reading any configuration',()=>{
 for(const kind of ['learning_on','learning_off','auto_on','auto_off','approve','rollback']){
  const r=run([kind,'--reason','x'],{GITHUB_EVENT_NAME:'schedule'});
  assert.equal(r.code,1,kind);assert.equal(r.out.status,'OWNER_ACTION_NOT_SCHEDULABLE');
 }
});

test('owner actions need a reason; approve needs a version',()=>{
 assert.equal(run(['rollback']).out.status,'USAGE');
 assert.equal(run(['approve','--reason','ok']).out.status,'USAGE');
});

test('without the props database settings it stops and says so',()=>{
 const r=run(['evaluate']);
 assert.equal(r.code,1);assert.equal(r.out.status,'NOT_CONFIGURED');
});

test('training without the pinned history files stops before any write',()=>{
 const r=run(['train'],{SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'});
 assert.equal(r.code,1);assert.equal(r.out.status,'HISTORY_NOT_CONFIGURED');
});
