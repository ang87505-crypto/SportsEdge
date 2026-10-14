import {NextRequest} from 'next/server';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';
import {inspectFirstPaperOrder,PreflightError} from '@/lib/server/alpaca-first-order-preflight';
export const maxDuration=60;
const HEADERS={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,headers:HEADERS});
/** Read-only owner initiated preflight. No POST action, no approval, no broker orders. */
export async function GET(req:NextRequest){
 const secret=ownerSecret();
 if(!secret||!validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret))
  return json({status:'owner_access_required'},401);
 const url=new URL(req.url);
 if(url.search.length>65||url.searchParams.size!==2||
    [...url.searchParams.keys()].some(k=>k!=='symbol'&&k!=='limitCents')||
    url.searchParams.getAll('symbol').length!==1||
    url.searchParams.getAll('limitCents').length!==1)
  return json({status:'invalid_request'},400);
 const symbol=url.searchParams.get('symbol');
 const cents=url.searchParams.get('limitCents');
 if(!symbol||!/^[A-Z]{1,5}$/.test(symbol)||
    !cents||!/^[1-9]\d{0,3}$/.test(cents)||Number(cents)>2500)
  return json({status:'invalid_request'},400);
 const keyId=process.env.ALPACA_PAPER_KEY_ID,secretKey=process.env.ALPACA_PAPER_SECRET_KEY;
 if(!keyId||!secretKey)return json({status:'paper_connection_unavailable'},503);
 try{
  const report=await inspectFirstPaperOrder(symbol,Number(cents),{keyId,secretKey});
  return json(report);
 }catch(e){
  return json({status:'paper_preflight_unavailable',
   reason:e instanceof PreflightError?e.code:'BROKER_READ_UNVERIFIED',
   brokerOrderSubmitted:false,executionPermitted:false},503);
 }
}
