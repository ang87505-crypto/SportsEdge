import {OWNER_COOKIE,ownerSecret,validOwnerSession,secureTextEquals} from './alpaca-owner-session.ts';
import {kalshiPlatformStore,type KalshiPlatformStore} from './kalshi-platform-store.ts';
import {loadKalshiPlatformView} from './kalshi-platform-view.ts';
import {runKalshiPlatform,kalshiSchemaReady,platformCode,type SavedForecast} from './kalshi-platform-worker.ts';
import {kalshiDemoClient,type KalshiDemoClient} from './kalshi-demo-client.ts';
import {reconcileKalshiDemo,startKalshiDemo,stopKalshiDemo,runKalshiDemo} from './kalshi-demo-worker.ts';
import {buildKalshiFixtureReplay} from '../prediction-markets/kalshi/paper-fixture.ts';
import {verifyContractForecast} from '../prediction-markets/kalshi/contract-grade.ts';
export {OWNER_COOKIE};
type Request={url:string;ownerCookie?:string;origin?:string|null;body?:unknown;readBody?:()=>Promise<unknown>};
export type KalshiOwnerDeps={env?:Readonly<Record<string,string|undefined>>;now?:()=>number;
 store?:()=>KalshiPlatformStore;demo?:()=>KalshiDemoClient;run?:typeof runKalshiPlatform};
const reply=(status:number,body:unknown)=>({status,body});
function authorized(req:Request,d:KalshiOwnerDeps){
 const secret=d.env?.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY??ownerSecret();
 return !!secret&&/^[a-f0-9]{64}$/i.test(secret)&&validOwnerSession(req.ownerCookie,secret,(d.now??Date.now)());
}
export async function handleKalshiOwnerGet(req:Request,deps:KalshiOwnerDeps={}){
 if(!authorized(req,deps))return reply(401,{status:'OWNER_SIGN_IN_REQUIRED'});
 try{return reply(200,await loadKalshiPlatformView((deps.store??(()=>kalshiPlatformStore(deps.env)))(),new Date((deps.now??Date.now)()).toISOString(),deps.env));}
 catch(e){return reply(503,{status:'UNAVAILABLE',code:platformCode(e)});}
}
export async function handleKalshiOwnerPost(req:Request,deps:KalshiOwnerDeps={}){
 if(!authorized(req,deps))return reply(401,{status:'OWNER_SIGN_IN_REQUIRED'});
 try{if(!req.origin||new URL(req.origin).origin!==new URL(req.url).origin)return reply(403,{status:'SAME_ORIGIN_REQUIRED'});}
 catch{return reply(403,{status:'SAME_ORIGIN_REQUIRED'});}
 let body:unknown;try{body=req.readBody?await req.readBody():req.body;}catch{return reply(400,{status:'INVALID_REQUEST'});}
 if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{status:'INVALID_REQUEST'});
 const action=(body as {action?:unknown}).action;
 const allowed=['run-worker','offline-check','check-demo','start-demo','stop-demo','smoke-demo'];
 if(typeof action!=='string'||!allowed.includes(action))return reply(400,{status:'INVALID_ACTION'});
 try{
  const store=(deps.store??(()=>kalshiPlatformStore(deps.env)))();await kalshiSchemaReady(store);
  const now=()=>new Date((deps.now??Date.now)()).toISOString();
  const demo=deps.demo??(()=>kalshiDemoClient(deps.env));
  let result:unknown;
  if(action==='run-worker')result=await (deps.run??runKalshiPlatform)(store,{slot:'owner-'+now(),env:deps.env,now});
  else if(action==='offline-check'){
   const fixture=buildKalshiFixtureReplay();
   const revision=await store.rpc<number>('kalshi_save_fixture_ledger',{p_study:'synthetic-weather-account',p_expected_revision:0,p_document:JSON.stringify(fixture.journal)});
   result={status:'SYNTHETIC_CHECK_RECORDED',revision,warning:fixture.warning};
  }else if(action==='stop-demo'){
   let client:KalshiDemoClient|undefined;try{client=demo();}catch{}
   result=await stopKalshiDemo(store,client);
  }else if(action==='check-demo')result=await reconcileKalshiDemo(store,demo());
  else if(action==='start-demo')result=await startKalshiDemo(store,demo());
  else{
   const [latest]=await store.select<SavedForecast>('kalshi_contract_forecasts','select=*&order=target_date.desc&limit=1');
   if(!latest)throw Error('KALSHI_RUN_WORKER_FIRST');
   const forecast=verifyContractForecast(JSON.parse(latest.document));
   result=await runKalshiDemo(store,demo(),{forecast,training:[],kind:'SMOKE',now:deps.now});
  }
  return reply(200,{status:'RECORDED',action,result});
 }catch(e){return reply(503,{status:'UNAVAILABLE',code:platformCode(e)});}
}
/** Kept separate from owner actions: a scheduler can never Start or run a smoke order. */
export async function handleKalshiTick(req:{authorization?:string|null},deps:KalshiOwnerDeps={}){
 const env=deps.env??process.env,secret=env.CRON_SECRET;
 if(!secret||!req.authorization||!secureTextEquals(req.authorization,'Bearer '+secret))return reply(401,{status:'SCHEDULER_AUTH_REQUIRED'});
 if(env.SPORTSEDGE_PREVIEW_FIXTURES==='1')return reply(503,{status:'PREVIEW_FIXTURES'});
 const now=()=>new Date((deps.now??Date.now)()).toISOString();
 try{
  const result=await (deps.run??runKalshiPlatform)((deps.store??(()=>kalshiPlatformStore(env)))(),{
   slot:'tick-'+now().slice(0,13)+':00',env,now});
  return reply(200,result);
 }catch(e){return reply(503,{status:'UNAVAILABLE',code:platformCode(e)});}
}
