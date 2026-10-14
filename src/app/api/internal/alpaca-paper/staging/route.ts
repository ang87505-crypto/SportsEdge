import {NextRequest} from 'next/server';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';
import {getStagingPaperStatus,haltStagingPaperExecution,StagingPaperError}
 from '@/lib/server/alpaca-staging-operator';

export const maxDuration=30;
const NO_STORE={
 'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'
};
function json(body:Record<string,unknown>,status=200){
 return Response.json(body,{status,headers:NO_STORE});
}
function authorized(req:NextRequest):boolean{
 const secret=ownerSecret();
 return !!secret&&validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret);
}
function handleError(e:unknown){
 return json({status:'staging_control_unavailable',
  reason:e instanceof StagingPaperError?e.code:'UNEXPECTED',
  orderSubmissionEnabled:false,executionPermitted:false},503);
}
/** OWNER-ONLY read-only staging receipt and STOP status.
 * Never returns broker balances, owner credentials or raw outbox identifiers.
 */
export async function GET(req:NextRequest){
 if(!authorized(req))return json({status:'owner_access_required'},401);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 try{return json({status:'staging_read_only',data:await getStagingPaperStatus()});}
 catch(error){return handleError(error);}
}
/** OWNER-ONLY one-way STAGING emergency stop. Not an Alpaca order.
 * Deliberately no resume, start, approve or schedule action.
 */
export async function POST(req:NextRequest){
 if(!authorized(req))return json({status:'owner_access_required'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({status:'origin_rejected'},403);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 if(req.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
  return json({status:'invalid_request'},400);
 let action:unknown;
 try {
  const raw=await req.text();
  if(raw.length>48)return json({status:'invalid_request'},400);
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.keys(data).length!==1)return json({status:'invalid_request'},400);
  action=(data as Record<string,unknown>).action;
 }catch{return json({status:'invalid_request'},400);}
 if(action!=='halt')return json({status:'invalid_request'},400);
 try{return json({status:'staging_halted',data:await haltStagingPaperExecution()});}
 catch(error){return handleError(error);}
}
