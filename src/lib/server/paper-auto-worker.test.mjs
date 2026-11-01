// The worker CLI's owner commands refuse before any network call. Synthetic settings only;
// the proxy is pointed at a closed port so an accidental request would fail loudly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const WORKER=fileURLToPath(new URL('../../../scripts/paper-auto-worker.ts',import.meta.url));
const SETTINGS={SPORTSEDGE_STAGING_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',
 SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY:'synthetic-service-key-for-tests-0001',
 ALPACA_PAPER_AUTO_KEY_ID:'PKSYNTHETIC0000001',ALPACA_PAPER_AUTO_SECRET_KEY:'synthetic-secret-0001'};
const OWNER={SPORTSEDGE_PAPER_AUTO_OWNER_REF:'owner-'+'a'.repeat(32)};
function run(args,env={}){
 const base=Object.fromEntries(Object.entries(process.env).filter(([k])=>
  !/^(SPORTSEDGE_|ALPACA_|GITHUB_EVENT_NAME$)/.test(k)));
 const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',WORKER,...args],
  {encoding:'utf8',env:{...base,HTTPS_PROXY:'http://127.0.0.1:9',HTTP_PROXY:'http://127.0.0.1:9',...env},timeout:30_000});
 const line=r.stdout.trim().split('\n').at(-1);
 // No credential, service key or owner reference ever reaches the job log.
 for(const secret of [...Object.values(SETTINGS),OWNER.SPORTSEDGE_PAPER_AUTO_OWNER_REF].filter(v=>!v.startsWith('https:')))
  assert.ok(!r.stdout.includes(secret)&&!r.stderr.includes(secret),'leaked a configured secret');
 return {code:r.status,out:JSON.parse(line)};
}

test('owner commands need the owner reference and never run from a schedule',()=>{
 let r=run(['register','--experiment','fwd-2026-baseline'],SETTINGS);
 assert.deepEqual([r.code,r.out.status],[1,'OWNER_REF_REQUIRED']);
 r=run(['confirm-absent','--experiment','fwd-2026-baseline'],{...SETTINGS,...OWNER,GITHUB_EVENT_NAME:'schedule'});
 assert.deepEqual([r.code,r.out.status],[1,'OWNER_ACTION_NOT_SCHEDULABLE']);
 r=run(['resume','--experiment','fwd-2026-baseline'],SETTINGS);
 assert.deepEqual([r.code,r.out.status],[1,'OWNER_REF_REQUIRED']);
 r=run(['resume','--experiment','fwd-2026-baseline'],{...SETTINGS,...OWNER,GITHUB_EVENT_NAME:'schedule'});
 assert.deepEqual([r.code,r.out.status],[1,'OWNER_ACTION_NOT_SCHEDULABLE']);
 r=run(['register','--experiment','../etc'],{...SETTINGS,...OWNER});
 assert.deepEqual([r.code,r.out.status],[2,'USAGE']);
});

test('registration reads only the reviewed config for that experiment, before any broker call',()=>{
 const r=run(['register','--experiment','fwd-test-no-config'],{...SETTINGS,...OWNER});
 assert.deepEqual([r.code,r.out.status],[1,'REGISTRATION_CONFIG_INVALID']);
 const c=run(['confirm-absent','--experiment','fwd-2026-baseline','--intent','pai-xyz'],{...SETTINGS,...OWNER});
 assert.deepEqual([c.code,c.out.status],[2,'USAGE']);
 const s=run(['register','--experiment','fwd-2026-baseline'],OWNER);
 assert.deepEqual([s.code,s.out.status],[1,'NOT_CONFIGURED']);
});

test('each experiment uses only its own account keys, with no fallback to another pair',async()=>{
 const {paperAutoKeys}=await import('./paper-auto-accounts.ts');
 const env={ALPACA_PAPER_AUTO_KEY_ID:'PK1',ALPACA_PAPER_AUTO_SECRET_KEY:'s1'};
 assert.deepEqual(paperAutoKeys('stock-v2-weekly-1',env),{pair:1,keyId:'PK1',secretKey:'s1',configured:true});
 assert.deepEqual(paperAutoKeys('stock-v3-steady-weekly-1',env),{pair:2,keyId:'',secretKey:'',configured:false});
 const both={...env,ALPACA_PAPER_AUTO_2_KEY_ID:'PK2',ALPACA_PAPER_AUTO_2_SECRET_KEY:'s2'};
 assert.deepEqual(paperAutoKeys('stock-v3-steady-weekly-1',both),{pair:2,keyId:'PK2',secretKey:'s2',configured:true});
 assert.equal(paperAutoKeys('stock-v2-weekly-1',both).keyId,'PK1');
 assert.equal(paperAutoKeys('constructor',both).pair,1,'only listed experiments use pair 2');
});

test('a second account that is not set up yet: manual runs fail, scheduled runs skip quietly',()=>{
 let r=run(['execute','--experiment','stock-v3-steady-weekly-1'],SETTINGS);
 assert.deepEqual([r.code,r.out.status,r.out.keyPair,r.out.brokerCalls],[1,'NOT_CONFIGURED',2,0]);
 r=run(['monitor','--experiment','stock-v3-steady-weekly-1'],{...SETTINGS,GITHUB_EVENT_NAME:'schedule'});
 assert.deepEqual([r.code,r.out.status],[0,'NOT_CONFIGURED_SKIP']);
 r=run(['resume','--experiment','stock-v3-steady-weekly-1'],{...SETTINGS,...OWNER});
 assert.deepEqual([r.code,r.out.status],[1,'NOT_CONFIGURED'],'owner actions never borrow the first account');
});
