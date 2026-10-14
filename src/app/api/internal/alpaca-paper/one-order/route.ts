import {NextRequest} from 'next/server';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';
import {inspectFirstPaperOrder} from '@/lib/server/alpaca-first-order-preflight';
import {performOwnerOneOrder,oneShotStatus} from '@/lib/server/alpaca-owner-first-order';
import {PAPER_AUTOMATION_RELEASE} from '@/lib/stocks/paper-automation-release';

export const maxDuration=60;
const HDR={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const json=(data:Record<string,unknown>,status=200)=>Response.json(data,{status,headers:HDR});
function owner(req:NextRequest){
 const secret=ownerSecret();
 return !!secret&&validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret);
}
/** This is the only explicitly approved one-order release. Never Production. */
function ownerOneOrderReleased(){
 return PAPER_AUTOMATION_RELEASE.paperOnly===true &&
   Boolean(PAPER_AUTOMATION_RELEASE.manualOwnerOneShotEnabled) &&
   PAPER_AUTOMATION_RELEASE.placeOrdersEnabled===false &&
   PAPER_AUTOMATION_RELEASE.scheduledOrdersEnabled===false &&
   PAPER_AUTOMATION_RELEASE.realMoneyEnabled===false &&
   process.env.VERCEL_ENV==='preview' &&
   process.env.VERCEL_GIT_COMMIT_REF==='acceptance/alpaca-paper-first-order';
}
export async function GET(req:NextRequest){
 if(!owner(req))return json({status:'owner_access_required'},401);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 try{return json({stage:await oneShotStatus(),oneShotReleaseReady:ownerOneOrderReleased()});}
 catch{return json({status:'staging_unavailable',oneShotReleaseReady:false},503);}
}
export async function POST(req:NextRequest){
 if(!owner(req))return json({status:'owner_access_required'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)
  return json({status:'origin_rejected'},403);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 if(!ownerOneOrderReleased())return json({status:'one_order_release_off'},503);
 if(req.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
  return json({status:'invalid_request'},400);
 let request:unknown;
 try{
  const raw=await req.text();
  if(raw.length>160)return json({status:'invalid_request'},400);
  request=JSON.parse(raw) as unknown;
 }catch{return json({status:'invalid_request'},400);}
 if(!request||typeof request!=='object'||Array.isArray(request))
  return json({status:'invalid_request'},400);
 const x=request as Record<string,unknown>;
 if(Object.keys(x).length!==3||x.confirm!=='SUBMIT_ONE_ALPACA_PAPER_ORDER'||
  typeof x.symbol!=='string'||!/^[A-Z]{1,5}$/.test(x.symbol)||
  !Number.isSafeInteger(x.limitCents)||(x.limitCents as number)<1||
  (x.limitCents as number)>2500)
  return json({status:'invalid_request'},400);
 const keyId=process.env.ALPACA_PAPER_KEY_ID,secretKey=process.env.ALPACA_PAPER_SECRET_KEY;
 if(!keyId||!secretKey)return json({status:'paper_broker_not_configured'},503);
 try{
  // The POST never trusts the browser's displayed quote or earlier GET preview.
  // It fetches fresh broker account, all orders, market, asset and latest IEX.
  const p=await inspectFirstPaperOrder(x.symbol,x.limitCents,{keyId,secretKey});
  if(!p.quote||!p.marketOpen||p.staging!=='HALTED'||
   p.blockers.some(b=>![
    'STAGING_EMERGENCY_STOP_ENGAGED','NO_OWNER_APPROVED_EXECUTION_PATH',
    'NO_DURABLE_BROKER_ORDER_RELEASE'].includes(b)))
   return json({status:'paper_preflight_blocked',blockers:p.blockers,placed:false},409);
  const result=await performOwnerOneOrder(p,{keyId,secretKey});
  return json(result,result.status==='paper_broker_acknowledged'?200:503);
 }catch{
  // A transaction or network timeout can commit even when the caller loses
  // the response. DO NOT automatically resubmit or regenerate a new order.
  return json({status:'paper_order_state_unverified',
   checkFirstOrderStatus:true,retryAutomatically:false},503);
 }
}
